// Mocked tests: no model is called, and no worker is launched. Run with:
//   node --test .claude/skills/parallel-task-orchestrator/tests/orchestrator.test.cjs
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const o = require("../scripts/orchestrate.cjs");
const { refusalFor } = require("../../intelligent-model-router/scripts/guard.cjs");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const REPORT = (extra = {}) => `Done.\nWORKER-REPORT\n${JSON.stringify({ status: "completed", summary: "It worked", filesChanged: [], tests: "none", blockers: [], ...extra })}`;
const impl = (id, owns, extra = {}) => ({ id, title: `Implement ${id}`, signals: {}, owns, ...extra });
const statusOf = (run, id) => run.tasks.find((t) => t.id === id).status;
const task = (run, id) => run.tasks.find((t) => t.id === id);
/** One worker through a whole normal life. */
function completeWorker(run, id, reportText = REPORT()) {
  o.started(run, id, `agent-${id}`);
  const out = o.report(run, id, reportText);
  o.close(run, id);
  return out;
}

describe("1. independent tasks run concurrently, up to the limit", () => {
  test("three start together, and a fourth waits for a slot", () => {
    const run = o.createRun([impl("a", ["src/a.ts"]), impl("b", ["src/b.ts"]), impl("c", ["src/c.ts"]), impl("d", ["src/d.ts"])]);
    const first = o.next(run);
    assert.deepEqual(first.launch.map((l) => l.id), ["a", "b", "c"]);
    assert.deepEqual(first.waiting, ["d"]);
    for (const id of ["a", "b", "c"]) o.started(run, id);
    assert.deepEqual(o.next(run).launch, [], "no slot is free");
    completeWorker2(run, "a");
    assert.deepEqual(o.next(run).launch.map((l) => l.id), ["d"], "a finished worker frees its slot");
  });
  function completeWorker2(run, id) { o.report(run, id, REPORT()); o.close(run, id); }
  test("the limit can be lowered, and it's three by default", () => {
    assert.equal(o.MAX_CONCURRENT, 3);
    assert.equal(o.next(o.createRun([impl("a", ["x"]), impl("b", ["y"])], { maxConcurrent: 1 })).launch.length, 1);
    assert.throws(() => o.createRun([impl("a", [])], { maxConcurrent: 0 }));
  });
  test("calling next twice doesn't launch the same worker twice", () => {
    const run = o.createRun([impl("a", ["x"])]);
    assert.equal(o.next(run).launch.length, 1);
    assert.equal(o.next(run).launch.length, 0);
    assert.equal(task(run, "a").launches, 1);
  });
  test("each launch says which native agent, model and isolation to use", () => {
    const [l] = o.next(o.createRun([impl("a", ["x"], { isolation: "worktree" })])).launch;
    assert.deepEqual([l.subagent_type, l.model, l.isolation], ["development-agent", "sonnet", "worktree"]);
  });
  test("the prompt carries the rules, as a worktree worker may not load CLAUDE.md", () => {
    const [l] = o.next(o.createRun([impl("a", ["src/a.ts"])])).launch;
    assert.match(l.prompt, /src\/a\.ts/);
    assert.match(l.prompt, /Never apply migrations/);
    assert.match(l.prompt, /fitdb_test_other/);
    assert.match(l.prompt, /WORKER-REPORT/);
  });
});

