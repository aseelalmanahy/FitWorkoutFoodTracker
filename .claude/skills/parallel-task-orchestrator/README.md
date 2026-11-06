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
| Failed tests | One retry, with the failure in the prompt. Then one on a stronger tier, through the router. Then `FAILED`. **The only failure that's evidence more reasoning could help** |
| Crash or tool failure | One more try, on the same tier, in case it was transient. Then `FAILED`. **Never escalates** |
| No complete report | The same worker is asked once, as re-running repeats all its work. Then `FAILED` |
| The same failure twice | `FAILED` at once, as another try has no reason to differ |
| Permission denied, guard refusal, missing approval, invalid path, unsupported tool, context limit | `BLOCKED` for the main session straight away, also when the error text shows it. **Never retried, and never moved to a stronger model** |
| Model unavailable | Moves up a tier when planning if the router allows it, or `BLOCKED`. Never moves down |
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

## How tokens are kept down

**Measured from those nine transcripts:** each worker used about 15,000 tokens, of which about 500 were its own output. So 139,000 or so in all, and most of it is fixed load, read from or written to the cache (77,934 read, 56,586 written). Claude Code's own notifications gave lower figures, about 8,000 each, and which it counts isn't documented. The transcript's format isn't documented either.

| Mechanism | Effect |
|---|---|
| **Not starting a worker** | By far the largest: about 15,000 tokens each, by the figure above |
| Results reused when inputs are unchanged | Avoids a whole worker, and only for read-only, low-risk work with declared files |
| A repeated goal held back | Avoids a whole worker |
| Tests skipped only on exactly the same code | Avoids the run, and never for `required` tests |
| Asking for a missing report, and bounded retries | Avoids repeating a worker's work |
| Handing over exact paths and known facts | Avoids exploring. **Not measured on real work** |
| Shorter prompts | Fixed prompt text went from 910 to 463 characters. **That's roughly 110 tokens by the usual four-characters estimate, under 1 % of a worker's load, so small, and it's an estimate** |

**No overall saving is claimed.** The live runs came before these changes, and no new benchmark was run, to avoid its cost. Repeated reads are visible now: in those runs, `package.json` and `tsconfig.json` were each read by two workers, as the sequential comparison repeated them on purpose.

## Avoiding duplicated work

- **Planning:** the same goal and files runs once. Files several workers would read are listed at creation.
- **Later:** a result is reused only if the goal matches, its declared files are byte-for-byte the same before and after the earlier worker ran, it ran no tests, and it isn't high-risk. **Everything else runs again.**
- **Tests:** a pass counts only for the same command on the same commit, uncommitted changes and new files. A failure never counts.

## Reading `reconcile`

| Result | Meaning | Clean? |
|---|---|---|
| `sequential` | Two workers reported a file, one after the other | Yes |
| `simultaneous` | Two workers reported a file while both ran, or their times aren't known | **No** |
| `unowned` | Changed, and no task owns it | **No** |
| `unexpected` | Owned but reported by nobody, or reported by a worker that doesn't own it | **No** |

**It works from what workers said and when they ran.** Ownership isn't enforced during a run, so this can't prove who wrote a file.

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

`node --test .claude/skills/parallel-task-orchestrator/tests/orchestrator.test.cjs`. Efficiency rules are mocked and simulated, including 25 repeatable random orders, each checking that no more than three run and that no task is lost. **None has been exercised on real work.**

## Limits you should know

- **File ownership isn't enforced while a worker runs** in the shared checkout. It's in the prompt, and it's checked afterward, by the worker's report and `reconcile`. A worker that ignored it would overwrite the file first. **Static planning stops overlap only among the tasks' declared files.** Worktrees are the real isolation, at the cost below.
- **Worktrees start from the default branch,** not the branch you're on, unless `worktree.baseRef` is set to `head`. Seen here: a worktree worker found no skills, as `main` doesn't have them yet. So `create` blocks a worktree task unless the base matches. Setting `baseRef` is a project settings change, left for the owner. A subagent in a worktree also doesn't load the root `CLAUDE.md`, by the docs, which is why the rules are in each prompt.
- **The three-worker limit is applied by `next`,** and Claude Code doesn't know about it. If the main session launched workers without it, only Claude Code's limit of 20 would apply. `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` could enforce it, but that's an environment setting for the owner.
- **The guard isn't a sandbox,** and workers also inherit the session's permission mode. See the router's README, and TOOL-02.
- **Claude follows these steps by instruction.** Nothing forces it to use the orchestrator, or to keep the record current.
- **Not observed live:** a guard refusal inside a worktree, a worker crash or context limit, a changed worktree, a real multi-file change by parallel workers, or an interrupted session. Everything ran on Windows, in a trusted folder.

## Disabling it

`{"skillOverrides": {"parallel-task-orchestrator": "off"}}` in `.claude/settings.local.json`, or delete the skill's folder. To cap parallelism, lower `MAX_CONCURRENT`, or pass `maxConcurrent` to `createRun`. Run records can be deleted at any time, once nothing is running.
