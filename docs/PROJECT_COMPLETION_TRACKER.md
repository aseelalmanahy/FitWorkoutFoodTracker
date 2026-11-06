# Project Completion Tracker

**The single source of truth for what's done and what isn't.** Last updated 2026-11-06, on branch `feature/phase-4.0.1b-nutrition-targets`, from `main` at `429d961`.

**Rules:**

- Allowed statuses: COMPLETE, IN PROGRESS, BLOCKED, NOT STARTED, DEFERRED.
- Nothing is COMPLETE without evidence. An item left unfinished stays here, and is never silently dropped.
- "Implemented" isn't "verified". Where only part has been tested, the status isn't COMPLETE and the limit is stated.
- Update this file in the same change as the work. Decisions and their reasons stay in `docs/FEATURE_DECISIONS.md`, `docs/PHASE_4_0_DESIGN.md` and `docs/PHASE_4_0_1_IMPLEMENTATION_PLAN.md`. This file records status only, and approves nothing.

## 1. Milestones

| ID | Phase | Description | Status | Evidence, and its limits |
|---|---|---|---|---|
| M-01 | 1 | Training: accounts, profile, plans, schedule, logging, progress | COMPLETE | On `main`. `e2e-smoke` passes. Development only, see section 6 |
| M-02 | 2 | Nutrition tracking, food providers, targets | COMPLETE | On `main`. `nutrition-api`, `release-workflow`, `provider-*`, `e2e-nutrition` pass. A live provider check is recorded in `PHASE_2_PROGRESS.md`, and wasn't repeated since |
| M-03 | 3 | Image validation, label and PDF extraction, meal identification | COMPLETE for development | On `main`, tested **with stubs only.** No real model, phone or PDF has been tested, and AI stays off. `PHASE_3_PRODUCTION_READINESS.md` says "not ready for production" |
| M-04 | Agent | Product Strategy Agent | COMPLETE | `.claude/agents/product-strategy-agent.md`, used for 4.0 and 4.0.1 |
| M-05 | 4.0 | Phase 4.0 design | COMPLETE as a design | `docs/PHASE_4_0_DESIGN.md`. Its recommendations are pending the owner, section 5 |
| M-06 | 4.0.0a | Test-target guard | COMPLETE | Merged at `56606ee`. `guard` 51 of 51, `guard-browser` 21 of 21 |
| M-07 | 4.0.1 | Stage A: eligibility, access gate, automatic targets removed | COMPLETE | Merged at `429d961`. All guarded suites and 26 of 26 negative controls, with independent review. Not for real users on its own |
| M-08 | 4.0.1b | Nullable targets, calories-only, stopping a target | **IN PROGRESS** | Implemented on this branch. **Database-dependent verification BLOCKED,** section 3 |
| M-09 | 4.0.1c | Profile data minimization | NOT STARTED | Needs its own migration approval |
| M-10 | 4.0.2 | Account deletion and export | NOT STARTED | Export follows 4.0.1b |
| M-11 | 4.0.3 | Production foundation | NOT STARTED | Needs decisions 4, 5 and 14 |
| M-12 | 4.0.4 | Email-proven access | NOT STARTED | Needs 4.0.3 and decisions 8, 10, 11. Has a migration |
| M-13 | 4.0.5 | Notice, acceptance, retention | NOT STARTED | Needs legal review. Shares 4.0.4's migration |
| M-14 | 4.0.6 | Device testing and beta go/no-go | NOT STARTED | Needs everything above |
| M-15 | 4.1 | Core progress: weight log, goal card | NOT STARTED | Needs 4.0.2's coverage check |
| M-16 | 4.2 | Real-user beta | NOT STARTED | Needs 4.0 and 4.1 complete |

**Roadmap after the beta, deliberately not started:** Phases 4.3 and 4.4, Track A (paid AI) and Initiative T (trainers) in `PRODUCT_STRATEGY.md`. The beta's findings revise them.