describe("2. two tasks wanting the same file run in order", () => {
  for (const [label, a, b] of [
    ["the same file", "src/x.ts", "src/x.ts"],
    ["a file and its folder", "src/lib", "src/lib/x.ts"],
    ["a pattern", "src/**", "src/lib/x.ts"],
    ["different spellings", "./SRC\\x.ts", "src/x.ts"],
    ["anything at all", "*", "src/x.ts"],
  ]) {
    test(`${label}: never at once`, () => {
      const run = o.createRun([impl("a", [a]), impl("b", [b])]);
      assert.deepEqual(task(run, "b").serializedAfter, ["a"]);
      assert.deepEqual(o.next(run).launch.map((l) => l.id), ["a"]);
      o.started(run, "a");
      assert.deepEqual(o.next(run).launch, [], "b waits while a writes");
      o.report(run, "a", REPORT({ filesChanged: [] }));
      assert.deepEqual(o.next(run).launch.map((l) => l.id), ["b"]);
    });
  }
  // Two separate protections, which would otherwise hide each other's removal, so each is tested alone.
  test("planning puts them in order, as a real dependency", () => {
    const run = o.createRun([impl("a", ["x"]), impl("b", ["x"])]);
    assert.deepEqual(task(run, "b").dependsOn, ["a"]);
  });
  test("a running writer's files are also checked at launch, even with no dependency between them", () => {
    const run = o.createRun([impl("a", ["x"]), impl("b", ["y"])]);
    task(run, "b").owns = ["x"]; // as if the plan had changed after it was made
    assert.deepEqual(o.next(run).launch.map((l) => l.id), ["a"]);
  });
  test("worktrees don't lift that, as the files would still collide at integration", () => {
    const run = o.createRun([impl("a", ["x"], { isolation: "worktree" }), impl("b", ["x"], { isolation: "worktree" })]);
    assert.equal(o.next(run).launch.length, 1);
  });
  test("unrelated files with similar names can run together", () => {
    const run = o.createRun([impl("a", ["src/app"]), impl("b", ["src/application.ts"])]);
    assert.equal(o.next(run).launch.length, 2);
  });
  test("readers don't conflict with anything", () => {
    const run = o.createRun([impl("a", ["x"]), { id: "b", title: "Read", signals: { documentation: true } }]);
    assert.equal(o.next(run).launch.length, 2);
  });
});

