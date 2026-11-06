#!/usr/bin/env node
// Bookkeeping for a parallel run. It launches nothing: the main session launches workers with Claude Code's own
// Agent tool, and this keeps the record of what's allowed to start, what happened, and whether work can be closed.
// Only the main session writes it, so there's one source of truth. Pure functions, with a thin command line below.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { route, loadPolicy } = require("../../intelligent-model-router/scripts/route.cjs");

const MAX_CONCURRENT = 3;
const MAX_ATTEMPTS = 3; // only failed tests can use them all: one retry with the evidence, then one on a stronger tier
const STATUSES = new Set(["QUEUED", "RUNNING", "BLOCKED", "FAILED", "COMPLETED", "CANCELLED"]);
const FINISHED = new Set(["FAILED", "COMPLETED", "CANCELLED"]);
const ACTIVE_LIFECYCLE = new Set(["ASSIGNED", "STARTED", "RUNNING", "REPORTING"]);
const SIZES = new Set(["TRIVIAL", "SMALL", "MEDIUM", "LARGE", "HIGH-RISK"]);
const READ_ONLY_AGENTS = new Set(["security-review-agent", "product-strategy-agent"]);
const RETRY_ONCE = new Set(["crash", "tool-failure"]); // may be transient, so one more try, on the same tier
const NEVER_RETRY = new Set(["permission-denied", "needs-approval", "conflict", "model-unavailable", "invalid-input", "unsupported-tool", "context-limit"]);
const FAILURE_KINDS = new Set([...RETRY_ONCE, ...NEVER_RETRY, "test-failure", "missing-report"]);
// The same attempt would fail the same way, and a stronger model wouldn't change that.
const DETERMINISTIC_DETAIL = /\b(ENOENT|EACCES|no such file|not found|invalid path|unsupported|unknown tool|permission denied)\b/i;

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

// ─── Sizing ─────────────────────────────────────────────────────────────────

const isHighRisk = (signals) => !!(signals.securitySensitive || signals.architecture || signals.databaseIntegrity || signals.concurrency || signals.crossSubsystem || signals.isReview || signals.releaseReadiness || signals.restrictedActions?.length);

/** Risk always outranks a declared size, and length is never an input. */
function sizeOf(raw) {
  if (raw.size !== undefined && !SIZES.has(raw.size)) throw new Error(`Unknown size: ${raw.size}. Use ${[...SIZES].join(", ")}.`);
  const signals = raw.signals ?? {};
  if (isHighRisk(signals)) return "HIGH-RISK";
  if (signals.trivial) return "TRIVIAL";
  return raw.size ?? "MEDIUM";
}

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

/** A trivial or small task usually costs less here than a cold worker would, so it needs a reason to leave. */
function routingSignals(task) {
  const signals = { ...task.signals, failedAttempts: task.reasoningFailures };
  if (task.size === "TRIVIAL") return { ...signals, trivial: true };
  if (task.size === "SMALL") {
    const suitsQuickAgent = task.contextIsolation && (!task.owns.length || task.signals.documentation);
    return suitsQuickAgent ? { ...signals, lightweightAnalysis: true } : { ...signals, trivial: true };
  }
  return signals;
}