## 2. Phase 4.0.1b detail

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| B-01 | 4.0.1b | Migration written: 4 nullable columns, 2 CHECK constraints, no row rewritten | IN PROGRESS | P0 | MIG-01 | **Done:** static tests, and Prisma's offline schema diff gives the same 4 statements. **Left:** applied to a test database, `migration-verify` passes |
| B-02 | 4.0.1b | Calories-only and partial targets; blank is null, zero is zero | IN PROGRESS | P0 | MIG-01 | **Done:** unit tests with an in-memory table, API rules, and browser Part A proves what the form sends. **Left:** T41 against real columns |
| B-03 | 4.0.1b | `POST /api/nutrition/targets/stop`, with confirmation | IN PROGRESS | P0 | MIG-01 | **Done:** rules by unit test, auth, Origin and gate on the real route, no-target case, and the confirmation in 3 browsers with the request intercepted. **Left:** T39, T40, T42 writing a real stopped row |
| B-04 | 4.0.1b | Null displays as "Not set", in the editor, history, Nutrition and macro bars | IN PROGRESS | P0 | MIG-01 | **Done:** type-checked, and the editor in 3 browsers. **Left:** T43 and browser Part B, as these screens have never rendered a real null row |
| B-05 | 4.0.1b | All readers reviewed for nulls | IN PROGRESS | P1 | MIG-01 | **Done:** nullable types make the compiler flag each reader. **Left:** T43 |
| B-06 | 4.0.1b | Independent review, owner migration approval, merge approval | BLOCKED | P0 | MIG-01 | Reviewed commit approved. **Don't merge before the migration is verified:** on a database without it, saving calories only would fail |

## 3. Tests: run, failed, blocked

**Results for this branch, on the unmigrated `fitdb_test`. Nothing here ran on `fitdb`.**

| Test | Result | Limit |
|---|---|---|
| Unit tests (`vitest`) | PASSED, 1,346 | The target rules use an in-memory table, not PostgreSQL |
| Type check, build | PASSED | |
| `prisma validate`, offline schema diff | PASSED | No database involved. Doesn't show PostgreSQL accepts the CHECK constraints |
| `guard` | PASSED, 51 | |
| `nutrition-api` | PASSED, 77 | No null column written |
| `release-workflow` | PASSED, 8 | |
| `e2e-nutrition`, `eligibility`, `hardening` | PASSED | Eligibility and hardening in 3 browsers |
| `nutrition-targets-e2e` Part A | PASSED, 3 browsers | Saves are intercepted, so nothing reached the database |
| `migration-snapshot` | Ran as a dry run | Must be retaken just before applying |
| **`nutrition-targets`,** T38 to T43 and isolation | **BLOCKED, 8 tests, not passed** | Refuses to run until the migration is applied. Written, never executed against real columns |
| **`nutrition-targets-e2e` Part B** | **BLOCKED, not passed** | Same. Reports exit 3 |
| **`migration-verify`,** T44 | **BLOCKED, not passed** | Same |
| Other guarded suites | Not rerun for this branch | Passed at Stage A. These changes don't touch them. Rerun in full after the migration |
| Failed | None | Blocked isn't failed, and isn't passed |

**Negative controls.** 11 of 11 runnable controls failed on their intended assertion, and files were restored: NC28, NC29, NC30, NC31a, NC31b, NC32, NC37, NC38, NC40, NC41, NC42. **Their limit:** most exercise unit tests or the migration's text.

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| T-01 | 4.0.1b | Run `nutrition-targets`, Part B and `migration-verify` | BLOCKED | P0 | MIG-01 | All pass on `fitdb_test`, with no test weakened |
| T-02 | 4.0.1b | Database-level negative controls: delete on stop, stopped row returned, and a dropped CHECK against T38 and T39 | BLOCKED | P0 | MIG-01 | Each fails on its named assertion |
| T-03 | 4.0.1b | Whether `prisma migrate` reports drift over the raw CHECK constraints | BLOCKED | P1 | MIG-01 | Observed on a test database, and recorded |
| T-04 | 4.0.1b | What old code does against a null row | BLOCKED | P2 | MIG-01 | Observed, or the forward-only rollback stands. Assumed unsafe until then |
| T-05 | 4.0.1b | Full guarded suite on the final commit | BLOCKED | P0 | MIG-01 | Every suite passes |
| T-06 | 3 | Real models, labels, meals, hostile inputs | BLOCKED | P1, if AI is wanted | Paid-test approval | Readiness items 2 to 4 |
| T-07 | 3 | Real phones and real PDFs | NOT STARTED | P0 | M-14 | Readiness items 6 and 7 |
| T-08 | 4.0.1 | `T3` exercises only the branch for the UTC hour it runs in, or both between 10:00 and 11:00 | DEFERRED | P3 | None | Accepted limit for now. NC3 was seen to catch one branch (`422 !== 200`), and the other hasn't been seen to fail. A control run at the right UTC hour would close this |

