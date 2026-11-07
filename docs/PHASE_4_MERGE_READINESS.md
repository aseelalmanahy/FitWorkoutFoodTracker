# Phase 4: merge-readiness decision package

**For the owner's decision. This document approves nothing, and nothing in it has been implemented.** `integration/phase-4` isn't merged into `main`, nothing is deployed, Phase 4.2 hasn't started, and there are no real users.

| | |
|---|---|
| Reviewed commit | `integration/phase-4` at `519bb38a8ab43af459383bf23b814ad1dd0c28e9`. Its last code change is `f7c9c1f` |
| Source branches | 4.0.5 `7d615b0`, 4.1 `2193add`, 4.0.6 `d80c618` |
| `main` | `5434f90b9b5ca71ebb5dc542a8bc3facdd88908c`, unchanged |
| Independent source review | ChatGPT's, including `f7c9c1f`, as reported by the owner on 2026-11-07. **Approved for the development checkpoint.** That isn't approval to merge into `main` |

Only documents have changed since the reviewed commit. Details of every test are in `PROJECT_COMPLETION_TRACKER.md`, section 2h.

## Readiness by gate

| Gate | Status | Why |
|---|---|---|
| **Engineering integration** | **READY,** approved for the development checkpoint | All three phases merged, tested below, and independently reviewed |
| **Merge into `main`** | **NOT READY** | Needs the owner's approvals below, starting with legal review or a written exception |
| **Production deployment** | **NOT READY** | Nothing is deployed. No production database, real email, verified restore or deployment approval. The notice is a draft, so real registration stays closed |
| **Beta, with real users** | **NOT READY** | Needs all of the above, plus legal and clinical review and real-device testing. Phase 4.2 needs its own approval |

## Test evidence

Results on one Windows machine, with a local production build, against `fitdb_test`. **This doesn't show how it behaves on a deployed server or a real phone.**

| Evidence | Result |
|---|---|
| Unit tests | **1,789 of 1,789,** with type check and build clean |
| Guarded suites | **41 of 41 applicable,** at `1e9bcb6`, with no timeout, crash or skip. After `f7c9c1f`, the affected suites were rerun and pass, and the regression wasn't repeated |
| Negative controls | **246 of 246** by assertion, at `f7c9c1f` |
| Browsers | **Chromium, Firefox and WebKit** each pass the 13 three-engine suites, with equal step counts. `e2e-smoke`, `e2e-nutrition` and `privacy-cleanup` run in Chromium only |
| QA fixtures | **All 10 preserved.** A hash of their data was identical before and after the regression and the controls |
| Not run | `safety-no-marker` and `db-guard-scoped` (T-14), and four on-demand suites for migrations already applied |

## MIG-04

**MIG-04 is applied to `fitdb_test` only.** It was applied on 2026-11-07 UTC, with the owner's written authorization and a verified backup. That backup hasn't been restored.

`fitdb`, `fitdb_test_other` and any production database were never accessed by this work, so this rests on the project's records, and not on inspecting them. **Tracker B-07 and C-08 also record `fitdb` as missing earlier migrations.**

## Exact approvals remaining before the main merge

| # | Approval | Who | Status |
|---|---|---|---|
| 1 | **Legal review of 4.0.5 (R-01), or a separate written exception for `main`.** The existing exception covers `integration/phase-4` only | Owner, legal reviewer | **Not given** |
| 2 | **What `fitdb` does after the merge (J-08, B-07, C-08).** Merged code needs MIG-04 and the earlier migrations on any database it runs against, or the dashboard, export and deletion fail there. Either authorize those migrations for `fitdb`, with a backup, or accept that `main` runs only on `fitdb_test` for now | Owner | **Not given** |
| 3 | **T-14:** authorize `fitdb_test_other` for its two suites, or accept the gap | Owner | **Not given** |
| 4 | **T-25 and T-27:** accept them for `main`, or hold the merge. T-27 is accepted for development integration only | Owner | **Not given** |
| 5 | **Product decisions and Low items below:** decide each, or explicitly carry it forward | Owner | **Not given** |
| 6 | **Owner UI acceptance of Phase 4,** under the workflow's new requirement: the owner tries it with the demo account and says it's accepted. `MANUAL_UI_TESTING_GUIDE.md` | Owner | **Pending** |
| 7 | **The merge itself:** written authorization naming `integration/phase-4`, its exact commit, and `main` | Owner | **Not given** |

Clinical review (R-02) is recorded as blocking the beta, and not the merge. The owner may choose to require it earlier.

## Recommended decisions, not implemented

| Item | Decision needed | Recommendation |
|---|---|---|
| **K-04** | Can finished workouts still be edited? | Refuse edits under the same lock, as the owner's direction says. The cost is that mistakes can't be corrected, as no correction flow exists. A separate change, after the merge |
| **J-04** | Must a goal be chosen? | Keep it optional, as built |
| **J-05** | What evidence before a numerical change is shown? | Keep the 10-day smoothing and 28-day window provisionally. Decide the proposed three weigh-ins separately. Today it takes two entries spanning 7 days |
| **J-06** | How does the weight log relate to `currentWeightKg`? | Keep them separate, as built |
| **J-07** | A null byte in an id answers 500 on other routes | A small fix, separate from this merge. It's Low, and returns only a generic error |
| **J-08** | Nothing at startup detects a missing MIG-04 | Apply it before the code on every database. Consider a startup check before deployment |
| **K-06** | Two older deadlocks, found by reading | Accept for `main`, as neither has been observed and the database ends them |
| **K-07** | The logger's saved-set check compares counts | Accept for `main`, and fix before the beta |
| **K-08** | The per-person limit against the connection pool | Set the pool size at deployment |
| **S-28** | A deliberate misconfiguration opens the draft gate | Accept for `main`, and fix before any deployment |
| **T-14** | Two guard suites not run | Authorize a scoped run, as they guard the database safety itself |
| **T-25, T-27** | Two unexplained one-off failures | Accept for `main`. Keep them open, and resolve or accept them before the beta |

## Other unresolved items, preserved

- **Legal and clinical review:** R-01 and R-02.
- **Draft registration notices:** H-02. The notice is `draft-2026-11-06b`, so real registration stays closed, and its weight-log wording and `BodyMetric` category still need legal review.
- **Before deployment or beta:** a real email provider (G-03), a timed backup restore (T-10, F-06), real iPhone and Android testing (T-15, R-13), and retention and reacceptance rules (H-03, H-04).

All of these stay open in the tracker until resolved or explicitly accepted.
