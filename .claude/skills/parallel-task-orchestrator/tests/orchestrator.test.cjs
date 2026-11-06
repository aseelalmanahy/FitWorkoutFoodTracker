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
    assert.match(l.prompt, /Never migrate, seed, deploy, merge, push, commit/);
    assert.match(l.prompt, /fitdb_test_other/);
    assert.match(l.prompt, /denied permission is final/);
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
    assert.match(l.prompt, /CHANGE NO FILES/);
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
  for (const kind of ["crash", "tool-failure"]) {
    test(`${kind}: one more try on the same tier, then FAILED, with every failure kept`, () => {
      const run = start();
      assert.deepEqual(o.fail(run, "a", kind, "first"), { action: "retry", tier: "sonnet", agent: "development-agent" });
      assert.equal(o.next(run).launch.length, 1);
      o.started(run, "a");
      assert.equal(o.fail(run, "a", kind, "second").action, "gave-up");
      assert.equal(statusOf(run, "a"), "FAILED");
      assert.equal(task(run, "a").failures.length, 2);
      assert.deepEqual(o.next(run).launch, [], "no third launch");
      assert.equal(task(run, "a").launches, 2);
      assert.equal(o.finish(run).complete, false);
    });
  }
  test("failed tests get one retry with the evidence, then a stronger tier, then stop", () => {
    const run = start();
    assert.equal(o.fail(run, "a", "test-failure", "2 tests failed").tier, "sonnet");
    const [retry] = o.next(run).launch;
    assert.match(retry.prompt, /LAST ATTEMPT FAILED, so change approach: test-failure: 2 tests failed/);
    o.started(run, "a");
    const second = o.fail(run, "a", "test-failure", "1 test failed");
    assert.deepEqual([second.tier, second.agent], ["opus", "architecture-agent"]);
    assert.deepEqual(o.next(run).launch.map((l) => l.subagent_type), ["architecture-agent"]);
    o.started(run, "a");
    assert.equal(o.fail(run, "a", "test-failure", "still failing").action, "gave-up");
    assert.equal(task(run, "a").launches, 3);
    assert.deepEqual(o.next(run).launch, []);
  });
  test("a crash is no evidence that more reasoning would help, so it doesn't escalate", () => {
    const run = start();
    assert.equal(o.fail(run, "a", "crash", "api error").tier, "sonnet");
    assert.equal(task(run, "a").reasoningFailures, 0);
  });
  test("a reply with no report is a failure, and never a success", () => {
    for (const text of ["All done, trust me.", "WORKER-REPORT", "WORKER-REPORT\n{broken", 'WORKER-REPORT\n{"status":"great","summary":"x"}', 'WORKER-REPORT\n{"status":"completed","summary":"x"}', "", null]) {
      const run = start();
      const out = o.report(run, "a", text);
      assert.equal(out.recorded, false);
      assert.notEqual(statusOf(run, "a"), "COMPLETED");
      assert.equal(task(run, "a").failures[0].kind, "missing-report");
    }
  });
  test("it asks the same worker once, rather than repeating the work, then records a failure", () => {
    const run = start();
    assert.equal(o.report(run, "a", "no report").action, "ask-for-report");
    assert.equal(task(run, "a").launches, 1);
    assert.equal(o.report(run, "a", "still none").action, "gave-up");
    assert.equal(statusOf(run, "a"), "FAILED");
    assert.equal(task(run, "a").launches, 1, "it never launched again");
  });
  test("it accepts the report once asked", () => {
    const run = start();
    o.report(run, "a", "no report");
    assert.equal(o.report(run, "a", REPORT()).action, "collected");
    assert.equal(statusOf(run, "a"), "COMPLETED");
  });
  test("a report of failure counts as one", () => {
    const run = start();
    o.report(run, "a", REPORT({ status: "failed", summary: "tests failed", blockers: ["2 failed"] }));
    assert.equal(task(run, "a").failures[0].kind, "test-failure");
    assert.equal(statusOf(run, "a"), "QUEUED");
  });
  test("a worker's text can't fake a later status: the last report counts", () => {
    const whole = (status) => JSON.stringify({ status, summary: "x", filesChanged: [], tests: "none", blockers: [] });
    assert.equal(o.parseReport(`WORKER-REPORT\n${whole("completed")}\nWORKER-REPORT\n${whole("failed")}`).status, "failed");
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
    o.fail(run, "a", "test-failure", "first");
    o.next(run); o.started(run, "a");
    assert.equal(o.fail(run, "a", "test-failure", "second").action, "needs-the-main-session", "it would need Opus, which isn't available");
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
    o.next(run); o.started(run, "a"); o.fail(run, "a", "test-failure", "first");
    o.next(run); o.started(run, "a"); o.fail(run, "a", "test-failure", "second");
    const [l] = o.next(run).launch;
    assert.equal(l.model, "opus");
    assert.equal(task(run, "a").owns.join(), before);
    assert.match(l.prompt, /Never migrate/);
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
    task(run, "a").filesChanged = ["src/a.ts"];
    task(run, "b").filesChanged = ["src/b.ts"];
    assert.equal(o.reconcile(run, ["src/a.ts", "src/b.ts"]).clean, true);
    const out = o.reconcile(run, ["src/a.ts", "src/b.ts", "src/stray.ts"]);
    assert.deepEqual(out.unowned, ["src/stray.ts"]);
    assert.equal(out.clean, false);
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

// ─── Efficiency ─────────────────────────────────────────────────────────────

describe("sizing decides whether to delegate at all", () => {
  const one = (extra) => o.createRun([{ id: "t", title: "T", ...extra }]);
  test("1. a trivial task stays in the main session", () => {
    for (const extra of [{ size: "TRIVIAL" }, { signals: { trivial: true } }, { size: "TRIVIAL", owns: ["src/a.ts"] }]) {
      const run = one(extra);
      assert.equal(task(run, "t").runsIn, "main");
      assert.deepEqual(o.next(run).launch, [], "no worker");
      assert.equal(run.delegation.workers, 0);
    }
  });
  test("2. a small task stays in the main session, unless isolating its context is worth it", () => {
    assert.equal(task(one({ size: "SMALL", owns: ["src/a.ts"] }), "t").runsIn, "main");
    assert.equal(task(one({ size: "SMALL", files: ["x"] }), "t").runsIn, "main");
    const isolated = one({ size: "SMALL", contextIsolation: true, files: ["big.log"] });
    assert.deepEqual([task(isolated, "t").agent, task(isolated, "t").model], ["quick-task-agent", "haiku"]);
  });
  test("2. code stays out of the Haiku agent, even when isolation is asked for", () => {
    assert.equal(task(one({ size: "SMALL", contextIsolation: true, owns: ["src/a.ts"] }), "t").runsIn, "main");
    assert.equal(task(one({ size: "SMALL", contextIsolation: true, owns: ["docs/a.md"], signals: { documentation: true } }), "t").agent, "quick-task-agent");
  });
  test("2. a small worker runs alone, so there's no parallel coordination for it", () => {
    const small = (id, file) => ({ id, title: id, goal: id, size: "SMALL", contextIsolation: true, files: [file] });
    const run = o.createRun([small("a", "x"), small("b", "y"), impl("c", ["z"])]);
    assert.deepEqual(o.next(run).launch.map((l) => l.id), ["a"]);
    o.started(run, "a");
    assert.deepEqual(o.next(run).launch, [], "nothing joins it");
    assert.equal(run.delegation.workers, 3);
  });
  test("medium and large go to one specialist, by the router", () => {
    for (const size of ["MEDIUM", "LARGE"]) {
      assert.equal(task(one({ size, owns: ["x"] }), "t").agent, "development-agent", size);
    }
  });
  test("10. risk outranks a declared size, so nothing risky can be sized down", () => {
    for (const size of ["TRIVIAL", "SMALL", "MEDIUM", "LARGE"]) {
      const run = one({ size, signals: { securitySensitive: true }, owns: ["x"] });
      assert.equal(task(run, "t").size, "HIGH-RISK", size);
      assert.deepEqual([task(run, "t").agent, task(run, "t").model], ["architecture-agent", "opus"], size);
    }
  });
  test("10. size never changes a restriction", () => {
    for (const size of ["TRIVIAL", "SMALL", "MEDIUM", "LARGE", "HIGH-RISK"]) {
      const run = one({ size, signals: { restrictedActions: ["migration-apply"] } });
      assert.equal(statusOf(run, "t"), "BLOCKED", size);
      assert.deepEqual(o.next(run).launch, [], size);
    }
  });
  test("10. the size of a long task isn't raised by its length", () => {
    assert.equal(task(one({ goal: "Write it up. ".repeat(2000), signals: { documentation: true } }), "t").model, "haiku");
  });
  test("an unknown size is refused", () => {
    assert.throws(() => one({ size: "HUGE" }), /Unknown size/);
  });
  test("the plan says whether parallel work is worth having", () => {
    assert.match(one({ size: "TRIVIAL" }).delegation.advice, /No workers/);
    assert.match(o.createRun([impl("a", ["x"]), impl("b", ["y"], { dependsOn: ["a"] })]).delegation.advice, /No parallel benefit/);
    const three = o.createRun([impl("a", ["x"]), impl("b", ["y"]), impl("c", ["z"])]);
    assert.equal(three.delegation.peakParallel, 3);
    assert.match(three.delegation.advice, /Up to 3/);
  });
});

describe("prompts carry only what's needed", () => {
  const prompt = (extra) => { const run = o.createRun([impl("a", ["src/a.ts"], extra)]); return o.next(run).launch[0].prompt; };
  test("everything but the goal stays short, and it was about twice this", () => {
    const base = prompt({ goal: "G" });
    assert.ok(base.length < 520, `${base.length} characters of fixed text`);
  });
  test("it holds the goal, files, inputs, acceptance, ownership and limits, when given", () => {
    const p = prompt({ goal: "Add it", files: ["src/lib.ts"], inputs: "The API is f(x)", acceptance: "vitest passes" });
    for (const text of ["GOAL: Add it", "src/lib.ts", "INPUTS: The API is f(x)", "DONE WHEN: vitest passes", "CHANGE ONLY: src/a.ts", "LIMITS:", "WORKER-REPORT"]) assert.ok(p.includes(text), text);
  });
  test("empty sections are left out", () => {
    const p = prompt({ goal: "G" });
    for (const text of ["READ THESE", "INPUTS:", "DONE WHEN:", "FINISHED BEFORE", "LAST ATTEMPT"]) assert.equal(p.includes(text), false, text);
  });
  test("only a dependency's summary carries over, and it's clipped", () => {
    const run = o.createRun([impl("a", ["x"]), impl("b", ["y"], { dependsOn: ["a"] })]);
    o.next(run);
    completeWorker(run, "a", REPORT({ summary: "s".repeat(5000) }));
    const [l] = o.next(run).launch;
    assert.ok(l.prompt.length < 1200, String(l.prompt.length));
    assert.match(l.prompt, /FINISHED BEFORE YOU/);
  });
  test("no safeguard was lost to the shortening", () => {
    const p = prompt({});
    for (const word of ["migrate", "seed", "deploy", "merge", "push", "commit", "production", "fitdb", "fitdb_test_other", "Claude settings", "denied permission is final"]) assert.ok(p.includes(word), word);
  });
  test("the fixed text of every worker's prompt is the same, and only tasks differ", () => {
    const run = o.createRun([impl("a", ["x"]), impl("b", ["y"])]);
    const [p1, p2] = o.next(run).launch.map((l) => l.prompt);
    const limits = (t) => t.slice(t.indexOf("LIMITS:"));
    assert.equal(limits(p1), limits(p2));
  });
});

describe("duplicate work", () => {
  test("5. the same goal and files runs once, and the second stays visible", () => {
    const run = o.createRun([impl("a", ["x"], { goal: "Do the  THING" }), impl("b", ["x"], { goal: "do the thing" })]);
    assert.equal(task(run, "b").duplicateOf, "a");
    assert.equal(statusOf(run, "b"), "BLOCKED");
    assert.deepEqual(o.next(run).launch.map((l) => l.id), ["a"]);
    assert.throws(() => o.requeue(run, "b"), /can't be requeued/);
    assert.equal(o.metrics(run).duplicateTasks, 1);
    o.started(run, "a");
    o.report(run, "a", REPORT());
    assert.equal(o.finish(run).complete, false, "and it isn't dropped from the account");
  });
  test("the same goal on different files isn't a duplicate", () => {
    const run = o.createRun([impl("a", ["x"], { goal: "Format" }), impl("b", ["y"], { goal: "Format" })]);
    assert.equal(task(run, "b").duplicateOf, null);
  });
  test("workers set to read the same file are pointed out", () => {
    const run = o.createRun([impl("a", ["x"], { files: ["src/big.ts"] }), impl("b", ["y"], { files: ["./SRC/big.ts"] })]);
    assert.deepEqual(run.delegation.sharedReads, [{ file: "src/big.ts", by: ["a", "b"] }]);
  });

  const read = (id, goal = "Summarize it", extra = {}) => ({ id, title: id, goal, files: ["src/a.ts"], signals: { lightweightAnalysis: true }, ...extra });
  const hashes = (h) => () => ({ "src/a.ts": h });
  const finished = (hash, reportExtra = {}) => {
    const run = o.createRun([read("p")], { id: "earlier", hashInputs: hashes(hash) });
    o.next(run);
    o.started(run, "p");
    o.report(run, "p", REPORT({ summary: "Earlier answer", ...reportExtra }), { hashInputs: hashes(hash) });
    return run;
  };
  test("a read-only result is reused when its inputs are byte-for-byte the same", () => {
    const run = o.createRun([read("n")], { previousRuns: [finished("h1")], hashInputs: hashes("h1") });
    assert.equal(statusOf(run, "n"), "COMPLETED");
    assert.equal(task(run, "n").reusedFrom, "earlier/p");
    assert.equal(task(run, "n").result, "Earlier answer");
    assert.deepEqual(o.next(run).launch, [], "no worker");
    assert.equal(o.metrics(run).reusedResults, 1);
  });
  test("it's never reused once a file changes", () => {
    const run = o.createRun([read("n")], { previousRuns: [finished("h1")], hashInputs: hashes("h2") });
    assert.equal(statusOf(run, "n"), "QUEUED");
    assert.equal(o.next(run).launch.length, 1);
  });
  test("it's never reused if a file changed while the earlier worker ran", () => {
    const run = o.createRun([read("p")], { id: "earlier", hashInputs: hashes("h1") });
    o.next(run);
    o.started(run, "p");
    o.report(run, "p", REPORT(), { hashInputs: hashes("h2") });
    assert.equal(task(run, "p").stableInputs, null);
    assert.equal(statusOf(o.createRun([read("n")], { previousRuns: [run], hashInputs: hashes("h2") }), "n"), "QUEUED");
  });
  for (const [label, make] of [
    ["high-risk work", () => read("n", "Summarize it", { signals: { securitySensitive: true } })],
    ["a review", () => read("n", "Summarize it", { signals: { isReview: true, securitySensitive: true } })],
    ["a different goal", () => read("n", "Something else")],
  ]) {
    test(`it's never reused for ${label}`, () => {
      assert.notEqual(task(o.createRun([make()], { previousRuns: [finished("h1")], hashInputs: hashes("h1") }), "n").reusedFrom, "earlier/p");
      assert.equal(task(o.createRun([make()], { previousRuns: [finished("h1")], hashInputs: hashes("h1") }), "n").reusedFrom, null);
    });
  }
  test("it's never reused if the task changes files, ran tests, or declared no inputs, or a file is missing", () => {
    const opts = { previousRuns: [finished("h1")], hashInputs: hashes("h1") };
    assert.equal(task(o.createRun([read("n", "Summarize it", { owns: ["x"], signals: {} })], opts), "n").reusedFrom, null);
    assert.equal(task(o.createRun([read("n")], { previousRuns: [finished("h1", { tests: "vitest passed" })], hashInputs: hashes("h1") }), "n").reusedFrom, null);
    assert.equal(task(o.createRun([read("n", "Summarize it", { files: [] })], opts), "n").reusedFrom, null);
    assert.equal(task(o.createRun([read("n")], { previousRuns: [finished("h1")], hashInputs: () => ({ "src/a.ts": null }) }), "n").reusedFrom, null);
  });

  test("a pass is reused only for the same command on exactly the same code", () => {
    const run = o.createRun([impl("a", ["x"])]);
    assert.equal(o.testDecision(run, "vitest", "f1").run, true, "it hasn't run");
    o.recordTest(run, "vitest", "f1", "passed");
    assert.equal(o.testDecision(run, "vitest", "f1").run, false);
    assert.equal(o.testDecision(run, "vitest", "f2").run, true, "stale after a code change");
    assert.equal(o.testDecision(run, "other", "f1").run, true);
    assert.equal(o.testDecision(run, "vitest", null).run, true, "unknown state");
  });
  test("a failure is never reused, and security tests always run", () => {
    const run = o.createRun([impl("a", ["x"])]);
    o.recordTest(run, "vitest", "f1", "failed");
    assert.equal(o.testDecision(run, "vitest", "f1").run, true);
    o.recordTest(run, "guard", "f1", "passed");
    assert.equal(o.testDecision(run, "guard", "f1", { required: true }).run, true);
    assert.throws(() => o.recordTest(run, "vitest", "f1", "probably"));
  });
  test("the code's fingerprint changes with any edit, and with new files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrator-"));
    const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git("init", "-q", "-b", "main"); git("config", "user.email", "t@example.invalid"); git("config", "user.name", "T");
    fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
    git("add", "."); git("commit", "-qm", "first");
    const first = o.treeFingerprint(dir);
    assert.equal(o.treeFingerprint(dir), first, "it's stable");
    fs.writeFileSync(path.join(dir, "a.txt"), "b\n");
    const edited = o.treeFingerprint(dir);
    assert.notEqual(edited, first);
    fs.writeFileSync(path.join(dir, "new.txt"), "1\n");
    const added = o.treeFingerprint(dir);
    assert.notEqual(added, edited);
    fs.writeFileSync(path.join(dir, "new.txt"), "2\n");
    assert.notEqual(o.treeFingerprint(dir), added, "an untracked file's contents count");
    assert.equal(o.treeFingerprint(path.join(dir, "no-such-dir")), null);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("7. reconcile tells conflicts from authorized work", () => {
  const at = (s) => `2026-01-01T00:00:${String(s).padStart(2, "0")}.000Z`;
  const worked = (run, id, from, to, files) => { Object.assign(task(run, id), { startedAt: at(from), endedAt: at(to), filesChanged: files }); };
  test("sequential edits to one file aren't a conflict", () => {
    const run = o.createRun([impl("a", ["src/x.ts"]), impl("b", ["src/x.ts"])]);
    worked(run, "a", 0, 5, ["src/x.ts"]);
    worked(run, "b", 6, 9, ["src/x.ts"]);
    const out = o.reconcile(run, ["src/x.ts"]);
    assert.deepEqual(out.sequential, [{ file: "src/x.ts", by: ["a", "b"] }]);
    assert.deepEqual(out.simultaneous, []);
    assert.equal(out.clean, true);
  });
  test("two workers changing one file at the same time is a genuine conflict", () => {
    const run = o.createRun([impl("a", ["src"]), impl("b", ["lib"])]);
    worked(run, "a", 0, 5, ["src/x.ts"]);
    worked(run, "b", 3, 9, ["src/x.ts"]);
    const out = o.reconcile(run, ["src/x.ts"]);
    assert.deepEqual(out.simultaneous, [{ file: "src/x.ts", by: ["a", "b"] }]);
    assert.equal(out.clean, false);
  });
  test("with no recorded times, it's treated as simultaneous, as nothing shows otherwise", () => {
    const run = o.createRun([impl("a", ["x"]), impl("b", ["x"])]);
    task(run, "a").filesChanged = ["x"];
    task(run, "b").filesChanged = ["./X"];
    const out = o.reconcile(run, []);
    assert.deepEqual(out.simultaneous, [{ file: "x", by: ["a", "b"] }]);
    assert.equal(out.clean, false);
  });
  test("declaring the same file isn't a conflict by itself, if only one worker changed it", () => {
    const run = o.createRun([impl("a", ["x"]), impl("b", ["x"])]);
    worked(run, "a", 0, 5, ["x"]);
    assert.equal(o.reconcile(run, ["x"]).clean, true);
  });
  test("a change nobody owns is unowned", () => {
    const run = o.createRun([impl("a", ["x"])]);
    worked(run, "a", 0, 5, ["x"]);
    const out = o.reconcile(run, ["x", "y"]);
    assert.deepEqual(out.unowned, ["y"]);
    assert.equal(out.clean, false);
  });
  test("an owned file that no worker reported changing is unexpected", () => {
    const run = o.createRun([impl("a", ["x"])]);
    worked(run, "a", 0, 5, []);
    const out = o.reconcile(run, ["x"]);
    assert.equal(out.unexpected[0].file, "x");
    assert.match(out.unexpected[0].reason, /no worker reported/);
    assert.equal(out.clean, false);
  });
  test("a worker reporting a file it doesn't own is unexpected", () => {
    const run = o.createRun([impl("a", ["x"]), impl("b", ["y"])]);
    worked(run, "a", 0, 5, ["y"]);
    const out = o.reconcile(run, ["y"]);
    assert.equal(out.unexpected[0].by, "a");
    assert.equal(out.clean, false);
  });
  test("a reported change that isn't on disk still gets checked", () => {
    const run = o.createRun([impl("a", ["x"])]);
    worked(run, "a", 0, 5, ["z"]);
    assert.equal(o.reconcile(run, []).clean, false);
  });
});

describe("8 and 9. retries need a reason", () => {
  const start = () => { const run = o.createRun([impl("a", ["x"])]); o.next(run); o.started(run, "a"); return run; };
  for (const kind of ["permission-denied", "needs-approval", "conflict", "model-unavailable", "invalid-input", "unsupported-tool", "context-limit"]) {
    test(`${kind} goes straight to the main session, with no retry and no escalation`, () => {
      const run = start();
      assert.equal(o.fail(run, "a", kind, "detail").action, "needs-the-main-session");
      assert.equal(statusOf(run, "a"), "BLOCKED");
      assert.deepEqual([task(run, "a").attempts, task(run, "a").reasoningFailures, task(run, "a").tier, task(run, "a").launches], [0, 0, "sonnet", 1]);
      assert.deepEqual(o.next(run).launch, []);
    });
  }
  for (const detail of ["ENOENT: no such file src/x.ts", "Invalid path given", "Unsupported tool", "unknown tool Foo", "Permission denied by the guard", "Module not found"]) {
    test(`a deterministic cause isn't retried, whatever it was filed under: ${detail}`, () => {
      for (const kind of ["crash", "tool-failure", "test-failure"]) {
        const run = start();
        assert.equal(o.fail(run, "a", kind, detail).action, "needs-the-main-session", kind);
        assert.equal(task(run, "a").tier, "sonnet", "never moved to a stronger model");
        assert.deepEqual(o.next(run).launch, []);
      }
    });
  }
  test("the same failure twice stops at once, as another try has no reason to differ", () => {
    const run = start();
    assert.equal(o.fail(run, "a", "test-failure", "same output").action, "retry");
    o.next(run); o.started(run, "a");
    assert.equal(o.fail(run, "a", "test-failure", "same output").action, "gave-up");
    assert.equal(task(run, "a").launches, 2);
    assert.equal(task(run, "a").tier, "sonnet", "no escalation for it");
  });
  test("a crash never reaches Opus, however often it happens", () => {
    const run = start();
    o.fail(run, "a", "crash", "one");
    o.next(run); o.started(run, "a");
    assert.equal(o.fail(run, "a", "crash", "two").action, "gave-up");
    assert.equal(task(run, "a").tier, "sonnet");
  });
  test("launches are bounded across mixed failures", () => {
    const run = start();
    o.fail(run, "a", "crash", "one");
    o.next(run); o.started(run, "a");
    o.fail(run, "a", "test-failure", "two");
    assert.ok(task(run, "a").launches <= o.MAX_ATTEMPTS);
    if (statusOf(run, "a") === "QUEUED") {
      o.next(run); o.started(run, "a");
      assert.equal(o.fail(run, "a", "test-failure", "three").action, "gave-up");
    }
    assert.ok(task(run, "a").launches <= o.MAX_ATTEMPTS);
  });
  test("a worker's report of a blocked permission isn't retried", () => {
    const run = start();
    o.report(run, "a", REPORT({ status: "failed", summary: "x", blockers: ["permission denied by the guard"] }));
    assert.equal(statusOf(run, "a"), "BLOCKED");
    assert.equal(task(run, "a").launches, 1);
  });
});

describe("11. security-sensitive work keeps its review", () => {
  const risky = (id = "a") => impl(id, ["src/auth.ts"], { signals: { securitySensitive: true } });
  const review = (id, reviews) => ({ id, title: "Review", goal: `Review ${reviews}`, signals: { isReview: true, securitySensitive: true }, reviews, dependsOn: reviews });
  test("a high-risk change isn't complete without its review", () => {
    const run = o.createRun([risky()]);
    o.next(run);
    completeWorker(run, "a");
    assert.deepEqual(o.reviewsOutstanding(run), ["a"]);
    const out = o.finish(run);
    assert.equal(out.complete, false);
    assert.deepEqual(out.reviewsOutstanding, ["a"]);
  });
  test("a finished review by the read-only agent settles it", () => {
    const run = o.createRun([risky(), review("r", ["a"])]);
    o.next(run);
    completeWorker(run, "a");
    const [l] = o.next(run).launch;
    assert.equal(l.subagent_type, "security-review-agent");
    completeWorker(run, "r");
    assert.deepEqual(o.reviewsOutstanding(run), []);
    assert.equal(o.finish(run).complete, true);
  });
  test("a failed review doesn't settle it", () => {
    const run = o.createRun([risky(), review("r", ["a"])]);
    o.next(run);
    completeWorker(run, "a");
    o.next(run);
    o.started(run, "r");
    o.fail(run, "r", "permission-denied", "no");
    assert.deepEqual(o.reviewsOutstanding(run), ["a"]);
  });
  test("a review result is never reused", () => {
    const earlier = o.createRun([{ id: "r", title: "R", goal: "Review it", files: ["a"], signals: { isReview: true, securitySensitive: true } }], { id: "e", hashInputs: () => ({ a: "h" }) });
    o.next(earlier); o.started(earlier, "r"); o.report(earlier, "r", REPORT(), { hashInputs: () => ({ a: "h" }) });
    const run = o.createRun([{ id: "r2", title: "R", goal: "Review it", files: ["a"], signals: { isReview: true, securitySensitive: true } }], { previousRuns: [earlier], hashInputs: () => ({ a: "h" }) });
    assert.equal(statusOf(run, "r2"), "QUEUED");
  });
  test("routine work owes no review", () => {
    const run = o.createRun([impl("a", ["x"])]);
    o.next(run);
    completeWorker(run, "a");
    assert.equal(o.finish(run).complete, true);
  });
});

describe("12 to 14. nothing gets lost, and the limit holds", () => {
  test("12. a report has every field, or it isn't accepted", () => {
    for (const missing of ["status", "summary", "filesChanged", "tests", "blockers"]) {
      const whole = { status: "completed", summary: "x", filesChanged: [], tests: "none", blockers: [] };
      delete whole[missing];
      assert.equal(o.parseReport(`WORKER-REPORT\n${JSON.stringify(whole)}`), null, missing);
    }
  });
  test("14. the limit can't be raised past three", () => {
    assert.throws(() => o.createRun([impl("a", ["x"])], { maxConcurrent: 4 }), /1 to 3/);
    assert.throws(() => o.createRun([impl("a", ["x"])], { maxConcurrent: 20 }), /1 to 3/);
  });
  // Random but repeatable orders of every outcome. Each step checks both promises, on every path.
  function seeded(seed) { let x = seed; return () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; }; }
  const OUTCOMES = [
    (r, id) => o.report(r, id, REPORT()), (r, id) => o.report(r, id, "no report"), (r, id) => o.report(r, id, REPORT({ status: "failed", summary: "x", blockers: [`b${r.events.length}`] })),
    (r, id) => o.report(r, id, REPORT({ status: "blocked", blockers: ["y"] })), (r, id) => o.fail(r, id, "crash", `c${r.events.length}`), (r, id) => o.fail(r, id, "permission-denied", "no"), (r, id) => o.cancel(r, id, "stop"),
  ];
  for (let seed = 1; seed <= 25; seed++) {
    test(`13 and 14. seed ${seed}: never more than three running, and every task accounted for`, () => {
      const random = seeded(seed * 7919);
      const input = Array.from({ length: 9 }, (_, i) => impl(`t${i}`, [`src/${i % 6}.ts`], { goal: `Goal ${i}`, dependsOn: i > 2 && random() < 0.3 ? [`t${Math.floor(random() * i)}`] : [] }));
      const run = o.createRun(input);
      for (let step = 0; step < 200; step++) {
        for (const l of o.next(run).launch) o.started(run, l.id);
        const running = run.tasks.filter((t) => t.status === "RUNNING");
        assert.ok(running.length <= 3, `${running.length} running`);
        if (!running.length) break;
        const t = running[Math.floor(random() * running.length)];
        OUTCOMES[Math.floor(random() * OUTCOMES.length)](run, t.id);
      }
      assert.equal(run.tasks.length, 9);
      assert.equal(o.metrics(run).peakConcurrent <= 3, true);
      const open = run.tasks.filter((t) => t.status === "QUEUED" || t.status === "RUNNING");
      assert.deepEqual(open.map((t) => t.id), [], "nothing is left waiting silently");
      assert.equal(o.finish(run).tasks.length, 9);
      for (const t of run.tasks) {
        assert.ok(t.launches <= o.MAX_ATTEMPTS, `${t.id} launched ${t.launches} times`);
        if (t.status !== "COMPLETED") assert.ok(t.blockers.length || t.result || t.failures.length, `${t.id} has no account`);
      }
    });
  }
});

describe("measurements are of what happened", () => {
  const line = (entry) => JSON.stringify(entry);
  const assistant = (id, content, usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }) => line({ type: "assistant", timestamp: "2026-01-01T00:00:01.000Z", message: { id, model: "claude-haiku-5-5", usage, content } });
  test("a transcript gives the model, tokens and files read, counting each message once", () => {
    const read = { type: "tool_use", id: "tu1", name: "Read", input: { file_path: "C:\\Repo\\A.ts" } };
    const m = o.measureTranscript([assistant("m1", [read]), assistant("m1", [read]), "{ partial", assistant("m2", [])].join("\n"));
    assert.deepEqual(m.models, ["claude-haiku-5-5"]);
    assert.deepEqual([m.inputTokens, m.outputTokens, m.cacheReadTokens, m.cacheWriteTokens], [20, 10, 200, 40]);
    assert.deepEqual(m.filesRead, ["c:/repo/a.ts"]);
  });
  test("anything missing stays null, and is never estimated", () => {
    const m = o.measureTranscript(line({ type: "assistant", message: { model: "x", content: [] } }));
    assert.equal(m.inputTokens, null);
    assert.deepEqual(o.measureTranscript("").models, []);
    const run = o.createRun([impl("a", ["x"])]);
    assert.equal(o.metrics(run).inputTokens, null);
    assert.equal(o.metrics(run).filesReadByMoreThanOneWorker, null);
  });
  test("the run counts tokens, repeated reads and retries, and names no saving", () => {
    const run = o.createRun([impl("a", ["x"]), impl("b", ["y"])]);
    const read = (id, f) => ({ type: "tool_use", id, name: "Read", input: { file_path: f } });
    o.recordMeasurement(run, "a", o.measureTranscript(assistant("m1", [read("1", "same.ts"), read("2", "a.ts")])));
    o.recordMeasurement(run, "b", o.measureTranscript(assistant("m2", [read("3", "same.ts")])));
    const m = o.metrics(run);
    assert.deepEqual([m.measuredWorkers, m.inputTokens, m.outputTokens, m.filesReadByMoreThanOneWorker], [2, 20, 10, 1]);
    assert.equal(task(run, "a").actualModel, "claude-haiku-5-5");
    assert.match(task(run, "a").modelCheck, /MISMATCH/, "planned sonnet, so a Haiku transcript is flagged");
    assert.equal(Object.keys(m).some((k) => /saving|cost|estimate/i.test(k)), false);
  });
  test("idle time between workers is measured", () => {
    const run = o.createRun([impl("a", ["x"]), impl("b", ["y"], { dependsOn: ["a"] })]);
    o.next(run);
    o.started(run, "a", null, { now: "2026-01-01T00:00:00.000Z" });
    o.report(run, "a", REPORT(), { now: "2026-01-01T00:00:04.000Z" });
    o.next(run);
    o.started(run, "b", null, { now: "2026-01-01T00:00:10.000Z" });
    o.report(run, "b", REPORT(), { now: "2026-01-01T00:00:12.000Z" });
    const m = o.metrics(run);
    assert.deepEqual([m.idleBetweenWorkersMs, m.summedWorkerMs, m.wallClockMs, m.peakConcurrent], [6000, 6000, 12000, 1]);
  });
});
