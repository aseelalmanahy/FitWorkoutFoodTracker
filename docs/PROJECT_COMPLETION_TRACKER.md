# Project Completion Tracker

**The single source of truth for what's done and what isn't.** Last updated 2026-11-06, on `main`, after Phase 4.0.4 merged at `eaeff34`. **No production infrastructure has been deployed.**

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
| M-08 | 4.0.1b | Nullable targets, calories-only, stopping a target | COMPLETE for development | Merged at `38c4a37`, and verified on `fitdb_test`, section 3. **The migration is on `fitdb_test` only, so `fitdb` can't run this yet (B-07).** Not for real users on its own |
| M-09 | 4.0.1c | Profile data minimization | COMPLETE for development | Merged at `899e54c`, and verified on `fitdb_test`, section 3. **The migration is on `fitdb_test` only, so `fitdb` can't run this yet (C-08, B-07).** `safety-no-marker` and `db-guard-scoped` weren't run on the final code (T-14). Not for real users on its own |
| M-10 | 4.0.2 | Account deletion and export | COMPLETE for development | Merged at `b79331d`, and verified on `fitdb_test`, sections 2b and 3. **Not for real users on its own:** real-device testing (T-15), backup and log retention (S-14) and legal decisions (E-06) stay open. `safety-no-marker` and `db-guard-scoped` weren't run (T-14) |
| M-11 | 4.0.3 | Production foundation | **IN PROGRESS** | Code and templates merged at `de4607f`, section 2c, with the development code independently source-reviewed. **Operational verification is incomplete: nothing is deployed, and no infrastructure exists. Not COMPLETE until the infrastructure items are done.** Needs decisions 4, 5 and 14 |
| M-12 | 4.0.4 | Email-proven access | COMPLETE for development | Merged at `eaeff34`, and verified on `fitdb_test`, section 2d. **That covers the locally verified implementation only. The production milestone isn't complete:** no real email can be sent (G-03), and nothing is deployed |
| M-13 | 4.0.5 | Notice, acceptance, retention | **IN PROGRESS** | L1 to L5 built on `feature/phase-4.0.5-privacy`, unmerged, section 2e. **Not COMPLETE:** the notice is a draft with no legal review, no retention rule exists, and a draft keeps real registration closed |
| M-14 | 4.0.6 | Device testing and beta go/no-go | NOT STARTED | Needs everything above |
| M-15 | 4.1 | Core progress: weight log, goal card | NOT STARTED | Needs 4.0.2's coverage check |
| M-16 | 4.2 | Real-user beta | NOT STARTED | Needs 4.0 and 4.1 complete |

**Roadmap after the beta, deliberately not started:** Phases 4.3 and 4.4, Track A (paid AI) and Initiative T (trainers) in `PRODUCT_STRATEGY.md`. The beta's findings revise them.

## 2. Phase 4.0.1b detail

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| B-01 | 4.0.1b | Migration: 4 nullable columns, 2 CHECK constraints, no row rewritten | COMPLETE for `fitdb_test` | P0 | None | Merged at `38c4a37`. `migration-verify` passed on `fitdb_test`. **Other databases are open:** B-07 and MIG-01 |
| B-02 | 4.0.1b | Calories-only and partial targets; blank is null, zero is zero | COMPLETE for development | P0 | None | Merged at `38c4a37`. T41, and browser Part B, on `fitdb_test` |
| B-03 | 4.0.1b | `POST /api/nutrition/targets/stop`, with confirmation | COMPLETE for development | P0 | None | Merged at `38c4a37`. T39, T40, T42, isolation, and 3 browsers, on `fitdb_test` |
| B-04 | 4.0.1b | Null displays as "Not set", in the editor, history, Nutrition and macro bars | COMPLETE for development | P0 | None | Merged at `38c4a37`. T43, Part B, and controls D9 and D10 |
| B-05 | 4.0.1b | All readers reviewed for nulls | COMPLETE for development | P1 | None | Merged at `38c4a37`. Compiler, T43, and the full regression |
| B-06 | 4.0.1b | Independent review, then the owner's merge approval | COMPLETE | P0 | None | The owner approved `38c4a37` for merge on 2026-11-06, and it was fast-forwarded to `main`. The review's own findings aren't recorded here |
| B-07 | 4.0.1b | `fitdb`, the development database, doesn't have this migration | BLOCKED | P1 | Separate owner approval | **Calories-only saves and stopping will fail there until it's applied.** Applying it needs its own decision and backup |

## 2a. Phase 4.0.1c detail

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| C-01 | 4.0.1c | Migration `20261106130000_nullable_profile_fields`: 7 nullable columns, no default, no row rewritten | COMPLETE for `fitdb_test` | P0 | None | Merged at `899e54c`. `profile-migration-verify` passed on `fitdb_test`. **Other databases are open:** C-08 and MIG-02 |
| C-02 | 4.0.1c | Onboarding asks for name, date of birth and units, and takes the time zone from the browser | COMPLETE for development | P0 | None | Merged at `899e54c`. T45, real saves in 3 browsers, on `fitdb_test` |
| C-03 | 4.0.1c | `PUT`: omitted leaves unchanged, null clears, a value sets. Date of birth, name, units and time zone stay required | COMPLETE for development | P0 | None | Merged at `899e54c`. `profile-nulls`, `profile-minimization`, and controls D1, D2 and D5, on `fitdb_test` |
| C-04 | 4.0.1c | Profile page: stored details show with a clear action, and nothing asks for unset ones. Only what was changed is sent | COMPLETE for development | P0 | None | Merged at `899e54c`. Parts A and B in 3 browsers, and controls D3, D4 and D9, on `fitdb_test` |
| C-05 | 4.0.1c | Eligibility unchanged: refusal, restriction and correction | COMPLETE for development | P0 | None | Merged at `899e54c`. `profile-nulls`, `profile-minimization`, `eligibility`, Part B, and control D7, on `fitdb_test` |
| C-06 | 4.0.1c | Owner's decision to apply the migration to `fitdb_test` | COMPLETE | P0 | None | Authorized by the owner and applied on 2026-11-06, to `fitdb_test` only. No other database is covered |
| C-07 | 4.0.1c | Independent review, then the owner's merge approval | COMPLETE | P0 | None | The owner approved `899e54c` for merge on 2026-11-06, recording independent review approval at that commit, and it was fast-forwarded to `main`. The review's own findings aren't recorded here |
| C-08 | 4.0.1c | **This code needs the migration on any database it runs against.** Without it, every save from the new form returns 500, including for people who already have a profile | BLOCKED | P0 | B-07, separate owner approval | Applied on `fitdb_test` only. **`fitdb` needs both the 4.0.1b and 4.0.1c migrations, each with its own backup, before this code is usable on it** |
| C-09 | 4.0.1c | Legal advice on not collecting these fields, and on the interim "Stored with your profile" wording (Decision 25) | BLOCKED | P1 | R-01 | Advice recorded, and the wording finalized |
| C-10 | 4.0.1c | Line endings changed a migration's recorded checksum. `core.autocrlf` is on, and `20261106120000_nullable_nutrition_targets` was applied as LF, then rewritten as CRLF by Git | COMPLETE for `fitdb_test` | P1 | None | **Fixed without touching migration history or running `migrate resolve`:** the file's LF bytes are restored, and `.gitattributes` now fixes each migration's line endings on every machine: CRLF for the four applied that way, LF for the rest. All 6 recorded checksums equal the files, and no Git blob changed. **`fitdb`'s checksums weren't read, so are unconfirmed.** `migrate dev` wasn't run, and remains unsafe to assume |

### Phase 4.0.1c migration pre-flight, 2026-11-06

**Read-only, at `dec7b2d`, before the migration. These are the results at that time.**

