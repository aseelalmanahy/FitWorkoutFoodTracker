# Phase 4 execution plan

**How 4.0.3 to 4.1 and 4.0.6 get built, in what order, and who needs to approve what.** Written 2026-11-06. It approves nothing, and starts nothing.

The tracker stays the only record of status, and this plan refers to its IDs instead of repeating them. Requirements stay in `PHASE_4_0_DESIGN.md`, and the review cycle in `DEVELOPMENT_WORKFLOW.md`. **Phase 4.2, the real-user beta, isn't part of this plan.**

## 1. Where each milestone stands

These are six separate states, and one never implies another.

| State | Means |
|---|---|
| **IMPLEMENTED** | The code exists on a named commit |
| **TESTED** | Automated checks passed on that commit, on `fitdb_test` where a database is needed |
| **REVIEWED** | An independent review of that commit is finished, and its findings closed |
| **MERGED** | It's on `main` |
| **OPERATIONALLY VERIFIED** | Seen working on real infrastructure or devices |
| **BLOCKED** | Can't move forward until the listed item clears |

| Milestone | Tracker | Implemented | Tested | Reviewed | Merged | Operationally verified | Blocked by |
|---|---|---|---|---|---|---|---|
| 4.0.3 Production foundation | M-11 | Yes, `de4607f` | Yes, local production build | Yes, source review of the code | Yes, `de4607f` | **No, nothing is deployed** | R-07, T-16, T-17 and F-06 to finish |
| Router and orchestrator | TOOL-01, 03, 04 | Yes, `3bc4471` | Yes, largely mocked | Yes, source review | Yes, `3bc4471` | Partly, small live checks | Live checks, from real use. TOOL-02 is NOT STARTED |
| 4.0.4 Email-proven access | M-12 | No | No | No | No | No | Decisions 8, 10, 11, feature approval, MIG-03 |
| 4.0.5 Notice and acceptance | M-13 | No | No | No | No | No | 4.0.4, R-01, Decisions 3, 6, 12 |
| 4.1 Core progress | M-15 | No | No | No | No | No | Scope approval, Decision 21, its own migration |
| 4.0.6 Device test and go/no-go | M-14 | No | No | No | No | No | Everything above, T-15, R-13 |

## 2. Tooling is frozen

No new agents, routing or orchestration features, or benchmarks without a real need. Further tooling changes need an actual application-development blocker. The tools are used as they are, with the limits in tracker section 8a. **In particular, file ownership isn't enforced during a run, and `reconcile` works from workers' own reports.**

## 3. Integration

**A1, A2 and A3 are completed, on the owner's approval of each.** All were normal pushes, with no force-push. **No production infrastructure has been deployed.**

| Step | What happened | Commit |
|---|---|---|
| **A1** | `main` fast-forwarded to Phase 4.0.3, then a tracker-only commit | `de4607f`, then `cbd9a0f` |
| **A2** | `main` merged into the router branch, with no conflicts. Router 217 of 217, orchestrator 178 of 178, `tsc`, Vitest 1507 of 1507, guard 51 of 51. **Application code identical to `de4607f`.** Database and browser suites weren't rerun, as nothing relevant changed | `3bc4471` |
| **A3** | `main` fast-forwarded to that reviewed merge | `3bc4471` |
| **A4** | Authorized. `feature/phase-4-program` starts from the commit that adds this text. **No application work starts before it** | |

### Interactions, as checked

| Where | Result |
|---|---|
| `.gitignore` | `deploy/production.env` and `.claude/orchestrator/` both stay ignored |
| Tracker | Sections from both branches are kept |
| Router guard and `deploy/`, `Dockerfile` | The guard stops workers changing these files. Intended, as they stay with the main session |
| 4.0.3's production-mode start | `next start` runs preflight, which affects any suite that starts a server. Handled for designated test databases, and tooling suites start no server |

**Later merges:** each checkpoint in section 5 fast-forwards `main` to a commit the owner names. Never a force-push, and never without approval for that branch and commit.

## 4. Order of work, and why

1. **4.0.3, merged,** as everything depends on its preflight, allowlist and headers.
2. **Router and orchestrator, merged,** which change no application code.
3. **4.0.4,** which replaces the sign-up flow that all later tests go through, and holds the first migration.
4. **4.0.5,** which shares 4.0.4's acceptance fields, and adds nothing to the schema of its own.
5. **4.1,** after MIG-03 is prepared, so that the two migrations stay in order. Its logic can begin alongside 4.0.4.
6. **4.0.6,** last, as device testing must cover 4.1. Go/no-go follows that retest, as the design already says.

## 5. Milestones

Each one is **user-visible or adds a table, so each takes the full cycle:** product review, feature approval, architecture, security and privacy, implementation, automated testing, source review, merge approval. Earlier product reviews count only for the scope they looked at. **If the scope changes, `product-strategy-agent` runs again.** Its recommendation isn't approval.

### 4.0.4 Email-proven access (design section 8)

**Scope:** link-first sign-up, with no account until the link is used and the allowlist applied at that point. `AccountToken`, stored as a SHA-256 hash. Password reset deleting all sessions in one transaction. Change password. Terms acceptance fields. A request deadline on auth. A local mail stub, with sending outside the request.

