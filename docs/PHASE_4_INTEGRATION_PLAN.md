# Phase 4: integration plan for 4.0.5, 4.1 and 4.0.6

**Preparation only. Nothing here has been merged, and `main` is unchanged at `5434f90`.** Each merge needs the owner's approval after ChatGPT's independent review, and this plan grants neither. Combining the branches isn't a release: legal, clinical, infrastructure, security and real-device blockers all stay open.

## Order

**4.0.5, then 4.1, then 4.0.6.** All three branch from `main` at `5434f90`, so 4.0.5 can fast-forward. The other two then each need a merge commit, and this plan gives every conflict in them.

| Branch | Tip reviewed | Files changed from `main` |
|---|---|---|
| `feature/phase-4.0.5-privacy` | `7d615b0` | 40 |
| `feature/phase-4.1-progress` | `ac5ff2b` | 36 |
| `feature/phase-4.0.6-readiness` | Last code change `09f0aa4`, then documents-only commits, including the one holding this plan | 26 |

If a tip changes after review, this plan has to be rechecked against the new one.

## What was tried, and how

The merges were tried in a **throwaway clone, in a temporary folder, with its remote removed.** It was never pushed, no ref in this repository moved, and the clone has been deleted. No database was used. The clone's `node_modules` was a link to this repository's, and Prisma's client was generated for the combined schema, then regenerated for this branch afterwards.

| Check on the combined code, with the changes below | Result |
|---|---|
| Unit tests | 1,789 of 1,789 |
| Guard suite | 51 of 51, so every script is classified |
| MIG-04's refusals and PowerShell blocks | 103 of 103, closed ports only |
| Conflict markers left | None |
| Suites from the three runners | All 40 kept |
| Scripts added by the three branches | All 12 in the guard's lists |
| Tracker rows from the three branches | None lost. **M-13, M-14 and M-15 came out twice,** step 3 |
| Type check | Clean |
| Production build | Clean |

Before those changes, the data-inventory test failed, as it should, as the merged code held a table the inventory didn't list. The trial was last run at 4.0.5 `7d615b0`, 4.1 `ac5ff2b` and 4.0.6 `b4f2c5c`, with the same conflicts as the runs before.

**What this doesn't show:** no database or browser test ran on the combined code, as they need MIG-04 on `fitdb_test`. Passing on one branch isn't passing when combined. T-14's two suites can't run at all while `fitdb_test_other` is off limits.

## Overlapping files

| File | 4.0.5 | 4.1 | 4.0.6 | Merging |
|---|---|---|---|---|
| `.gitignore` | Yes | Yes | Yes | The same lines, merges cleanly |
| `docs/PHASE_4_EXECUTION_PLAN.md` | Yes | Yes | Yes | Conflict, step 2 and step 3: one status row per phase |
| `docs/PROJECT_COMPLETION_TRACKER.md` | Yes | Yes | Yes | Conflict, step 2 and step 3: keep every row and section |
| `scripts/run-guarded-suites.cjs` | Yes | Yes | Yes | Conflict, step 2 and step 3: keep every suite |
| `scripts/test-target-guard.test.cjs` | Yes | Yes | Yes | Conflict, step 2 and step 3: **combine the lists by hand** |
| `src/lib/validation.ts` | Yes | Yes | No | Merges cleanly, in different places |
| `scripts/lib/signup.cjs` | Yes | No | Yes | **Conflict, step 3: keeping both sides is wrong** |

No application source conflicts. Every conflict is in a document, a test runner or a test helper. `prisma/schema.prisma` and the migrations change only on 4.1.

## Step 1: `main` to 4.0.5

Fast-forward, with no conflict. **Needs first:** legal review, or a separately approved exception for a development-only merge before it. O1 covers development, and Annex H2 says that review comes before merging.

## Step 2: 4.1 onto 4.0.5