## 4. Migrations

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| MIG-01 | 4.0.1b | `20261106120000_nullable_nutrition_targets`. **Written, not applied anywhere** | BLOCKED | P0 | Owner approval | Procedure below completes |
| MIG-02 | 4.0.1c | `Profile`: nullable unread fields, separate migration | NOT STARTED | P1 | Owner approval, Decision 9 = A | Annex H4 and T45 |
| MIG-03 | 4.0.4 | Token table and acceptance fields | NOT STARTED | P0 | Decisions 8, 10, 11 | Design section 8 |

**MIG-01 procedure, once approved, and only on designated test databases:**

1. `npm run test:suites -- migration-snapshot`
2. Apply with `prisma migrate deploy`, with `DATABASE_URL` naming `fitdb_test`. The owner decides whether `fitdb_test_other` is included.
3. `npm run test:suites -- migration-verify nutrition-targets nutrition-targets-e2e`
4. T-02, then T-05, then type check and build.

**Rollback:** forward-only once any null exists, Annex H6. **`fitdb` and any later production database each need separate approval.**

## 5. Owner decisions and approvals

The merged documents hold **recommendations.** Stage A's authorization covered its own decisions, and doesn't approve the rest. The register's amendments aren't written yet.

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| D-01 | 4.0 | Record in `FEATURE_DECISIONS.md` what was approved, as dated additions, and the agent's Phase 4.0 results | NOT STARTED | P1 | Owner | Annex H8 rows 1 to 8 resolved |
| D-02 | 4.0 | Update `PRODUCT_STRATEGY.md`, including "can't complete sign-up", floors, and estimates still described as existing | NOT STARTED | P1 | Owner | Annex H8 rows 3 to 7 resolved |
| D-03 | 4.0.0 | Decisions 2, 3, 4, 5, 8, 10, 11, 12, 13, 14, 16, 17, 18 | NOT STARTED | P0 | Owner | Each recorded, with date. Design section 15 |
| D-04 | 4.0.1 | Decision 29's attempt limit: built as recommended, the agent would cut it | DEFERRED | P3 | Legal | Revisit with legal advice |
| D-05 | Strategy | Open product decisions 5, 6, 7, 9, 10, 11 | NOT STARTED | P2 | Owner | `PRODUCT_STRATEGY.md` section 12 |

## 6. Beta and production blockers

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| R-01 | 4.0 | Legal review (Decision 6) | BLOCKED | P0 | Reviewer, Decision 2 | Dated advice answers every question in Annex H7 |
| R-02 | 4.0 | Clinical and nutrition safety review (Decision 7) | BLOCKED | P0 | Reviewer | Written review at a stated commit, or a signed gap under Annex H2's conditions |
| R-03 | 4.0.6 | Low-target and underweight-goal safeguards (Decision 23). **800 kcal is still accepted with no warning** | BLOCKED | P0 | R-02 | Reviewed number and source, or a signed gap with the register amended. **No threshold is invented here** |
| R-04 | 4.0.2 | Self-service deletion, including from refusal and restricted screens. The expected failure on custom exercises hasn't been observed | NOT STARTED | P0 | None | Design section 12 |
| R-05 | 4.0.2 | Self-service export | NOT STARTED | P0 | M-08 | Includes stopped rows and nulls as null |
| R-06 | 4.0.5 | Retention rule for refused and abandoned accounts. Their email and password hash persist until then | BLOCKED | P0 | R-01 | Rule stated in the notice, and applied |
| R-07 | 4.0.3 | Deployment, HTTPS, one instance, backups with a tested restore | NOT STARTED | P0 | Decisions 4, 5 | Design section 12 |
| R-08 | 4.0.3 | Read-only check that production starts empty. **Currently an untested assumption** | NOT STARTED | P0 | R-07 | Counts recorded, and 4.0.6's reset done. Otherwise return to Decisions 27 and 30 |
| R-09 | 4.0.3 | Closed registration, by allowlist | NOT STARTED | P0 | R-07 | Non-listed address refused |
| R-10 | 4.0.4 | Password recovery, change password, email verification | NOT STARTED | P0 | R-07 | Design section 8 |
| R-11 | 4.0.5 | Privacy notice and terms. None exists | BLOCKED | P0 | R-01 | Matches the data-flow inventory |
| R-12 | 4.0.6 | Help resource for eating concerns | BLOCKED | P0 | R-02 | Reviewed, and reachable |
| R-13 | 4.0.6 | Core flows on a real iPhone and Android phone | NOT STARTED | P0 | M-11 to M-13 | Each flow recorded pass or fail |
| R-14 | 3 | AI spending limit, model choice, cost, prompt injection. AI stays off until done | DEFERRED | P1, if AI is wanted | Decision on Track A | Readiness items 1 to 4 |
| R-15 | 3 | Readiness items 8 to 15: instances, proxy and TLS, memory on Linux, monitoring, security headers, Node pin, dependency findings, ESLint | NOT STARTED | P0 for beta, except ESLint | M-11 | `PHASE_3_PRODUCTION_READINESS.md` |