**Depends on:** A4, feature approval, Decisions 8, 10, 11. Decision 4, and Decision 5's provider, only for the operational check, as the stub is enough to build and test it.

**Acceptance:** identical responses, so nobody can learn who has an account. GET consumes nothing. Parallel use gives one success. Expiry tested at 1 ms either side, by backdating. Cooldown survives a restart. No token in logs. All 14 registering scripts go through the real flow. **No test-only bypass in production code.**

**To resolve during architecture review:** 4.0.3 opens registration for designated test databases through `FIT_TEST_OPEN_REGISTRATION`, on a loopback test server. Check that against "no test-only bypass" once the real flow exists, and remove what's no longer needed.

**Tests:** new guarded suite on `fitdb_test`, with negative controls, then the 14 scripts and all three Playwright browsers. **None of the database or browser tests can pass until MIG-03 is applied to `fitdb_test`,** which is approval A6.

**Closes in code, not operationally:** S-16, R-10, M-12. **Real delivery stays open** until a provider and a deployed server exist.

### 4.0.5 Notice, acceptance and retention (design section 4.0.5)

**Scope:** public notice and terms pages, recording acceptance through 4.0.4's fields, acceptance in the export, and applying the retention rule.

**Depends on:** 4.0.4. Decisions 3, 6, 12, and R-01 for final text.

**Acceptance:** every processor, data category and retention period in the notice matches the inventory, checked against the deployment. Sign-up can't complete without acceptance, and version and time are stored and exported. Pages are public, keyboard accessible, and linked from sign-up and profile. Refused and abandoned accounts follow the stated rule (R-06).

**Tests:** guarded suite, `account-data-map` coverage, export suite, Playwright.

**A limit that won't move:** the pages and their mechanism can be built, but **R-11 and R-06 stay BLOCKED until a legal reviewer has answered.** Interim text is marked as not final. Nobody here writes legal conclusions.

### 4.1 Core progress (`PRODUCT_STRATEGY.md`, `FEATURE_DECISIONS.md`)

**Scope:** a weight log by date with a smoothed trend, and one goal card on the existing dashboard. **Excluded:** other measures, photos, adaptive targets, predicted dates, a new dashboard.

**Depends on:** owner approval of this scope, Decision 21, and 4.0.2's coverage check. It needs a migration, proposed as MIG-04, ordered after MIG-03.

**To decide first:**

- **How the log relates to `currentWeightKg`.** Recommended: separate, with nothing changed automatically. Check first what still reads that field since Stage A removed automatic targets.
- **The table.** The strategy says one table with a `kind` column, and the decision record says weight only to start. Recommended: weight is the only behaviour, with the table's shape left to architecture review.
- **The smoothing method,** which must be named, tested, and not shown more precisely than it supports.

**Acceptance:** trend and change come from the smoothed value. Missing days never read as zero, and missing data stays null. Fat loss or muscle gain shows trend against goal weight, strength shows recent PRs, and maintenance shows distance from the starting weight. Muscle gain isn't presented as weight gain. No predicted dates. Neutral wording, and the log stays optional. Each user's data is isolated, in export and deletion, and out of logs.

**Tests:** unit tests of the trend, with gaps and single entries. Guarded suite for isolation, export and deletion, with `account-data-map` forcing the new model to be classified. Playwright. **Database and browser tests need A7.**

**Limit:** underweight-goal safeguards stay with R-03 and Decision 23. **No threshold is invented here.**

### 4.0.6 Device test and go/no-go (design section 4.0.6)

**Scope:** scripted flows on one iPhone and one Android, including 4.1's. A real week of use by the owner. The checklist. A decision on S-07's idempotency. The database reset. Any hardening that's left (R-15, T-18).

**Depends on:** everything above, Decisions 7, 16, 17, 23, and a deployed rehearsal server.

**Acceptance:** each flow recorded pass or fail per device, including T-15, a link opened from a mail app, date entry, a screen lock between sets, a network drop while saving, session persistence, reset, export and deletion. No open blocker. Checklist signed by the owner. Database reset before the first participant.

**Most of this is the owner's and the reviewers' to do.** The code side is small. Go/no-go is a decision, and **a "go" still wouldn't begin Phase 4.2 without its own authorization.**

## 6. Workstreams

**Most of this can't run at once,** as auth, tests and schema share files. So parallel windows are few, and a worker runs only where its task is really independent. At most three run at once, in the shared checkout, as worktrees start from the default branch rather than the program branch. **Merging, committing, pushing, the tracker and all restricted actions stay with the main session.**

| Stream | Model, through the router | Owns | Commit group |
|---|---|---|---|
| **A, security and auth** | Opus, `architecture-agent` | `AccountToken`, auth routes, session and reset logic, **all schema and migration files for any milestone** | auth |
| **B, fitness and app** | Sonnet, `development-agent`. Moves to Opus after a failed retry, or on anything touching auth, schema or concurrency | Trend logic, weight and goal routes and UI, consent pages | weight/goals, privacy/consent |
| **C, test prep and docs** | Haiku, `quick-task-agent`, **for documents only** | Device checklist, runbook text, documents | testing/release |

