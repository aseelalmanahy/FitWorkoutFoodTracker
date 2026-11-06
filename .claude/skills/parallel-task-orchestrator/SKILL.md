---
name: parallel-task-orchestrator
description: Coordinates up to three specialist subagents working at once from the main session, with the model router choosing each one. Use when a substantial request splits into tasks that are genuinely independent, or when asked to run work in parallel. Not for a single task, or for tasks that touch the same files, unless they run in order.
argument-hint: "[request to split up]"
---

# Parallel task orchestrator

**You, the main session, are the orchestrator and the single source of truth.** Workers report to you, you keep the record, and you do the final integration. Workers never talk to the owner, and never hold an approval.

`S` below means `node .claude/skills/parallel-task-orchestrator/scripts/orchestrate.cjs`.

## First, decide how many workers it deserves

**Every worker costs about 15,000 tokens before it does anything, so the biggest saving is not starting one.** Parallel work can save time, but it never saves tokens.

| Workers | When |
|---|---|
| **0** | It's trivial, or one simple file, or you already hold the context, or a cold start would cost more than the work |
| **1** | One substantial task, or reading that would bloat your context |
| **2** | Two independent, substantial tasks |
| **3** | Three independent workstreams that justify the cost. **Never more** |

Size each task. **Risk always outranks size, and length never raises it.**

| `size` | What happens |
|---|---|
| `TRIVIAL` | Main session |
| `SMALL` | Main session. With `contextIsolation`, one Haiku worker, alone, if it changes no code |
| `MEDIUM` (the default) | One specialist, by the router |
| `LARGE` | One specialist. Split it only into truly independent subtasks |
| `HIGH-RISK` (set by any risk signal) | Stronger model, and an independent review is owed |

Never add a worker because capacity exists, or to summarize another worker's result. A restricted action stays with you and the owner's explicit approval.

## Steps

1. **Split the request** into tasks. For each, decide its dependencies, the exact files it may change (`owns`), and its signals, as defined in the `intelligent-model-router` skill. Read-only tasks own nothing. Write them to a JSON file in the scratchpad:

   ```json
   [{ "id": "A", "title": "Short title", "size": "MEDIUM", "goal": "The objective, in a sentence or two", "signals": {}, "files": ["exact/paths/to/read.ts"], "inputs": "Interfaces or facts you already know", "acceptance": "How to tell it's done", "owns": ["src/x.ts"], "dependsOn": [] }]
   ```

   **Hand over what you already know,** with exact paths and facts, so that the worker doesn't explore or re-read it. Don't paste documents. To review a task, add `"reviews": ["A"]`.

2. **Create the run:** `S create <tasks.json> <run-id>`. It prints how many workers the plan needs, and any files several workers would read. Each task is routed here. Overlapping files are put in order, a repeated goal is held back, and a read-only result is reused if its `files` are byte-for-byte unchanged.

3. **Launch:** `S next <run-id>` returns what may start now. **For each entry, call the Agent tool, with all of them in one message, using its `subagent_type` and `prompt` exactly.** Pass `isolation: "worktree"` only if the entry says so. **Don't pass `model`,** as the agent's definition sets it. Then `S started <run-id> <task> <agentId>`.

   If `inMain` lists a task, do it yourself, then `S done-in-main <run-id> <task> "<summary>"`.

4. **While they run,** don't poll, and don't post a status for every event. Each result arrives by itself as a notification. **You can't see a worker's progress until it reports,** so never describe one as further along than that. The owner can see live rows in `/tasks`.

5. **When a worker reports:** save its reply to a file, then `S report <run-id> <task> <file>`. Do what the `action` says:

   | `action` | Do this |
   |---|---|
   | `collected` | Record its model, then close it |
   | `ask-for-report` | Send that worker one short message through `SendMessage` asking for its `WORKER-REPORT`, rather than re-running it |
   | `retry` | Run `S next` and launch it again. Its prompt now holds the last failure |
   | `gave-up` | It's FAILED. Tell the owner, with its failure record |
   | `needs-the-main-session` | It's BLOCKED. Read the blockers, and decide or ask the owner |

   A worker that never reports, or whose failure notification arrives: `S fail <run-id> <task> <kind> "<detail>"`, with `crash`, `tool-failure`, `test-failure`, `context-limit`, `missing-report`, `permission-denied`, `needs-approval`, `conflict`, `model-unavailable`, `invalid-input` or `unsupported-tool`. **Give the real error,** as it decides whether a retry could help.

6. **Record what it used:** `S measure <run-id> <task> <transcript>`, for its model, tokens and files read. Transcripts are under `~/.claude/projects/<project>/<session>/subagents/agent-<agentId>.jsonl`. **Only state a model as used if this verified it.**

7. **Close it:** `S close <run-id> <task>`, then `S next` again, as a slot and perhaps a dependency are now free. Finished workers need no further stopping.

8. **To cancel:** stop the worker with the `TaskStop` tool, then `S cancel <run-id> <task> "<reason>"`. Its partial changes stay on disk, for you to review.

9. **Integrate.** List what changed, with `git status --porcelain`, and run `S reconcile <run-id> <files...>`. `sequential` is fine. **On `simultaneous`, `unowned` or `unexpected`, stop: keep both workers' changes, report it, and resolve it without deleting unrelated work.** Run the relevant tests yourself, as a worker's "passed" is a report, not your evidence. Before each, `S test-check <run-id> "<command>"`, then `S test-done <run-id> "<command>" passed|failed`. Add `required` to the check for security and data-integrity tests, which always run.

10. **Finish:** `S dashboard <run-id>` and `S finish <run-id>`. Report the result to the owner, including anything failed, blocked or unverified. `reviewsOutstanding` lists high-risk changes with no finished review. Run it, or tell the owner it's still owed.

## If the session was interrupted

`S interrupted <run-id>`. Underway tasks become BLOCKED, as whether they survived isn't documented. Check each one's transcript and owned files. Then `S requeue <run-id> <task>`, or close it. **Nothing restarts by itself,** as that could duplicate work.

## Worktrees

**Sharing the checkout with file ownership is the default.** Use `"isolation": "worktree"` only if tasks can't be separated by file. A worktree branches from the default branch unless `worktree.baseRef` is `head`, so on a feature branch **a worker wouldn't see the branch's work.** `S create` blocks such a task. A worktree with changes stays on disk. Check it with `S worktree-check <path> <base>`, and integrate it yourself. **Never force-remove one.**

## What never changes

- **Routing and parallelism grant nothing.** A retry or a stronger model never gets more permission.
- Workers never apply migrations, seed, deploy, merge, push, commit, or touch production, `fitdb`, `fitdb_test_other` or Claude's settings. A denied permission is final, and goes to you.
- Only `quick-task-agent`, `development-agent`, `architecture-agent` and `security-review-agent` are workers. None can start another agent.
- **File ownership isn't enforced while a worker runs.** It's in the prompt, and is checked afterward by `reconcile`. See [README.md](README.md) for this and every other limit.