| Check | Result |
|---|---|
| Commits, on GitHub | Feature `dec7b2d`, `main` `5239fb6`. Both as expected |
| Migration file | Blob `25d1bab` in the commit and the working tree. `prisma/` is identical to the commit |
| Test-target guard | `guard` 51 of 51 |
| Database | `fitdb_test`, `localhost:5432`, schema `public`, from both the connection and `migrate status` |
| Identity marker | `fitworkoutfoodtracker:test-database:v1:fitdb_test` |
| Phase 4.0.1b | Applied: 4 columns nullable, both CHECKs present. No migration unfinished or rolled back. Its checksum differed, since resolved, C-10 |
| Pending | Only `20261106130000_nullable_profile_fields`. The live database differs from `schema.prisma` by exactly its 7 statements |
| `Profile` rows | **2,314,** with no nulls in the 7 columns, none missing a required field, and none orphaned. Includes 198 goal weights, 92 overrides, 114 zero workout days, 80 under the minimum, and the 5 dry-run rows, which are kept |
| `Profile` dependents | No triggers, views, or generated columns. No other session connected |
| SQL | 7 `DROP NOT NULL` on one table. No rewrite, delete, default or type change |
| `pg_dump` | 18.6 available, with `pg_restore`. The backup folder exists, with 270 GB free |
| Snapshot | No file exists, so a fresh one is needed. `verify` refuses one over 24 hours old, and compares every recorded row in every column, so a missing row fails |

**Prisma and `.env`.** `migrate status` printed "Environment variables loaded from .env", and still named `fitdb_test`, as a variable already set isn't replaced. So `--env-file=.env.test` decides the target. **Node lets a variable already in the shell win over `--env-file`.** `DATABASE_URL` is unset in the shell now, and that has to be rechecked just before applying. The guard doesn't cover the Prisma CLI.

**Procedure, as authorized and carried out, with results in section 3:**

1. Recheck the commit, blob `25d1bab`, an unset shell `DATABASE_URL`, and `node --env-file=.env.test node_modules/prisma/build/index.js migrate status`, which must name `fitdb_test` and one pending migration.
2. Backup: a custom-format `pg_dump` of `fitdb_test` to `C:\Users\Aseel\FitWorkoutFoodTracker-backups\fitdb_test-pre-4.0.1c-<timestamp>.dump`, requiring exit 0 and a `pg_restore --list` that shows `Profile` data.
3. Snapshot: `node --env-file=.env.test scripts/run-guarded-suites.cjs profile-migration-snapshot`. This adds 5 more legacy-shaped rows and records every row. Nothing is deleted.
4. Apply: `node --env-file=.env.test node_modules/prisma/build/index.js migrate deploy`.
5. Verify, in order: `migrate status`, `profile-migration-verify`, `migrate diff` from the live database to the schema, `profile-nulls`, `profile-minimization`, `profile-minimization-e2e` Parts A and B, every form suite listed as BLOCKED below, the T-12 controls, then the full regression, type check and build.
## 2b. Phase 4.0.2 detail

**Migration: none needed.** The schema was reviewed, and no change was made.

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| E-01 | 4.0.2 | Deletion: `POST /api/account/delete`, in one transaction, with a row lock, explicit owner-scoped steps, session identity, password and the word DELETE | COMPLETE for development | P0 | None | Merged at `b79331d`. `account-data` on `fitdb_test`. Limits: S-10, S-12, S-14 |
| E-02 | 4.0.2 | Export: `POST /api/account/export`, versioned JSON, from a field allowlist, in one snapshot, counted first, with password re-entry as the design requires | COMPLETE for development | P0 | None | Merged at `b79331d`. Every mapped field of every model compared with the row, on `fitdb_test`. Limit: S-13 |
| E-03 | 4.0.2 | `/account` page and public `/account-deleted` page, reachable from the profile, onboarding, refusal and restricted screens | COMPLETE for development | P0 | None | Merged at `b79331d`. 3 browsers at a phone-sized viewport. **Real phones are T-15** |
| E-04 | 4.0.2 | Every model and field classified in `account-data-map.json`, so a new one fails the unit tests | COMPLETE | P1 | None | Merged at `b79331d`. Checked against Prisma's own model list, control N24 |
| E-05 | 4.0.2 | Stage A gate unchanged: both routes are named exceptions, and everything else stays closed | COMPLETE | P0 | None | Merged at `b79331d`. T33, `nutrition-api`, `eligibility` |
| E-06 | 4.0.2 | Owner's decision on export fallback, and legal advice on timing (design section 4.0.2's approvals). The "backups may keep a copy" wording is interim | BLOCKED | P1 | Owner, R-01 | Recorded, with final wording |
| E-07 | 4.0.2 | Independent review, then the owner's merge approval | COMPLETE | P0 | None | Independent review approved `b79331d`, as recorded by the owner on 2026-11-06, and it was fast-forwarded to `main`. The review's own findings aren't recorded here |

**Deletion map, from the schema:**

| Kind | Models | How |
|---|---|---|
| Owned, deleted by an explicit step | `Session`, `Profile`, `WorkoutTemplate`, `ScheduleSlot`, `WorkoutSession`, `FoodEntry`, `NutritionTarget`, then `User` | `where: { userId }` |
| Owned, but shared when there's no owner | `Exercise`, `Food` | Only rows with this `userId`. Built-in and provider rows have none, and stay |
| Children, by cascade from an owned parent | `TemplateExercise`, `SessionExercise`, `SetEntry`, `FoodServing` | Checked by id after each deletion |
| Restricting | `TemplateExercise.exercise`, `SessionExercise.exercise` | Sessions and templates go first. A plain `user.delete` was observed to fail on these |
| Set null | `FoodEntry.food`, `WorkoutSession.template` | Another person's entry would keep its own copy |
| External assets | **None.** No model holds a file, and nothing in `src/` writes one | Uploads stay in memory for the request |
| In memory | Login throttle records with the email, and password and age-refusal attempts, are cleared. Upload, label-scan and food-search limiter entries hold an id only, and expire | S-11 |
## 2c. Phase 4.0.3 detail

**Migration: none.** No schema change. **No infrastructure was created, and nothing was deployed.**

**Merged at `de4607f`, by fast-forward, after independent source review of the development code. That covers the code only.** M-11 stays IN PROGRESS, and every unresolved infrastructure and security blocker stays open, each at the status shown in this tracker.

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| F-01 | 4.0.3 | Startup preflight: `production-config.ts`, `production-preflight.ts`, `instrumentation.ts` | IN PROGRESS | P0 | T-16 | **Verified locally:** every condition refuses alone, in unit tests and the real server. **The successful start is only tested with a stand-in database,** T-16 |
| F-02 | 4.0.3 | Closed registration | IN PROGRESS | P0 | R-09 | See R-09 |
| F-03 | 4.0.3 | Headers, a nonce-based CSP, HSTS, API headers, cookies checked, `/api/health`, image validation off while AI is off, Node pin | IN PROGRESS | P0 | T-17 | **Verified locally,** in 3 browsers and by header. **HTTPS itself hasn't been exercised,** T-17 |
| F-04 | 4.0.3 | Deployment templates and runbook | IN PROGRESS | P0 | Decisions 4, 5, 14 | **Prepared, never run.** Only `docker compose config` was run, offline, and the templates were read by tests |
| F-05 | 4.0.3 | Backup, recovery and deletion ledger design | IN PROGRESS | P0 | Owner, R-01 | **Design only.** Objectives and periods are proposals |
| F-06 | 4.0.3 | A real backup, with a timed restore into a named target | BLOCKED | P0 | R-07, authorization for the exact database | Written record of the date, duration and result. Includes T-10 |
| F-07 | 4.0.3 | Clean `npm ci`, image build, and all suites on Linux | BLOCKED | P0 | A running Docker daemon or a Linux host | Recorded results. Includes whether `next.config.ts` loads without dev dependencies |
| F-08 | 4.0.3 | Independent review, then the owner's merge approval | COMPLETE | P0 | None | The owner approved `de4607f` after independent source review, and it's merged. **This covers the code, and verifies nothing operationally** |
| F-09 | 4.0.3 | Least-privilege database roles, rehearsed | BLOCKED | P1 | Decision 5 | App and migration both work under `deploy/database-roles.sql`, or it's corrected |
| F-10 | 4.0.3 | A release and a rollback rehearsed, monitoring and alerts in operation, a named person for patching | BLOCKED | P0 | R-07, owner | Each done once, and written down |
| F-11 | 4.0.3 | 3 high `npm audit` findings, in `deepmerge-ts` through Prisma. The fix is a breaking move to Prisma 7 | BLOCKED | P1 | Owner decision | Upgraded, or accepted in writing. **The owner kept Prisma 6 for 4.0.4's development verification, which doesn't accept this for production.** Stays open for a separate reviewed upgrade before release, after 4.0.4's suites, which have now passed, and before F-07 and any real user. `PHASE_4_0_4_EMAIL_ACCESS.md` |

