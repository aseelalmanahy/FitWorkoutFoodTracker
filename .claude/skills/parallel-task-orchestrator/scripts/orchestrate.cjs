#!/usr/bin/env node
// Bookkeeping for a parallel run. It launches nothing: the main session launches workers with Claude Code's own
// Agent tool, and this keeps the record of what's allowed to start, what happened, and whether work can be closed.
// Only the main session writes it, so there's one source of truth. Pure functions, with a thin command line below.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { route, loadPolicy } = require("../../intelligent-model-router/scripts/route.cjs");

const MAX_CONCURRENT = 3;
const MAX_ATTEMPTS = 3; // the first, one retry, then one on a stronger tier if the router moves it up
const STATUSES = new Set(["QUEUED", "RUNNING", "BLOCKED", "FAILED", "COMPLETED", "CANCELLED"]);
const FINISHED = new Set(["FAILED", "COMPLETED", "CANCELLED"]);
const ACTIVE_LIFECYCLE = new Set(["ASSIGNED", "STARTED", "RUNNING", "REPORTING"]);
const RETRYABLE = new Set(["crash", "context-limit", "tool-failure", "test-failure", "missing-report"]);
const NEEDS_A_PERSON = new Set(["permission-denied", "conflict", "model-unavailable", "needs-approval"]);
const READ_ONLY_AGENTS = new Set(["security-review-agent", "product-strategy-agent"]);
const FAILURE_KINDS = new Set([...RETRYABLE, ...NEEDS_A_PERSON]);

// ─── Files ──────────────────────────────────────────────────────────────────

const normalize = (p) => String(p).trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "").toLowerCase();
/** The part of a path or pattern before any wildcard. Comparing these errs toward "these overlap". */
const literalPrefix = (p) => normalize(p).split(/[*?[{]/)[0].replace(/\/+$/, "");
function pathsOverlap(a, b) {
  const [x, y] = [literalPrefix(a), literalPrefix(b)];
  if (x === "" || y === "") return true; // a pattern with no fixed part could match anything
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}
const ownsFile = (owns, file) => owns.some((o) => pathsOverlap(o, file));

// ─── Creating a run ─────────────────────────────────────────────────────────

/** Tasks in an order that respects dependencies, or the first cycle found. */
function topologicalOrder(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const order = [];
  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") throw new Error(`These tasks depend on each other in a cycle: ${[...trail, id].join(" -> ")}`);
    state.set(id, "visiting");
    for (const dep of byId.get(id).dependsOn) visit(dep, [...trail, id]);
    state.set(id, "done");
    order.push(id);
  };
  for (const t of tasks) visit(t.id, []);
  return order;
}

function dependsOnTransitively(tasks, from, to) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const stack = [...byId.get(from).dependsOn];
  const seen = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (id === to) return true;
    if (!seen.has(id)) { seen.add(id); stack.push(...byId.get(id).dependsOn); }
  }
  return false;
}

function applyRoute(task, { policy, project, availableTiers }) {
  const decision = route({ ...task.signals, failedAttempts: task.attempts, ...(availableTiers ? { availableTiers } : {}) }, { policy, project });
  task.tier = decision.tier;
  task.model = decision.model;
  task.reason = decision.reason;
  task.fallback = decision.fallback;
  task.independentReview = decision.independentReview;
  if (decision.execution === "delegate") {
    task.agent = decision.agent;
    task.runsIn = "worker";
    return;
  }
  task.agent = null;
  if (decision.execution === "main-session") {
    // Includes an approved restricted action, which never goes to a worker.
    task.runsIn = "main";
    return;
  }
  task.runsIn = "nobody";
  task.status = "BLOCKED";
  task.lifecycle = "NOT_STARTED";
  task.blockers = [decision.reason];
}