function applyRoute(task, { policy, project, availableTiers }) {
  const decision = route({ ...routingSignals(task), ...(availableTiers ? { availableTiers } : {}) }, { policy, project });
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

const goalKey = (t) => `${String(t.goal).toLowerCase().replace(/\s+/g, " ").trim()}|${t.owns.map(normalize).sort().join(",")}`;

/**
 * A finished read-only result can stand in for a new task only if the goal is the same and every file it depended
 * on is byte-for-byte unchanged. It needs declared inputs, as otherwise nothing shows them unchanged. Anything
 * high-risk, anything that changes files, and anything that ran tests always runs again.
 */
function findReusable(previousRuns, task, hashes) {
  if (task.owns.length || task.size === "HIGH-RISK" || !task.files.length) return null;
  if (!hashes || task.files.some((f) => !hashes[f])) return null;
  for (const run of previousRuns) {
    for (const prior of run.tasks) {
      if (prior.status !== "COMPLETED" || prior.tests !== "none" || !prior.stableInputs) continue;
      if (goalKey(prior) !== goalKey(task)) continue;
      if (task.files.every((f) => prior.stableInputs[f] === hashes[f])) return { runId: run.id, taskId: prior.id, result: prior.result };
    }
  }
  return null;
}

/** What the plan comes to, and whether parallel work is worth having. Simulates the order, with no model involved. */
function delegationSummary(run) {
  const workers = run.tasks.filter((t) => t.runsIn === "worker" && t.status === "QUEUED");
  const done = new Set(run.tasks.filter((t) => t.status === "COMPLETED" || t.runsIn === "main").map((t) => t.id));
  const left = new Set(workers.map((t) => t.id));
  let peak = 0;
  while (left.size) {
    const ready = workers.filter((t) => left.has(t.id) && t.dependsOn.every((d) => done.has(d)));
    if (!ready.length) break;
    const substantial = ready.filter((t) => t.size !== "SMALL");
    const batch = substantial.length ? substantial.slice(0, run.maxConcurrent) : ready.slice(0, 1);
    peak = Math.max(peak, batch.length);
    for (const t of batch) { left.delete(t.id); done.add(t.id); }
  }
  const reads = new Map();
  for (const t of workers) for (const f of t.files) reads.set(normalize(f), [...(reads.get(normalize(f)) ?? []), t.id]);
  return {
    mainSessionTasks: run.tasks.filter((t) => t.runsIn === "main").length,
    workers: workers.length,
    peakParallel: peak,
    advice: !workers.length ? "No workers are needed." : peak < 2 ? "No parallel benefit: run these one at a time." : `Up to ${peak} can run together.`,
    sharedReads: [...reads].filter(([, by]) => by.length > 1).map(([file, by]) => ({ file, by })),
  };
}

function createRun(input, { id = `run-${Date.now()}`, availableTiers, maxConcurrent = MAX_CONCURRENT, project = {}, policy = loadPolicy(), now = new Date().toISOString(), worktreeProblem = null, previousRuns = [], hashInputs = null } = {}) {
  if (!Array.isArray(input) || !input.length) throw new Error("A run needs at least one task.");
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > MAX_CONCURRENT) throw new Error(`maxConcurrent must be a whole number from 1 to ${MAX_CONCURRENT}.`);
  const ids = new Set();
  const tasks = input.map((raw) => {
    if (!raw.id || !raw.title) throw new Error("Each task needs an id and a title.");
    if (ids.has(raw.id)) throw new Error(`Duplicate task id: ${raw.id}`);
    ids.add(raw.id);
    return {
      id: raw.id, title: raw.title, goal: raw.goal ?? raw.title, signals: raw.signals ?? {}, owns: raw.owns ?? [], dependsOn: [...(raw.dependsOn ?? [])],
      size: sizeOf(raw), contextIsolation: !!raw.contextIsolation, files: raw.files ?? [], inputs: raw.inputs ?? null, acceptance: raw.acceptance ?? null, reviews: raw.reviews ?? [],
      isolation: raw.isolation === "worktree" ? "worktree" : "shared",
      status: "QUEUED", lifecycle: "NOT_STARTED", attempts: 0, reasoningFailures: 0, launches: 0, agent: null, model: null, tier: null, runsIn: null,
      agentId: null, result: null, tests: null, blockers: [], actualModel: null, modelCheck: "not checked", startedAt: null, endedAt: null, failures: [], serializedAfter: [], reportRequested: false, inputHashes: null, stableInputs: null, duplicateOf: null, reusedFrom: null, measured: null,
    };
  });
  for (const t of tasks) for (const dep of t.dependsOn) if (!ids.has(dep)) throw new Error(`Task ${t.id} depends on ${dep}, which doesn't exist.`);
  const order = topologicalOrder(tasks);
  const position = new Map(order.map((taskId, i) => [taskId, i]));

  for (const t of tasks) applyRoute(t, { policy, project, availableTiers });
  for (const t of tasks) {
    if (READ_ONLY_AGENTS.has(t.agent) && t.owns.length) {
      throw new Error(`Task ${t.id} goes to ${t.agent}, which is read-only, so it can't own files.`);
    }
    if (worktreeProblem && t.isolation === "worktree" && t.runsIn === "worker") {
      t.status = "BLOCKED";
      t.blockers = [worktreeProblem];
    }
  }

  // The same goal twice is one piece of work. The second never launches, and stays visible.
  const seenGoals = new Map();
  for (const t of tasks) {
    const key = goalKey(t);
    if (seenGoals.has(key) && t.status === "QUEUED") {
      t.status = "BLOCKED";
      t.duplicateOf = seenGoals.get(key);
      t.blockers = [`Same goal and files as ${t.duplicateOf}`];
    } else if (!seenGoals.has(key)) {
      seenGoals.set(key, t.id);
    }
  }

  for (const t of tasks) {
    if (t.status !== "QUEUED" || t.runsIn !== "worker" || !t.files.length) continue;
    t.inputHashes = hashInputs ? hashInputs(t.files) : null;
    const earlier = findReusable(previousRuns, t, t.inputHashes);
    if (earlier) {
      t.status = "COMPLETED";
      t.lifecycle = "CLOSED";
      t.result = earlier.result;
      t.tests = "none";
      t.reusedFrom = `${earlier.runId}/${earlier.taskId}`;
      t.stableInputs = t.inputHashes;
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
  const run = { id, createdAt: now, maxConcurrent, availableTiers: availableTiers ?? null, tasks, testRuns: [], events: [{ at: now, event: "created", tasks: tasks.length }] };
  run.delegation = delegationSummary(run);
  return run;
}

// ─── Moving a run forward ───────────────────────────────────────────────────

const taskOf = (run, id) => {
  const task = run.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`No task ${id} in this run.`);
  return task;
};
const log = (run, event, id, detail, now) => run.events.push({ at: now ?? new Date().toISOString(), event, task: id, ...(detail ? { detail } : {}) });
const activeWorkers = (run) => run.tasks.filter((t) => t.runsIn === "worker" && ACTIVE_LIFECYCLE.has(t.lifecycle) && !["COMPLETED", "CANCELLED", "FAILED", "BLOCKED"].includes(t.status));

// Short, as every word goes to every worker. The agent's definition holds its role, and its guard enforces the rest.
// These limits stay explicit: a worktree worker may not load CLAUDE.md, and they must never depend on that.
const LIMITS = "LIMITS: Never migrate, seed, deploy, merge, push, commit, or touch production, fitdb, fitdb_test_other or Claude settings. A refusal or denied permission is final. If you need another file, stop and report it. Claim only what you saw.";
const REPORT_FORMAT = 'END WITH:\nWORKER-REPORT\n{"status":"completed|failed|blocked","summary":"under 40 words","filesChanged":[],"tests":"command and result, or none","blockers":[]}';

function workerPrompt(task, run) {
  const clip = (s) => (String(s).length > 300 ? `${String(s).slice(0, 300)}...` : String(s));
  const before = task.dependsOn.map((id) => taskOf(run, id)).filter((d) => d.result).map((d) => `- ${d.id}: ${clip(d.result)}`);
  const lastFailure = task.failures[task.failures.length - 1];
  return [
    `Worker ${task.id}, run ${run.id}. Report to the main session.`,
    `GOAL: ${task.goal}`,
    task.files.length ? `READ THESE, and search for anything else rather than exploring: ${task.files.join(", ")}` : null,
    task.inputs ? `INPUTS: ${task.inputs}` : null,
    task.acceptance ? `DONE WHEN: ${task.acceptance}` : null,
    task.owns.length ? `CHANGE ONLY: ${task.owns.join(", ")}` : "CHANGE NO FILES.",
    before.length ? `FINISHED BEFORE YOU:\n${before.join("\n")}` : null,
    lastFailure ? `LAST ATTEMPT FAILED, so change approach: ${clip(`${lastFailure.kind}: ${lastFailure.detail}`)}` : null,
    LIMITS,
    REPORT_FORMAT,
  ].filter(Boolean).join("\n");
}

/**
 * What may start now. Only tasks whose dependencies finished, up to the limit, and never one whose files overlap
 * a running worker's. A small task runs alone, as it isn't worth parallel coordination. Tasks that can never start
 * are marked, so nothing waits silently.
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
    if (active.some((a) => a.size === "SMALL") || (t.size === "SMALL" && active.length)) continue;
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

/** A report has to be whole. A partial one could hide what a worker changed, so it counts as no report. */
function parseReport(text) {
  const at = String(text ?? "").lastIndexOf("WORKER-REPORT");
  if (at < 0) return null;
  const match = String(text).slice(at + "WORKER-REPORT".length).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const report = JSON.parse(match[0]);
    if (!["completed", "failed", "blocked"].includes(report.status) || typeof report.summary !== "string") return null;
    if (!Array.isArray(report.filesChanged) || typeof report.tests !== "string" || !Array.isArray(report.blockers)) return null;
    return { status: report.status, summary: report.summary, filesChanged: report.filesChanged.map(String), tests: report.tests, blockers: report.blockers.map(String) };
  } catch {
    return null;
  }
}