**Owner decisions still needed:** 4 (name and domain), 5 (host, database, ceiling), 12 (backup retention), 14 (production data access), the recovery objectives, the deletion ledger including whether deletion may depend on it, and F-11.

## 2d. Phase 4.0.4 detail

**Migration: `20261106140000_account_tokens`, applied to `fitdb_test` only.** Decisions 8, 10 and 11 were recorded on 2026-11-06. **No email provider, SDK or new dependency was added, and nothing was deployed.** Plan and F-11 assessment: `PHASE_4_0_4_EMAIL_ACCESS.md`.

| State | Phase 4.0.4 |
|---|---|
| **IMPLEMENTED** | Yes, on `feature/phase-4-program`: link-first sign-up, one-time links, reset, change password, session revocation, limits, generic responses, file mail stub, provider interface |
| **TESTED** | **Yes, on `fitdb_test`,** results below. Real races are run in a known order, and controlled by real locks. **Real email and real devices aren't exercised** |
| **REVIEWED** | **Yes, for development.** The owner approved `eaeff34` after independent GitHub review by ChatGPT. Earlier, a read-only security agent reviewed the plan, the code, and the final code with `scripts/` at `8057d59`. **That agent ran nothing, and didn't see `ae5e10e`, `5b36b6c` or `e82cbd9`** |
| **MERGED** | **Yes, at `eaeff34`,** by fast-forward from `40d730f`, so there's no separate merge commit |
| **OPERATIONALLY VERIFIED** | No |

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| G-01 | 4.0.4 | Sign-up, recovery, change password and their pages | COMPLETE for development | P0 | None | All suites passed on the final code, below, and the owner approved `eaeff34` after independent review. **Real delivery stays with G-03** |
| G-02 | 4.0.4 | Back up `fitdb_test` and apply MIG-03 to it. **This code can't run on any database without it,** like B-07 and C-08 | COMPLETE | P0 | None | Applied on 2026-11-06 with the owner's authorization, after a verified backup, section 4. `migrate status` clean, no drift, every table's row count unchanged, and the marker's row unchanged. **`fitdb_test` only** |
| G-03 | 4.0.4 | A real email provider. **Production sends nothing today:** it warns once at startup, and sign-up and reset fail closed behind the same response | BLOCKED | P0 | Decision 5, Decision 4, R-07 | Provider chosen with click tracking off, built behind `MailTransport`, delivery observed, and startup then refuses to run without it |
| G-04 | 4.0.4 | Confirm judgement values: 24-hour sign-up and 60-minute reset links, 60-second cooldown, 5 live tokens per address, 200 tokens an hour | NOT STARTED | P1 | Owner | Each confirmed or changed. **These are token lifetimes and limits, not legal retention periods** |
| G-05 | 4.0.4 | Emails say "Forge", as the app does | NOT STARTED | P2 | Decision 4 | Matches the chosen name |
| G-06 | 4.0.4 | Runbook steps: deleting an account also removes its address from the allowlist, or it can sign up again. A manual email change deletes tokens for both addresses | NOT STARTED | P1 | F-04 | Written in the runbook |

**Summary at merge:** 32 of 32 regression suites, 1,600 of 1,600 unit tests, 57 of 57 unit negative controls, 5 of 5 database negative controls in the final set, and a clean production build and type check. MIG-03 is applied to `fitdb_test` only.

**Final results, on `e82cbd9`, one step at a time. Available memory stayed above 14 GB, against a stop at 4 GB.**

| Check | Result |
|---|---|
| Type check, clean production build | PASSED |
| Vitest, on fakes | PASSED, 1600 of 1600 in 40 files |
| `account-tokens`, real races | PASSED, 32 of 32 |
| Other guarded suites | PASSED: `account-data` 26, `nutrition-api` 77, `release-workflow` 8, `provider-protection` 7, `provider-malformed` 4, `provider-config` 1, `production-startup` 17, `production-security` 14, `production-https` 3, `usda-missing-nutrients` 4, `live-identity` 9, `units` 19, `nutrition-targets` 8, `profile-minimization` 7, `profile-nulls` 16, `guard` 51 |
| Browsers: Chromium, Firefox, WebKit | PASSED: `e2e-smoke`, `e2e-nutrition`, `eligibility`, `nutrition-targets-e2e`, `profile-minimization-e2e`, `account-data-e2e`, `production-security-e2e`, `label-scan`, `label-pdf`, `meal`, `hardening`, three unconfigured checks, `guard-browser` 21 |
| **`safety-no-marker`, `db-guard-scoped`** | **NOT RUN,** as they need `fitdb_test_other`, T-14 |
| Unit negative controls | **57 of 57 caught, 0 missed, 0 retired.** 56 on `5b36b6c`. On `e82cbd9`, the 13 near that change, with one new |
| Database negative controls | **15 of 15 caught by an assertion, none by a timeout alone,** on `8057d59`: reusable token, expired token, wrong purpose, session surviving reset, four stale authorizations, an overwritten account, a duplicate address, cross-account export, enumeration, three unsafe targets. **Then 5 on `5b36b6c`:** reusable token, stale login, export not at one point in time, no lock limit, link not tied to its address. **The lock limit again on `e82cbd9`** |
| `A7` from 4.0.3 | **Stays RETIRED,** and isn't counted as passed |

**Security controls, and what checks each:** authentication, reset and sessions, `account-tokens`. Deletion and export, `account-data` and `account-tokens`. Startup, `production-startup`. Registration limits, `production-security` and `account-tokens`. Database targets, `guard` and `guard-browser`. Logging, the log test in `account-tokens` and `production-security`. Headers, `production-security`, `production-https` and `production-security-e2e`. Validation and rate limits, Vitest and those suites. **All of this is on a local server, so none is operationally verified.**

**The lock limit, measured.** With the row held 9 seconds: the first request in the queue answered 503 at 4,019 ms, and the second at 8,029 ms. A password change alone answered 503 at about 4,080 ms. **So "4 seconds" is per lock, and a queued request can take about 8.** An earlier version answered 500 there, as Prisma's 5-second limit expired first, which a later run found. Sign-in transactions now allow 10 seconds. The response names no database detail, nothing changes, the link isn't spent, sessions stand, the server recovers, no connection is left idle in a transaction, and the setting ends with its transaction. **Deletion and export set no lock limit:** deletion waits on the row, and export takes no lock.

**Two infrastructure failures, each once in 6 runs, both in the run that was later stopped for low memory:**

- **Firefox, `guard-browser`:** `Browser.removeBrowserContext` failed with `_maybeDontRestoreTabs` undefined, in a browser-only control with no application. The message is from the browser's session code, so it's test infrastructure and not an application defect. **No assertion failed, and none was changed.** It passed 5 other times.
- **Chromium, `production-security-e2e`:** `ERR_PROXY_CONNECTION_FAILED` on `/account`, on the test guard's local proxy. **Cause not established.** Memory was low around that run, which is circumstantial. It passed 5 other times, and if it recurs the proxy should be investigated.

**Database cleanup, 2026-11-06.** 44 rows were removed from `AccountToken` on `fitdb_test`, after a query showed 22 `PASSWORD_RESET` and 22 `SIGNUP`, all at `test.dev`. **The table was verified empty straight after MIG-03.** The three `account-data` runs that seeded links before the cleanup was added left 7, 8 and 7 seeded users (19:39, 19:45 and 19:59 UTC), so 22 users with 2 links each is exactly 44. The rows were gone before this accounting, so it's reasoned from those counts, and no row-by-row record exists. No other table was touched. The suite now removes its own links, and the table has held 0 rows after each later run. Pre-migration backup: section 4.

## 2e. Phase 4.0.5 detail

**Migration: none,** as MIG-03 holds the fields. **The text is a draft with marked gaps, and isn't legal advice. A tick isn't claimed as valid consent.** Plan: `PHASE_4_0_5_PLAN.md`. Inventory: `PHASE_4_0_5_DATA_INVENTORY.md`.