/** A worktree starts from the default branch unless told otherwise, so on another branch it wouldn't hold that branch's work. */
function worktreeBaseProblem({ head, defaultHead, baseRef }) {
  if (baseRef === "head") return null;
  if (head && defaultHead && head === defaultHead) return null;
  return "A worktree would start from the default branch, not this one. Run it in order instead, or have the owner set worktree.baseRef to head";
}

function createRun(input, { id = `run-${Date.now()}`, availableTiers, maxConcurrent = MAX_CONCURRENT, project = {}, policy = loadPolicy(), now = new Date().toISOString(), worktreeProblem = null } = {}) {
  if (!Array.isArray(input) || !input.length) throw new Error("A run needs at least one task.");
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new Error("maxConcurrent must be a positive whole number.");
  const ids = new Set();
  const tasks = input.map((raw) => {
    if (!raw.id || !raw.title) throw new Error("Each task needs an id and a title.");
    if (ids.has(raw.id)) throw new Error(`Duplicate task id: ${raw.id}`);
    ids.add(raw.id);
    return {
      id: raw.id, title: raw.title, goal: raw.goal ?? raw.title, signals: raw.signals ?? {}, owns: raw.owns ?? [], dependsOn: [...(raw.dependsOn ?? [])],
      isolation: raw.isolation === "worktree" ? "worktree" : "shared",
      status: "QUEUED", lifecycle: "NOT_STARTED", attempts: 0, launches: 0, agent: null, model: null, tier: null, runsIn: null,
      agentId: null, result: null, tests: null, blockers: [], actualModel: null, modelCheck: "not checked", startedAt: null, endedAt: null, failures: [], serializedAfter: [],
    };
  });
  for (const t of tasks) for (const dep of t.dependsOn) if (!ids.has(dep)) throw new Error(`Task ${t.id} depends on ${dep}, which doesn't exist.`);
  const order = topologicalOrder(tasks);
  const position = new Map(order.map((taskId, i) => [taskId, i]));

  for (const t of tasks) applyRoute(t, { policy, project, availableTiers });
  if (worktreeProblem) {
    for (const t of tasks) {
      if (t.isolation === "worktree" && t.runsIn === "worker") {
        t.status = "BLOCKED";
        t.blockers = [worktreeProblem];
      }
    }
  }
  for (const t of tasks) {
    if (READ_ONLY_AGENTS.has(t.agent) && t.owns.length) {
      throw new Error(`Task ${t.id} goes to ${t.agent}, which is read-only, so it can't own files.`);
    }
  }

  // Two tasks wanting the same file run one after the other, in dependency order, even in separate worktrees.
  const writers = tasks.filter((t) => t.owns.length).sort((a, b) => position.get(a.id) - position.get(b.id));
  for (let i = 0; i < writers.length; i++) {
    for (let j = i + 1; j < writers.length; j++) {
      const [first, second] = [writers[i], writers[j]];
      if (!first.owns.some((a) => second.owns.some((b) => pathsOverlap(a, b)))) continue;
      if (!dependsOnTransitively(tasks, second.id, first.id)) {
        second.dependsOn.push(first.id);
        second.serializedAfter.push(first.id);
      }
    }
  }
  return { id, createdAt: now, maxConcurrent, availableTiers: availableTiers ?? null, tasks, events: [{ at: now, event: "created", tasks: tasks.length }] };
}

// ─── Moving a run forward ───────────────────────────────────────────────────

const taskOf = (run, id) => {
  const task = run.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`No task ${id} in this run.`);
  return task;
};
const log = (run, event, id, detail, now) => run.events.push({ at: now ?? new Date().toISOString(), event, task: id, ...(detail ? { detail } : {}) });
const activeWorkers = (run) => run.tasks.filter((t) => t.runsIn === "worker" && ACTIVE_LIFECYCLE.has(t.lifecycle));

