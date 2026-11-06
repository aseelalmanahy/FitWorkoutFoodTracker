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
| M-08 | 4.0.1b | Nullable targets, calories-only, stopping a target | **IN PROGRESS** | Implemented on this branch, and verified on `fitdb_test`, section 3. **Not COMPLETE until independent review and merge** |
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
| B-01 | 4.0.1b | Migration: 4 nullable columns, 2 CHECK constraints, no row rewritten | IN PROGRESS | P0 | B-06 | **Verified on `fitdb_test`:** `migration-verify` passed. **Left:** review and merge |
| B-02 | 4.0.1b | Calories-only and partial targets; blank is null, zero is zero | IN PROGRESS | P0 | B-06 | **Verified:** T41, and browser Part B. **Left:** review and merge |
| B-03 | 4.0.1b | `POST /api/nutrition/targets/stop`, with confirmation | IN PROGRESS | P0 | B-06 | **Verified:** T39, T40, T42, isolation, and 3 browsers. **Left:** review and merge |
| B-04 | 4.0.1b | Null displays as "Not set", in the editor, history, Nutrition and macro bars | IN PROGRESS | P0 | B-06 | **Verified:** T43, Part B, and controls D9 and D10. **Left:** review and merge |
| B-05 | 4.0.1b | All readers reviewed for nulls | IN PROGRESS | P1 | B-06 | **Verified:** compiler, T43, and the full regression. **Left:** review and merge |
| B-06 | 4.0.1b | Independent review, then the owner's merge approval | NOT STARTED | P0 | ChatGPT review, owner | A specific reviewed commit is approved |
| B-07 | 4.0.1b | `fitdb`, the development database, doesn't have this migration | BLOCKED | P1 | Separate owner approval | **Calories-only saves and stopping will fail there until it's applied.** Applying it needs its own decision and backup |

## 3. Tests: run, failed, blocked

**Results for this branch, on `fitdb_test` after the migration. Nothing ran on `fitdb`, and `fitdb_test_other` wasn't migrated.**

| Test | Result | Limit |
|---|---|---|
| Unit tests (`vitest`) | PASSED, 1,346 | |
| Type check, production build | PASSED | Built against the test database |
| `migration-verify`, T44 | PASSED | 1,229 snapshot rows unchanged. Columns nullable, both constraints present |
| `nutrition-targets` | PASSED, 8 of 8 | T38, T39, T40, T41, T42, T43, isolation, legacy rows |
| `nutrition-targets-e2e`, Parts A and B | PASSED, 3 browsers | Chromium, Firefox and WebKit at a phone-sized viewport. No real phone |
| Rest of the guarded suite | PASSED | `guard` 51, `guard-browser` 21, `units` 19, `live-identity` 9, `nutrition-api` 77, `release-workflow` 8, `provider-protection` 7, `provider-malformed` 4, `provider-config` 1, `usda-missing-nutrients` 4, `db-guard-scoped` 6, `safety-no-marker` 7 with 1 skipped by design, `e2e-smoke`, `e2e-nutrition`, `eligibility`, `label-scan`, `label-pdf`, `meal`, `hardening`, and the 3 unconfigured suites |
| Failed | None at the final state | The first Part B run failed on a test locator, fixed. Details below |

**Test corrections made during verification, each a test defect and none weakening a check:** Part B's `2,500 kcal` locator matched two correct elements. T43's HTML check now removes React's comment markers, as it couldn't have seen `C 0 g` otherwise. Part B's "Not set" count now asserts rather than times out.

**Negative controls: 21 of 21 caught, with every file restored and hash-checked.**

| Group | Controls | Fails on |
|---|---|---|
| Unit, browser and text (before the migration) | NC28, NC29, NC30, NC31a, NC31b, NC32, NC37, NC38, NC40, NC41, NC42 | Their named assertions |
| D1 stop deletes earlier rows | Database | T39: earlier rows unchanged |
| D2 stopped row returned as a target | Database | T39: no target today |
| D3 null macro compared as 0 | Database | T41 |
| D4 stop written at the local date only | Database | T42: tomorrow has no target |
| D5 app sends carbs without both macros | Database | T41: 500, as the app's write is refused |
| D6 app sends macros on a stopped row | Database | T39: 500. Server log shows PostgreSQL `23514`, a check-constraint violation |
| D7 repeat stop writes again | Database | T40 |
| D8 stop reads another person's latest row | Database | T40. The harness first expected only one of T40's two assertions, and was corrected and rerun |
| D9 null shown as `0 g` | Database | T43 |
| D10 Nutrition page treats a null macro as 0 | Browser | Part B: each macro reads Not set |