| State | Phase 4.0.5, L1 to L5 |
|---|---|
| **IMPLEMENTED** | Yes, unmerged: inventory checked against the code, `/privacy` and `/terms` from one source, acceptance recorded with the account, a counts-only report, and a gate keeping drafts from opening registration |
| **TESTED** | Yes, on `fitdb_test`, below |
| **REVIEWED** | **Partly.** A read-only security agent reviewed the plan, the code and the fixes, and ran nothing. **Independent source review is pending** |
| **MERGED** | No |
| **OPERATIONALLY VERIFIED** | No |

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| H-01 | 4.0.5 | L1 to L5 | IN PROGRESS | P0 | Source review, merge approval | Reviewed and merged. Whether it may merge before legal advice is still the owner's decision, plan section 2 |
| H-02 | 4.0.5 | Final notice and terms | BLOCKED | P0 | R-01, Decisions 2, 3, 4, 5, 6, 7, 12, 14, 16 | A reviewed version passes `noticeIsFinal()`, and is checked against a deployment. **Until then, real registration stays closed** |
| H-03 | 4.0.5 | Retention deletion. Not built, by O4 and the plan's section 6 | BLOCKED | P0 | R-06, product review, S-14's ledger | Its own design and approval |
| H-04 | 4.0.5 | Reacceptance when a version changes, and whether a history must be kept, which would need a migration | BLOCKED | P1 | R-01 (O3) | Legal's answer, then its own approval |

## 3. Tests: run, failed, blocked

### Phase 4.0.3, on `fitdb_test` and with fake settings, with no schema change

| Test | Result | Limit |
|---|---|---|
| Authorized regression | **PASSED, 31 of 31 suites** | Includes all form, account, label, meal and hardening suites. Run before one small console-guard correction, after which the affected suites were rerun |
| After that correction | PASSED | Unit tests 1,507, type check, build, `guard` 51, `production-startup` 17, `production-security` 13, `production-https` 3, `production-security-e2e` in 3 browsers |
| **`safety-no-marker`, `db-guard-scoped`** | **NOT RUN** | They need `fitdb_test_other`, which isn't authorized, T-14. The first needed a settings change for this phase, **which hasn't been run** |
| **A real production start** | **BLOCKED** | Needs a database that isn't a test one. The refusals run on the real server, but success only with a stand-in |
| **Docker build, proxy, TLS, restore, Linux** | **BLOCKED** | No Docker daemon was running, and no infrastructure exists. F-06, F-07, T-16, T-17 |

**Negative controls, final: 42 caught, 0 missed, 0 blocked, 0 not run, and 1 retired, of 43 defined.** Each ran one defect at a time, with every file restored and hash-checked, and each failed on its intended assertion, checked in the logs. **So not 43 of 43.**

| Control | Defect | Fails on |
|---|---|---|
| U1 to U14 | Each preflight rule removed | That rule's own named test |
| U15 | The exemption ignores where the database is | The local test exemption |
| U16, U17 | A wildcard opens sign-up, or it's open by default | Their named tests |
| U18, U19 | A test marker ignored, or an unreachable database passes | Their named tests |
| U20 | A problem message includes the value | Never includes a value |
| U21 | Prisma's log on in production | Off outside development |
| **U22** | `logServerError` prints the whole error | `expected 'PrismaClientUnknownRequestError: Inva…' not to contain` the row id. **First reported as missed: a real weakness in the test,** as `JSON.stringify` drops an error's message, so it could never see a leak. The test is corrected |
| U23, U26 | The console guard does nothing, or misses an ordinary error repeating Prisma's text | The row id reaches the output. U26 covers a gap found in review, now fixed |
| U24, U25 | CSP allows inline script, or the Node pin drifts | Their named tests |
| **S1** | The preflight never runs | `the server should have stopped. Served: true`, on 17 of 17 tests. **The first run was only a harness timeout, and didn't count.** The test's wait was cut from 45 to 20 seconds, on a refusal that takes about 3 |
| **S2** | The preflight doesn't stop the process | The same, on 17 of 17 |
| S3 | The output prints the database URL | No password in the output |
| A1 to A5 | Anyone registers, a different answer for existing accounts, no hash on refusal, health reveals the database, no fresh nonce | Their named assertions |
| **A6** | The nonce doesn't reach the page | `inline script without the nonce`. **First reported as missed:** removing one header changed nothing, as Next.js has another source. The stronger defect removes the request headers and changes the response's nonce |
| **A8** | Prisma's log on **and** the console guard off | `no row id in the log`. **First reported as missed:** either layer alone hides the other's removal, so this removes both |
| A9 | Image validation stays on with AI off | `415 !== 404` |
| H1, H3 | No HSTS, or cookies not Secure | Their named assertions |
| H2 | Host believed over `APP_ORIGIN` | `a forged forwarded host`. It first failed on a different assertion, so the test's order changed and it was rerun |
| B1, B2 | The theme script has no nonce, or there's no policy | No violation, and an injected script doesn't run |

**A7, RETIRED, and not counted as passed.** It removed middleware's early redirect for signed-out requests. That had no observable effect, as pages redirect by themselves through `requireUser`. The requirement stays, covered by `signed-out redirects keep their policy` and the existing suites.

**Found by running it:** the nonce's reach, a Zod eval probe the policy now blocks harmlessly, and a Windows WebKit build that won't send a `Secure` cookie over plain `http://localhost`, so **its login can't complete locally,** and it uses a directly set session after the login request (T-15). **A real full login in WebKit hasn't been observed under this policy.**

### Phase 4.0.2, on `fitdb_test`, with no schema change

| Test | Result | Limit |
|---|---|---|
| Unit tests, type check, production build | PASSED, 1,405 | `npm run lint` is the type check. There's no ESLint, R-15 |
| `account-data` | PASSED, 26 of 26 | Includes all five custom-exercise cases, a whole-database scan for the person's id, email and text, rollback, races, and 250,001 sets |
| `account-data-e2e` | PASSED, 3 browsers | Eligible, no-profile, refused and restricted accounts, including a real file download. Phone-sized viewport, no real phone. **A real iPhone download is T-15** |
| Other guarded suites | PASSED | `guard` 51, `guard-browser` 21, `units` 19, `live-identity` 9, `nutrition-api` 77, `release-workflow` 8, `nutrition-targets` 8, `nutrition-targets-e2e`, `profile-minimization` 7, `profile-nulls` 16, `profile-minimization-e2e`, `e2e-smoke`, `e2e-nutrition`, `eligibility`, `hardening` |
| **`safety-no-marker`, `db-guard-scoped`** | **NOT RUN** | They connect to `fitdb_test_other`, which isn't authorized, T-14 |
| Not rerun, as unrelated | Not run for this phase | `label-scan`, `label-pdf`, `meal`, the 3 unconfigured suites, `provider-*`, `usda-missing-nutrients` |
| Failed | None at the final state | See below |

**Found by running it.** PostgreSQL 18 reports a RESTRICT violation as `23001`, which Prisma surfaces as an unknown error rather than `P2003`. Deletion returned 500 until it was mapped, which the rollback test caught. **Measured:** 20,000 sets export at about 345 bytes each, 6.6 MiB. So 250,000 rows is about 86 MiB, within the 128 MiB limit. Deleting 250,001 sets took under a second here, on an unloaded local database.

**Negative controls: 24 of 24 caught, with every file restored and hash-checked.** One defect at a time, with a rebuild.

| Control | Defect | Fails on |
|---|---|---|
| N1 | Exercises deleted before sessions | A custom exercise in a session doesn't stop deletion |
| N2 | Steps run outside the transaction | A failure part-way: every row and column is back |
| N3, N4 | Deletion or export skips the password | A wrong password deletes and exports nothing |
| N5 | Confirmation becomes optional | A missing or wrong confirmation deletes nothing |
| N6 | The body names the account | Nobody can delete someone else's account |
| N7 | Shared foods deleted with the person | Control user and shared data unchanged |
| N8 | The user row stays | Every row goes |
| N10 | The row lock is removed | Two deletions together get the same answer |
| N11 | Export includes the password hash | No password hash |
| N12 | Export reads everyone's food entries | Nothing of anyone else's |
| N13 | Export turns null into 0 | Nulls stay null |
| N14 | Export drops stopped targets | Every row is in the file |
| N15 | No row limit | Over the row limit |
| N16, N17 | Routes closed to restricted or profile-less accounts | Those accounts can export and delete |
| N18 | Cookies not cleared | Session cookie cleared |
| N19 | Password attempts unlimited | Even the right password waits |
| N20 | A reference conflict isn't reported as one | A failure part-way |
| N21, N22 | The form sends without the word or password | Nothing is sent |
| N23 | The restricted page has no way out | A restricted account has a link to its data controls: a named assertion, replacing an earlier browser timeout. Rerun against the mutation and restored, and the unmutated `account-data-e2e` passes in 3 browsers, also asserting the export and deletion controls on the page |
| N24, N25 | A field left out of the map, or a step left out of the code | Their unit tests |