/** The prompt each worker gets. Spelled out in full, as a worktree worker may not load the project's CLAUDE.md. */
function workerPrompt(task, run) {
  const finished = task.dependsOn.map((id) => taskOf(run, id)).filter((d) => d.result).map((d) => `- ${d.id}: ${d.result}`);
  return [
    `You are worker ${task.id} in run ${run.id}. The main session coordinates this run, and you report to it.`,
    "",
    `GOAL: ${task.goal}`,
    "",
    task.owns.length ? `FILES YOU MAY CHANGE, and no others:\n${task.owns.map((f) => `- ${f}`).join("\n")}` : "YOU MAY CHANGE NO FILES. This task only reads.",
    ...(finished.length ? ["", "FINISHED BEFORE YOU:", ...finished] : []),
    "",
    "RULES:",
    "- Other workers may be running. If you need a file you don't own, stop and report it as a blocker. Don't change it.",
    "- Never apply migrations, run seeds, deploy, merge, push, force-push, commit, or touch production, fitdb, fitdb_test_other or Claude's settings. Those stay with the main session and the owner's explicit approval.",
    "- A refusal from the guard or a denied permission is final. Report it, and don't look for another way.",
    "- Report only what you did and saw. Don't claim a test passed unless you saw it pass.",
    "",
    "END YOUR REPLY with exactly this, on its own lines, with valid JSON:",
    "WORKER-REPORT",
    '{"status":"completed or failed or blocked","summary":"one or two sentences","filesChanged":[],"tests":"what you ran and the result, or none","blockers":[]}',
  ].join("\n");
}

/**
 * What may start now. Only tasks whose dependencies finished, up to the limit, and never one whose files overlap
 * a running worker's. Tasks that can never start are marked, so nothing waits silently.
 */
function next(run, { now } = {}) {
  for (const t of run.tasks) {
    if (t.status !== "QUEUED" || t.lifecycle !== "NOT_STARTED") continue;
    const stuck = t.dependsOn.map((id) => taskOf(run, id)).filter((d) => ["FAILED", "CANCELLED", "BLOCKED"].includes(d.status));
    if (stuck.length) {
      t.status = "BLOCKED";
      t.blockers = stuck.map((d) => `Waiting on ${d.id}, which is ${d.status}`);
      log(run, "blocked-by-dependency", t.id, t.blockers.join("; "), now);
    }
  }
  const launch = [];
  const inMain = [];
  const ready = run.tasks.filter((t) => t.status === "QUEUED" && t.lifecycle === "NOT_STARTED" && t.dependsOn.every((id) => taskOf(run, id).status === "COMPLETED"));
  for (const t of ready) {
    if (t.runsIn === "main") { inMain.push(t.id); continue; }
    const active = activeWorkers(run);
    if (active.length >= run.maxConcurrent) break;
    if (active.some((a) => a.owns.some((f) => t.owns.some((g) => pathsOverlap(f, g))))) continue;
    t.lifecycle = "ASSIGNED";
    t.launches += 1;
    log(run, "assigned", t.id, `${t.agent} on ${t.model}`, now);
    launch.push({ id: t.id, subagent_type: t.agent, model: t.model, description: t.title, isolation: t.isolation, prompt: workerPrompt(t, run) });
  }
  return { launch, inMain, waiting: run.tasks.filter((t) => t.status === "QUEUED" && t.lifecycle === "NOT_STARTED" && !inMain.includes(t.id)).map((t) => t.id) };
}

function started(run, id, agentId, { now = new Date().toISOString() } = {}) {
  const t = taskOf(run, id);
  if (t.lifecycle !== "ASSIGNED") throw new Error(`${id} can't start from ${t.lifecycle}.`);
  t.lifecycle = "RUNNING";
  t.status = "RUNNING";
  t.agentId = agentId ?? null;
  t.startedAt = now;
  log(run, "started", id, agentId, now);
}