## 7. Known bugs and security risks

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| S-01 | 4.0 | `APP_ORIGIN` falls back to request headers, a hazard for reset links | NOT STARTED | P0 | M-11 | Mandatory in production |
| S-02 | 3 | Rate limits are in memory, per process, and reset on restart | DEFERRED | P1 | One instance at beta | Shared store before scaling |
| S-03 | 4.0 | Register's 409 and timing reveal whether an email exists | NOT STARTED | P0 | M-12 | Link-first sign-up closes it |
| S-04 | 4.0 | Declared age can be false. Accepted, and never called verification | DEFERRED | P2 | R-01 | Legal confirms |
| S-05 | 4.0.1 | Legacy `SUGGESTED` rows stay in force, possibly with defective values, until replaced or stopped | DEFERRED | P1 | R-08 | Empty production database |
| S-06 | 4.0.1 | Legacy zeros can't be told from deliberate ones, and aren't rewritten | DEFERRED | P2 | R-08 | Empty production database |
| S-07 | 4.0 | `POST .../sets` has no idempotency key, so a lost response could log a set twice | NOT STARTED | P1 | M-14 | Decided in 4.0.6 |
| S-08 | 4.0 | Light-theme contrast defects, from the design's review | NOT STARTED | P2 | None | Contrast checked, and fixed |
| S-09 | 4.0.1 | Raw field names reach people in forms other than profile and targets (`client/api.ts`) | DEFERRED | P2 | None | Fixed copy per form |

## 8. Technical debt

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| TD-01 | 4.0.1 | `calorieTargetOverride` column unused, with a stale comment at `schema.prisma` | DEFERRED | P3 | MIG-02 | Comment fixed, then the column dropped with approval |
| TD-02 | 4.0.1 | `Segmented` keeps button-based radios, and section 11's native radios weren't built, as Annex D allowed | DEFERRED | P3 | None | Separate accessibility change, with a keyboard test |
| TD-03 | 4.0.1 | Sex, activity, goal, experience and days are asked for with nothing reading them | NOT STARTED | P1 | MIG-02 | T45 |
| TD-04 | 4.0.1b | Raw CHECK constraints are invisible in `schema.prisma`, and only commented there | DEFERRED | P3 | T-03 | Drift behaviour recorded |
| TD-05 | 4.0.1b | The stop's date can overwrite a future row, only after a move to an earlier time zone. Accepted, as the alternative undoes the stop | DEFERRED | P3 | None | Revisit if real use shows a problem |
| TD-06 | Docs | `README.md`, `ARCHITECTURE.md` and the Phase 3.6 status line carry stale statements | NOT STARTED | P2 | None | Design section 15's list done |
| TD-07 | Docs | `PHASE_4_0_0A_TEST_TARGET_GUARD.md` still says "not merged" | NOT STARTED | P3 | None | Status corrected |
| TD-08 | Tests | `npm run test:e2e` and `test:api` cover only some suites. `test:suites` is the complete run | DEFERRED | P3 | None | Named clearly in the README |

## 9. Items outside this tracker

`docs/BUNNY_AGENT_DESIGN.md` is an untracked file belonging to the owner. It hasn't been read or evaluated, and it isn't counted here as planned work.
