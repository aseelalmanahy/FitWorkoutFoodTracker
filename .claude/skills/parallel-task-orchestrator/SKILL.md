---
name: parallel-task-orchestrator
description: Coordinates up to three specialist subagents working at once from the main session, with the model router choosing each one. Use when a substantial request splits into tasks that are genuinely independent, or when asked to run work in parallel. Not for a single task, or for tasks that touch the same files, unless they run in order.
argument-hint: "[request to split up]"
---

# Parallel task orchestrator

**You, the main session, are the orchestrator and the single source of truth.** Workers report to you, you keep the record, and you do the final integration. Workers never talk to the owner, and never hold an approval.

`S` below means `node .claude/skills/parallel-task-orchestrator/scripts/orchestrate.cjs`.

## First, decide whether this is worth it

Parallel work costs more tokens, as every worker starts cold, and it only saves time when tasks really are independent. **Do the work yourself, or use one agent, when:**

- There's one task, or it's small enough that briefing a worker takes longer than doing it.
- The tasks depend on each other's results, or need the same files.
- It needs a restricted action. That stays with you and the owner's explicit approval.

Never add a worker because capacity exists.

## Steps

1. **Split the request** into tasks. For each, decide its dependencies, the exact files it may change (`owns`), and its signals, as defined in the `intelligent-model-router` skill. Read-only tasks own nothing. Write them to a JSON file in the scratchpad:

   ```json
   [{ "id": "A", "title": "Short title", "goal": "Everything the worker needs, as it starts with no context", "signals": {}, "owns": ["src/x.ts"], "dependsOn": [] }]
   ```

2. **Create the run:** `S create <tasks.json> <run-id>`. Each task is routed here. Tasks that overlap on a file are put in order automatically. Show the owner the dashboard if the run is substantial.

3. **Launch:** `S next <run-id>` returns what may start now. **For each entry, call the Agent tool, with all of them in one message, using its `subagent_type` and `prompt` exactly.** Pass `isolation: "worktree"` only if the entry says so. **Don't pass `model`,** as the agent's definition sets it. Then `S started <run-id> <task> <agentId>`.

   If `inMain` lists a task, do it yourself, then `S done-in-main <run-id> <task> "<summary>"`.

4. **While they run,** don't poll. Each result arrives by itself as a notification. Tell the owner what's running from your record. **You can't see a worker's progress until it reports,** so never describe one as further along than that. The owner can see live rows in `/tasks`.

5. **When a worker reports:** save its reply to a file, then `S report <run-id> <task> <file>`. Do what the `action` says:

   | `action` | Do this |
   |---|---|
   | `collected` | Record its model, then close it |
   | `retry` | Run `S next` and launch it again. The attempts are bounded, and the router may move it up a tier |
   | `gave-up` | It's FAILED. Tell the owner, with its failure record |
   | `needs-the-main-session` | It's BLOCKED. Read the blockers, and decide or ask the owner |

   A worker that never reports, or whose failure notification arrives: `S fail <run-id> <task> <kind> "<detail>"`, with `crash`, `context-limit`, `tool-failure`, `test-failure`, `missing-report`, `permission-denied`, `conflict`, `model-unavailable` or `needs-approval`.

6. **Record the model used:** `node .claude/skills/intelligent-model-router/scripts/verify-model.cjs <transcript>`, then `S model <run-id> <task> <model>`. Transcripts are under `~/.claude/projects/<project>/<session>/subagents/agent-<agentId>.jsonl`. **Only state a model as used if this verified it.**

7. **Close it:** `S close <run-id> <task>`, then `S next` again, as a slot and perhaps a dependency are now free. Finished workers need no further stopping.

8. **To cancel:** stop the worker with the `TaskStop` tool, then `S cancel <run-id> <task> "<reason>"`. Its partial changes stay on disk, for you to review.

9. **Integrate.** List what changed, with `git status --porcelain`, and run `S reconcile <run-id> <files...>`. **Stop on any conflict: keep both workers' changes, report it, and resolve it without deleting unrelated work.** Run the relevant tests yourself. A worker's "passed" is a report, not your evidence.

10. **Finish:** `S dashboard <run-id>` and `S finish <run-id>`. Report the result to the owner, including anything failed, blocked or unverified.

## If the session was interrupted

`S interrupted <run-id>`. Underway tasks become BLOCKED, as whether they survived isn't documented. Check each one's transcript and owned files. Then `S requeue <run-id> <task>`, or close it. **Nothing restarts by itself,** as that could duplicate work.

## Worktrees

**Sharing the checkout with file ownership is the default.** Use `"isolation": "worktree"` only if tasks can't be separated by file. A worktree branches from the default branch unless `worktree.baseRef` is `head`, so on a feature branch **a worker wouldn't see the branch's work.** `S create` blocks such a task. A worktree with changes stays on disk. Check it with `S worktree-check <path> <base>`, and integrate it yourself. **Never force-remove one.**

## What never changes

- **Routing and parallelism grant nothing.** A retry or a stronger model never gets more permission.
- Workers never apply migrations, seed, deploy, merge, push, commit, or touch production, `fitdb`, `fitdb_test_other` or Claude's settings. A denied permission is final, and goes to you.
- Only `quick-task-agent`, `development-agent`, `architecture-agent` and `security-review-agent` are workers. None can start another agent.
- **File ownership isn't enforced while a worker runs.** It's in the prompt, and is checked afterward by `reconcile`. See [README.md](README.md) for this and every other limit.