**Corrected along the way:** the first run reported 3 misses. N7 was caught, on the control user's assertion, which fires first, so its expected text was widened. N10 wasn't caught, as the race rarely happens, so a new test holds the row so both requests queue every time, and that catches it. N9 removed one step plus the user row, so it only repeated N8, and it's retired. **A missing step alone can't fail at runtime, as the cascade still removes those rows.** N25 is what catches that, in the source.

### Phase 4.0.1c, on the migrated `fitdb_test`

**Migration.** Only `20261106130000_nullable_profile_fields` was applied, to `fitdb_test`, `localhost:5432`, schema `public`, with `node --env-file=.env.test node_modules/prisma/build/index.js migrate deploy` and `DATABASE_URL` removed from the shell. The script checked in the same process that the effective URL equalled `.env.test` immediately before running it. `migrate dev` and `migrate resolve` weren't run. Nothing touched `fitdb` or `fitdb_test_other`.

| Check, after applying | Result | Limit |
|---|---|---|
| Backup | `C:\Users\Aseel\FitWorkoutFoodTracker-backups\fitdb_test-pre-4.0.1c-20261106T133707Z.dump`, 979,163 bytes. `pg_dump` exit 0, `pg_restore --list` exit 0, names `fitdb_test`, and holds `Profile` and `_prisma_migrations` data | **Not restored,** T-10. Taken before the snapshot's 5 rows |
| Snapshot | Fresh, 2,319 rows, every live row at that moment: 2,314 plus its own 5 | |
| `profile-migration-verify`, T44 | PASSED, right after applying and again after every suite and control. **All 2,319 rows unchanged in every column.** No default added | The table now has 2,639 rows, the extra 320 being new test users |
| Columns | All 7 nullable. `userId`, `name`, `birthDate`, `unitSystem`, `timezone`, `updatedAt` stay NOT NULL | |
| `migrate status`, `migrate diff` to the schema | "Database schema is up to date!", and an empty diff | `migrate dev` not observed |
| Dry-run rows | All kept: the earlier 5 and the snapshot's 5, so 10 | |

| Test | Result | Limit |
|---|---|---|
| Unit tests, type check, production build | PASSED, 1,372 | There's no ESLint, R-15. Built against the test database |
| `profile-nulls` | PASSED, 16 of 16 | |
| `profile-minimization` | PASSED, 7 of 7 | |
| `profile-minimization-e2e`, Parts A and B | PASSED, 3 browsers | Chromium, Firefox and WebKit at a phone-sized viewport. No real phone |
| Form suites, previously BLOCKED | PASSED | `e2e-smoke`, `e2e-nutrition`, `eligibility`, `label-scan`, `label-pdf`, `meal`, `hardening`, and the 3 unconfigured suites. **Stub providers only** |
| Rest of the authorized regression | PASSED | `guard` 51, `guard-browser` 21, `units` 19, `live-identity` 9, `nutrition-api` 77, `release-workflow` 8, `nutrition-targets` 8, `nutrition-targets-e2e`, `provider-protection` 7, `provider-malformed` 4, `provider-config` 1, `usda-missing-nutrients` 4 |
| **`safety-no-marker`, `db-guard-scoped`** | **NOT RUN** | They connect to `fitdb_test_other`, which isn't authorized. T-14 |
| Failed | None at the final state | |

**Test correction, strengthening only:** Part B's re-save check now requires all 8 fields to stay null, rather than 2.

**Negative controls T-12, on the migrated database: 9 of 9 caught, with every file restored and hash-checked.** One defect at a time, with a rebuild. No schema change. D6 was first wrongly defined, as it read a request body already consumed, and its rerun pattern was then broken by a shell escape. Each was corrected and rerun. The final run failed on the named assertion.

| Control | Defect | Fails on |
|---|---|---|
| D1 | Route invents a value on create | T45: `sex`, nothing invented |
| D2 | An explicit null is ignored | T45: explicit null clears only its own field |
| D3 | Serializer shows a null as a value | Part B: nothing asks for unset details |
| D4 | Form saves a null row with a 0 | Part B: a null row re-saved stays null, `workoutDaysPerWeek` |
| D5 | An omitted field is overwritten | Omitted leaves a legacy value |
| D6 | The body names the row | B unchanged, even when A's body names B |
| D7 | The gate lets a cleared field through | Phase 4.0.1a: a null row under the minimum is restricted |
| D8 | Saving a profile deletes targets | Phase 4.0.1b: clearing changes no target |
| D9 | A page prints a null | Every page loads with a null row: `/profile` |

**Before the migration,** these were recorded as BLOCKED, or passed only on a temporary route that wrote the omitted fields itself, restored and hash-checked. That wasn't counted as a pass, and all are now run for real, above.

**Found by running it:** Prisma's `upsert` is one `INSERT ... ON CONFLICT`, and PostgreSQL checks NOT NULL on the row it would insert. So a body that omits a field fails before the migration even for an existing row. That's item C-08, and it's why those tests moved to `profile-nulls`. After the migration, `upsert` leaves omitted fields unchanged, as the tests show.

**Earlier negative controls, before the migration: 16 of 16 caught, with every file restored and hash-checked.** One defect at a time. Three control definitions were first wrong and were corrected and rerun: B5 didn't change behaviour in metric, T1 didn't compile, and T2 read a consumed request body.

| Control | Defect | Fails on |
|---|---|---|
| U1 | Date of birth becomes optional | Still requires `birthDate` |
| U2 | A blank height clears | Refuses `heightCm = ""` |
| U3 | Schema supplies a default | T45: adds no value of its own |
| U4 | Serializer invents a value | Passes every null through |
| U5, U6 | Migration adds a default, or backfills | T44: rewrites no row, adds no default |
| U7 | Migration frees the date of birth | T44: exactly the seven approved columns |
| A1 | Under-minimum date no longer refused | `profile-minimization`, on real rows |
| A2 | Omitted date of birth no longer refused | `profile-minimization`, on real rows |
| B1, NC33 | Form sends a default | T45: only the four required fields are sent |
| B2 | Form always sends a stored number | Saving unchanged rewrites nothing |
| B3 | A clear sends nothing | A clear is an explicit null |
| B4 | Onboarding asks for a stored detail | Onboarding: Sex isn't asked for |
| B5 | A blanked number saves silently | A blanked number is an error |
| T1 | Omitted field overwritten | **On the temporary build:** omitted leaves a legacy value |
| T2 | Request body names the row | **On the temporary build:** B unchanged |

T1 and T2 showed those tests can fail, on the temporary route. D5 and D6 above repeat them on the real one.

### Phase 4.0.1b