function parseReport(text) {
  const at = String(text ?? "").lastIndexOf("WORKER-REPORT");
  if (at < 0) return null;
  const match = String(text).slice(at + "WORKER-REPORT".length).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const report = JSON.parse(match[0]);
    if (!["completed", "failed", "blocked"].includes(report.status) || typeof report.summary !== "string") return null;
    return { status: report.status, summary: report.summary, filesChanged: Array.isArray(report.filesChanged) ? report.filesChanged.map(String) : [], tests: report.tests == null ? "none" : String(report.tests), blockers: Array.isArray(report.blockers) ? report.blockers.map(String) : [] };
  } catch {
    return null;
  }
}

/** A failure always leaves a record. Only some kinds are retried, and no retry changes a permission. */
function fail(run, id, kind, detail, { now = new Date().toISOString(), policy = loadPolicy(), project = {} } = {}) {
  if (!FAILURE_KINDS.has(kind)) throw new Error(`Unknown failure kind: ${kind}`);
  const t = taskOf(run, id);
  if (FINISHED.has(t.status)) throw new Error(`${id} has already finished as ${t.status}.`);
  t.failures.push({ kind, detail: detail ?? "", at: now });
  t.endedAt = now;
  log(run, "failure", id, `${kind}: ${detail ?? ""}`, now);
  if (NEEDS_A_PERSON.has(kind)) {
    t.status = "BLOCKED";
    t.lifecycle = "REPORTING";
    t.blockers = [`${kind}: ${detail ?? "no detail"}`];
    return { action: "needs-the-main-session" };
  }
  t.attempts += 1;
  if (t.attempts >= MAX_ATTEMPTS) {
    t.status = "FAILED";
    t.lifecycle = "REPORTING";
    t.blockers = [`Failed ${t.attempts} times. Last: ${kind}`];
    return { action: "gave-up" };
  }
  applyRoute(t, { policy, project, availableTiers: run.availableTiers ?? undefined });
  if (t.runsIn !== "worker") {
    if (t.status !== "BLOCKED") { t.status = "BLOCKED"; t.blockers = [`Retry needs the main session: ${kind}`]; }
    t.lifecycle = "REPORTING";
    return { action: "needs-the-main-session" };
  }
  t.status = "QUEUED";
  t.lifecycle = "NOT_STARTED";
  t.agentId = null;
  t.blockers = [];
  return { action: "retry", tier: t.tier, agent: t.agent };
}

/** Takes the worker's final reply. A reply with no report is a failure, and never a silent success. */
function report(run, id, text, { now = new Date().toISOString(), policy, project } = {}) {
  const t = taskOf(run, id);
  if (t.lifecycle !== "RUNNING") throw new Error(`${id} can't report from ${t.lifecycle}.`);
  const parsed = parseReport(text);
  if (!parsed) return { ...fail(run, id, "missing-report", "The reply had no readable WORKER-REPORT", { now, policy, project }), recorded: false };
  t.lifecycle = "REPORTING";
  t.result = parsed.summary;
  t.tests = parsed.tests;
  t.filesChanged = parsed.filesChanged;
  t.endedAt = now;
  log(run, "reported", id, parsed.status, now);
  const strays = parsed.filesChanged.filter((f) => !ownsFile(t.owns, f));
  if (strays.length) {
    t.status = "BLOCKED";
    t.failures.push({ kind: "conflict", detail: strays.join(", "), at: now });
    t.blockers = [`Changed files it doesn't own: ${strays.join(", ")}`, ...parsed.blockers];
    return { action: "needs-the-main-session", recorded: true };
  }
  if (parsed.status === "completed") {
    t.status = "COMPLETED";
    t.lifecycle = "COMPLETED";
    t.blockers = parsed.blockers;
    return { action: "collected", recorded: true };
  }
  if (parsed.status === "blocked") {
    t.status = "BLOCKED";
    t.blockers = parsed.blockers.length ? parsed.blockers : ["The worker reported a blocker without details"];
    return { action: "needs-the-main-session", recorded: true };
  }
  t.lifecycle = "RUNNING";
  return { ...fail(run, id, "test-failure", parsed.blockers.join("; ") || parsed.summary, { now, policy, project }), recorded: true };
}

