# Parallel task orchestrator

Runs up to three specialist subagents at once from the main session, with `intelligent-model-router` choosing each one. Checked on Claude Code 2.1.319, on Windows, on 2026-11-06.

**It's Claude Code's own subagents, plus a small record of what's happening.** There's no process manager, as Claude Code already starts, reports and stops workers. `scripts/orchestrate.cjs` launches nothing. It decides what may start, and keeps the account.

## What Claude Code provides

| Capability | State, from the docs and what was seen here | Used? |
|---|---|---|
| Parallel subagents | Supported, and seen: 3 ran at once. Claude Code's own limit is 20 | **Yes,** capped at 3 here |
| Model per agent | Supported, and seen on Haiku, Sonnet and Opus | **Yes** |
| Results to the parent | Supported, and seen: a report and a completion notification | **Yes** |
| Stopping a worker | `TaskStop`, seen: the parent got a `killed` notification | **Yes** |
| A worker ending | Seen: it reports, and its notification says `completed`. It needs no separate stop | **Yes** |
| Worktrees | `isolation: "worktree"`. Seen: an unchanged one was removed automatically | **Only if needed** |
| Permissions | Workers inherit the session's mode. Background prompts surface in the main session | **Yes** |
| Live progress | **Not documented.** Rows appear in `/tasks`, for the person. The parent hears only at the end | Stated plainly |
| Agent teams, shared task lists | **Experimental and off by default,** with no session resumption, and turning them on changes how named subagents launch. The docs say to check for something lighter first | **No** |
| What happens to workers if the parent session ends | **Not documented,** and not tested live | Handled as unknown |

## How it fits together

```
owner -> main session -> orchestrate.cjs (what may start) -> Agent tool -> worker
                 ^                                                           |
                 '---------------- report and notification <-----------------'
```

**One record, one writer.** The run's file is at `.claude/orchestrator/runs/<id>.json`, ignored by Git. Only the main session writes it, and the guard refuses workers' writes to it.

**Dashboard:** `orchestrate.cjs dashboard <run>`. Its columns are task, worker, model, status, files owned, dependencies, result, tests and blockers. **It's updated when something happens, and it isn't a live feed.**

**Worker life:** `ASSIGNED`, `RUNNING` (`STARTED` is recorded in the same step), `REPORTING`, `COMPLETED`, `CLOSED`. A slot frees when a worker stops being active. A task can't close without a result or a failure record.

**Status:** `QUEUED`, `RUNNING`, `BLOCKED`, `FAILED`, `COMPLETED` or `CANCELLED`.

## What each failure does

| What happens | Result |
|---|---|
| Crash, context limit, tool failure, failed tests, or a reply with no readable report | Retried, up to 3 attempts. The third may be on a stronger tier, through the router. Then `FAILED` |
| Permission denied, or the guard refused | `BLOCKED` for the main session. **Never retried, and never moved to a stronger model** |
| Model unavailable | Moves up a tier if the router allows it, or `BLOCKED`. Never moves down |
| Changed a file it doesn't own | `BLOCKED`. Nothing is reverted |
| Its dependency failed | `BLOCKED`, naming the dependency, and so on down the chain |
| A restricted action | `BLOCKED` from the start, and can't be requeued. Once approved, it stays in the main session |
| Parent interrupted | Underway tasks are `BLOCKED` as unknown. Nothing restarts by itself |

## Measured

**Live, on 2026-11-06, with small read-only tasks. These show the mechanism, and don't predict real work.**

| Run | Workers | Peak at once | Wall clock | Summed worker time |
|---|---|---|---|---|
| Parallel, two Haiku reads | 2 | 2 | 4.2 s | 8.2 s |
| **Sequential, the same two reads** | 2 | 1 | **17.4 s** | 8.1 s |
| Parallel, Haiku, Sonnet and Opus | 3 | 3 | 17.8 s | 28.9 s |

- **The sequential run's extra 9 s or so is coordination:** the main session taking its turn between workers. That's 9.3 s measured between one worker ending and the next starting. Time is limited by the slowest worker, here Sonnet at 17.8 s, on a task Haiku and Opus finished in about 6 s.
- **Launches:** 10 across 4 runs, 9 of which finished, and one stopped on purpose. Failed: 0. Duplicated work: 0.
- **Tokens:** Claude Code reported about 8,000 to 9,600 for each of those 9 workers, on one-line tasks, 76,414 in all. **So each worker has a large fixed cost. Parallel work spends the same or more tokens to save time.**
- **No cost saving is claimed.** The main session's own use wasn't separated out.

## Tested

| Scenario | Mocked | Live |
|---|---|---|
| 1. Three independent tasks at once | Yes | **Yes** |
| 2. Two tasks needing the same file | Yes | No, as live tasks only read |
| 3. A worker blocked by a dependency | Yes | **Yes,** the second sequential task waited |
| 4 to 7. Haiku docs, Sonnet, Opus architecture, Opus review | Yes | **Yes,** model confirmed from each transcript. Their tasks were small checks, not real work |
| 8. Worker failure | Yes | No |
| 9. Cancellation | Yes | **Yes** |
| 10. Model unavailable | Yes | No |
| 11. Permission denied | Yes | **Yes:** the guard refused `git config` and the reviewer's `ls` |
| 12. Worker completes and exits | Yes | **Yes** |
| 13. Safe worktree cleanup | On real temporary repositories | **Partly:** an unchanged one went away. A changed one wasn't tried live |
| 14. Interrupted parent | Yes | **No** |
| 15. Results collected centrally | Yes | **Yes** |

`node --test .claude/skills/parallel-task-orchestrator/tests/orchestrator.test.cjs`

## Limits you should know

- **File ownership isn't enforced while a worker runs** in the shared checkout. It's in the prompt, and it's checked afterward, by the worker's report and `reconcile`. A worker that ignored it would overwrite the file first. **Static planning stops overlap only among the tasks' declared files.** Worktrees are the real isolation, at the cost below.
- **Worktrees start from the default branch,** not the branch you're on, unless `worktree.baseRef` is set to `head`. Seen here: a worktree worker found no skills, as `main` doesn't have them yet. So `create` blocks a worktree task unless the base matches. Setting `baseRef` is a project settings change, left for the owner. A subagent in a worktree also doesn't load the root `CLAUDE.md`, by the docs, which is why the rules are in each prompt.
- **The three-worker limit is applied by `next`,** and Claude Code doesn't know about it. If the main session launched workers without it, only Claude Code's limit of 20 would apply. `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` could enforce it, but that's an environment setting for the owner.
- **The guard isn't a sandbox,** and workers also inherit the session's permission mode. See the router's README, and TOOL-02.
- **Claude follows these steps by instruction.** Nothing forces it to use the orchestrator, or to keep the record current.
- **Not observed live:** a guard refusal inside a worktree, a worker crash or context limit, a changed worktree, a real multi-file change by parallel workers, or an interrupted session. Everything ran on Windows, in a trusted folder.

## Disabling it

`{"skillOverrides": {"parallel-task-orchestrator": "off"}}` in `.claude/settings.local.json`, or delete the skill's folder. To cap parallelism, lower `MAX_CONCURRENT`, or pass `maxConcurrent` to `createRun`. Run records can be deleted at any time, once nothing is running.