**Results at `38c4a37`, on `fitdb_test` after the migration. Nothing ran on `fitdb`, and `fitdb_test_other` wasn't migrated.**

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
| T-01 | 4.0.1b | `nutrition-targets`, Part B and `migration-verify` | COMPLETE | P0 | None | Results above, at `38c4a37` |
| T-02 | 4.0.1b | Database-level negative controls | COMPLETE, except T-09 | P0 | None | D1 to D10 above |
| T-03 | 4.0.1b | Drift over the raw CHECK constraints | COMPLETE | P1 | None | Findings above. `migrate dev` not observed |
| T-04 | 4.0.1b | What old code does against a null row | COMPLETE | P2 | None | Findings above |
| T-05 | 4.0.1b | Full guarded suite | COMPLETE | P0 | None | Results above |
| T-06 | 3 | Real models, labels, meals, hostile inputs | BLOCKED | P1, if AI is wanted | Paid-test approval | Readiness items 2 to 4 |
| T-07 | 3 | Real phones and real PDFs | NOT STARTED | P0 | M-14 | Readiness items 6 and 7 |
| T-08 | 4.0.1 | `T3` exercises only the branch for the UTC hour it runs in, or both between 10:00 and 11:00 | DEFERRED | P3 | None | Accepted limit for now. NC3 was seen to catch one branch (`422 !== 200`), and the other hasn't been seen to fail. A control run at the right UTC hour would close this |
| T-11 | 4.0.1c | `profile-nulls`, Part B, `profile-migration-verify`, and the browser suites listed as BLOCKED earlier | COMPLETE | P0 | None | Results above, on `fitdb_test` |
| T-12 | 4.0.1c | Controls needing a null column: the route inventing a value on create, a clear ignored, and a page showing a null as a value | COMPLETE | P1 | None | D1 to D9 above. No control changes the schema |
| T-13 | 4.0.1c | Whether `migrate status` and `migrate diff` stay clean after this migration | COMPLETE | P2 | None | Both clean, after real null rows. `migrate dev` not observed |
| T-14 | 4.0.1c, 4.0.2 | **NOT RUN:** `safety-no-marker` and `db-guard-scoped`, as both connect to `fitdb_test_other`, which wasn't authorized. They last passed before the 4.0.1c migration | BLOCKED | P1 | Owner, to authorize that access | Both pass on the final code, or the owner accepts the gap |
| T-15 | 4.0.2, 4.0.4 | Download and deletion on a real iPhone and Android phone, and an emailed link keeping its `#token=` when opened from a mail app | NOT STARTED | P0 | M-14 | Recorded pass or fail per device, including a file save on iOS |
| T-16 | 4.0.3 | A real production start: preflight passing, against a database that isn't a test one | BLOCKED | P0 | R-07 | Observed once on the rehearsal server |
| T-17 | 4.0.3 | The design's forged-header test, TLS, HSTS, body limit and the database's closed port, through the deployed proxy | BLOCKED | P0 | R-07 | Each recorded |
| T-18 | 4.0.3 | A real page-render failure, showing the console guard works on what Next.js logs itself | NOT STARTED | P2 | None | Only unit-tested so far. Observed once |
| T-19 | 4.0.4 | `account-tokens`, for real races, lock order, backdated expiry, revocation and logs on a real database | COMPLETE | P0 | None | 32 of 32 on `e82cbd9`, on `fitdb_test`, section 2d |
| T-20 | 4.0.4 | Every suite that registers, moved to the real flow, and all three browsers | COMPLETE | P0 | None | All pass on `e82cbd9`, section 2d. The first real run found two script defects, both fixed. **Excludes T-14's two suites** |
| T-21 | 4.0.4 | **Not covered by those results:** `live-provider-check.safety`'s tests, moved to the new flow and never run, including its marker refusals. Its SIGTERM test is also skipped on Windows | BLOCKED | P1 | T-14 | Runs when T-14 is authorized |
| T-23 | 4.0.5 | `privacy-consent` and `privacy-e2e`, on `fitdb_test` and in three browsers | COMPLETE for `fitdb_test` | P1 | None | Passing on `feature/phase-4.0.5-privacy`, with 34 suites in all. **A real deployment's closed gate is unit-tested, and has never been seen on one** |
| T-09 | 4.0.1b | **Not run:** dropping a CHECK on a live database, to show T38 then fails. The owner's authorization allowed only the approved migration to change the schema | DEFERRED | P2 | Owner, if wanted | **Partly covered:** NC31a and NC31b catch a removed constraint in the migration's text, T38 shows the live constraints refuse every invalid shape, and D5 and D6 show they stop the app's own bad writes |
| T-10 | 4.0.1b, 4.0.1c | **Not run:** restoring either `fitdb_test` backup, from before 4.0.1b and 4.0.1c. Only their archive listings were read | NOT STARTED | P2 | Owner, for a restore target | Restored into a separately approved database, with row counts compared to the snapshots |

## 4. Migrations

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| MIG-01 | 4.0.1b | `20261106120000_nullable_nutrition_targets`, Git blob `62b7459`. **Applied to `fitdb_test` only,** on 2026-11-06, with owner authorization | COMPLETE for `fitdb_test` | P0 | None | `migration-verify` passed. **Not applied to `fitdb`, `fitdb_test_other` or any production database,** which each need separate approval |
| MIG-02 | 4.0.1c | `20261106130000_nullable_profile_fields`: `sex`, `heightCm`, `currentWeightKg`, `goal`, `activityLevel`, `experience`, `workoutDaysPerWeek`. **Applied to `fitdb_test` only,** on 2026-11-06, with owner authorization | COMPLETE for `fitdb_test` | P1 | None | `profile-migration-verify` passed. **Not applied to `fitdb`, `fitdb_test_other` or any production database,** which each need separate approval. **Rollback is forward-only,** as `fitdb_test` now holds null rows, Annex H6 |
| MIG-03 | 4.0.4 | `20261106140000_account_tokens`, blob `8c1e6ca`: `AccountToken` and its enum, and nullable `User.termsVersion` and `termsAcceptedAt`. Additive. **Applied to `fitdb_test` only,** on 2026-11-06, with owner authorization | COMPLETE for `fitdb_test` | P0 | None | Preflight, backup and verification passed, section 2d. **Not applied to `fitdb` or anywhere else. `fitdb` needs its own decision and backup, after B-07 and C-08** |

**Backup taken before applying:** `C:\Users\Aseel\FitWorkoutFoodTracker-backups\fitdb_test-pre-4.0.1b-20261106T060140Z.dump`, custom format, 859,762 bytes. `pg_dump` exited 0, and `pg_restore --list` read it. **It hasn't been restored,** so the restore itself is untested (T-10).

**Backup before MIG-03:** `C:\Users\Aseel\FitWorkoutFoodTracker-backups\fitdb_test-pre-4.0.4-20261106T192540Z.dump`, custom format, 11,711,870 bytes. `pg_dump` exited 0, and `pg_restore --list` read every table and `_prisma_migrations`. **It hasn't been restored,** T-10.

**Rollback:** forward-only, Annex H6. `fitdb_test` now holds real null rows from the suites.

## 5. Owner decisions and approvals

The merged documents hold **recommendations.** Stage A's authorization covered its own decisions, and doesn't approve the rest. The register's amendments aren't written yet.

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| D-01 | 4.0 | Record in `FEATURE_DECISIONS.md` what was approved, as dated additions, and the agent's Phase 4.0 results | NOT STARTED | P1 | Owner | Annex H8 rows 1 to 8 resolved |
| D-02 | 4.0 | Update `PRODUCT_STRATEGY.md`, including "can't complete sign-up", floors, and estimates still described as existing | NOT STARTED | P1 | Owner | Annex H8 rows 3 to 7 resolved |
| D-03 | 4.0.0 | Decisions 2, 3, 4, 5, 8, 10, 11, 12, 13, 14, 16, 17, 18. **8, 10 and 11 recorded on 2026-11-06,** and the rest are open | IN PROGRESS | P0 | Owner | Each recorded, with date. Design section 15 |
| D-04 | 4.0.1 | Decision 29's attempt limit: built as recommended, the agent would cut it | DEFERRED | P3 | Legal | Revisit with legal advice |
| D-05 | Strategy | Open product decisions 5, 6, 7, 9, 10, 11 | NOT STARTED | P2 | Owner | `PRODUCT_STRATEGY.md` section 12 |