/** Records a stop. The worker itself is stopped with Claude Code's TaskStop tool, before or just after this. */
function cancel(run, id, reason, { now = new Date().toISOString() } = {}) {
  const t = taskOf(run, id);
  if (FINISHED.has(t.status)) throw new Error(`${id} has already finished as ${t.status}.`);
  t.status = "CANCELLED";
  t.lifecycle = "REPORTING";
  t.result = t.result ?? `Cancelled: ${reason}`;
  t.endedAt = now;
  log(run, "cancelled", id, reason, now);
}

/** The model the worker actually ran on, compared with the plan. A difference is shown, and never smoothed over. */
function recordModel(run, id, actual) {
  const t = taskOf(run, id);
  t.actualModel = actual ?? null;
  if (!actual) t.modelCheck = "unverified";
  else if (t.model === "inherit") t.modelCheck = "verified";
  else t.modelCheck = String(actual).toLowerCase().includes(String(t.model).toLowerCase()) ? "verified" : `MISMATCH: planned ${t.model}`;
  return t.modelCheck;
}

/** The last step. It needs a collected result or a failure record, so nothing closes without an account of it. */
function close(run, id, { now } = {}) {
  const t = taskOf(run, id);
  if (t.lifecycle === "CLOSED") return;
  if (["RUNNING", "ASSIGNED", "STARTED"].includes(t.lifecycle)) throw new Error(`${id} is still ${t.lifecycle}, so its report hasn't been collected.`);
  if (!t.result && !t.failures.length && t.status !== "BLOCKED") throw new Error(`${id} has no result or failure record.`);
  if (t.status === "QUEUED") throw new Error(`${id} is queued for a retry, so it can't close.`);
  t.lifecycle = "CLOSED";
  log(run, "closed", id, t.status, now);
}

/**
 * After an interrupted session. The docs don't say whether background workers survive that, so a task that was
 * underway is treated as unknown, and held. Nothing is relaunched automatically, as it could duplicate work.
 */
function markInterrupted(run, { now } = {}) {
  const held = [];
  for (const t of run.tasks) {
    if (ACTIVE_LIFECYCLE.has(t.lifecycle) && t.status !== "COMPLETED" && t.status !== "BLOCKED") {
      t.status = "BLOCKED";
      t.lifecycle = "REPORTING";
      t.blockers = ["Interrupted. Its state is unknown: check its transcript and owned files, then requeue or close it"];
      held.push(t.id);
      log(run, "interrupted", t.id, undefined, now);
    }
  }
  return held;
}

/** A decision by the main session, after checking. Never changes what the task may do. */
function requeue(run, id, { now } = {}) {
  const t = taskOf(run, id);
  if (t.status !== "BLOCKED" || t.runsIn === "nobody") throw new Error(`${id} can't be requeued from ${t.status}, running in ${t.runsIn}.`);
  t.status = "QUEUED";
  t.lifecycle = "NOT_STARTED";
  t.agentId = null;
  t.blockers = [];
  log(run, "requeued", id, undefined, now);
}

/** Compares what changed on disk with who owned it. Conflicts are reported, and nothing is reverted. */
function reconcile(run, changedFiles) {
  const unowned = [];
  const contested = [];
  const writers = run.tasks.filter((t) => t.owns.length);
  for (const file of changedFiles) {
    const owners = writers.filter((t) => ownsFile(t.owns, file)).map((t) => t.id);
    if (!owners.length) unowned.push(file);
    else if (owners.length > 1) contested.push({ file, owners });
  }
  const reported = new Map();
  for (const t of run.tasks) for (const f of t.filesChanged ?? []) reported.set(normalize(f), [...(reported.get(normalize(f)) ?? []), t.id]);
  const claimedByTwo = [...reported].filter(([, by]) => by.length > 1).map(([file, by]) => ({ file, by }));
  return { unowned, contested, claimedByTwo, clean: !unowned.length && !contested.length && !claimedByTwo.length };
}