**Needs first:** MIG-04 applied to `fitdb_test` by `docs/MIG_04_RUNBOOK.md`, with the owner's authorization naming `MIG-04 — fitdb_test`. Without it, this code breaks the dashboard, deletion and export, so nothing can be tested. The owner's decisions J-04, J-05 and J-06 should be settled too, or recorded as carried over.

Then generate Prisma's client with the PowerShell block in the runbook, as 4.1 adds a model.

### Conflicts

| File | Resolution |
|---|---|
| `scripts/run-guarded-suites.cjs` | Keep both: `privacy-consent`, `privacy-e2e`, `privacy-cleanup`, `weight-progress`, `weight-e2e` |
| `scripts/test-target-guard.test.cjs` | Keep every name in `GUARDED`, `OTHER_WRITE_CAPABLE` and `NOT_GUARDED`: 4.0.5 adds the privacy scripts and `account-facts`, and 4.1 adds the weight scripts and `mig-04`. The `GUARDED` lines clash, and a plain union would break the array |
| `docs/PROJECT_COMPLETION_TRACKER.md` | Keep both sides in all three places: sections 2e and 2f, rows H-01 to H-05 and J-01 to J-06, and T-23 and T-24 |
| `docs/PHASE_4_EXECUTION_PLAN.md` | One row each for 4.0.4, 4.0.5 and 4.1, with their current status |

### Changes the merge has to add

These are tracker J-03, and **the merged code fails its tests without them.** They were tried in the clone.

| Area | File | Change |
|---|---|---|
| **Privacy inventory** | `src/lib/data-inventory.json` | Add `"BodyMetric": "profile"` to `models`, and `"BodyMetric.value"` to `possiblyHealthRelated` |
| **Inventory document** | `docs/PHASE_4_0_5_DATA_INVENTORY.md` | Add `BodyMetric` and dated weight entries to the Profile row |
| **Draft notice** | `src/lib/legal/notice.ts` | Add the weight log to "What you log", for example "your dated body-weight entries". Bump the version, for example to `draft-2026-11-06b`. **Still a draft, and needs legal review** |
| **A test that stops being true** | `src/lib/data-inventory.test.ts` | "a model added to the schema" uses `BodyMetric` as its example of an unknown model. Change the example to a made-up name. **Don't remove the test or weaken what it checks** |

The notice's wording and the category are proposals for review. Whether weight counts as health data stays with legal review (R-01), and the notice marks that as undecided already.

The version bump needs nothing else: tests read the version from the source, no real person has accepted a draft, and the QA accounts' older value stays as recorded. Reacceptance stays blocked at H-04.

### Prisma model coverage

| Where a model has to be listed | State on 4.1 | At the merge |
|---|---|---|
| `prisma/schema.prisma`, MIG-04 | Done | Nothing |
| `src/lib/account-data-map.json` | Done | Nothing |
| `src/lib/server/account/delete.ts` | Done | Nothing |
| `src/lib/server/account/export.ts` | Done | Nothing |
| `src/lib/data-inventory.json` | **Doesn't exist on 4.1** | **Add it, above** |
| `scripts/lib/account-facts.cjs` | Names no such model | Nothing. It counts accounts only |

### Tests for this step

Focused, on the merged code: Vitest, `guard`, type check, build, then `privacy-consent`, `privacy-e2e`, `privacy-cleanup`, `weight-progress`, `weight-e2e`, `account-data`, `account-data-e2e`, and 4.1's real-server deliberate defects.

## Step 3: 4.0.6 onto the result

### Conflicts