## 6. Beta and production blockers

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| R-01 | 4.0 | Legal review (Decision 6) | BLOCKED | P0 | Reviewer, Decision 2 | Dated advice answers every question in Annex H7 |
| R-02 | 4.0 | Clinical and nutrition safety review (Decision 7) | BLOCKED | P0 | Reviewer | Written review at a stated commit, or a signed gap under Annex H2's conditions |
| R-03 | 4.0.6 | Low-target and underweight-goal safeguards (Decision 23). **800 kcal is still accepted with no warning** | BLOCKED | P0 | R-02 | Reviewed number and source, or a signed gap with the register amended. **No threshold is invented here** |
| R-04 | 4.0.2 | Self-service deletion, including from refusal and restricted screens | IN PROGRESS | P0 | T-15, S-14, E-06 | Merged at `b79331d`. A plain delete was observed to be refused by the foreign key, and the ordered deletion works. **Left before the beta:** real phones, and backup and log retention |
| R-05 | 4.0.2 | Self-service export | IN PROGRESS | P0 | T-15, E-06 | Merged at `b79331d`, with stopped rows and nulls as null, including cleared profile fields. **Left before the beta:** a real iPhone download, and the export policy decision |
| R-06 | 4.0.5 | Retention rule for refused and abandoned accounts. Their email and password hash persist until then | BLOCKED | P0 | R-01 | Rule stated in the notice, and applied |
| R-07 | 4.0.3 | Deployment, HTTPS, one instance, backups with a tested restore | IN PROGRESS | P0 | Decisions 4, 5, 12, 14 | **Templates only,** never run: `Dockerfile`, `deploy/`, and the two `PHASE_4_0_3` documents. **Left:** everything real, section 2c |
| R-08 | 4.0.3 | Read-only check that production starts empty. **Currently an untested assumption** | NOT STARTED | P0 | R-07 | Counts recorded, and 4.0.6's reset done. Otherwise return to Decisions 27 and 30 |
| R-09 | 4.0.3 | Closed registration, by allowlist | IN PROGRESS | P0 | S-16, R-07 | Built, and tested on a local production build. **Not on any deployed server.** Non-listed address refused, with the same answer as an existing account |
| R-10 | 4.0.4 | Password recovery, change password, email verification | IN PROGRESS | P0 | G-03, R-07 | Code merged at `eaeff34`, section 2d. **Nothing can be emailed yet** |
| R-11 | 4.0.5 | Privacy notice and terms. **A draft exists, unmerged, with marked gaps** | BLOCKED | P0 | R-01 | Matches the data-flow inventory, H-02 |
| R-12 | 4.0.6 | Help resource for eating concerns | BLOCKED | P0 | R-02 | Reviewed, and reachable |
| R-13 | 4.0.6 | Core flows on a real iPhone and Android phone | NOT STARTED | P0 | M-11 to M-13 | Each flow recorded pass or fail |
| R-14 | 3 | AI spending limit, model choice, cost, prompt injection. AI stays off until done | DEFERRED | P1, if AI is wanted | Decision on Track A | Readiness items 1 to 4 |
| R-15 | 3 | Readiness items 8 to 15: instances, proxy and TLS, memory on Linux, monitoring, security headers, Node pin, dependency findings, ESLint | IN PROGRESS | P0 for beta, except ESLint | M-11 | **Done locally:** security headers, Node pin. **Prepared, untested:** one instance, proxy and TLS, monitoring plan. **Open:** memory on Linux (S-13), monitoring in operation, 3 high `npm audit` findings needing a Prisma 7 decision (F-11), ESLint |

## 7. Known bugs and security risks

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| S-01 | 4.0 | `APP_ORIGIN` falls back to request headers, a hazard for reset links | IN PROGRESS | P0 | T-17 | A production server now refuses to start without an HTTPS `APP_ORIGIN`, tested. The fallback stays for development and the suites. Reviewed and merged at `de4607f`. Emailed links never use a request header, unit-tested and merged at `eaeff34`. **Left:** a test through a real proxy (T-17) |
| S-02 | 3 | Rate limits are in memory, per process, and reset on restart | DEFERRED | P1 | One instance at beta | Shared store before scaling |
| S-03 | 4.0 | Register's 409 and timing reveal whether an email exists | IN PROGRESS | P0 | M-12 | **Closed in production mode at `de4607f`:** one 403 and matching timing, tested. **Removed in code, merged at `eaeff34`:** every address gets the same 200, in every mode, with nothing looked up before the response. Verified on `fitdb_test`, T-19. **Left:** a deployed server |
| S-04 | 4.0 | Declared age can be false. Accepted, and never called verification | DEFERRED | P2 | R-01 | Legal confirms |
| S-05 | 4.0.1 | Legacy `SUGGESTED` rows stay in force, possibly with defective values, until replaced or stopped | DEFERRED | P1 | R-08 | Empty production database |
| S-06 | 4.0.1 | Legacy zeros can't be told from deliberate ones, and aren't rewritten | DEFERRED | P2 | R-08 | Empty production database |
| S-07 | 4.0 | `POST .../sets` has no idempotency key, so a lost response could log a set twice | NOT STARTED | P1 | M-14 | Decided in 4.0.6 |
| S-08 | 4.0 | Light-theme contrast defects, from the design's review | NOT STARTED | P2 | None | Contrast checked, and fixed |
| S-10 | 4.0.2, 4.0.3 | `db.ts` passed `log: ["error"]`, so Prisma printed its own error text in production, past `safe-log`. A RESTRICT violation printed the row's id and the constraint | IN PROGRESS | P1 | T-18 | **Code correction reviewed and merged at `de4607f`:** Prisma's log is off outside development, and a console guard covers what Next.js logs itself. Verified by unit tests and live on a local production build, controls U21 to U23, U26 and A8. **Left:** a real page-render failure, which wasn't triggered (T-18) |
| S-11 | 4.0.2 | **New.** After a deletion, upload, label-scan and food-search limiters keep the user id in memory until they expire, up to 24 hours. An id only, with no name or email | DEFERRED | P3 | None | Accepted, or cleared with them |
| S-12 | 4.0.2 | **New.** If another person's plan or session ever referred to someone's custom exercise, that person couldn't delete their account: they get 409, and nothing changes. The API refuses such references, so only direct database writes could make one | DEFERRED | P2 | None | Accepted, or a support path once one exists |
| S-13 | 4.0.2, 4.0.3 | An export is held in memory, up to 128 MiB, with 2 at once per process. 250,000 rows is judgement | IN PROGRESS | P2 | M-11, R-15 | **Measured locally:** 249,000 rows, 82 MiB, peak about 700 MB, on Windows. So two at once approach the 1.5 GB limit. **Left: measurement on the deployed Linux instance** |
| S-14 | 4.0.2, 4.0.3 | Deletion can't reach backups or logs. **A restore can bring deleted accounts back,** with their old password working. No written policy yet | BLOCKED | P0 | R-01, R-07, Decision 12, owner approval of F-05 | **A design only,** `PHASE_4_0_3_BACKUP_RECOVERY.md`: an HMAC ledger outside the database and its backups, written in two steps. **Not built, and not operational.** Needs storage, a key and a real restore test |
| S-15 | 4.0.2 | **New.** A deletion leaves no record, as anything kept would identify the person. So nothing can show that it happened | DEFERRED | P2 | R-01 | Legal says whether a record is needed |
| S-16 | 4.0.3 | **New.** Until 4.0.4's email proof, anyone who guesses an invited, unused address can claim it, with a password of their own | IN PROGRESS | P0 | M-12 | **Closed in code, merged at `eaeff34`,** as no account exists until the link is used, verified on `fitdb_test`. **Left:** a deployed server, and real delivery, G-03. Until then, a small list, added just before inviting and removed once used |
| S-17 | 4.0.3 | **New.** A restart resets in-memory password limits, and a database outage at startup causes a restart loop, so an outage could also reset them | DEFERRED | P2 | S-02 | A shared store, or accepted for the beta |
| S-18 | 4.0.3 | **New.** No CSP report endpoint exists, so a violation for a real person goes unseen. `next dev` isn't checked by the preflight, so it must never serve real traffic | DEFERRED | P3 | None | Decided at 4.0.6 |
| S-19 | 4.0.4 | Export didn't re-check the verified hash, as login, change password and deletion do | IN PROGRESS | P2 | Owner, to accept the limit | **Fixed at `3e65a51`:** compared in the snapshot and again after it, with no lock, so it can't delay a reset. A real race, in a known order, gets 409 with no data. **Accepted limit:** a response already past the last check is still sent, with data from before the reset |
| S-20 | 4.0.3, 4.0.4 | A loopback database named `fitdb_test` skips preflight's identity check, including with open registration. Needs a deliberate misconfiguration. Low. **Narrowed on `feature/phase-4.0.5-privacy`:** a test server now has to confirm its database's own marker, in any mode | DEFERRED | P3 | H-01 | A `host=` redirect is now refused, at `ae5e10e`. **Left:** the marker isn't required when the flag is set. Accepted, or required |
| S-21 | 4.0.4 | Prisma's transaction limit doesn't interrupt a query waiting on a lock, so a held row could hold login, reset and change password as long | IN PROGRESS | P2 | None | **Fixed at `ae5e10e` and `e82cbd9`:** a lock limit, answering 503. Measured in section 2d: about 4 seconds, or about 8 for a queued request. **Left:** pool exhaustion under a long schema change is unmeasured, and deletion's own wait isn't limited |
| S-22 | 4.0.4 | An abandoned sign-up token holds its address until it expires and the next token is issued, as no background job exists | BLOCKED | P2 | R-06 | Covered by the retention rule. **No period is invented here.** The review rates this medium before the beta, and notes that purging already-expired rows on a timer needs no new period. Not built, as it adds a background job |
| S-23 | 4.0.4 | Throttles are in memory. At 50,000 keys, eviction can remove a `reauth:` key, and a restart clears all of them, which resets that guess limit. Low | NOT STARTED | P3 | None | Reauth keys kept apart, or accepted |
| S-24 | 4.0.4 | Development mail files hold live tokens, and are never aged out. `0o600` may not restrict them on Windows. Suites now remove theirs. Low, development only | NOT STARTED | P3 | None | Aged out, or accepted |
| S-25 | 4.0.4 | The password-changed notice isn't retried, and is lost on a restart. A full queue no longer drops it. A stalled request can also finish deletion or export after its session ends, if it has the current password, which gives nothing beyond logging in. Low | DEFERRED | P3 | None | Accepted, or fixed with a real provider, G-03 |
| S-26 | 4.0.5 | `next dev` with a local `fitdb`, on a machine others can reach, still opens registration under a draft, as `next dev` skips startup checks. Its mail stays in a local file, so nobody can finish signing up. Low | DEFERRED | P3 | None | Accepted, or a host check added |
| S-27 | 4.0.5 | The box is enforced in the browser. A script can post the public version with no box, so a stored version shows only that the token holder posted it. By design, and legal says what a tick means (O6) | DEFERRED | P2 | R-01 | Legal's answer recorded |
| S-09 | 4.0.1 | Raw field names reach people in forms other than profile and targets (`client/api.ts`) | DEFERRED | P2 | None | Fixed copy per form |