/** A task the main session did itself, which used no worker or slot. */
function doneInMain(run, id, summary, { tests = "none", now } = {}) {
  const t = taskOf(run, id);
  if (t.runsIn !== "main" || t.status !== "QUEUED") throw new Error(`${id} isn't waiting for the main session.`);
  t.status = "COMPLETED";
  t.lifecycle = "CLOSED";
  t.result = summary;
  t.tests = tests;
  log(run, "done-in-main", id, undefined, now);
}

/** The final account. Refuses while anything is unaccounted for, so a worker can't quietly vanish from the report. */
function finish(run) {
  const open = run.tasks.filter((t) => t.status === "RUNNING" || t.status === "QUEUED");
  if (open.length) throw new Error(`Still open: ${open.map((t) => `${t.id} (${t.status})`).join(", ")}`);
  return { complete: run.tasks.every((t) => t.status === "COMPLETED"), counts: Object.fromEntries([...STATUSES].map((s) => [s, run.tasks.filter((t) => t.status === s).length])), metrics: metrics(run), tasks: run.tasks.map((t) => ({ id: t.id, status: t.status, agent: t.agent, model: t.model, actualModel: t.actualModel, modelCheck: t.modelCheck, result: t.result, tests: t.tests, blockers: t.blockers })) };
}

function metrics(run) {
  const timed = run.tasks.filter((t) => t.startedAt && t.endedAt).map((t) => [Date.parse(t.startedAt), Date.parse(t.endedAt)]);
  const sum = timed.reduce((total, [a, b]) => total + (b - a), 0);
  const wall = timed.length ? Math.max(...timed.map(([, b]) => b)) - Math.min(...timed.map(([a]) => a)) : 0;
  const events = [...timed.flatMap(([a, b]) => [[a, 1], [b, -1]])].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let current = 0, peak = 0;
  for (const [, delta] of events) { current += delta; peak = Math.max(peak, current); }
  const ids = run.tasks.map((t) => t.goal);
  return { workerLaunches: run.tasks.reduce((n, t) => n + t.launches, 0), failures: run.tasks.reduce((n, t) => n + t.failures.length, 0), duplicateTasks: ids.length - new Set(ids).size, peakConcurrent: peak, summedWorkerMs: sum, wallClockMs: wall };
}

function dashboard(run) {
  const cell = (v) => (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length) ? "-" : String(Array.isArray(v) ? v.join(", ") : v)).replace(/\|/g, "/").replace(/\s+/g, " ");
  const rows = run.tasks.map((t) => [
    t.id, t.runsIn === "main" ? "main session" : t.agent, t.actualModel ? `${t.actualModel} (${t.modelCheck})` : `${t.model ?? "none"} (planned)`,
    t.status, t.owns, t.dependsOn, t.result, t.tests, t.blockers,
  ].map(cell));
  const head = ["TASK ID", "WORKER", "MODEL", "STATUS", "FILES OWNED", "DEPENDENCIES", "RESULT", "TESTS", "BLOCKERS"];
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...rows.map(line)].join("\n");
}

/**
 * Whether a worktree can go. Anything uncertain keeps it: an error, a change, an untracked file, or a commit not on
 * its base. It only answers: the main session removes it, with a plain `git worktree remove`, which also refuses.
 */