**Drift findings.** `prisma migrate diff` from the live database to `schema.prisma` reports "No difference detected", after real null rows were written. `migrate status` reports up to date. So the raw CHECK constraints don't appear as drift in these commands. **Limit:** `prisma migrate dev`, which uses a shadow database, wasn't run.

**Old-code compatibility, observed.** A client generated from `main`'s schema (`429d961`), reading `fitdb_test` read-only:

| Person | Result |
|---|---|
| No null rows | Reads normally |
| Has a stopped row | Throws `P2032` on `kcal` |
| Has a partial row | Throws `P2032` on `proteinG` |

So code from before this migration **fails for those people, and never reads a null as 0.** It works for everyone else. **Limit:** this exercised the client, not the old running application. It confirms that rollback is forward-only once nulls exist.

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| T-01 | 4.0.1b | `nutrition-targets`, Part B and `migration-verify` | COMPLETE | P0 | None | Results above, at this branch's final commit |
| T-02 | 4.0.1b | Database-level negative controls | COMPLETE, except T-09 | P0 | None | D1 to D10 above |
| T-03 | 4.0.1b | Drift over the raw CHECK constraints | COMPLETE | P1 | None | Findings above. `migrate dev` not observed |
| T-04 | 4.0.1b | What old code does against a null row | COMPLETE | P2 | None | Findings above |
| T-05 | 4.0.1b | Full guarded suite | COMPLETE | P0 | None | Results above |
| T-06 | 3 | Real models, labels, meals, hostile inputs | BLOCKED | P1, if AI is wanted | Paid-test approval | Readiness items 2 to 4 |
| T-07 | 3 | Real phones and real PDFs | NOT STARTED | P0 | M-14 | Readiness items 6 and 7 |
| T-08 | 4.0.1 | `T3` exercises only the branch for the UTC hour it runs in, or both between 10:00 and 11:00 | DEFERRED | P3 | None | Accepted limit for now. NC3 was seen to catch one branch (`422 !== 200`), and the other hasn't been seen to fail. A control run at the right UTC hour would close this |
| T-09 | 4.0.1b | **Not run:** dropping a CHECK on a live database, to show T38 then fails. The owner's authorization allowed only the approved migration to change the schema | DEFERRED | P2 | Owner, if wanted | **Partly covered:** NC31a and NC31b catch a removed constraint in the migration's text, T38 shows the live constraints refuse every invalid shape, and D5 and D6 show they stop the app's own bad writes |

## 4. Migrations

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| MIG-01 | 4.0.1b | `20261106120000_nullable_nutrition_targets`, Git blob `62b7459`. **Applied to `fitdb_test` only,** on 2026-11-06, with owner authorization | COMPLETE for `fitdb_test` | P0 | None | `migration-verify` passed. **Not applied to `fitdb`, `fitdb_test_other` or any production database,** which each need separate approval |
| MIG-02 | 4.0.1c | `Profile`: nullable unread fields, separate migration | NOT STARTED | P1 | Owner approval, Decision 9 = A | Annex H4 and T45 |
| MIG-03 | 4.0.4 | Token table and acceptance fields | NOT STARTED | P0 | Decisions 8, 10, 11 | Design section 8 |

**Backup taken before applying:** `C:\Users\Aseel\FitWorkoutFoodTracker-backups\fitdb_test-pre-4.0.1b-20261106T060140Z.dump`, custom format, 859,762 bytes. `pg_dump` exited 0, and `pg_restore --list` read it. **It hasn't been restored,** so the restore itself is untested.

**Rollback:** forward-only, Annex H6. `fitdb_test` now holds real null rows from the suites.

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