**A correction to the requested split:** the 14 registering scripts and shared test helpers are code, so the router sends them to Sonnet. Haiku's agent has no shell, and isn't for logic. They go with B, after 4.0.4's routes are stable.

| Window | Running together | Reason it's safe |
|---|---|---|
| 1 | A: 4.0.4 core and MIG-03's file. B: the trend function and its unit tests, in new files, once scope is approved. C: checklist | No shared files |
| 2 | B: registering scripts and helpers. A: stops, or takes findings | Scripts depend on A's finished routes |
| 3 | A: MIG-04's file, after MIG-03. B: 4.1 routes and UI, then 4.0.5's pages | Schema stays with A, in order |
| 4 | Main session only: integration, full suites, release | Nothing here is independent |

**One writer at a time, and declared in advance:** `prisma/schema.prisma`, `prisma/migrations/`, `src/lib/validation.ts`, `src/lib/account-data-map.json`, `src/lib/server/stage-a.test.ts`, `scripts/run-guarded-suites.cjs`, `scripts/test-target-guard.test.cjs`, `scripts/lib/test-users.cjs`, `scripts/lib/e2e-onboarding.cjs`. The tracker is the main session's alone.

**Commits stay separately reviewable,** in five groups: auth, privacy/consent, weight/goals, hardening, testing/release. No worker runs just to summarize another's results.

### Independent security review

`security-review-agent`, read-only, on the actual diff, at these points only:

1. MIG-03's file, the token design, and the auth flows, before their tests are called complete.
2. Reset, session deletion and enumeration, once the 14 scripts pass.
3. 4.0.5's acceptance and export.
4. 4.1's isolation, export and deletion.
5. Release readiness, before 4.0.6's go/no-go.

## 7. Approvals needed

**A recommendation here isn't approval. Each is for the named branch, commit or database.**

| ID | What | When | Recommendation |
|---|---|---|---|
| **A1** | Merge 4.0.3 at `de4607f` to `main`, with a tracker commit | | **Done** |
| **A2** | Merge `main` into the router branch, with a normal push | | **Done** |
| **A3** | Fast-forward `main` to `3bc4471`, with a documentation commit | | **Done** |
| **A4** | Create `feature/phase-4-program` from that `main` | | **Authorized,** and follows this text |
| **A5** | Decisions 8, 10, 11, recorded in D-03. Prepare MIG-03's file | Before 4.0.4 | 8: link-first with allowlist. 10: yes. **11: no for the beta, following the product agent over the design's earlier yes,** as it's the smaller change |
| **A6** | Back up and apply MIG-03 to `fitdb_test` only | When 4.0.4 reaches database tests | Decide then, on the reviewed file |
| **A7** | Same for MIG-04 | When 4.1 reaches database tests | Decide then |
| **A8** | 4.1's scope, Decision 21, `currentWeightKg`, table shape | Before 4.1 | Section 5 |
| **A9** | F-11: Prisma 7, or accept in writing | **Preferably before MIG-03,** so the upgrade isn't done across new migrations | Owner's call, as it's a breaking upgrade |
| **A10** | Decisions 3, 4, 5, 6, 7, 12, 14, 16, 17, 23, and engaging legal and clinical reviewers | Before 4.0.5's final text, deployment and 4.0.6 | Owner's call. Paid services and production resources each need their own approval |

**`fitdb` and `fitdb_test_other` aren't touched by any of this.** B-07, C-08 and T-14 need their own separate decisions.

## 8. Blockers that this plan doesn't remove

Finishing the code leaves these open, and each stays in the tracker until its own acceptance criteria are met.

| Area | IDs |
|---|---|
| Legal and clinical reviews | R-01, R-02, R-03, R-12, C-09, E-06, S-04, S-15 |
| Backups, restore and deletion | S-14, F-05, F-06, T-10 |
| Production and recovery verification | R-07, R-08, R-15, T-16, T-17, F-04 to F-10 |
| Migrations on other databases | B-07, C-08, plus MIG-03 and MIG-04 on anything beyond `fitdb_test` |
| Untested or unrun | T-06 to T-10, T-14, T-15, T-18, R-13 |
| Accepted or undecided risk | S-02 to S-18, F-11, S-16 until 4.0.4 |
| Owner decisions | D-01 to D-05 |
| AI, staying off | R-14 |
| Tooling | TOOL-01 to TOOL-04 |

**This list is an index, and the tracker's section 3 and sections 5 to 8 win if they differ.**

## 9. When this plan is complete

- 4.0.4, 4.0.5 and 4.1 are IMPLEMENTED, TESTED, REVIEWED and MERGED, each by its own commit, with the states recorded separately in the tracker.
- 4.0.6's checklist is finished, on real devices, with a written go/no-go.
- Every blocker above is closed, or accepted in writing by the owner, where the tracker allows it.
- **Merged code is never described as operationally verified,** and a complete plan doesn't authorize real users.

**Realistically, the code can be finished long before the go/no-go can.** Legal review, clinical review, hosting and backups depend on people and purchases that haven't been arranged.