## 8. Technical debt

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| TD-01 | 4.0.1 | `calorieTargetOverride` column unused. Its stale comment is corrected | DEFERRED | P3 | MIG-02 | Column dropped with approval |
| TD-02 | 4.0.1 | `Segmented` keeps button-based radios, and section 11's native radios weren't built, as Annex D allowed | DEFERRED | P3 | None | Separate accessibility change, with a keyboard test |
| TD-03 | 4.0.1 | Sex, activity, goal, experience and days were asked for with nothing reading them | COMPLETE for development | P1 | None | Stopped at `899e54c`, and T45 passes. The stored columns remain, TD-10 |
| TD-04 | 4.0.1b | Raw CHECK constraints are invisible in `schema.prisma`, and only commented there | DEFERRED | P3 | T-03 | Drift behaviour recorded |
| TD-05 | 4.0.1b | The stop's date can overwrite a future row, only after a move to an earlier time zone. Accepted, as the alternative undoes the stop | DEFERRED | P3 | None | Revisit if real use shows a problem |
| TD-06 | Docs | `README.md`, `ARCHITECTURE.md` and the Phase 3.6 status line carry stale statements | NOT STARTED | P2 | None | Design section 15's list done |
| TD-07 | Docs | `PHASE_4_0_0A_TEST_TARGET_GUARD.md` still says "not merged" | NOT STARTED | P3 | None | Status corrected |
| TD-09 | 4.0.1c | `goalWeightKg` has no reader, but stays an optional field on the profile page, as it isn't among Annex H4's seven. It's gone from onboarding | DEFERRED | P2 | Owner, R-03 | Decide with underweight-goal safeguards and 4.1's goal card |
| TD-10 | 4.0.1c | Unread columns stay in the database. Dropping them and their stored values wasn't proposed | DEFERRED | P3 | Owner | Revisit with retention, R-06 |
| TD-11 | 4.0.1c | Every profile save overwrites the stored time zone with the browser's. Existing behaviour, not changed here | DEFERRED | P3 | None | Decide whether it should only follow a choice |
| TD-12 | 4.0.1c | A cleared detail can't be entered again from the app, as nothing asks for unset ones (Annex H4) | DEFERRED | P3 | M-15 | 4.1 adds what it reads, including a state for no goal |
| TD-14 | 4.0.2 | `account-data` leaves one shared food row in `fitdb_test` per run, as shared rows must outlive the deletions it tests | DEFERRED | P3 | None | Test database only |
| TD-15 | 4.0.3 | Every page now renders per request, as the nonce must be fresh, so pages that were static no longer are. Effect on the server unmeasured | DEFERRED | P3 | R-15 | Measured with S-13 |
| TD-16 | 4.0.3 | No `__Host-` cookie prefix, as the suites run over plain HTTP | DEFERRED | P3 | None | Considered with 4.0.4's auth work |
| TD-13 | Docs | `ARCHITECTURE.md`'s Profile summary doesn't say these fields are nullable | NOT STARTED | P3 | Merge of 4.0.1c | Updated |
| TD-08 | Tests | `npm run test:e2e` and `test:api` cover only some suites. `test:suites` is the complete run | DEFERRED | P3 | None | Named clearly in the README |

## 8a. Development tooling

Not a product feature, and it changes nothing in the application.

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| TOOL-01 | Tooling | Model router: the `intelligent-model-router` skill and four specialist agents | IN PROGRESS | P3 | The live checks below | **Independently source-reviewed and merged at `3bc4471`.** An earlier review conditionally approved `665cb10`, and its fallback defect is fixed: a model moved up now takes that tier's agent. Tests pass, and 25 deliberate defects were caught. All four agents parse with PyYAML, and a fresh session listed them. **Live:** `quick-task-agent` launched on `claude-haiku-5-5` under an Opus parent, and its guard refused `.env.router-smoke` with "Blocked by the model router". **Not observed live:** the other three agents, the Bash rules and read-only profile, a real hook failure, an untrusted folder, or non-Windows. **It can't change the main session's model, and doesn't enforce that routing happens.** Its guard is defence in depth, and not a sandbox. Not COMPLETE until those live checks are seen in real use |
| TOOL-03 | Tooling | Parallel Agent Orchestration: the `parallel-task-orchestrator` skill, using native subagents, with at most 3 at once | IN PROGRESS | P3 | TOOL-01, the live checks below | **Independently source-reviewed and merged at `3bc4471`.** **Native capabilities:** checked against the docs and 2.1.319. Agent teams aren't used, as they're experimental. **Concurrency:** 3 workers ran at once, live. **Models:** Haiku, Sonnet and Opus confirmed from transcripts. **Reporting:** results reach the main session at completion, and **no live progress is available to it.** **Cleanup:** finished workers need no stop, `TaskStop` worked, and an unchanged worktree was removed. **Permissions:** guard refusals seen live, and none changed. **Not observed live:** a crash, an interrupted parent, a changed worktree, a real multi-file change, or a guard refusal in a worktree. **Platform limits:** Windows and a trusted folder only. Worktrees start from the default branch, so they're blocked on a feature branch unless the owner sets `worktree.baseRef`. File ownership isn't enforced while a worker runs |
| TOOL-04 | Tooling | Agent Efficiency Optimization: task sizing, duplicate and stale-result checks, bounded retries, conflict accounting and measurements, in the orchestrator | IN PROGRESS | P3 | TOOL-03, use on real work | **Independently source-reviewed and merged at `3bc4471`.** Tests and deliberate defects pass, **all mocked or simulated, as no new live run was made, to avoid its cost.** **Measured from earlier transcripts:** about 15,000 tokens per worker, nearly all fixed load, so not launching is the main saving, and shorter prompts save under 1 % by estimate. **No overall saving is claimed.** `reconcile` relies on workers' own reports, as ownership isn't enforced during a run. Reuse relies on declared inputs, so an undeclared dependency could go unnoticed. **Corrected at `07a2e26`:** `reconcile` now judges ownership apart from timing, so an unauthorized edit can't come out clean, whatever its timing, and a worker with no report stops a clean result. Checked by every combination of a small model and 10 deliberate defects, on mocks. **It still works from workers' own reports, so it can't prove who wrote a file** |
| TOOL-02 | Tooling | Project permission rules and the sandbox, as stronger protection than the guard | NOT STARTED | P2 | Owner decision | Proposed rules and their consequences are in the skill's README, and aren't applied, as they also affect the main session. Protected databases need credential separation, as no rule can see them |

**Tooling is frozen, by the owner's instruction of 2026-11-06.** No new agents, routing or orchestration features, or benchmarks without a real need. **Further tooling changes need an actual application-development blocker.** TOOL-02 stays NOT STARTED. TOOL-01, TOOL-03 and TOOL-04 are reviewed and merged, and stay IN PROGRESS, as their live verification is outstanding, with their limits above unchanged. That verification comes from real use, with no benchmark run for it. None of it blocks Phase 4.

## 9. Items outside this tracker

`docs/BUNNY_AGENT_DESIGN.md` is an untracked file belonging to the owner. It hasn't been read or evaluated, and it isn't counted here as planned work.