| File | Resolution |
|---|---|
| **`scripts/lib/signup.cjs`** | **Don't keep both sides, or the page loads twice.** Take 4.0.6's block, which reports what the page showed, then add 4.0.5's three changes: `NOTICE_VERSION`, `acceptedVersion` in the API sign-up, and `await page.check("input[name=accept]")` straight before the browser sign-up's submit |
| `scripts/run-guarded-suites.cjs` | Keep every suite, adding 4.0.6's `workout-sets`, `readiness-e2e` and `readiness-performance` |
| `scripts/test-target-guard.test.cjs` | Add `workout-sets.test.cjs`, `e2e-readiness.cjs` and `readiness-performance.test.cjs` to `GUARDED` |
| `docs/PROJECT_COMPLETION_TRACKER.md` | Keep every section and row, adding 2g, K-01 to K-06, T-25 and T-26 |
| `docs/PHASE_4_EXECUTION_PLAN.md` | One row per phase |

### Project tracker, after the merge

- **M-13, M-14 and M-15 each come out twice** if both sides are kept, as every branch edits them. Keep one row each, combining what they say.
- Update each merged item's MERGED state and SHA, and leave anything unverified as it is.
- M-13, M-14 and M-15 stay IN PROGRESS, as their blockers aren't closed.
- K-02 is what the regression below answers: 4.0.6's local checks did not include privacy or weight.
- **Delete nothing unresolved.**

## The one final regression

After all three are authorized and merged, on the final combined code, **once:** the complete unit suite, type check, build, every applicable guarded suite one at a time, all three browsers, the security and authorization suites, the deliberate defects for all three phases, export, deletion and data isolation, and database integrity and migration compatibility. Watch memory, and stop below 4 GB. A timeout or a suite that can't start is a failure to investigate, and not a detected defect. After a correction, rerun the affected and dependent suites. Repeat all of it only if a change invalidates the earlier result.

**It doesn't replace:** T-14's two suites, the real phones, a deployed server, real email, a production database, or legal and clinical review. `fitdb` and production need their own migration decisions.

## Provisional product direction

The owner's direction, which guides this work and **doesn't authorize new development or close any item.** Each stays open in the tracker until the owner resolves or accepts it.

| Direction | Item | The code at 4.1 and 4.0.6 |
|---|---|---|
| Keep the weight log separate from `Profile.currentWeightKg` | J-06 | Matches. `weight.ts` never touches that field |
| Keep fitness goals optional | J-04 | Matches. `Profile.goal` is nullable |
| Keep 10-day smoothing and a 28-day window for now | J-05 | Matches: `TREND_TIME_CONSTANT_DAYS`, `CHANGE_WINDOW_DAYS` |
| Need enough history before showing a numerical trend | J-05 | Matches. Under `MIN_CHANGE_SPAN_DAYS`, 7 days from first to last entry, no change is stated |
| Treat finished workouts as immutable in ordinary editing | K-04 | **Doesn't match, and isn't changed.** See below |

S-28 and K-06 stay open, to be fixed or accepted.

### K-04: the change this direction implies, not yet made

**Today,** the owner of a finished workout can still edit or delete its sets, delete an exercise with its sets, add an empty exercise, move an exercise and change its notes, for example from a stale tab. The history page offers none of this. New sets are already refused.

**The proposal:** those routes hold the workout's row with the same lock as logging a set, and answer 409 once it's finished: `sets/[setId]` PATCH and DELETE, `exercises` POST, and `exercises/[seId]` PATCH and DELETE. That also closes the case where a delete lands just after a finish has counted the sets. Renaming a workout and its notes stay as they are unless the owner says otherwise. It needs no schema change.

**The cost:** nobody could correct a finished workout's mistake, as no separate correction flow exists. It needs tests on the same forced orderings, and **the owner's approval before it's built.**

## Risks in this order

| Risk | What guards against it |
|---|---|
| 4.1 merged, and any database without MIG-04 runs it | The runbook comes first. Any deployment has to apply it before the code |
| A resolved list drops a script | The guard's "every script is classified" test fails on one that's missing |
| A resolved list drops a suite | **Nothing does, automatically.** Count them: 40 in the trial's runner |
| The draft notice forgets the weight log | Only review. The inventory's tripwire checks the model, not the sentence |
| `prisma generate` forgotten after switching | The data-map and inventory tests fail, as they did in the trial before generating |