/**
 * A failure always leaves a record. A retry needs a reason to expect a different result: a transient failure gets
 * one more try, and failed tests get one with the evidence, then a stronger tier through the router. Anything
 * deterministic, or needing a person, goes straight to the main session, and is never moved to a stronger model.
 */
function fail(run, id, kind, detail, { now = new Date().toISOString(), policy = loadPolicy(), project = {} } = {}) {
  if (!FAILURE_KINDS.has(kind)) throw new Error(`Unknown failure kind: ${kind}`);
  const t = taskOf(run, id);
  if (FINISHED.has(t.status)) throw new Error(`${id} has already finished as ${t.status}.`);
  const text = detail ?? "";
  const repeated = t.failures.some((f) => f.kind === kind && f.detail === text);
  t.failures.push({ kind, detail: text, at: now });
  t.endedAt = now;
  log(run, "failure", id, `${kind}: ${text}`, now);
  const stop = (status, blocker, action) => {
    t.status = status;
    t.lifecycle = "REPORTING";
    t.blockers = [blocker];
    return { action };
  };
  if (NEVER_RETRY.has(kind) || DETERMINISTIC_DETAIL.test(text)) return stop("BLOCKED", `${kind}: ${text || "no detail"}`, "needs-the-main-session");
  if (repeated) return stop("FAILED", `The same failure twice, so it wasn't retried again: ${kind}`, "gave-up");
  if (kind === "missing-report") return stop("FAILED", "The worker didn't give a usable report, even when asked", "gave-up");
  t.attempts += 1;
  const limit = RETRY_ONCE.has(kind) ? 2 : MAX_ATTEMPTS;
  if (t.attempts >= limit || t.launches >= MAX_ATTEMPTS) return stop("FAILED", `Failed ${t.attempts} times. Last: ${kind}`, "gave-up");
  if (kind === "test-failure") t.reasoningFailures += 1; // only this is evidence that more reasoning could help
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

/**
 * Takes the worker's final reply. A reply with no complete report is never a success. The first time, ask the same
 * worker for it through SendMessage, as re-running the whole task would repeat all its work.
 */
function report(run, id, text, { now = new Date().toISOString(), policy, project, hashInputs = null } = {}) {
  const t = taskOf(run, id);
  if (t.lifecycle !== "RUNNING") throw new Error(`${id} can't report from ${t.lifecycle}.`);
  const parsed = parseReport(text);
  if (!parsed) {
    if (!t.reportRequested) {
      t.reportRequested = true;
      t.failures.push({ kind: "missing-report", detail: "first request", at: now });
      log(run, "report-requested", id, undefined, now);
      return { action: "ask-for-report", recorded: false };
    }
    return { ...fail(run, id, "missing-report", "Still no complete WORKER-REPORT", { now, policy, project }), recorded: false };
  }
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
    // Reusable later only if its inputs didn't change while it ran, which another worker could have caused.
    if (t.inputHashes && hashInputs) {
      const after = hashInputs(t.files);
      if (t.files.every((f) => after[f] && after[f] === t.inputHashes[f])) t.stableInputs = after;
    }
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

/**
 * What a transcript shows: model, tokens and files read. Its format isn't a documented interface, so anything
 * missing stays null, and is never estimated. Streaming repeats a message, so each message id counts once.
 */
function measureTranscript(text) {
  const models = new Set();
  const reads = [];
  const usage = new Map();
  let first = null, last = null;
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.timestamp) { first = first && first < entry.timestamp ? first : entry.timestamp; last = last && last > entry.timestamp ? last : entry.timestamp; }
    if (entry.type !== "assistant" || !entry.message) continue;
    if (typeof entry.message.model === "string" && !entry.message.model.startsWith("<")) models.add(entry.message.model);
    if (entry.message.usage && entry.message.id) usage.set(entry.message.id, entry.message.usage);
    for (const block of Array.isArray(entry.message.content) ? entry.message.content : []) {
      if (block.type === "tool_use" && block.name === "Read" && block.input?.file_path && !reads.some((r) => r.id === block.id)) reads.push({ id: block.id, file: normalize(block.input.file_path) });
    }
  }
  const sum = (key) => (usage.size ? [...usage.values()].reduce((n, u) => n + (u[key] ?? 0), 0) : null);
  return { models: [...models], inputTokens: sum("input_tokens"), outputTokens: sum("output_tokens"), cacheReadTokens: sum("cache_read_input_tokens"), cacheWriteTokens: sum("cache_creation_input_tokens"), filesRead: reads.map((r) => r.file), firstAt: first, lastAt: last };
}