describe("3. dependencies", () => {
  test("a task waits, then starts with its dependency's result", () => {
    const run = o.createRun([impl("b", ["y"], { dependsOn: ["a"] }), impl("a", ["x"])]);
    assert.deepEqual(o.next(run).launch.map((l) => l.id), ["a"]);
    completeWorker(run, "a", REPORT({ summary: "API added" }));
    const [l] = o.next(run).launch;
    assert.equal(l.id, "b");
    assert.match(l.prompt, /API added/);
  });
  test("it's blocked, with a reason, if its dependency fails or is cancelled", () => {
    for (const end of [(r) => { o.started(r, "a"); o.fail(r, "a", "permission-denied", "no"); }, (r) => { o.started(r, "a"); o.cancel(r, "a", "stop"); }]) {
      const run = o.createRun([impl("a", ["x"]), impl("b", ["y"], { dependsOn: ["a"] }), impl("c", ["z"], { dependsOn: ["b"] })]);
      o.next(run);
      end(run);
      o.next(run);
      assert.equal(statusOf(run, "b"), "BLOCKED");
      assert.match(task(run, "b").blockers[0], /Waiting on a/);
      o.next(run);
      assert.equal(statusOf(run, "c"), "BLOCKED", "and so does whatever waits on it");
    }
  });
  test("a cycle, a missing dependency and a duplicate id are refused", () => {
    assert.throws(() => o.createRun([impl("a", [], { dependsOn: ["b"] }), impl("b", [], { dependsOn: ["a"] })]), /cycle/);
    assert.throws(() => o.createRun([impl("a", [], { dependsOn: ["nope"] })]), /doesn't exist/);
    assert.throws(() => o.createRun([impl("a", []), impl("a", [])]), /Duplicate/);
    assert.throws(() => o.createRun([]), /at least one/);
  });
});

describe("4 to 7. the router picks each worker", () => {
  const one = (signals, owns = []) => o.next(o.createRun([{ id: "t", title: "T", signals, owns }])).launch[0];
  test("4. documentation goes to Haiku", () => {
    const l = one({ documentation: true });
    assert.deepEqual([l.subagent_type, l.model], ["quick-task-agent", "haiku"]);
  });
  test("5. routine implementation goes to Sonnet", () => {
    const l = one({}, ["src/x.ts"]);
    assert.deepEqual([l.subagent_type, l.model], ["development-agent", "sonnet"]);
  });
  test("6. architecture goes to Opus", () => {
    const l = one({ architecture: true }, ["docs/x.md"]);
    assert.deepEqual([l.subagent_type, l.model], ["architecture-agent", "opus"]);
  });
  test("7. a security review goes to the read-only Opus agent, and can't own files", () => {
    const l = one({ isReview: true, securitySensitive: true });
    assert.deepEqual([l.subagent_type, l.model], ["security-review-agent", "opus"]);
    assert.match(l.prompt, /YOU MAY CHANGE NO FILES/);
    assert.throws(() => o.createRun([{ id: "t", title: "T", signals: { isReview: true, securitySensitive: true }, owns: ["x"] }]), /read-only/);
  });
  test("a backend task moves to Opus when it's risky", () => {
    assert.equal(one({}, ["x"]).model, "sonnet");
    assert.equal(one({ securitySensitive: true }, ["x"]).model, "opus");
  });
  test("a trivial edit stays in the main session, using no slot", () => {
    const run = o.createRun([{ id: "t", title: "T", signals: { trivial: true } }, impl("a", ["x"])]);
    const out = o.next(run);
    assert.deepEqual(out.inMain, ["t"]);
    assert.deepEqual(out.launch.map((l) => l.id), ["a"]);
  });
  test("the main session records its own task, and it counts for what depends on it", () => {
    const run = o.createRun([{ id: "t", title: "T", signals: { trivial: true } }, impl("a", ["x"], { dependsOn: ["t"] })]);
    assert.deepEqual(o.next(run).launch, []);
    o.doneInMain(run, "t", "Fixed");
    assert.deepEqual(o.next(run).launch.map((l) => l.id), ["a"]);
    assert.throws(() => o.doneInMain(run, "a", "x"), /isn't waiting/);
  });
  test("an actual model that differs from the plan is shown, and never smoothed over", () => {
    const run = o.createRun([impl("a", ["x"])]);
    assert.equal(o.recordModel(run, "a", "claude-sonnet-5-5"), "verified");
    assert.equal(o.recordModel(run, "a", "claude-haiku-5-5"), "MISMATCH: planned sonnet");
    assert.match(o.dashboard(run), /claude-haiku-5-5 \(MISMATCH: planned sonnet\)/);
    assert.equal(o.recordModel(run, "a", null), "unverified");
    assert.match(o.dashboard(o.createRun([impl("b", ["x"])])), /sonnet \(planned\)/, "unverified is never shown as used");
  });
});

describe("8. a failed worker leaves a record", () => {
  const start = (extra) => { const run = o.createRun([impl("a", ["x"], extra)]); o.next(run); o.started(run, "a"); return run; };
  for (const kind of ["crash", "context-limit", "tool-failure", "test-failure"]) {
    test(`${kind}: retried a bounded number of times, then FAILED, with every failure kept`, () => {
      const run = start();
      assert.equal(o.fail(run, "a", kind, "first").action, "retry");
      assert.equal(statusOf(run, "a"), "QUEUED");
      assert.equal(o.next(run).launch.length, 1);
      o.started(run, "a");
      assert.equal(o.fail(run, "a", kind, "second").action, "retry");
      o.next(run);
      o.started(run, "a");
      assert.equal(o.fail(run, "a", kind, "third").action, "gave-up");
      assert.equal(statusOf(run, "a"), "FAILED");
      assert.equal(task(run, "a").failures.length, 3);
      assert.deepEqual(o.next(run).launch, [], "no fourth launch");
      assert.equal(task(run, "a").launches, 3);
      assert.equal(o.finish(run).complete, false);
    });
  }
  test("the first retry stays on the tier, and the next moves up through the router", () => {
    const run = start();
    assert.equal(o.fail(run, "a", "crash").tier, "sonnet");
    o.next(run); o.started(run, "a");
    const second = o.fail(run, "a", "crash");
    assert.deepEqual([second.tier, second.agent], ["opus", "architecture-agent"]);
    assert.deepEqual(o.next(run).launch.map((l) => l.subagent_type), ["architecture-agent"]);
  });
  test("a reply with no report is a failure, and never a success", () => {
    for (const text of ["All done, trust me.", "WORKER-REPORT", "WORKER-REPORT\n{broken", 'WORKER-REPORT\n{"status":"great","summary":"x"}', "", null]) {
      const run = start();
      const out = o.report(run, "a", text);
      assert.equal(out.recorded, false);
      assert.notEqual(statusOf(run, "a"), "COMPLETED");
      assert.equal(task(run, "a").failures[0].kind, "missing-report");
    }
  });
  test("a report of failure counts as one", () => {
    const run = start();
    o.report(run, "a", REPORT({ status: "failed", summary: "tests failed", blockers: ["2 failed"] }));
    assert.equal(task(run, "a").failures[0].kind, "test-failure");
    assert.equal(statusOf(run, "a"), "QUEUED");
  });
  test("a worker's text can't fake a later status: the last report counts", () => {
    assert.equal(o.parseReport(`WORKER-REPORT\n{"status":"completed","summary":"x"}\nWORKER-REPORT\n{"status":"failed","summary":"y"}`).status, "failed");
  });
  test("an unknown failure kind is refused", () => {
    assert.throws(() => o.fail(start(), "a", "shrug"), /Unknown/);
  });
});

describe("9. cancellation", () => {
  test("a cancelled worker frees its slot, and leaves a record", () => {
    const run = o.createRun([impl("a", ["a"]), impl("b", ["b"]), impl("c", ["c"]), impl("d", ["d"])]);
    o.next(run);
    o.started(run, "a");
    o.cancel(run, "a", "owner changed plans");
    assert.equal(statusOf(run, "a"), "CANCELLED");
    assert.match(task(run, "a").result, /owner changed plans/);
    o.close(run, "a");
    assert.deepEqual(o.next(run).launch.map((l) => l.id), ["d"]);
  });
  test("a finished task can't be cancelled, and a cancelled one can't report as done", () => {
    const run = o.createRun([impl("a", ["a"])]);
    o.next(run);
    completeWorker(run, "a");
    assert.throws(() => o.cancel(run, "a", "x"), /already finished/);
    const other = o.createRun([impl("b", ["b"])]);
    o.next(other);
    o.started(other, "b");
    o.cancel(other, "b", "x");
    assert.throws(() => o.report(other, "b", REPORT()), /can't report/);
  });
});

describe("10. a model is unavailable", () => {
  test("a task moves up, to that tier's agent", () => {
    const run = o.createRun([{ id: "d", title: "Docs", signals: { documentation: true } }], { availableTiers: ["sonnet", "opus"] });
    const [l] = o.next(run).launch;
    assert.deepEqual([l.subagent_type, l.model], ["development-agent", "sonnet"]);
    assert.equal(task(run, "d").fallback, true);
  });
  test("it never moves down: the task is blocked, and no worker starts", () => {
    const run = o.createRun([impl("a", ["x"], { signals: { securitySensitive: true } })], { availableTiers: ["haiku", "sonnet"] });
    assert.equal(statusOf(run, "a"), "BLOCKED");
    assert.deepEqual(o.next(run).launch, []);
    assert.match(task(run, "a").blockers[0], /won't be substituted/);
  });
  test("a review without Opus is blocked, and isn't given to an agent that can edit", () => {
    const run = o.createRun([{ id: "r", title: "Review", signals: { isReview: true, securitySensitive: true } }], { availableTiers: ["haiku", "sonnet"] });
    assert.deepEqual(o.next(run).launch, []);
    assert.equal(task(run, "r").agent, null);
  });
  test("a model lost while running blocks the task for a decision, without retrying", () => {
    const run = o.createRun([impl("a", ["x"])]);
    o.next(run);
    o.started(run, "a");
    assert.equal(o.fail(run, "a", "model-unavailable", "gone").action, "needs-the-main-session");
    assert.equal(statusOf(run, "a"), "BLOCKED");
    assert.deepEqual(o.next(run).launch, []);
  });
  test("a retry respects the same limit", () => {
    const run = o.createRun([impl("a", ["x"])], { availableTiers: ["haiku", "sonnet"] });
    o.next(run); o.started(run, "a");
    o.fail(run, "a", "crash");
    o.next(run); o.started(run, "a");
    assert.equal(o.fail(run, "a", "crash").action, "needs-the-main-session", "it would need Opus, which isn't available");
    assert.equal(statusOf(run, "a"), "BLOCKED");
  });
});

describe("11. permissions", () => {
  test("a denied permission is final: blocked, with no retry and no stronger model", () => {
    const run = o.createRun([impl("a", ["x"])]);
    o.next(run);
    o.started(run, "a");
    assert.equal(o.fail(run, "a", "permission-denied", "guard refused git push").action, "needs-the-main-session");
    assert.equal(statusOf(run, "a"), "BLOCKED");
    assert.equal(task(run, "a").attempts, 0);
    assert.equal(task(run, "a").tier, "sonnet");
    assert.deepEqual(o.next(run).launch, []);
  });
  for (const action of ["migration-apply", "database-write", "seed", "deploy", "production", "merge", "paid-service"]) {
    test(`${action} is never given to a worker`, () => {
      const run = o.createRun([{ id: "t", title: "T", signals: { restrictedActions: [action] } }]);
      assert.deepEqual(o.next(run).launch, []);
      assert.equal(statusOf(run, "t"), "BLOCKED");
      assert.equal(task(run, "t").agent, null);
      assert.throws(() => o.requeue(run, "t"), /can't be requeued/, "and it can't be pushed through later");
    });
  }
  test("an approved restricted action stays in the main session", () => {
    const run = o.createRun([{ id: "t", title: "T", signals: { restrictedActions: ["migration-apply"], approvalConfirmed: true } }]);
    const out = o.next(run);
    assert.deepEqual(out.launch, []);
    assert.deepEqual(out.inMain, ["t"]);
  });
  test("escalating after failures changes the model and nothing else", () => {
    const run = o.createRun([impl("a", ["x"])]);
    const before = task(run, "a").owns.join();
    o.next(run); o.started(run, "a"); o.fail(run, "a", "crash");
    o.next(run); o.started(run, "a"); o.fail(run, "a", "crash");
    const [l] = o.next(run).launch;
    assert.equal(l.model, "opus");
    assert.equal(task(run, "a").owns.join(), before);
    assert.match(l.prompt, /Never apply migrations/);
  });
  test("workers can't write the run's record, or the orchestrator itself", () => {
    for (const f of [".claude/orchestrator/runs/x.json", ".claude/skills/parallel-task-orchestrator/scripts/orchestrate.cjs"]) {
      assert.ok(refusalFor({ tool_name: "Write", tool_input: { file_path: f } }, "standard", ROOT), f);
    }
  });
  test("no worker agent can start another", () => {
    for (const name of ["quick-task-agent", "development-agent", "architecture-agent", "security-review-agent"]) {
      const tools = fs.readFileSync(path.join(ROOT, ".claude", "agents", `${name}.md`), "utf8").match(/^tools: *(.*)$/m)[1];
      assert.doesNotMatch(tools, /\bAgent\b|\bTask\b/, name);
    }
  });
});

describe("12. a worker's whole lifecycle", () => {
  test("assigned, started, running, reporting, completed, closed", () => {
    const run = o.createRun([impl("a", ["x"])]);
    assert.equal(task(run, "a").lifecycle, "NOT_STARTED");
    o.next(run);
    assert.equal(task(run, "a").lifecycle, "ASSIGNED");
    o.started(run, "a", "agent-1");
    assert.equal(task(run, "a").lifecycle, "RUNNING");
    assert.equal(statusOf(run, "a"), "RUNNING");
    o.report(run, "a", REPORT());
    assert.equal(task(run, "a").lifecycle, "COMPLETED");
    assert.equal(statusOf(run, "a"), "COMPLETED");
    o.close(run, "a");
    assert.equal(task(run, "a").lifecycle, "CLOSED");
    assert.equal(task(run, "a").agentId, "agent-1");
  });
  test("it can't skip a step, or close before its report", () => {
    const run = o.createRun([impl("a", ["x"])]);
    assert.throws(() => o.started(run, "a"), /can't start/);
    o.next(run);
    assert.throws(() => o.close(run, "a"), /hasn't been collected/);
    o.started(run, "a");
    assert.throws(() => o.started(run, "a"), /can't start/);
    assert.throws(() => o.close(run, "a"), /hasn't been collected/);
  });
  test("a worker that changed a file it doesn't own is held for the main session", () => {
    const run = o.createRun([impl("a", ["src/a.ts"])]);
    o.next(run); o.started(run, "a");
    const out = o.report(run, "a", REPORT({ filesChanged: ["src/a.ts", "src/other.ts"] }));
    assert.equal(out.action, "needs-the-main-session");
    assert.equal(statusOf(run, "a"), "BLOCKED");
    assert.match(task(run, "a").blockers[0], /src\/other\.ts/);
  });
  test("a blocked report needs the main session", () => {
    const run = o.createRun([impl("a", ["x"])]);
    o.next(run); o.started(run, "a");
    o.report(run, "a", REPORT({ status: "blocked", blockers: ["needs y.ts"] }));
    assert.equal(statusOf(run, "a"), "BLOCKED");
    assert.deepEqual(task(run, "a").blockers, ["needs y.ts"]);
  });
});

describe("13. worktree cleanup, on a real temporary repository", () => {
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  function repo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrator-"));
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "t@example.invalid");
    git(dir, "config", "user.name", "T");
    fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "first");
    const wt = path.join(dir, "wt");
    git(dir, "worktree", "add", "-q", "-b", "worker", wt);
    return { dir, wt };
  }
  const remove = (dir) => fs.rmSync(dir, { recursive: true, force: true });
  test("an unchanged worktree can go", () => {
    const { dir, wt } = repo();
    assert.equal(o.worktreeDecision(wt, "main").remove, true);
    remove(dir);
  });
  test("a changed file keeps it", () => {
    const { dir, wt } = repo();
    fs.writeFileSync(path.join(wt, "a.txt"), "changed\n");
    assert.deepEqual(o.worktreeDecision(wt, "main"), { remove: false, reason: "it has uncommitted or untracked changes" });
    remove(dir);
  });
  test("an untracked file keeps it", () => {
    const { dir, wt } = repo();
    fs.writeFileSync(path.join(wt, "new.txt"), "new\n");
    assert.equal(o.worktreeDecision(wt, "main").remove, false);
    remove(dir);
  });
  test("an unmerged commit keeps it", () => {
    const { dir, wt } = repo();
    fs.writeFileSync(path.join(wt, "b.txt"), "b\n");
    git(wt, "add", ".");
    git(wt, "commit", "-qm", "worker");
    assert.match(o.worktreeDecision(wt, "main").reason, /1 commit/);
    git(dir, "merge", "-q", "worker");
    assert.equal(o.worktreeDecision(wt, "main").remove, true, "and once merged it can go");
    remove(dir);
  });
  test("anything it can't check keeps it", () => {
    assert.equal(o.worktreeDecision(path.join(os.tmpdir(), "no-such-worktree"), "main").remove, false);
    assert.equal(o.worktreeDecision("x", "main", () => { throw new Error("git broke"); }).remove, false);
    assert.equal(o.worktreeDecision("x", "main", (a) => (a[0] === "status" ? "" : "not a number")).remove, false);
  });
});

describe("13b. a worktree has to start from the right place", () => {
  test("on the default branch, or with baseRef head, it's fine", () => {
    assert.equal(o.worktreeBaseProblem({ head: "abc", defaultHead: "abc" }), null);
    assert.equal(o.worktreeBaseProblem({ head: "abc", defaultHead: "def", baseRef: "head" }), null);
  });
  test("on another branch, or when it can't tell, the task is blocked and doesn't launch", () => {
    for (const state of [{ head: "abc", defaultHead: "def" }, { head: "abc", defaultHead: null }, { head: null, defaultHead: null }, { head: "abc", defaultHead: "def", baseRef: "fresh" }]) {
      const problem = o.worktreeBaseProblem(state);
      assert.match(problem, /default branch/);
      const run = o.createRun([impl("w", ["x"], { isolation: "worktree" }), impl("s", ["y"])], { worktreeProblem: problem });
      assert.equal(statusOf(run, "w"), "BLOCKED");
      assert.deepEqual(o.next(run).launch.map((l) => l.id), ["s"], "other work still runs");
    }
  });
});

describe("14. an interrupted parent session", () => {
  const cli = (env, ...args) => spawnSync(process.execPath, [path.join(__dirname, "..", "scripts", "orchestrate.cjs"), ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  test("running work is held as unknown, and nothing restarts by itself", () => {
    const run = o.createRun([impl("a", ["a"]), impl("b", ["b"]), impl("c", ["c"], { dependsOn: ["a"] })]);
    o.next(run);
    o.started(run, "a");
    o.started(run, "b");
    o.report(run, "b", REPORT());
    const reloaded = JSON.parse(JSON.stringify(run));
    assert.deepEqual(o.markInterrupted(reloaded), ["a"]);
    assert.equal(statusOf(reloaded, "a"), "BLOCKED");
    assert.match(task(reloaded, "a").blockers[0], /Interrupted/);
    assert.equal(statusOf(reloaded, "b"), "COMPLETED", "a collected result survives");
    assert.deepEqual(o.next(reloaded).launch, [], "nothing is relaunched, so no work is duplicated");
    assert.equal(statusOf(reloaded, "c"), "BLOCKED");
  });
  test("the main session can decide to run it again, after checking", () => {
    const run = o.createRun([impl("a", ["a"])]);
    o.next(run);
    o.started(run, "a");
    o.markInterrupted(run);
    o.requeue(run, "a");
    assert.equal(o.next(run).launch.length, 1);
  });
  test("the record survives on disk, through a separate process each step", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrator-"));
    const env = { CLAUDE_PROJECT_DIR: dir };
    const tasks = path.join(dir, "tasks.json");
    fs.writeFileSync(tasks, JSON.stringify([impl("a", ["a"])]));
    assert.equal(cli(env, "create", tasks, "r1").status, 0);
    assert.match(cli(env, "next", "r1").stdout, /development-agent/);
    assert.equal(cli(env, "started", "r1", "a", "agent-1").status, 0);
    assert.match(cli(env, "interrupted", "r1").stdout, /"a"/);
    assert.match(cli(env, "dashboard", "r1").stdout, /BLOCKED/);
    assert.equal(cli(env, "bad-command").status, 2);
    assert.equal(cli(env, "close", "no-such-run", "a").status, 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  test("a run's id can't reach outside its folder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrator-"));
    const tasks = path.join(dir, "tasks.json");
    fs.writeFileSync(tasks, JSON.stringify([impl("a", ["a"])]));
    assert.equal(cli({ CLAUDE_PROJECT_DIR: dir }, "create", tasks, "..\\..\\..\\evil").status, 0);
    assert.equal(fs.existsSync(path.join(dir, "..", "evil.json")), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("15. results come back to one place", () => {
  test("the dashboard has every column and task", () => {
    const run = o.createRun([impl("a", ["src/a.ts"]), impl("b", ["src/b.ts"], { dependsOn: ["a"] }), { id: "z", title: "Blocked", signals: { restrictedActions: ["deploy"] } }]);
    o.next(run);
    completeWorker(run, "a", REPORT({ summary: "Added | it", tests: "vitest 3 passed" }));
    const text = o.dashboard(run);
    for (const head of ["TASK ID", "WORKER", "MODEL", "STATUS", "FILES OWNED", "DEPENDENCIES", "RESULT", "TESTS", "BLOCKERS"]) assert.ok(text.includes(head), head);
    assert.match(text, /\| a \| development-agent \| sonnet \(planned\) \| COMPLETED \| src\/a\.ts \| - \| Added \/ it \| vitest 3 passed \| - \|/);
    assert.match(text, /\| b \|.*QUEUED \| src\/b\.ts \| a \|/);
    assert.match(text, /\| z \| - \|.*BLOCKED/);
  });
  test("the final account refuses while anything is unaccounted for", () => {
    const run = o.createRun([impl("a", ["a"]), impl("b", ["b"])]);
    assert.throws(() => o.finish(run), /Still open: a \(QUEUED\), b \(QUEUED\)/);
    o.next(run);
    o.started(run, "a");
    assert.throws(() => o.finish(run), /a \(RUNNING\)/);
    o.report(run, "a", REPORT());
    o.started(run, "b");
    o.report(run, "b", REPORT({ summary: "second" }));
    const out = o.finish(run);
    assert.equal(out.complete, true);
    assert.equal(out.counts.COMPLETED, 2);
    assert.deepEqual(out.tasks.map((t) => t.result), ["It worked", "second"]);
  });
  test("a failure stays visible in the final account", () => {
    const run = o.createRun([impl("a", ["a"])]);
    o.next(run); o.started(run, "a"); o.fail(run, "a", "permission-denied", "no");
    const out = o.finish(run);
    assert.equal(out.complete, false);
    assert.equal(out.counts.BLOCKED, 1);
    assert.match(out.tasks[0].blockers[0], /permission-denied/);
  });
  test("what changed on disk is checked against who owned it, and nothing is reverted", () => {
    const run = o.createRun([impl("a", ["src/a.ts"]), impl("b", ["src/b.ts"])]);
    assert.deepEqual(o.reconcile(run, ["src/a.ts", "src/b.ts"]).clean, true);
    const out = o.reconcile(run, ["src/a.ts", "src/stray.ts"]);
    assert.deepEqual(out.unowned, ["src/stray.ts"]);
    assert.equal(out.clean, false);
  });
  test("two workers claiming the same file is reported", () => {
    const run = o.createRun([impl("a", ["src"]), impl("b", ["lib"])]);
    task(run, "a").filesChanged = ["shared.ts"];
    task(run, "b").filesChanged = ["./shared.ts"];
    assert.deepEqual(o.reconcile(run, []).claimedByTwo, [{ file: "shared.ts", by: ["a", "b"] }]);
  });
  test("the numbers come from what happened, and estimate nothing", () => {
    const run = o.createRun([impl("a", ["a"]), impl("b", ["b"])]);
    o.next(run);
    o.started(run, "a", null, { now: "2026-01-01T00:00:00.000Z" });
    o.started(run, "b", null, { now: "2026-01-01T00:00:01.000Z" });
    o.report(run, "a", REPORT(), { now: "2026-01-01T00:00:04.000Z" });
    o.report(run, "b", REPORT(), { now: "2026-01-01T00:00:05.000Z" });
    const m = o.metrics(run);
    assert.deepEqual([m.workerLaunches, m.peakConcurrent, m.summedWorkerMs, m.wallClockMs, m.failures, m.duplicateTasks], [2, 2, 8000, 5000, 0, 0]);
    assert.equal(Object.keys(m).some((k) => /saving|cost/i.test(k)), false);
  });
  test("no worker can be lost: every status is one of the agreed six", () => {
    const allowed = new Set(["QUEUED", "RUNNING", "BLOCKED", "FAILED", "COMPLETED", "CANCELLED"]);
    const run = o.createRun([impl("a", ["a"]), impl("b", ["b"]), impl("c", ["c"]), { id: "d", title: "D", signals: { restrictedActions: ["deploy"] } }]);
    o.next(run); o.started(run, "a"); o.started(run, "b"); o.started(run, "c");
    o.report(run, "a", "nothing useful");
    o.fail(run, "b", "permission-denied");
    o.cancel(run, "c", "x");
    for (const t of run.tasks) assert.ok(allowed.has(t.status), t.status);
  });
});