function worktreeDecision(worktreePath, baseRef, git = (args) => execFileSync("git", ["-C", worktreePath, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) {
  try {
    if (git(["status", "--porcelain"]).trim()) return { remove: false, reason: "it has uncommitted or untracked changes" };
    const ahead = Number(git(["rev-list", "--count", `${baseRef}..HEAD`]).trim());
    if (!Number.isInteger(ahead)) return { remove: false, reason: "its commits couldn't be counted" };
    if (ahead > 0) return { remove: false, reason: `it has ${ahead} commit(s) not on ${baseRef}` };
    return { remove: true, reason: "no changes, and no commits beyond its base" };
  } catch {
    return { remove: false, reason: "git couldn't check it" };
  }
}

// ─── Command line, for the main session only ────────────────────────────────

/** Read-only. Anything it can't find is treated as "doesn't match", which keeps the worktree from being used. */
function readWorktreeBase(projectDir) {
  const git = (...args) => {
    try { return execFileSync("git", ["-C", projectDir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); } catch { return null; }
  };
  let baseRef = null;
  for (const file of [".claude/settings.local.json", ".claude/settings.json"]) {
    try { baseRef = JSON.parse(fs.readFileSync(path.join(projectDir, file), "utf8")).worktree?.baseRef ?? baseRef; } catch { /* no such file */ }
    if (baseRef) break;
  }
  return { head: git("rev-parse", "HEAD"), defaultHead: git("rev-parse", "origin/HEAD"), baseRef };
}

function runCli(argv) {
  const [command, ...args] = argv;
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const dir = path.join(projectDir, ".claude", "orchestrator", "runs");
  const file = (id) => path.join(dir, `${path.basename(id)}.json`);
  const load = (id) => JSON.parse(fs.readFileSync(file(id), "utf8"));
  const save = (run) => {
    fs.mkdirSync(dir, { recursive: true });
    const temp = `${file(run.id)}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(run, null, 2));
    fs.renameSync(temp, file(run.id));
  };
  const project = (() => { try { return JSON.parse(fs.readFileSync(path.join(projectDir, ".claude", "model-router.project.json"), "utf8")); } catch { return {}; } })();
  const print = (v) => console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
  const withRun = (id, work) => { const run = load(id); const out = work(run); save(run); return out; };

  switch (command) {
    case "create": {
      const [tasksFile, runId, tiers] = args;
      const tasks = JSON.parse(fs.readFileSync(tasksFile, "utf8"));
      const worktreeProblem = tasks.some((t) => t.isolation === "worktree") ? worktreeBaseProblem(readWorktreeBase(projectDir)) : null;
      const run = createRun(tasks, { id: runId, project, worktreeProblem, ...(tiers ? { availableTiers: tiers.split(",") } : {}) });
      save(run);
      return print(dashboard(run));
    }
    case "next": return print(withRun(args[0], (run) => next(run)));
    case "started": return withRun(args[0], (run) => started(run, args[1], args[2]));
    case "report": return print(withRun(args[0], (run) => report(run, args[1], fs.readFileSync(args[2], "utf8"), { project })));
    case "fail": return print(withRun(args[0], (run) => fail(run, args[1], args[2], args[3], { project })));
    case "cancel": return withRun(args[0], (run) => cancel(run, args[1], args[2]));
    case "model": return print(withRun(args[0], (run) => recordModel(run, args[1], args[2])));
    case "close": return withRun(args[0], (run) => close(run, args[1]));
    case "done-in-main": return withRun(args[0], (run) => doneInMain(run, args[1], args[2]));
    case "interrupted": return print(withRun(args[0], (run) => markInterrupted(run)));
    case "requeue": return withRun(args[0], (run) => requeue(run, args[1]));
    case "reconcile": return print(reconcile(load(args[0]), args.slice(1)));
    case "dashboard": return print(dashboard(load(args[0])));
    case "finish": return print(finish(load(args[0])));
    case "worktree-check": return print(worktreeDecision(args[0], args[1]));
    default:
      console.error("usage: orchestrate.cjs create|next|started|report|fail|cancel|model|close|done-in-main|interrupted|requeue|reconcile|dashboard|finish|worktree-check ...");
      process.exitCode = 2;
  }
}

if (require.main === module) {
  try {
    runCli(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = { MAX_CONCURRENT, MAX_ATTEMPTS, pathsOverlap, createRun, next, started, parseReport, report, fail, cancel, recordModel, close, doneInMain, markInterrupted, requeue, reconcile, finish, metrics, dashboard, worktreeDecision, worktreeBaseProblem, workerPrompt };