function recordMeasurement(run, id, measured) {
  const t = taskOf(run, id);
  t.measured = measured;
  recordModel(run, id, measured.models.length === 1 ? measured.models[0] : measured.models.join(",") || null);
  return measured;
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

/**
 * After an interrupted session. The docs don't say whether background workers survive that, so a task that was
 * underway is treated as unknown, and held. Nothing is relaunched automatically, as it could duplicate work.
 */
function markInterrupted(run, { now } = {}) {
  const held = [];
  for (const t of run.tasks) {
    if (ACTIVE_LIFECYCLE.has(t.lifecycle) && !["COMPLETED", "BLOCKED", "FAILED", "CANCELLED"].includes(t.status)) {
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
  if (t.status !== "BLOCKED" || t.runsIn === "nobody" || t.duplicateOf) throw new Error(`${id} can't be requeued from ${t.status}, running in ${t.runsIn}.`);
  t.status = "QUEUED";
  t.lifecycle = "NOT_STARTED";
  t.agentId = null;
  t.blockers = [];
  log(run, "requeued", id, undefined, now);
}

/** Did these two workers' recorded times overlap? Missing times count as overlapping, as nothing shows otherwise. */
function ranTogether(a, b) {
  if (!a.startedAt || !a.endedAt || !b.startedAt || !b.endedAt) return true;
  return Date.parse(a.startedAt) < Date.parse(b.endedAt) && Date.parse(b.startedAt) < Date.parse(a.endedAt);
}

/**
 * Compares what changed on disk with who owned it and who said they changed it. Nothing is reverted. It relies on
 * the workers' own reports and recorded times, as ownership isn't enforced while they run, so it can't prove who
 * wrote what. `clean` means nothing here contradicts the plan.
 *   simultaneous: two workers report the same file, and ran at the same time. A genuine conflict.
 *   sequential:   two workers report the same file, one after the other. Authorized, and fine.
 *   unowned:      changed, and no task owns it.
 *   unexpected:   changed and owned, but no owner reported it, or reported by a worker that doesn't own it.
 */
function reconcile(run, changedFiles) {
  const out = { simultaneous: [], sequential: [], unowned: [], unexpected: [] };
  const writers = run.tasks.filter((t) => t.owns.length);
  const files = new Map();
  for (const file of changedFiles) files.set(normalize(file), file);
  for (const t of run.tasks) for (const file of t.filesChanged ?? []) if (!files.has(normalize(file))) files.set(normalize(file), file);
  for (const file of files.values()) {
    const owners = writers.filter((t) => ownsFile(t.owns, file));
    const reporters = run.tasks.filter((t) => (t.filesChanged ?? []).some((f) => normalize(f) === normalize(file)));
    if (reporters.length > 1) {
      const together = reporters.some((a, i) => reporters.slice(i + 1).some((b) => ranTogether(a, b)));
      (together ? out.simultaneous : out.sequential).push({ file, by: reporters.map((t) => t.id) });
    } else if (reporters.length === 1 && !owners.includes(reporters[0])) {
      out.unexpected.push({ file, by: reporters[0].id, reason: "reported by a worker that doesn't own it" });
    } else if (!reporters.length && !owners.length) {
      out.unowned.push(file);
    } else if (!reporters.length) {
      out.unexpected.push({ file, by: null, reason: `owned by ${owners.map((t) => t.id).join(", ")}, and no worker reported changing it` });
    }
  }
  return { ...out, clean: !out.simultaneous.length && !out.unowned.length && !out.unexpected.length };
}

/** Review the plan owes: a high-risk change needs an independent review that finished, or the owner's decision. */
function reviewsOutstanding(run) {
  const reviewed = new Set(run.tasks.filter((t) => t.status === "COMPLETED" && t.agent === "security-review-agent").flatMap((t) => t.reviews));
  return run.tasks.filter((t) => t.independentReview && t.owns.length && t.status === "COMPLETED" && !reviewed.has(t.id)).map((t) => t.id);
}

/** The final account. Refuses while anything is unaccounted for, so a worker can't quietly vanish from the report. */
function finish(run) {
  const open = run.tasks.filter((t) => t.status === "RUNNING" || t.status === "QUEUED");
  if (open.length) throw new Error(`Still open: ${open.map((t) => `${t.id} (${t.status})`).join(", ")}`);
  const outstanding = reviewsOutstanding(run);
  return {
    complete: run.tasks.every((t) => t.status === "COMPLETED") && !outstanding.length,
    reviewsOutstanding: outstanding,
    counts: Object.fromEntries([...STATUSES].map((s) => [s, run.tasks.filter((t) => t.status === s).length])),
    metrics: metrics(run),
    tasks: run.tasks.map((t) => ({ id: t.id, status: t.status, size: t.size, agent: t.agent, model: t.model, actualModel: t.actualModel, modelCheck: t.modelCheck, result: t.result, tests: t.tests, blockers: t.blockers, reusedFrom: t.reusedFrom, duplicateOf: t.duplicateOf })),
  };
}

/** Only what was recorded. Token and read figures appear only for workers with a measured transcript. */
function metrics(run) {
  const workers = run.tasks.filter((t) => t.startedAt && t.endedAt);
  const timed = workers.map((t) => [Date.parse(t.startedAt), Date.parse(t.endedAt)]).sort((a, b) => a[0] - b[0]);
  const sum = timed.reduce((total, [a, b]) => total + (b - a), 0);
  const wall = timed.length ? Math.max(...timed.map(([, b]) => b)) - timed[0][0] : 0;
  const events = timed.flatMap(([a, b]) => [[a, 1], [b, -1]]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let current = 0, peak = 0;
  for (const [, delta] of events) { current += delta; peak = Math.max(peak, current); }
  let gap = 0, reach = timed.length ? timed[0][1] : 0;
  for (const [a, b] of timed) { if (a > reach) gap += a - reach; reach = Math.max(reach, b); }
  const measured = run.tasks.filter((t) => t.measured);
  const total = (key) => (measured.length && measured.every((t) => t.measured[key] !== null) ? measured.reduce((n, t) => n + t.measured[key], 0) : null);
  const readBy = new Map();
  for (const t of measured) for (const f of new Set(t.measured.filesRead)) readBy.set(f, (readBy.get(f) ?? 0) + 1);
  return {
    workerLaunches: run.tasks.reduce((n, t) => n + t.launches, 0),
    retries: run.tasks.reduce((n, t) => n + Math.max(0, t.launches - 1), 0),
    failures: run.tasks.reduce((n, t) => n + t.failures.length, 0),
    duplicateTasks: run.tasks.filter((t) => t.duplicateOf).length,
    reusedResults: run.tasks.filter((t) => t.reusedFrom).length,
    peakConcurrent: peak, summedWorkerMs: sum, wallClockMs: wall, idleBetweenWorkersMs: gap,
    testRuns: (run.testRuns ?? []).length,
    measuredWorkers: measured.length, inputTokens: total("inputTokens"), outputTokens: total("outputTokens"), cacheReadTokens: total("cacheReadTokens"), cacheWriteTokens: total("cacheWriteTokens"),
    filesReadByMoreThanOneWorker: measured.length ? [...readBy].filter(([, n]) => n > 1).length : null,
    models: Object.fromEntries(run.tasks.filter((t) => t.launches).map((t) => [t.id, t.actualModel ?? `${t.model} (planned)`])),
  };
}

/**
 * Whether a test has to run. A pass counts again only for the same command on exactly the same code. A failure is
 * never reused. `required` is for security and data-integrity tests, which always run.
 */
function testDecision(run, command, fingerprint, { required = false } = {}) {
  if (required) return { run: true, reason: "required" };
  if (!fingerprint) return { run: true, reason: "the code's state couldn't be established" };
  const last = (run.testRuns ?? []).filter((r) => r.command === command).pop();
  if (last && last.fingerprint === fingerprint && last.result === "passed") return { run: false, reason: "it passed on exactly this code" };
  return { run: true, reason: last ? "the code changed, or it didn't pass" : "it hasn't run" };
}

function recordTest(run, command, fingerprint, result, { now = new Date().toISOString() } = {}) {
  if (!["passed", "failed"].includes(result)) throw new Error("A test result is passed or failed.");
  run.testRuns = run.testRuns ?? [];
  run.testRuns.push({ command, fingerprint, result, at: now });
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

/** A worktree starts from the default branch unless told otherwise, so on another branch it wouldn't hold that branch's work. */
function worktreeBaseProblem({ head, defaultHead, baseRef }) {
  if (baseRef === "head") return null;
  if (head && defaultHead && head === defaultHead) return null;
  return "A worktree would start from the default branch, not this one. Run it in order instead, or have the owner set worktree.baseRef to head";
}

// ─── Command line, for the main session only ────────────────────────────────

const gitIn = (projectDir) => (...args) => {
  try { return execFileSync("git", ["-C", projectDir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 }).trim(); } catch { return null; }
};

/** Read-only. Anything it can't find is treated as "doesn't match", which keeps the worktree from being used. */
function readWorktreeBase(projectDir) {
  const git = gitIn(projectDir);
  let baseRef = null;
  for (const file of [".claude/settings.local.json", ".claude/settings.json"]) {
    try { baseRef = JSON.parse(fs.readFileSync(path.join(projectDir, file), "utf8")).worktree?.baseRef ?? baseRef; } catch { /* no such file */ }
    if (baseRef) break;
  }
  return { head: git("rev-parse", "HEAD"), defaultHead: git("rev-parse", "origin/HEAD"), baseRef };
}

/** Each file's Git hash, or null if it can't be read, which rules out reusing anything that depends on it. */
const fileHasher = (projectDir) => (files) => Object.fromEntries(files.map((f) => [f, fs.existsSync(path.join(projectDir, f)) ? gitIn(projectDir)("hash-object", f) : null]));

/** The commit plus every uncommitted change, so any edit gives a different value. Null if it can't be established. */
function treeFingerprint(projectDir) {
  const git = gitIn(projectDir);
  const [head, diff, untracked] = [git("rev-parse", "HEAD"), git("diff", "HEAD"), git("ls-files", "-o", "--exclude-standard")];
  if (head === null || diff === null || untracked === null) return null;
  const hash = crypto.createHash("sha256").update(head).update(diff).update(untracked);
  for (const f of untracked.split("\n").filter(Boolean)) hash.update(git("hash-object", f) ?? "unreadable");
  return hash.digest("hex");
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
  const previousRuns = () => { try { return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))); } catch { return []; } };
  const hashInputs = fileHasher(projectDir);

  switch (command) {
    case "create": {
      const [tasksFile, runId, tiers] = args;
      const tasks = JSON.parse(fs.readFileSync(tasksFile, "utf8"));
      const worktreeProblem = tasks.some((t) => t.isolation === "worktree") ? worktreeBaseProblem(readWorktreeBase(projectDir)) : null;
      const run = createRun(tasks, { id: runId, project, worktreeProblem, previousRuns: previousRuns(), hashInputs, ...(tiers ? { availableTiers: tiers.split(",") } : {}) });
      save(run);
      print(run.delegation);
      return print(dashboard(run));
    }
    case "next": return print(withRun(args[0], (run) => next(run)));
    case "started": return withRun(args[0], (run) => started(run, args[1], args[2]));
    case "report": return print(withRun(args[0], (run) => report(run, args[1], fs.readFileSync(args[2], "utf8"), { project, hashInputs })));
    case "fail": return print(withRun(args[0], (run) => fail(run, args[1], args[2], args[3], { project })));
    case "cancel": return withRun(args[0], (run) => cancel(run, args[1], args[2]));
    case "model": return print(withRun(args[0], (run) => recordModel(run, args[1], args[2])));
    case "measure": return print(withRun(args[0], (run) => recordMeasurement(run, args[1], measureTranscript(fs.readFileSync(args[2], "utf8")))));
    case "close": return withRun(args[0], (run) => close(run, args[1]));
    case "done-in-main": return withRun(args[0], (run) => doneInMain(run, args[1], args[2]));
    case "interrupted": return print(withRun(args[0], (run) => markInterrupted(run)));
    case "requeue": return withRun(args[0], (run) => requeue(run, args[1]));
    case "reconcile": return print(reconcile(load(args[0]), args.slice(1)));
    case "test-check": return print(testDecision(load(args[0]), args[1], treeFingerprint(projectDir), { required: args[2] === "required" }));
    case "test-done": return withRun(args[0], (run) => recordTest(run, args[1], treeFingerprint(projectDir), args[2]));
    case "dashboard": return print(dashboard(load(args[0])));
    case "finish": return print(finish(load(args[0])));
    case "worktree-check": return print(worktreeDecision(args[0], args[1]));
    default:
      console.error("usage: orchestrate.cjs create|next|started|report|fail|cancel|model|measure|close|done-in-main|interrupted|requeue|reconcile|test-check|test-done|dashboard|finish|worktree-check ...");
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

module.exports = { MAX_CONCURRENT, MAX_ATTEMPTS, pathsOverlap, sizeOf, createRun, delegationSummary, findReusable, next, started, parseReport, report, fail, cancel, recordModel, measureTranscript, recordMeasurement, close, doneInMain, markInterrupted, requeue, reconcile, reviewsOutstanding, finish, metrics, testDecision, recordTest, treeFingerprint, dashboard, worktreeDecision, worktreeBaseProblem, workerPrompt };
