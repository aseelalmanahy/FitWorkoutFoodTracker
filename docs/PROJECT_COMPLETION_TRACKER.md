# Project Completion Tracker

**The single source of truth for what's done and what isn't.** Last updated 2026-11-07, on `integration/phase-4`, after Phases 4.0.5, 4.1 and 4.0.6 were integrated there for development. **`main` is unchanged at `5434f90`. No production infrastructure has been deployed.** The handoff for the next session is in `SESSION_HANDOFF.md`, on `feature/demo-account`. **The release-completion register, with every approval still needed, is section 2j, on `feature/release-completion`.**

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
| M-13 | 4.0.5 | Notice, acceptance, retention | **IN PROGRESS** | L1 to L5 built on `feature/phase-4.0.5-privacy`, unmerged, section 2e. **Not COMPLETE:** the notice is a draft with no legal review, no retention rule exists, and a draft keeps real registration closed **Integrated on `integration/phase-4` for development only, section 2h. Not on `main`.** |
| M-15 | 4.1 | Core progress: weight log, goal card | **IN PROGRESS** | Code on `feature/phase-4.1-progress`, unmerged, section 2f. MIG-04 is applied to `fitdb_test` only, and focused database and browser tests pass there. **Not COMPLETE:** not merged, not in a full regression, independent review pending **Integrated on `integration/phase-4` for development only, section 2h. Not on `main`.** |
| M-14 | 4.0.6 | Device testing and beta go/no-go | **IN PROGRESS** | Local readiness only, on `feature/phase-4.0.6-readiness`, unmerged, section 2g. **Real devices, a deployed server, the checklist and the go/no-go have not started** **Integrated on `integration/phase-4` for development only, section 2h. Not on `main`.** |
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
| F-11 | 4.0.3 | 3 high `npm audit` findings, in `deepmerge-ts` through Prisma. `npm audit` offered only a breaking move to Prisma 7 | **RESOLVED at `55a686a`** without Prisma 7: an npm override to `deepmerge-ts` 8.0.2 under `@prisma/config`, the CLI config loader that was its only path; `npm audit` 0 vulnerabilities; see 2j | P1 | None | Upgraded, or accepted in writing. **The owner kept Prisma 6 for 4.0.4's development verification, which doesn't accept this for production.** Stays open for a separate reviewed upgrade before release, after 4.0.4's suites, which have now passed, and before F-07 and any real user. `PHASE_4_0_4_EMAIL_ACCESS.md` |

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
| **REVIEWED** | **Partly.** A read-only security agent reviewed the plan, the code and the fixes, and ran nothing. A last one read `e6fbc21` and `c8bf808`: nothing opens registration for a real person under a draft, and its cleanup findings are fixed in the next two commits, which no agent has re-read. **Independent source review is pending** |
## 2f. Phase 4.1 detail

**Migration: `20261106150000_body_metrics`, prepared and applied nowhere.** Choices and limits: `PHASE_4_1_PROGRESS.md`.

| State | Phase 4.1 |
|---|---|
| **IMPLEMENTED** | Yes, unmerged: dated weight entries, a smoothed trend, change over time, a chart, entries with paging, a goal card, and the goal selectable on the profile |
| **TESTED** | **Focused tests, on `fitdb_test`,** with MIG-04 applied. `weight-progress` 22 of 22, `weight-e2e` in three browsers, the suites it affects, and 25 real-server deliberate defects. **No full regression, and nothing on combined code.** One unexplained failure, T-27 |
| **REVIEWED** | **Partly.** A read-only security agent read `a56110e`, and its findings are addressed in the next commit, which no agent has re-read. **Independent source review is pending** |
| **MERGED** | No |
| **OPERATIONALLY VERIFIED** | No |

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| H-01 | 4.0.5 | L1 to L5 | IN PROGRESS | P0 | Source review, merge approval | Reviewed and merged. Whether it may merge before legal advice is still the owner's decision, plan section 2 **Integrated for development, under the owner's exception, which doesn't waive legal review for `main`, deployment or real users.** |
| H-02 | 4.0.5 | Final notice and terms | BLOCKED | P0 | R-01, Decisions 2, 3, 4, 5, 6, 7, 12, 14, 16 | A reviewed version passes `noticeIsFinal()`, and is checked against a deployment. **Until then, real registration stays closed** |
| H-03 | 4.0.5 | Retention deletion. Not built, by O4 and the plan's section 6 | BLOCKED | P0 | R-06, product review, S-14's ledger | Its own design and approval |
| H-05 | 4.0.5 | `e2e-privacy` left a usable sign-up token and an account behind on any failure. **Fixed:** cleanup runs on success, failure, a hang, a stuck browser and a row arriving late, by exact address, and a failed cleanup fails the run. `privacy-cleanup` forces each one on a real server, beside look-alike rows. **Limits:** a forced kill can't be caught, and Ctrl-C's path isn't tested, as Windows can't send the signal to a test | COMPLETE for `fitdb_test` | P1 | None | 8 of 8, with 16 of 16 deliberate defects caught by assertion |
| H-04 | 4.0.5 | Reacceptance when a version changes, and whether a history must be kept, which would need a migration | BLOCKED | P1 | R-01 (O3) | Legal's answer, then its own approval |
| J-01 | 4.1 | Weight log and goal card | IN PROGRESS | P1 | Review, merge approval, K-02's regression | All suites pass on the final code, and the owner approves. **Focused tests pass on `fitdb_test`** **Integrated for development, section 2h. Not on `main`.** |
| J-02 | 4.1 | Back up `fitdb_test`, and apply MIG-04 to it, by `docs/MIG_04_RUNBOOK.md`. **Before it's applied to a database, this code breaks the dashboard, account deletion and export there, for everyone.** Any deployment has to apply it first | COMPLETE for `fitdb_test` | P1 | None | Applied on 2026-11-07 UTC with the owner's written authorization. Preflight, backup, apply and verify all passed, with no safeguard stopping it, and `migrate status` clean. **`fitdb_test` only** |
| J-07 | 4.1 | A malformed id with a null byte, such as `/%00`, answers 500 on `/api/sessions`, `/api/exercises`, `/api/foods` and `/api/templates`, as it reaches the database as an error. Probed on 2026-11-07, older than 4.1, and it returns nothing but a generic error. **Fixed for `/api/weight` only,** which now answers 404. Low | NOT STARTED | P3 | Owner | Answered as not found app-wide, or accepted |
| J-03 | 4.1 | Merging after 4.0.5: classify `BodyMetric` in the data inventory, and add the weight log to the draft notice | COMPLETE for `integration/phase-4` | P1 | H-01 | 4.0.5's inventory tests pass on the merged code **Done on `integration/phase-4`, in the merge. The wording and category are drafts for legal review.** |
| J-04 | 4.1 | Whether a goal must be chosen (Decision 21). Built as optional | NOT STARTED | P2 | Owner | Recorded |
| J-05 | 4.1 | Confirm the 10-day smoothing constant, 28-day change window and 7-day minimum, which are judgements | NOT STARTED | P2 | Owner | Confirmed or changed **Open. A threshold of three weigh-ins has been proposed for showing a numerical change. It isn't built: today it takes two entries spanning 7 days. Awaiting the owner.** |
| J-06 | 4.1 | Open decision 8: how the log relates to `currentWeightKg`. Built as separate, as the execution plan recommends. The strategy recommends the latest entry becoming current weight | NOT STARTED | P1 | Owner | Recorded |
## 2g. Phase 4.0.6 detail

**Local readiness only. Results by area, and what can't be verified here: `PHASE_4_0_6_READINESS.md`.** No migration. It doesn't contain 4.0.5 or 4.1, so it can't verify privacy, consent, weight or goals.

| State | Phase 4.0.6, local part |
|---|---|
| **IMPLEMENTED** | Yes, unmerged: unknown nutrition stays null, a partial total isn't called a miss, logging a set is safe to retry, finished workouts take no new set, `/previous` answers 404 |
| **TESTED** | **Yes, on `fitdb_test`.** 35 of 35 suites at `d363e4c`, deliberate defects 41 of 41, then focused suites and 23 of 23 deliberate defects for the locking at `09f0aa4`. **No full regression has run at `09f0aa4`,** by the phase-level approach: one final regression on the combined code. **One unexplained failure in an earlier run, T-25. `safety-no-marker` and `db-guard-scoped` weren't run, T-14** |
| **REVIEWED** | **Partly.** A read-only security agent read `5763413`, and its findings are addressed in `d363e4c`. Another read the locking at `846c8c7`, and its findings are addressed in `09f0aa4` or recorded as K-04. No agent has re-read those. **Independent source review is pending** |
| **MERGED** | No |
| **OPERATIONALLY VERIFIED** | **No. Nothing here ran on a real device or a deployed server** |

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| K-01 | 4.0.6 | Local readiness fixes and document | IN PROGRESS | P1 | Review, merge approval | Full regression passes on the code that merges, and the owner approves **Integrated for development, section 2h. Not on `main`.** |
| K-02 | 4.0.6 | Repeat the regression once 4.0.5 and 4.1 are merged, and verify privacy, consent, weight and goals there | COMPLETE for `integration/phase-4` | P0 | H-01, J-01, K-01 | All suites pass on the merged code **Done on `integration/phase-4` at `1e9bcb6`, section 2h, not on `main`.** |
| K-04 | 4.0.6 | **Whether a finished workout can still change. Needs a decision, as it changes what the product does.** Its owner can still edit or delete its sets, delete an exercise with its sets, and add an empty exercise, for example from a stale tab, though the history page offers none of it. That alters personal records and "previous" figures, and deleting the last set leaves a finished workout with none. A delete committing just after a finish counts its sets can do the same. Found in review, and older than 4.0.6. **No new set can be added** | NOT STARTED | P2 | Owner | Decided: refused under the same lock, or kept as a way to correct records. **The owner's provisional direction is immutable in ordinary editing. Nothing is built, and the proposal is in `PHASE_4_INTEGRATION_PLAN.md`** **Still open, and nothing is built.** |
| K-05 | 4.0.6 | Integration order and every required change: `PHASE_4_INTEGRATION_PLAN.md`. Tried in a throwaway clone at the latest commits, with no database. Nothing merged. **No database or browser test has run on the combined code** | COMPLETE for `integration/phase-4` | P1 | H-01, J-01, K-01, owner approvals | All three merged by that plan, with one final regression on the combined code **Done on `integration/phase-4`, section 2h.** |
| K-06 | 4.0.6 | Two deadlocks found by reading, both older than this work, involving one person only, and ended by the database rolling one side back: finishing against moving an exercise, with two empty exercises, and deleting an account against deleting a template. Low, and not observed. The other side gets an error and can retry | NOT STARTED | P3 | None | Fixed, or accepted by the owner |
| K-03 | 4.0.6 | About 5,700 users on `fitdb_test`, nearly all leftovers from suite runs, and each regression adds about 180. `account-data` also leaves 7 `BodyMetric` rows on its own test users per run, 21 so far, and none on QA accounts. Harmless so far, and not removed | NOT STARTED | P3 | Owner | Left as is, or removed with authorization, keeping the 10 QA accounts |

## 2h. Phase 4 integration

**`integration/phase-4`, development only, under the owner's written exception. It doesn't waive legal review for `main`, deployment or real-user registration. `main` is unchanged at `5434f90`. Nothing is deployed.** How the merges were done is in `PHASE_4_INTEGRATION_PLAN.md`.

| State | Integrated Phase 4 |
|---|---|
| **IMPLEMENTED** | Yes: 4.0.5 at `7d615b0`, 4.1 at `2193add`, 4.0.6 at `d80c618`, merged in that order, with corrections up to `f7c9c1f` |
| **TESTED** | **Yes, on `fitdb_test`.** At `1e9bcb6`: 41 of 41 guarded suites, 1,789 of 1,789 unit tests, type check and build clean. At `f7c9c1f`: the affected suites, and 246 of 246 deliberate defects by assertion. **Six suites didn't run,** below |
| **REVIEWED** | **Yes, for the development checkpoint.** ChatGPT's independent source review of `519bb38`, including `f7c9c1f`, is complete, as reported by the owner on 2026-11-07. A read-only security agent also read `1e9bcb6`, and found no high-severity defect or damage from conflict resolution. **This isn't approval to merge into `main`** |
| **MERGED** | **Not to `main`** |
| **OPERATIONALLY VERIFIED** | **No.** One Windows machine, a local production build, and `fitdb_test` |

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| I-01 | Integration | The three branches on `integration/phase-4` | IN PROGRESS | P0 | The owner's approvals in `PHASE_4_MERGE_READINESS.md`, starting with legal review or a written exception | On `main`, once approved. **Engineering integration is approved for the development checkpoint. Merging into `main` isn't approved.** MIG-04 is on `fitdb_test` only |
| I-02 | Integration | The final regression, once, on the integrated code | COMPLETE for `integration/phase-4` | P0 | None | 41 of 41 at `1e9bcb6`, with the QA fixtures unchanged. `f7c9c1f` changes the logger's Finish, one browser test and one runner entry, so `readiness-e2e`, `workout-sets`, `e2e-smoke`, `account-facts` and `guard` were rerun, with the unit tests, type check and build, and all pass. **The whole regression wasn't repeated, as that change doesn't invalidate the rest** |
| I-03 | Integration | Suites not run in that regression. `safety-no-marker` and `db-guard-scoped` connect to `fitdb_test_other`, which isn't authorized (T-14). The four on-demand migration suites bracket applying earlier migrations, already applied | BLOCKED | P1 | Owner, for T-14 | T-14's two run, or the owner accepts their absence |
| K-07 | 4.0.6 | Theoretical, Low. After a lost response, the logger decides a set saved by comparing counts. If another tab added a set meanwhile, a lost one could read as saved. Found in review | NOT STARTED | P3 | None | Looks for the set by its id, or the owner accepts it |
| K-08 | 4.0.6 | Theoretical, Low. The limit of 8 waiting per person is per process, and no connection pool size is set, so a small server's default pool could be smaller than 8. It would matter only if a lock holder were stuck. Found in review | NOT STARTED | P2 | Deployment | Pool size set on deployment, with the limit below it |
| J-08 | 4.1 | Operational. Nothing at startup detects a missing MIG-04, so the merged code on a database without it fails on the dashboard, export and deletion. **This includes `fitdb`, where MIG-04 isn't applied** | NOT STARTED | P1 | Owner, for each database | Applied before the code on any database, or checked at startup |

**The regression at `1e9bcb6`, in order:** `guard` 51, `mig-04-refusals` 103, `guard-browser` 21, `units` 19, `live-identity` 9, `nutrition-api` 78, `release-workflow` 8, `provider-protection` 7, `provider-malformed` 4, `provider-config` 1, `e2e-smoke`, `e2e-nutrition`, `eligibility`, `nutrition-targets` 8, `nutrition-targets-e2e`, `profile-minimization` 7, `profile-nulls` 16, `profile-minimization-e2e`, `account-data` 26, `account-tokens` 32, `privacy-consent` 9, `privacy-e2e`, `privacy-cleanup` 8, `weight-progress` 22, `weight-e2e`, `workout-sets` 25, `readiness-performance` 1, `readiness-e2e`, `account-data-e2e`, `production-startup` 19, `production-security` 14, `production-https` 3, `production-security-e2e`, `label-scan`, `label-pdf`, `meal`, `hardening`, three unconfigured checks, and `usda-missing-nutrients` 4. No timeout, crash or skip. Lowest available memory 7.7 GB.

**Browsers:** Chromium, Firefox and WebKit ran each of `guard-browser`, `eligibility`, `nutrition-targets-e2e`, `profile-minimization-e2e`, `privacy-e2e`, `weight-e2e`, `readiness-e2e`, `account-data-e2e`, `production-security-e2e`, `label-scan`, `label-pdf`, `meal` and `hardening`, with equal step counts. **`e2e-smoke`, `e2e-nutrition` and `privacy-cleanup` run in Chromium only.**

**Deliberate defects at `f7c9c1f`, 246 of 246 by assertion:** 4.0.5 unit 44, cleanup 16, real server 4. 4.1 unit 40, real server 25. 4.0.6 unit 24, real browser 17. Locking unit 12, real server 11. MIG-04's checks 45, and its Windows procedure 8. Each real-server one was rebuilt, with a clean build after.

**Database:** only `fitdb_test`, checked by name, schema, loopback address and marker before and after. 8 migrations, MIG-04 last with the reviewed checksum, `migrate status` up to date, and no drift from the integrated schema. **The 10 QA fixtures, with their profiles, workouts, sets, foods, targets, exercises, plans and schedules, hash identically before and after the regression and the deliberate defects,** and hold no `BodyMetric` rows. **No migration, reset or broad cleanup ran.**

## 2i. Demo account and owner acceptance

**On `feature/demo-account`, from `integration/phase-4`. Local only, on `fitdb_test` only, as the owner authorized. The password is only in the Git-ignored `demo-account.local.md`.**

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| U-01 | Workflow | Every phase ends with a UI demonstration and owner acceptance. In `DEVELOPMENT_WORKFLOW.md` and `CLAUDE.md` | IN PROGRESS | P1 | Merge approval | On `main`, and followed by each phase |
| U-02 | Workflow | The permanent demo account, `scripts/demo-account.cjs`, with four plans, a schedule, workout history, nutrition, weight history and a goal. Populating is idempotent, adds only its own rows, and keeps the same password | COMPLETE for `fitdb_test` | P1 | None | `demo-account` and the browser check pass. **Only on `fitdb_test`. It isn't a real or production account** |
| U-03 | Workflow | `scripts/demo-server.cjs` and `MANUAL_UI_TESTING_GUIDE.md`. Registration stays closed, AI is off, providers are the local stub, and mail stays in a temporary folder | COMPLETE for `fitdb_test` | P1 | None | Verified as running on `fitdb_test`, in Chromium, Firefox and WebKit |
| U-04 | Phase 4 | **The owner's UI acceptance of Phase 4** | NOT STARTED | P0 | The owner | **The owner has tried it and said it's accepted.** Implementation complete, automated tests passed, and UI demonstration ready. **OWNER ACCEPTANCE PENDING** |

**Owner UI feedback, 2026-11-07, for product review first.** The owner named four topics. Their details aren't recorded yet, and none are guessed. The next task is review and investigation only, as `SESSION_HANDOFF.md` section 7 sets out.

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| UF-01 | Feedback | Food search: "large egg" not found, filters confusing. **Cause:** custom-food search ignored serving labels ("Whole egg (demo)" is served "1 large"), the stand-in has no egg, and the filters gave no feedback before typing or when empty | IN PROGRESS | P1 | UX-01 A | Fixed on `feature/ux-reliability-redesign`, owner acceptance pending |
| UF-02 | Feedback | Desktop too narrow, every page in a 576 px column | IN PROGRESS | P2 | UX-01 B | Built on `feature/ux-reliability-redesign`, owner acceptance pending |
| UF-03 | Feedback | Colours too bright. The owner chose Slate & Mist | IN PROGRESS | P2 | UX-01 C | Built, with contrast measured, owner acceptance pending |
| UF-04 | Feedback | Proposed health-tracking features. `product-strategy-agent` reviewed them on 2026-11-07, and its records are recommendations only | IN PROGRESS | P2 | The owner | See "Product backlog from the owner's vision" below. Nothing built |

**UX-01, approved by the owner on 2026-11-07.** On `feature/ux-reliability-redesign`, from `feature/demo-account` at `aaeaade`, in a separate worktree. **Separate from Phase 4's release and merge approvals, and not merged anywhere.** The approved scope: food-search reliability, responsive layouts, the Slate & Mist redesign, the login and welcome screen, better exercise and workout notes, focused tests and a UI demonstration. **No schema change, migration or new dependency.**

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| UX-01A | UX-01 | Food search: serving labels count in custom-food search; filters renamed (All sources, USDA foods, Packaged foods, My foods) and explained; only the chosen filter's sources requested (My foods always included, as it calls no provider), with an all-sources answer reused when narrowed; empty, unavailable, partly unavailable and failed searches told apart, with "Show all sources"; stale or pending results never shown or selectable; the local stand-in disclosed as test data | IN PROGRESS | P1 | Owner acceptance | `7257572`, then `cecf609` after ChatGPT's review of `65f1a45`: the filter now limits provider calls. Unit tests count the provider calls per filter, with 10 deliberate defects caught in all. **`e2e-nutrition` and `nutrition-api` additions not run,** as they write to `fitdb_test` |
| UX-01B | UX-01 | Responsive shell: side bar from 1024 px with content up to 1200 px, tablet column with bottom bar, phones unchanged. Per-page widths and desktop grids for the dashboard, workouts, nutrition, history, progress and weight | IN PROGRESS | P2 | Owner acceptance | `27797e5`. Type check and build clean. Signed-in screens not yet viewed, see UX-01T |
| UX-01C | UX-01 | Slate & Mist tokens, light and dark, every pair measured. Charts with legends and muted series. **Closes the chart part of S-08** | IN PROGRESS | P2 | Owner acceptance | `a524b44` |
| UX-01D | UX-01 | Welcome screen around the unchanged login form: split screen on desktop, compact header on phones | IN PROGRESS | P2 | Owner acceptance | `14b5072`, `9c88a66`. Seen at 1440, 820 and 390 px in both themes, with no horizontal scroll and no console errors |
| UX-01E | UX-01 | Exercise notes made prominent; the existing session notes exposed in the logger as "Workout notes"; both labelled in history, which stays read-only (K-04) | IN PROGRESS | P2 | Owner acceptance | `0f79e8c`, then `ab52a06` after review: five note-saving defects confirmed by reading (newer text dropped during a slow save, Finish not waiting, racing saves, a late save after Finish, no warning on leaving) and fixed with one saver per note, one request at a time, flushed before Finish. 9 saver tests, the old behaviour caught. **`e2e-smoke` additions not run,** as it writes to `fitdb_test` |
| UX-01T | UX-01 | The guarded suites that write to `fitdb_test`, scoped to UX-01: `e2e-smoke`, `e2e-nutrition`, `nutrition-api`, `hardening`, `eligibility`, `weight-e2e`, `release-workflow`, `provider-protection`, `provider-malformed`, `provider-config`; then `demo-account-e2e` and a signed-in visual pass. Each suite's effects were inspected first, and are in the authorization request of 2026-11-07 | BLOCKED | P1 | The owner's authorization to write to `fitdb_test` | Each run passes, the 10 QA fixtures and the demo account unchanged by a read-only status before and after |
| UX-01V | UX-01 | Contrast of the shipped tokens, read from `globals.css`, in light and dark | COMPLETE | P2 | None | `ab52a06`: 61 checks pass, and 2 deliberate regressions are caught |
| UX-01Q | UX-01 | Signed-in visual QA on the demo account, read-only (one login-session row per run, every other write blocked in the browser), at 390, 820, 1440 and 1920 px in light and dark | IN PROGRESS | P1 | Owner acceptance | At `4d1dae0`: 96 captures, no console errors; 3 FAILs at 390 px (Workouts 746 px wide, Progress 447 px, food search 414 to 425 px after typing). **Fixed at `88d45e6`** and re-verified: no overflow on any page at any size or theme, layouts at 820 px and up unchanged. Not verified: the workout session page and editing notes or adding food in a browser, as they write |
| UX-01R | UX-01 | **The review environment**, authorized 2026-11-07: `fitdb_review` (created, 8 migrations by `migrate deploy`, built-in exercises seeded, review marker), served by `scripts/review-server.cjs` on 127.0.0.1:3002 from the folder `FitWorkoutFoodTracker-review`, with live USDA and Open Food Facts. The owner's account `owner@review.local` has no profile or history. Two labelled tester accounts hold test data only | IN PROGRESS | P1 | Owner acceptance | 25 of 26 real browser workflow steps passed first time; the 26th, isolation, passed once tester 2 had a profile (another account gets 404 on tester data). Data survives a restart, and there are 96 page captures at four widths with no overflow or console error. Live searches return results from both providers for all eight foods asked for. **Limits:** Open Food Facts 4 searches a minute per person; no email; paid AI off; a shorter local database password, warned at start |
| UX-01I | UX-01 | `fitdb_test_isolated`, created and migrated the same way, with its own test marker, for the guarded suites; never `fitdb_test` | IN PROGRESS | P1 | None | The full guarded run on it, with `responsive` added; the two suites needing `fitdb_test_other` are refused there |
| UX-01U | UX-01 | **The owner's UI acceptance of UX-01** | NOT STARTED | P1 | UX-01T | The owner has tried it and said it's accepted. **OWNER ACCEPTANCE PENDING** |

**Product backlog from the owner's vision, 2026-11-07. Not approved for implementation, and not dropped.** Each needs its own product review, the owner's approval and, where noted, a migration approval.

| Item | Next stage | The `product-strategy-agent`'s recommendation, not approved |
|---|---|---|
| Recovery: daily sleep hours, sleep quality, energy 1 to 5, optional notes, history | After UX-01 acceptance | One optional daily check-in, starting with sleep hours and energy. No recovery or readiness score, and no medical claims. Probably new `BodyMetric` kinds, which is a migration |
| Workout effort rating | With recovery | One session-level rating, distinct from daily energy. `SetEntry.rpe` exists with no UI, and stays unused |
| Movement: running, cycling, walking, yoga, pilates, hiking, other | After recovery | A separate activity table: type, duration, optional distance, note. Pace derived, never stored. Strength analytics unchanged. A migration |
| Progress photographs, private by default | Later | Postponed: the first stored images, needing storage, encryption, export, deletion including backups |
| GPS routes for running and cycling | Future decision | Rejected for the web app as planned: precise location, device limits, map costs |
| Followers, sharing progress photos | Future decision | Rejected: conflicts with "not a social network". Needs separate privacy and security review if reopened |
| Device-adaptive scanning (camera on phones, upload on desktop) | With Track A | Postponed with paid AI |
| A nutrition card on the dashboard | Not scheduled | A small addition to the existing dashboard |

## 2j. Release completion: the master register

**On `feature/release-completion`, from `feature/ux-reliability-redesign` at `7daf826`. Not merged anywhere, nothing deployed, no paid service, no schema change, no migration.** The candidate runs on 127.0.0.1:3003 from the folder `FitWorkoutFoodTracker-release`, beside the unchanged stable build on 3002, both on `fitdb_review`. Statuses are the owner's for this register: NOT STARTED, IN PROGRESS, IMPLEMENTED — UNVERIFIED, VERIFIED — FUNCTIONAL, BLOCKED — OWNER AUTHORIZATION, BLOCKED — EXTERNAL DEPENDENCY, OWNER ACCEPTED. **Nothing here is OWNER ACCEPTED, and the release isn't production-ready: nothing has been deployed.**

| ID | Status | Implemented | Functionally verified | Blocked by | Not completed |
|---|---|---|---|---|---|
| SEC-01 | VERIFIED — FUNCTIONAL | Every server the scripts start binds 127.0.0.1, enforced by a guard test. **`demo-server.cjs --app-dir` (`20bf44e`) serves another folder's own build on loopback**, so A1 no longer replaces UX-01's code | 3002 and 3003 on 127.0.0.1 only; live: UX-01's build on spare port 3998 served its own build ID, on 127.0.0.1 only, nothing on the LAN address | A1 | **3000, 3001 and their food stubs (54220, 62493) still listen on all interfaces**, from code older than SEC-01 |
| SEC-02 | BLOCKED — OWNER AUTHORIZATION | `deploy/local-security/A2-firewall.ps1` (`55e91f1`): check, apply, rollback, policy export | Check only: both "Node.js JavaScript Runtime" rules (TCP, UDP, Public, Allow) enabled. **Its apply and rollback paths haven't been executed** | A2 | The rule is unchanged |
| SEC-03 | BLOCKED — OWNER AUTHORIZATION | `deploy/local-security/A3-postgres-listen.ps1` (`55e91f1`): check, apply with hash-checked backup, rollback | Check only: `listen_addresses = '*'`, listening on 0.0.0.0 and ::, no remote connection; `pg_hba.conf` loopback only. **Apply and rollback not executed** | A3 | Unchanged |
| SEC-04 | BLOCKED — OWNER AUTHORIZATION | `scripts/local-db-roles.cjs` (`cfedfeb`): verify, plan, apply, rollback; per-object ownership (the earlier plan's `REASSIGN OWNED` would have handed `fitdb_review` to `fit_test`: RC-10) | Rehearsal on a throwaway cluster with the real migrations: 11 checks passed, rollback byte for byte. Real server, read only: **NOT ISOLATED**: `fit`, and any role, can connect to all five databases | A4 | Not applied |
| F-11 | VERIFIED — FUNCTIONAL | `deepmerge-ts` overridden to 8.0.2 under `@prisma/config` (`55a686a`); its only path was the Prisma CLI's config loader, not the app's runtime | `npm audit`: 0 vulnerabilities (was 3 high, one advisory); `prisma validate` and `generate` through a config file, generated types identical; `migrate status` on `fitdb_test_isolated`: up to date; unit tests and type check | None | None. Prisma 7 not needed |
| FOOD-01 | VERIFIED — FUNCTIONAL | Caching, one request per identical search, typing pause, 3-character minimum | Call-count tests; live: 12 searches, about 1 s each, no errors; a cache hit costs no allowance | None | None |
| FOOD-02 | VERIFIED — FUNCTIONAL | Ranking, revised for RC-01 | Benchmark re-run at `aff12dd`: 4 of 4 checks; the ideal result first in at least 23 of 24 cases; USDA "bread" still lists fruit, naan, zucchini, puri and pumpkin breads first | F1 | USDA "bread" (RC-01). Whether "white bread" finds it isn't recorded in the benchmark, so unverified |
| FOOD-03 | BLOCKED — OWNER AUTHORIZATION | Evaluated, not built | Not applicable | Owner's decision: group F | Recommendation: don't build; the benchmark's remaining gap isn't one a catalog fixes |
| FOOD-04 | VERIFIED — FUNCTIONAL | Barcodes and servings (earlier phases) | Live: two real barcodes found with their values, a made-up one found nothing; a household serving logged correctly | None | None |
| EMAIL-01 | BLOCKED — EXTERNAL DEPENDENCY | Resend transport, refused at startup unless fully configured; **Compose now passes the mail settings to the app (`cb01d45`; before, they were silently dropped: RC-09)** | Unit tests with a fake network only | C1 | **No email has ever been sent** |
| EMAIL-02 | VERIFIED — FUNCTIONAL | Reset by emailed, single-use, expiring, hashed token. Reviewed again this round: no defect. **C2 account option (`eacc008`)** | `account-tokens` 32 of 32 in each full run; C2 refusals tested | Real delivery: C1, C2 | Checklist G.1 to G.6 on a real inbox |
| AI-01 | IN PROGRESS | On-device reading; screens say where it's read (RC-07). **Evaluation harness (`aff12dd`): shared scoring, Ollama (D1) and provider (D2) paths, derived orientation and low-light sets** | 21 real packet photos, on-device, at `aff12dd`: 9 recognized as labels; 2 values right, 0 wrong, 3 with no reference; 172 of 174 printed values left empty; about 5 s each (reproduces the earlier baseline of 5 values, none wrong). Rotated 90°: 8 recognized, 1 right, 1 differing from the reference; 180°: 8 recognized, 1 right, 1 differing, 2 unchecked; dimmed (simulated low light): 10 recognized, no value read. **The one value differing from the reference, checked by eye, is printed as read (5.4 g protein); the reference is wrong, so 0 misreadings** | D0 photos; D1 or D2 | Useful real-photo reading not achieved on-device (RC-03) |
| AI-02 | IN PROGRESS | On-device main-dish suggestions; same harness | 35 Commons photos, on-device, at `aff12dd`: right food first 23 of 35 (66%), among three 30 (86%), reproducing the baseline; 11 wrong suggestions, none marked likely; about 0.1 s each. Rotated 90°: first 23, among three 29; dimmed: first 23, among three 28. Multi-food plates, mixed meals, real low light and no-food: **no sets exist, so unmeasured** | D0; D1 or D2 | Several foods per photo |
| MOBILE-01 | BLOCKED — EXTERNAL DEPENDENCY | App side as before; **checklist H.1 to H.10 and the certificate-log exposure in the manual guide (`a6431ff`)** | WebKit at phone size through a local HTTPS stand-in (doesn't count as physical) | E1 | Physical Safari, camera, HEIC |
| MOBILE-02 | BLOCKED — EXTERNAL DEPENDENCY | As MOBILE-01 | Layouts at 390 px in three engines | E1 | Physical Chrome, camera |
| DEPLOY-01 | BLOCKED — OWNER AUTHORIZATION | Templates; **`scripts/g1-image-check.cjs` (`83b1466`): build, layer scan for files and secret values, throwaway TLS database, preflight refusals, hardened run, health, label, meal, memory with a 249,000-row export, shutdown** | Layer scan and refusals unit-tested; **not run: Docker Desktop is stopped** | G1, then G2 | Everything operational |
| DEPLOY-02 | BLOCKED — OWNER AUTHORIZATION | Startup refuses weak or partial settings, including mail, `LABEL_OCR`, `MEAL_RECOGNITION` and missing model files | Unit tests | A domain and host: group G | Certificates, real HTTPS |
| DEPLOY-03 | IMPLEMENTED — UNVERIFIED | A verified backup of `fitdb_review`; `restore-check.cjs` | Nine refusals tested before connecting (`df09541`); live, with the real backup: refused because the scratch database doesn't exist, nothing created | B2 | **No restore has been performed** |
| DEPLOY-04 | BLOCKED — OWNER AUTHORIZATION | Health check, rollback runbook (4.0.3) | Health route exists | A deployed server: group G | Monitoring |
| QA-01 | IN PROGRESS | 46 suites | **Latest complete run: `a6431ff`, 2026-11-08, on `fitdb_test_isolated`: 46 of 46 run suites passed**, one run, no retries, nothing else running (log in the diagnostics folder). Includes `guard` 60 of 60 (the script audit), `guard-browser` 27 of 27 (6 new RC-08 tests), `demo-account` 32 of 32, `label-pdf`, `responsive`. The browser suites ran on the production build of 2026-11-07 20:04; no application source has changed since `b77a7db` (this round changed scripts, tests, templates, the evaluation code the app doesn't import, and documents). **Unit tests at `c018279`: 2,219 passed, 1 skipped (the on-request evaluation runner); type check clean.** Its first full unit run failed 1 (the data inventory caught the evaluation-only Ollama address), fixed in `c018279`, which changed only that test data and a test, which the guarded suites don't use. No production build this round: none of the application's source changed. **Excluded, not failed: `safety-no-marker`, `db-guard-scoped` (B1b)**. Earlier: 46 of 46 at `8152c8f`, at `b77a7db`; 45 of 45 at `905c47c` | QA-04 | `safety-no-marker`, `db-guard-scoped` (B1b) |
| QA-02 | IN PROGRESS | Journeys A to I | See the journeys below: A, B, C, D, E, F and I pass on the final candidate; G and H blocked | E multi-item: D; G: C; H: E | G and H |
| QA-03 | VERIFIED — FUNCTIONAL | Firefox teardown and navigation races handled, only those exact errors | Firefox `guard-browser` 8 of 8, and every full run since | None | None |
| QA-04 | BLOCKED — OWNER AUTHORIZATION | **B1a done (`a457eff`): `fitdb_test_isolated_other` as the isolated database's companion**, from `.env.isolated` only; the runner pairs each target with its own companion and refuses the two suites until it exists with its marker | Guard tests; live: both suites refused on `fitdb_test_isolated` (exit 1), nothing created | B1b | Neither suite has run on recent code |
| RC-01 | VERIFIED — FUNCTIONAL | See FOOD-02 | Benchmark gate | None | USDA "bread" lists flavoured breads first: no record marks the everyday one |
| RC-02 | VERIFIED — FUNCTIONAL | Busy ports explained; `--stop` only for this folder's own server; apps end with their script | `server-lifecycle` 8 of 8, with a control; the real leftover stopped, 3002 correctly not touched | None | None |
| RC-03 | IN PROGRESS | Real-photo measurement (see AI-01) | No wrong value in 21 photos | The owner's photos; group D | Usefulness on real packets |
| RC-04 | VERIFIED — FUNCTIONAL | Run lock; trace and description on failure | Cause shown by a trace: the browser starved of CPU (no click delivered, 2 frames in 34 s) while the app answered in milliseconds; ruled out: hydration, the scan budget, a leave-page dialog, the server. Since the lock and diagnostics: 28 consecutive runs passed (18, then 10 at `905c47c`), plus the full regression's; under deliberate full load on all 32 threads, 5 of 6 | None | A browser can still stall under extreme CPU load; the lock prevents only overlapping guarded runs, so other heavy work must not run beside a regression |
| UX-01 | VERIFIED — FUNCTIONAL | UX-01A to E, Q, R, I | `responsive` 13 views, 4 widths, 2 themes; visual QA; journeys | **The owner** | **OWNER ACCEPTANCE PENDING** |

**Journeys, on the candidate, as review tester 1 (test data only):** **A PASS:** sign-in, dashboard, session kept (profile creation passed earlier on unchanged onboarding code). **B PASS:** plan, exercises, sets and reps, schedule, start, log and edit sets, both kinds of notes, a failed note save refused at Finish, history, progress. **C PASS:** live USDA and Open Food Facts search, household serving, grams, custom food, Recent, earlier date, edit and delete with totals adding up, history. **D PASS:** a generated label read on the server; the serving the two readings disagreed on was completed by the person; saved and logged. **E PASS:** a real Commons pizza photo suggested as pizza on the server in 0.9 s, accepted, matched to a USDA record, 150 g logged with that record's values; several foods per photo aren't supported (group D). **F PASS:** weight on two days, history, trend, chart, goal weight and goal card (the older workflow script's two weight steps fail only because they assume an empty account). **G BLOCKED:** no email (group C). **H BLOCKED:** physical phones (group E); the application side passed in WebKit through an HTTPS stand-in. **I PASS:** the candidate restarted, tester 1 signed in again, every record read back identical. Isolation: another account gets 404

**Open defects:**

| ID | Defect | Severity |
|---|---|---|
| RC-01 | USDA "bread" ranks flavoured breads (fruit, naan, zucchini) before white or whole-wheat bread; nothing in the records marks the everyday variety | P3 |
| RC-03 | On-device label reading fills in few values on real packet photos (5 values from 21 photos; none wrong) | P2 |
| RC-05 | The meal model names one main dish; other foods on a plate must be added by hand, and a small item on a large plate can be taken for no food | P3 |
| RC-06 | The production image has never been built. The model step is now in the Dockerfile (opt-in) and the settings in the template, but nothing is verified on Linux. Measured on this Windows PC only, below | P2 |
| RC-07 | **Fixed** at `b77a7db`: the label and meal screens now say where the image is actually read (this server, the provider, or a PDF's own text), and tag values accordingly. Unit tests, `label-scan` (provider wording) and the new `label-local` suite (on-device wording, three browsers) | Closed |
| RC-08 | `label-pdf` failed intermittently: one of the scan page's scripts failed through the test proxy (`ERR_PROXY_CONNECTION_FAILED`) before the page could react to the file. **Fixed defect** (`8152c8f`): hop-by-hop headers forwarded, so a new connection per request. **This round (`cf785a5`):** a failed app script now fails the step at once, by path, instead of a 30 s timeout, and the browser is closed on failure; 6 deterministic tests in three engines (connection failure, proxy 502, a real cancelled load ignored). Tried and not reproduced: 20,000 server-closed connections, 0 failures; the proxy's idle timeout is 120 s. **The cause of that one connection failure remains undetermined;** 20 passes don't prove it can't recur. Separate from RC-04 | P2, **recurred** on `feature/beta-critical-capabilities` (2k): reopened |
| RC-09 | **Fixed** (`cb01d45`): Compose passed only its listed variables to the app, and mail, `LABEL_OCR` and `MEAL_RECOGNITION` weren't listed, so in production they'd have been silently off. A test now requires every setting the template offers to reach the app; it failed before the fix | Closed |
| RC-10 | **Fixed in the plan** (`cfedfeb`): A4's `REASSIGN OWNED BY fit`, run in one database, also moves shared objects, so it would have given `fitdb_review` to `fit_test`. The script changes ownership object by object; the rehearsal shows the hazard as a control | Closed |
| RC-11 | **Fixed in the plan** (`20bf44e`): A1 would have restarted the UX-01 preview from the release folder, replacing its code. `--app-dir` serves its own build | Closed |

**AI baselines, recorded 2026-11-07, for comparing any stronger approach on the same inputs.** Neither on-device feature is accurate for arbitrary labels or meals.

| Feature | Input set | Baseline |
|---|---|---|
| Label reading (on-device OCR) | 21 real packet photos, Open Food Facts (`src/lib/server/labels/eval/off-photos.json`) | 9 recognized as nutrition labels; 5 values read; 0 wrong |
| Label reading | 13 generated variations (`local-ocr.test.ts`) | 11 fully read; heavy blur and dim light nothing kept; 0 wrong |
| Meal suggestions (CLIP ViT-B/32) | 35 single-food photos, Wikimedia Commons (`src/lib/server/meals/eval/commons-photos.json`) | right food first 23 (66%); among three 30 (86%); one main dish only |

**Acceptance tests a stronger model must pass before it's adopted** (proposed thresholds, for the owner to confirm; measured on fixed, recorded sets, each photo checked by a person):

| # | Test | Set | Must achieve |
|---|---|---|---|
| L1 | Real packets | The 21 Open Food Facts photos, plus 20 of the owner's own | At least 80% recognized as labels; at least 70% of printed calories, protein, carbohydrate and fat read; **0 values that differ from the label** |
| L2 | Glossy packaging | 10 photos with glare | At least 60% of those values read; 0 wrong |
| L3 | Curved labels | 10 photos of bottles, tubs, wrappers | At least 60% read; 0 wrong |
| L4 | Low light | 10 photos in dim light | At least 50% read, the rest left empty with a reason; 0 wrong |
| L5 | Multilingual and two-column labels | 10 European labels | The per-100 g and per-serving columns never mixed; 0 wrong |
| M1 | Single dishes | The 35 Commons photos | Right food first at least 85%, among three at least 95% |
| M2 | Multi-food plates | 20 plates of 2 to 5 foods, each food listed by a person | At least 80% of the foods found, at least 80% of suggestions correct, each food a separate item |
| M3 | Mixed meals | 15 stews, salads, bowls, sandwiches | The dish named, and at least half the visible components offered as possible ingredients |
| M4 | Low-light meals | 10 photos | At least 70% right among three, or "unknown"; never "likely" when wrong |
| M5 | No food | 10 photos of documents, rooms, people | "No food" in at least 9 |
| G1 | Every test | All of the above | Every output accepted by the schema; no amount, weight, calorie or nutrient anywhere; every value and item correctable by the person |
| G2 | Speed and size | On the target server | Under 10 s per label and 5 s per meal photo at the 95th percentile; memory within the deployment budget |
| G3 | Privacy | All | Local: no network request while reading. Provider: only the cleaned image sent, as the notice says |

**Memory and time, measured on this PC only** (Windows 11, i9-14900K, Node 24.21.0; `node scripts/measure-recognition.cjs --port=3003 --account=<review-tester-1.local.md>` on a freshly started candidate; Linux unmeasured):

| Step | Request ms | Memory MB | Peak MB |
|---|---|---|---|
| Fresh server, before any request | | 181 | 336 |
| After sign-in | 72 | 203 | 336 |
| First label scan (loads the OCR) | 430 | 267 | 336 |
| Second label scan | 274 | 260 | 336 |
| First meal photo (loads the model) | 741 | 789 | 789 |
| Second meal photo | 92 | 803 | 803 |

With both loaded the server held about 0.8 GB. The image's 1.5 GB limit also has to hold an export, which peaked at about 700 MB earlier (S-13): **1.5 GB is likely too little with on-device meal recognition on; measure on Linux before choosing the limit.**

**Production image readiness:** OCR language data is an npm dependency, installed by the runner's `npm ci`. Native modules (sharp, onnxruntime-node, argon2) come from npm's per-platform packages, never installed on Linux here. The meal model is now an opt-in Dockerfile step (`--build-arg WITH_MEAL_MODEL=1`), checked against its hashes. The new settings are in `deploy/production.env.example`. `.dockerignore` now keeps `*.local.md` (local passwords) and `.cache` (models, evaluation photos) out of every layer; before, the build stage's `COPY . .` would have taken them in. **No image has been built or run.** Docker Desktop is installed on this PC but stopped, and starting it needs your approval (G1).

**Owner approvals needed, consolidated (revised 2026-11-08, after the completion round).** Approve by ID; approving one approves nothing else. Each is now a script or a checklist, with its own check, verification and rollback, so nothing below needs further engineering before it can run. "Ready" means it can be approved as written; the others need something only you can provide.

| # | ID | What runs | Needs from you | Cost | Privacy | Downtime | Verified by | Rollback | Risk |
|---|---|---|---|---|---|---|---|---|---|
| 1 | A1 | Stop 3000 and 3001 (and their food stubs on 54220 and 62493); restart each with `scripts/demo-server.cjs --confirm=fitdb_test --port=… --app-dir=<its own folder>`, as in the manual guide | Ready | None | Less exposure of test data | Under a minute each | `netstat`: 127.0.0.1 only; each serves its own build (build ID); demo status unchanged | Restart the old commands | Low: same builds, same `fitdb_test` |
| 2 | A2 | `deploy/local-security/A2-firewall.ps1 -Apply -Approval A2`, elevated | Ready | None | Less exposure | None | Its own check; a phone on Wi-Fi can't open port 3000 | `-Rollback -State <file>`, or import the exported policy | Low; apply path not yet executed |
| 3 | A3 | `deploy/local-security/A3-postgres-listen.ps1 -Apply -Approval A3`, elevated | Ready | None | Less exposure | 5 to 10 s, PostgreSQL restart: requests in flight on 3000 to 3003 fail | Its own check: 5432 on 127.0.0.1 and ::1 only | `-Rollback -Backup <copy>` | Low; apply path not yet executed |
| 4 | A4 | `scripts/local-db-roles.cjs --apply --confirm=A4` with `ADMIN_DATABASE_URL` set in your shell; then restart each server | The `postgres` password, typed into your own shell only | None | Least privilege: a leaked test password can't reach review data | Under a minute per server restart | It verifies itself; `--verify` reports ISOLATED; rehearsal passed | `--rollback --confirm=A4 --state=<file>` | Medium: every server's credentials change; rehearsed end to end |
| 5 | B2 | `CREATE DATABASE fitdb_restore_check OWNER fit_review` (or `fit` before A4); `restore-check.cjs`; then `DROP DATABASE` | Ready | Disk, briefly | The copy holds review data until dropped; never leaves this PC | None | "RESTORE VERIFIED"; `fitdb_review` unchanged before and after | Drop the scratch database | Low: the check refuses anything but an empty, unmarked scratch database |
| 6 | B1b | `local-db.cjs --init --confirm=fitdb_test_isolated_other` (from `.env.isolated`), then the runner with `safety-no-marker db-guard-scoped` | Ready | Disk | Test data only | None | Both suites pass; the other databases' markers and counts unchanged | Drop the new database | Low |
| 7 | E1 | Tailscale on this PC and both phones; HTTPS certificates on; `tailscale serve --bg 3003`; review server with `--origin`; checklist H.1 to H.10 | A Tailscale account; both phones; a machine name you accept being public (certificate logs) | Free personal plan (check) | Device names to Tailscale; names in public certificate logs | One review-server restart | H.1 to H.10 on each real phone | `tailscale serve reset`; uninstall | Low |
| 8 | C1 | A Resend account, a verified sending domain, a send-only key in `.env.review` | A domain you control (or buy one) and its DNS | Resend free allowance (check); a domain if needed | Recipient address and link pass through Resend | One review-server restart | Domain shows verified | Remove the settings; revoke the key; remove DNS records | Low |
| 9 | C2 | `review-account.cjs --mail-tester --email=<address>`; checklist G.1 to G.6 | One inbox you control | None | That address stored in `fitdb_review` until deleted | None | G.1 to G.6 | Delete the account in the app | Low |
| 10 | D0 | Collect the missing sets: glare, curved, real low light, multilingual two-column labels; multi-food plates, mixed meals, real low-light meals, no-food photos; 20 of your own packets | Your photos, or a choice of licensed public ones, each checked by a person | Your time | Yours stay on this PC unless D2b | None | A manifest per set | Not applicable | None |
| 11 | D1 | Install Ollama, pull one vision model (5 to 8 GB), run `run.eval.test.ts` with `AI_EVAL_READER=ollama` | Approval to install and download | Disk, GPU | Nothing leaves this PC | None | The same sets and scoring as today's baselines | Uninstall | Low |
| 12 | D2a / D2b | `run.eval.test.ts` with `AI_EVAL_READER=provider`, `AI_EVAL_APPROVAL=D2a` (public sets only) or `D2b` (your photos), `AI_EVAL_MAX_IMAGES` | A spending limit set in the provider console; current prices | Per request, about 170 images for every set once | **Images go to Anthropic**: D2a public photos only; D2b yours | None | The same scoring | Remove the key | Low with a spending limit |
| 13 | F1 | Accept the USDA "bread" ranking as a known beta limitation | Your choice | None | None | None | Benchmark gate stays | Not applicable | Low: other searches unaffected |
| 14 | G1 | Start Docker Desktop; `node scripts/g1-image-check.cjs --approval=G1` | Approval to start Docker Desktop and download base images | Several GB of disk; no money (check Docker Desktop's licence terms) | Test data only | None | Its 8 recorded steps | Stop Docker Desktop; it removes what it made | Low |
| 15 | G2 | Decisions 4 (name and domain), 5 (host, managed database, monthly ceiling), 14 (who may read production data), backup retention and recovery objectives (RPO, RTO), how deletion reaches backups, production access, and accepting any open dependency finding | Your decisions | Sets the ceiling | Sets the rules | Not applicable | Recorded in `FEATURE_DECISIONS.md` | Not applicable | None until G3 |
| 16 | G3 to G7 | Rehearsal on a disposable server (G3); HTTPS on the real domain (G4); backup and restore on the target (G5); monitoring and alerts (G6); invited rollout after the pre-beta safeguards, your UX-01 acceptance and merge approval (G7) | G1 and G2 first; then each in order | Within your ceiling | Real data from G7 only | Not before launch | Each gate's checks, as in `PHASE_4_0_3_DEPLOYMENT.md` | Destroy the rehearsal; previous image tag | Medium; each separately approved |

**Proposed defaults for G2, for you to change:** backups daily, kept 30 days; recovery point objective 24 hours, recovery time objective 4 hours for the beta; an account deleted in the app is gone from the live database at once, and from backups as they expire (at most 30 days), as the privacy notice must then say; production data read only by you, through the provider's console, with every access noted; no dependency finding of high severity accepted (there are none today).

**A known limit, not a defect:** the session cookie is `Secure`, and this Windows WebKit build won't send one over plain `http://localhost`. Sign-in succeeds there, and the browser check carries on with a non-Secure copy, as other WebKit suites do. Chrome, Edge and Firefox stay signed in. Real Safari and real phones are unverified (T-15, R-13).

## 2k. Beta critical capabilities

**On `feature/beta-critical-capabilities`, from `feature/release-completion` at `ca015e5`, in its own worktree (`FitWorkoutFoodTracker-beta`). Not merged, nothing deployed, no paid service or hosted AI used.** The owner approved the scope of phases 1 to 5 on 2026-11-08; `product-strategy-agent` was run for the record (it recommended shipping feedback first, cutting scope as adopted below, and noted plan import and front-of-pack scanning lacked demand evidence; the owner's approval stands). Plan: `BETA_PLAN.md`. **Nothing here is OWNER ACCEPTED.**

**Test environment for this branch:** the branch adds a table, so its suites run against a throwaway PostgreSQL cluster made by `scripts/disposable-db.cjs` (temporary folder, 127.0.0.1:55434, `fitdb_test_isolated` and `fitdb_test_isolated_other` migrated, seeded and marked, so every guard applies unchanged). No real database was migrated or written; the shared `fitdb_test_isolated` was not used by this branch.

| ID | Status | Implemented (commit) | Verified | Not verified | Blocked by |
|---|---|---|---|---|---|
| BETA-1 PWA | VERIFIED — FUNCTIONAL (browsers) | Manifest, temporary icons, standalone, viewport, service worker caching only build files, icons and an offline page; offline banner; install help (`757217d`) | Unit 5; `pwa` suite: installable metadata in three engines; after signed-in pages and API calls the cache holds no page, API answer or personal text (Chromium, Firefox); offline page (Chromium); negative control: a worker caching every GET fails | Installing and launching on a real iPhone and Android; offline page in Firefox (Playwright's offline mode bypasses workers) | E1 |
| BETA-2 Barcode | VERIFIED — FUNCTIONAL (browsers) | Camera scanner, on-device decoding (native or `barcode-detector` 3.2.3 / zxing-wasm, self-hosted), check digits, two-frame rule, UPC-E, typed and photo entry, confirmation before logging (`638b76e`) | Unit 8; `barcode` suite: a real EAN-13 read by Chromium's fake camera, confirmed and logged from the provider's record; one record however often scanned; two cameras; refused camera; unknown code; wrong check digit never looked up; WebAssembly fallback in three engines; only digits sent | The native detector (absent on desktop Windows); real phone cameras; USDA barcode lookup (Open Food Facts only, as before) | E1 |
| BETA-3 Plan import | VERIFIED — FUNCTIONAL (browsers) | PDF, images, CSV, TXT, DOCX, XLSX; documents read in the browser; images and scanned pages read as text on the server and released; deterministic parser; exact-only matching; validated atomic save, new plans only, schedule only gains slots (`d74a665`) | Unit 23 + PDF 105; `workout-import-api` 7; `workout-import` suite: a full TXT import to saved plans; CSV, DOCX, XLSX, PDF in three engines; screenshots and a scanned PDF in Chromium; eight hostile files refused in the browser; no document uploaded | Real users' plans (only fixtures); layouts the parser doesn't recognise go to "lines not read" for the person; no hosted model | None (a hosted model would need D2-style approval) |
| BETA-4 Package photo | VERIFIED — FUNCTIONAL (browsers) | Barcode from the photo, else its words (filtered: no numbers, nutrition terms or claims) for the person to search with; normal provider search and confirmation; fallbacks label scan or a private food (`f0c37fc`) | Unit 2; API 1; `barcode` suite +3: words offered, nothing searched before choosing, provider record logged; unreadable photo handled | Real packaging photos; accuracy | E1 for phones |
| BETA-5 Feedback | VERIFIED — FUNCTIONAL | Submission with privacy notice, own list, admin review by `ADMIN_USER_IDS` (404 to everyone else), triage, duplicates, task links, redacted pseudonymous export; one additive migration (`5197037`, `97ca9a4`) | Unit 4; `feedback-api` 8; `account-data` 26 with feedback in export and deletion; `nutrition-api` admin 404 test; route audit | **Migration not applied to any real database**; the privacy notice doesn't yet name feedback | Migration approval (MIG-FB) |
| BETA-6 Review workflow | IMPLEMENTED | `FEEDBACK_REVIEW_WORKFLOW.md` (`d5d1430`) | Not applicable | First real use | Beta feedback |
| BETA-8 Hosting | IMPLEMENTED — UNVERIFIED | `BETA_HOSTING.md`: one server against a managed database, indicative 2026 prices from cited third-party sources (`d5d1430`) | Not applicable | Prices at decision time | G2 |
| F-11 | VERIFIED — FUNCTIONAL | Resolved at `55a686a`; stale notes in three documents reconciled on this branch | `npm audit` 0 on this branch too, after adding `barcode-detector` | None | None |

**Test results for this branch, at `c7eb47f`, on the throwaway cluster (production build of the current application code):** full regression, second run: **53 suites ran, 51 passed, 2 failed**: `label-pdf-unconfigured` (RC-08's `ERR_PROXY_CONNECTION_FAILED` on its first page load; passed 3 of 3 reruns) and `safety-no-marker` (QA-05, pre-existing). It includes the 7 new suites (`feedback-api` 8, `pwa`, `barcode`, `workout-import-api` 8, `workout-import`) and, for the first time on recent code, `db-guard-scoped` (passed, 6 of 6) on the throwaway companion database; this is not B1b, which concerns the real server. Unit tests at `97ca9a4`: 66 files, **2,270 passed, 1 skipped** (the on-request evaluation runner); `c7eb47f` changed only scripts and documents. Type check clean; `npm audit` 0. **RC-08 recurred on this branch** (once confirmed, once likely): it is reopened, P2, with the logs in `diagnostics\rc08-recurrence`; the earlier mitigation reduced it but didn't remove it.

**The first full regression on this branch failed 8 suites; all causes found:** (1) the PWA's service worker routed page requests where Playwright's routes, request records and the guard's route layer can't see them (6 suites): guarded test pages now get no service worker API unless a suite opts in (`pwa` does), tested in three engines; the app is unchanged. (2) `mig-04`'s "newest migration" test protected a real hazard: run from this branch, MIG-04's `migrate deploy` would also have applied the feedback migration; `mig-04.cjs` now stops before deploying when a later migration exists. (3) QA-05, below, is pre-existing.

| ID | Defect | Evidence | Severity |
|---|---|---|---|
| QA-05 | `safety-no-marker`'s "request TIMEOUT: a sign-up that lands after the client gave up is removed by the second sweep" finds no late user to remove (`removed 0`) | Fails identically on the release code at `ca015e5` against the same throwaway databases, so not caused by this branch; the suite hadn't run on recent code before (T-14). Log in `diagnostics\qa05`. Cause not yet found | P2: it tests the live check's cleanup, not the app |

**Defects found and fixed during this round:** the route and script audits caught a test sending requests outside the guard proxy (`page.request`), three new routes missing from the route classification, and `barcode-detector` missing from the data inventory (all fixed before or in the following commit); escaped-character mistakes in my own edits were caught by syntax checks and tests.

**Security review of this round.** New attack surface: four authenticated endpoints (feedback, admin review, two image-to-text readers) and three file parsers. Controls: the admin review is server-side by user ID, answers 404 to everyone else and is classified in the route audit; every input is schema-validated and size-bounded; feedback is rate-limited from the table and de-duplicated; images go through the existing upload validation, slots and the daily scan allowance, and only text comes back; document parsing runs in the person's own tab with limits on size, parts, declared and real decompressed size, rows and columns, and refuses encryption; nothing from a document is executed or rendered as markup (tested); the service worker stores no private data (tested with a negative control); frames and documents are never uploaded (tested by recording every request); `npm audit` 0. **Remaining risks, for owner acceptance:** (1) the scan allowance is in memory per process, as before; (2) local OCR is CPU-heavy, bounded only by the upload slots and allowance; (3) redaction can't find names or health details, so the owner reads every export; (4) administrators change only with a restart; (5) **the privacy notice must name feedback and the reading of plan and package images before the beta** (a versioned legal text: owner and legal review); (6) parsed plans and package words depend on layout and OCR quality, with the person checking every value.

**Branding:** pages, the manifest and the home screen use "FitWorkoutFoodTracker" ("FitTracker" under the icon). The in-app wordmark and emails still say "Forge", and the icons are temporary: the owner's branding decision. **Superseded in 2l:** the wordmark and emails now say FitWorkoutFoodTracker too.

### Beta launch gates and approvals, consolidated (dependency order)

Earlier items keep their full rows in 2j; new items are marked **new**.

| # | ID | What it allows | Needs | Risk |
|---|---|---|---|---|
| 1 | A1–A4 | Local servers, firewall, PostgreSQL listener, role isolation (2j) | As in 2j | As in 2j |
| 2 | B2, B1b | Restore check; QA-04 suites on the real companion database (2j). Both suites also ran on this branch's throwaway cluster (see below) | As in 2j | Low |
| 3 | **MIG-FB** (new) | Applying migration `20261108120000_feedback` (one table, four enums, nothing changed) to `fitdb_review` for the owner's review, and to production at G3 | Approval, after a backup | Low: additive |
| 4 | **NOTICE-B** (new) | Privacy notice and data inventory text naming feedback and the reading of plan and package images, before any real user | Owner and legal review | Without it, the beta can't start |
| 5 | **BRAND** (new) | The product name in the app and emails, and final icons | Owner's choice | None |
| 6 | E1 | Phones: install the PWA, checklist H, plus: barcode by camera, package photo, plan import from a phone screenshot | Tailscale, both phones | Low |
| 7 | C1, C2 | Real email and reset (2j) | A domain and Resend | Domain cost |
| 8 | D0–D2 | Stronger photo reading (2j); also applies to plan import's images if wanted | As in 2j | Hosted: image transfer and cost |
| 9 | G1 | Linux image build and memory (2j); now also with the feedback migration | Docker Desktop started | Low |
| 10 | G2 | Hosting choice (`BETA_HOSTING.md`), domain, budget ceiling, retention and recovery targets, production access, `ADMIN_USER_IDS` | Owner's decisions | Sets cost |
| 11 | G3–G7 | Rehearsal, HTTPS, restore on target, monitoring, invited rollout; merge of this branch | Each approved; UX-01 accepted; security sign-off | Medium |

## 2l. Multi-gym, exercise swaps and the food-photo gap

**On `feature/multi-gym-exercise-alternatives`, from `feature/beta-critical-capabilities` at `5b854f7`, in the same worktree (`FitWorkoutFoodTracker-beta`). Not merged, nothing deployed, no paid service or hosted AI used, no real database migrated or written.** The owner approved the multi-gym and exercise-alternatives feature in the directive of 2026-11-08. **Nothing here is OWNER ACCEPTED.** Tests ran on the throwaway cluster from `scripts/disposable-db.cjs` (127.0.0.1:55434), which has both pending migrations.

| ID | Status | Implemented (commit) | Verified | Not verified | Blocked by |
|---|---|---|---|---|---|
| GYM-1 Gyms | VERIFIED — FUNCTIONAL (browsers) | Create and rename gyms, up to 20, with case-insensitive unique names; equipment kinds; named machines, optionally for one exercise, up to 100 per gym. Private, with no location. The gym can be chosen before or during a workout. History can be filtered by gym (`47bc004`, `4e42c85`, `3c811a8`, `57f8604`) | `gyms-api` 14: CRUD, duplicates, limits under 25 concurrent requests, isolation through 13 routes (404), kinds, machines, gym rules; `gyms-e2e` in Chromium | Real phones (E1) | MIG-GYM |
| GYM-2 Machine contexts | VERIFIED — FUNCTIONAL | Previous performance, histories and PRs keyed by exercise plus machine. Sets with no machine, which covers every old workout, keep the shared history. `/previous` and `/history` accept `?machine=`. The progress page shows each context with a label | `gyms-api`: 100 kg on machine A, 40 kg on machine B and 60 kg with no machine, each kept apart; a new machine starts empty; `gyms-e2e` on the progress page | None | MIG-GYM |
| GYM-3 Swap | VERIFIED — FUNCTIONAL (browsers) | Swap exercise: suggestions come from reviewed movement patterns (47 built-in exercises, 21 patterns), never from muscle alone, plus the person's own earlier swaps, each marked by what the gym has. The planned row keeps its sets. The replacement is linked by `substitutesId` and `plannedExerciseId`. The plan changes only on request, and only its first matching entry. The swap is locked, refused on a finished workout, and repeating the same swap is idempotent | `gyms-api`: sets byte-identical after the swap and after Finish, plan unchanged, `updatePlan`, five concurrent swaps make one, refusals; `gyms-e2e`: the whole flow in Chromium, and a swap with a plan update in Chromium, Firefox and WebKit; `movement-patterns` unit 6 | The pattern table needs owner review for coverage (custom exercises get only "used before" suggestions) | MIG-GYM |
| GYM-4 Data handling | VERIFIED — FUNCTIONAL | Export covers gyms, equipment and every gym, machine and swap field. Deletion removes all of it, after sessions. The data map and inventory are classified | `account-data` 26, with gym rows seeded in every model; data-map tests | None | MIG-GYM |
| MIG-GYM migration | IMPLEMENTED — UNAPPLIED | `20261109120000_multi_gym`: additive only. Every new column on an existing table is nullable with no default, so no old workout gets a gym or machine | `migration-safety` 6 (only additions, its keys' delete rules); applied only to the throwaway cluster | Not applied to `fitdb_test`, `fitdb_review` or production | **Owner approval** |
| MIG-GUARD | VERIFIED — FUNCTIONAL | `prisma/approved-migrations.json`, with a SHA-256 per approved migration. `migrate-approved.cjs` is the Docker migrate step and `npm run db:deploy`. `local-db.cjs` and `mig-04.cjs` refuse any folder that hasn't been approved, whatever its name (`47bc004`, `b11564c`) | `migration-safety` 6; `mig-04` 103; image step and `fitdb_review` each refuse with exit 4, applying nothing | A Linux image build (G1) | None |
| FOOD-GAP | VERIFIED — FUNCTIONAL (browsers) | A package photo with no barcode goes: words → one search of the approved sources → up to 5 candidates with their source and the provider's own values → confirmation → the usual resolve and cache → the amount sheet. Fixture results carry the "Test data" notice. The photo isn't kept, and the fallbacks remain (`c9697df`) | `package-match` unit 5; `barcode` suite: one search with no claim or value in it, candidates, confirming, going back, no match, the full search, logged with the record's own values | Real packaging photos; live providers (not called) | E1 |
| BRAND | VERIFIED — FUNCTIONAL | The side bar, welcome pages and account emails say FitWorkoutFoodTracker. No "Forge" is left in `src`, `public` or `scripts`, and no internal identifier changed (`448e6db`) | Account unit 130; e2e suites | Final name and icons, FitBunny | Owner's branding decision |
| PRIV-D | IMPLEMENTED | `PRIVACY_WORDING_DRAFTS.md`: wording for feedback, product and plan images, device versus server reading, gyms, third parties, export and deletion, and backups. Facts checked against the code (`81af4f8`) | Not applicable | Legal review | NOTICE-B |
| DEMO-GYM | IMPLEMENTED — UNAPPLIED | Demo account: two gyms, two named machines, gyms on workouts from 2026-10-19, one swap. Added only where MIG-GYM is applied; otherwise the rows are skipped with a message. Guide steps MG.1 to MG.15 (`6c14a42`) | `demo-account` 33; the built rows inserted twice into the throwaway database (keys hold, and the second run adds 0) | On `fitdb_test`: needs MIG-FB and MIG-GYM there | Owner approval |

**RC-08 disposition: not reproduced; confined to test infrastructure; traced from now on.**

- **Evidence.** The recurrence logs show `ERR_PROXY_CONNECTION_FAILED` on the first `page.goto` of a suite. The app server's log is clean, so the request never reached the app.
- **Tried, with tracing on:**
  - 200 fresh Chromium loads, one at a time, of a page with 8 scripts through the real guard proxy;
  - 900 loads with 6 browsers in parallel (5,400 connections, 8,100 requests, 8,100 responses, with no client or upstream error);
  - 25 loops of `label-pdf-unconfigured` plus `profile-minimization-e2e`, 50 of 50 passed;
  - earlier, 20,000 server-closed connections.
- **Ruled out, as far as these runs reach:**
  - **Server lifecycle:** the app log is clean and the request didn't reach it.
  - **Service worker:** it's hidden in guarded contexts, and the probes had none.
  - **Concurrent runs:** the RC-04 lock was held.
  - **Proxy keep-alive timeout:** 120 s.
- **Not excluded:** the browser's connection to the loopback proxy being refused or reset under full-regression load (resource exhaustion), before the proxy accepts it.
- **Tracing from now on.** Commit `53b388e` gives every guarded suite a connection trace (paths and status codes only), so the next occurrence will show whether the connection reached the proxy.
- **This round's full regression:** `label-pdf-unconfigured` passed and no suite logged `ERR_PROXY`.
- **Only the test proxy is involved, never the app.** P2, and it stays open.

**QA-05 disposition: no defect in the app; the test's assumption was outdated; fixed (`d6f94f3`).**

- **What happened.** The delayed sign-up request did reach the app, after 2.5 s. It was answered 400 ("This link isn't valid or has expired"), because the first sweep had already deleted the run's sign-up token. No account was created, and none and no token remained.
- **The fix.** The test now checks both protections: a late completion is refused, and a late-created account is removed by the second sweep.
- **Negative control.** With the second sweep disabled, the test fails and a user is left behind.
- **Result.** `safety-no-marker`: 7 passed, 1 skipped (SIGTERM, which is POSIX only). **No late account survives, so it doesn't block the release.**

**Security review of this round (independent, read-only).**

- **Critical, high, and cross-user access:** none.
- **Medium (fixed, `b11564c`).** The migration guard looked only at timestamp-named folders and trusted an approved name without checking its file, and `db:deploy` was unguarded.
- **Lows (fixed, `57f8604`):**
  - the limits weren't checked under a lock (on the old code, 24 gyms were made against a limit of 20);
  - the gym could be changed under a machine;
  - the machine's gym was checked before the lock;
  - a machine set up for one exercise could be used for another.
- **Already safe.** Removing a machine at the same moment it's chosen answers 409 (P2003).
- **Remaining, for the owner:**
  1. Anyone who can run the migrate image with another command can still call Prisma directly (operational access, G3).
  2. When the exercise appears twice in a plan, "update plan" changes only the first matching entry.
  3. Finished workouts can still be edited by their owner (K-04, pre-existing).
  4. Five earlier pages still ship zod's eval probe, which Firefox reports under the CSP (low; the probe is caught).
  5. The remembered next gym is cleared on sign-out only, not when a session expires. It's an id, and it's ignored for anyone else.

**Test results, at `6c14a42` (full regression) and `a0fcb9e` (affected suites), on the throwaway cluster, production builds:**

- **Full regression: 55 suites ran, 52 passed, 3 failed. Excluded (on demand): 5:** `migration-snapshot`, `migration-verify`, `profile-migration-snapshot`, `profile-migration-verify`, `demo-account-e2e` (fitdb_test only). **Blocked: 0.** The 3 failures:
  - **`mig-04-refusals`:** a tripwire listing the later migrations, which the new one correctly tripped. Updated, and the same name filter was hardened.
  - **`gyms-api`, 2 of 14:** new tests run against the earlier build, as the build couldn't be replaced while suites were running. On that build they confirmed the race the reviewer found.
  - **`readiness-e2e`:** Firefox reported zod's eval probe under the CSP on the workout page. Fixed (`a0fcb9e`).
- **Rerun after the fixes:** `gyms-api` 14/14, `gyms-e2e`, `readiness-e2e`, `mig-04-refusals` 103/103, `guard` 60/60, `workout-sets` 25/25, `e2e-smoke`, `account-data` 26/26 and `barcode` all passed.
- **Unit tests:** 69 files, **2,293 passed, 1 skipped**.
- **Type check and audit:** type check clean; `npm audit` 0.
- **Not done:** simulated phone widths are not physical devices, and no physical device was tested.

### Gates and approvals, in dependency order (supersedes the list in 2k)

| # | ID | What it allows | Needs |
|---|---|---|---|
| 1 | A1–A4 | Local servers, firewall, PostgreSQL listener, role isolation (2j) | As in 2j |
| 2 | B2, B1b | Restore check; QA-04 suites on the real companion database | As in 2j |
| 3 | MIG-FB | `20261108120000_feedback` on `fitdb_test` (demo), `fitdb_review`, and later production | Approval, after a backup |
| 4 | **MIG-GYM** (new) | `20261109120000_multi_gym` on the same databases, after MIG-FB (deploy applies both, in order). Then `demo-account.cjs --populate` adds the gyms | Approval, after a backup; then add both to `approved-migrations.json` with their hashes |
| 5 | NOTICE-B | The notice names feedback, image reading and gyms (`PRIVACY_WORDING_DRAFTS.md`) | Owner and legal review |
| 6 | UX-01 | The UX round's acceptance | Owner |
| 7 | **GYM-ACCEPT** (new) | The owner's UI acceptance of this round (guide MG.1 to MG.15) | MIG-FB and MIG-GYM on `fitdb_test`, or the throwaway-cluster preview |
| 8 | E1 | Phones, now including gym choice, swaps and package photos | Tailscale, both phones |
| 9 | C1, C2 | Real email and reset | Domain, Resend |
| 10 | G1 | Linux image build, now with both migrations and the guard | Docker Desktop started |
| 11 | G2–G7 | Hosting, budget, rehearsal, HTTPS, restore on target, monitoring, invited rollout; merges | Each approved; security sign-off; final regression |
| 12 | BRAND | Final name and icons | Owner |

## 2m. Review-findings round (multi-gym branch)

**On `feature/multi-gym-exercise-alternatives`, `a376204..e35f76d`, 8 commits.** No merge, no deployment, and no migration applied to `fitdb`, `fitdb_test`, `fitdb_review` or production. Tests ran on the throwaway cluster from `scripts/disposable-db.cjs`. **MIG-GYM and GYM-ACCEPT are not approved.** Nothing here is OWNER ACCEPTED.

### The seven review findings, and two later security reviews

| # | Finding | Confirmed defect? | Fix (commit) | Regression test |
|---|---|---|---|---|
| 1 | Machine deletion vs machine choice | Partly. Foreign keys already kept any workout from pointing at a removed machine. The defect was the answer: a generic 409, "Referenced by other records" | Removal holds the machine row `FOR UPDATE` and counts its uses; a choice, directly or in a swap, holds it `FOR SHARE`. The answer is now "kept, it's used" (409) or "not found" (404) (`99c68f6`) | `gyms-api`: 12 concurrent rounds, plus forced orderings in both directions through real database locks, plus a swap onto a machine being removed |
| 2 | Swap idempotency with `updatePlan` | **Yes.** A retry with `updatePlan: true` answered "not updated" and dropped the request | A retry makes the plan change it asks for; a retry without it never undoes one (`99c68f6`) | `gyms-api`: a plain swap, then 2 concurrent retries with the update, then one without |
| 3 | The same exercise twice in a plan | **Yes.** The update changed the first matching entry | Each workout row records its plan entry (`SessionExercise.templateExerciseId`, nullable, `SET NULL`, kept when repeating a workout). Only that entry changes, under a row lock. If the plan can't be changed as asked, the whole swap is refused with the reason (`99c68f6`) | `gyms-api`: the second of two bench entries; a repeated workout; no plan; an exercise added during the workout; a plan edited since the workout started |
| 4 | Gym-name uniqueness | **Yes**, for spellings that differ only by Unicode encoding, invisible characters or case folding (for example "Straße" and "STRASSE"), sent at once or one after another | Names are cleaned (NFKC, hidden characters removed, spaces collapsed) and compared case-folded, under the person's lock (`99c68f6`, `ebabcee`, `6e77cd8`) | `gyms-api`: six spellings at once give 1 created; a rename racing a create gives 1; machine names. Unit: 8 cases, including Persian ZWNJ, emoji ZWJ and flag tags kept |
| 5 | Migration safeguards and role permissions | **Yes, found live:** the default privileges gave `fit_app` write access to `_prisma_migrations`, so the app's role could mark a migration as applied, or erase one | After each deploy, and before it, the migrate step leaves the history writable by its owner alone, or refuses. It revokes every grant in the table's ACL, then checks effective write access (`has_table_privilege`) for every role but the owner (`4926fb9`, `5c5d7d2`, `e35f76d`) | Live, the real script run from a disposable copy against throwaway databases, S1–S7: see below. `migration-safety` 8 |
| 6 | Food-photo matching | **Yes:** records sharing no word were shown, as were look-alike duplicates. A fast second tap could show a different product | Candidates sharing nothing, or only the brand, aren't offered; look-alike records are shown once; complete records rank first; missing nutrients are named; weak matches are marked "partial"; each candidate says which words it shares; a second tap is ignored; the resolved record must be the one chosen (`f468dd8`) | `package-match` unit 11; `barcode` suite |
| 7 | CSP violations | **Yes, wider than reported:** on the previous build, Chromium reported zod's eval probe on 5 pages too | zod is imported only through `src/lib/zod.ts`, which sets `jitless`. The policy is unchanged (`60fbc0f`) | `csp-e2e`: 28 pages, signed out and in, in Chromium, Firefox and WebKit, with a positive control in each. It failed on the previous build and passes here. A unit test keeps every zod import going through the one module |

**Second review (full branch, including the modified MIG-GYM): no critical or high finding, and no cross-user access.**

| ID | Severity | Finding | Fixed (commit) |
|---|---|---|---|
| M1 | Medium | Two lock-order deadlocks gave a 500: a swap against a plan save, and a gym rename against machine changes | One lock order (person, gym, equipment; workout, machine, plan entry, exercise rows). A deadlock (P2034 or 40P01) answers 503 with Retry-After, and nothing changes (`ebabcee`) |
| M2 | Medium | The history protection could find nothing to revoke and still print success | It fails closed, before and after each deploy, on success and failure (`5c5d7d2`) |
| L1 | Low | Bidi isolates and other invisible characters weren't removed from names | `ebabcee`, refined in `6e77cd8` |
| L2 | Low | A stale read before the swap's transaction | Re-read under the lock (`ebabcee`) |
| L3 | Low | "Nothing was swapped" when an earlier swap existed | The message is right now (`ebabcee`) |

**Third review (the fixes): no critical or high finding.**

| ID | Severity | Finding | Fixed (commit) |
|---|---|---|---|
| N1 | Low | Deleting a plan against a swap could deadlock (it answered 503 after M1) | The delete holds the plan's in-progress workouts first (`6e77cd8`) |
| N2 | Low | When the final check failed, the revokes before it were rolled back | Revoke and verify run as two commands, and each revoke stands alone (`e35f76d`) |
| N3 | Low | Write access without an ACL entry (membership of the owner role, `pg_write_all_data`) was missed | Checked through `has_table_privilege` (`e35f76d`) |
| N4 | Low | The L1 fix stripped characters real names need (ZWNJ, ZWJ, flag tags) | Kept as typed, and ignored only when comparing (`6e77cd8`) |

**MIG-GYM changed in this round.** `20261109120000_multi_gym` gains `SessionExercise.templateExerciseId` (nullable TEXT), its index, and a `SET NULL` foreign key to `TemplateExercise`, all regenerated with `prisma migrate diff`. It still only adds (`migration-safety`). It has been applied only to the throwaway cluster. **The owner's review of MIG-GYM must cover this column.**

### Migration guard, live (from a disposable copy; the working tree wasn't changed)

| Scenario | Result |
|---|---|
| S1: fresh database | Deployed, exit 0. `fit_app` can't forge, erase or read the history; its rows still work; DDL is still refused |
| S2: run again | Exit 0, idempotent, still protected |
| S3: history owned by an administrator (a direct deploy) | Refused, exit 4, nothing applied (10 rows before and after) |
| S4: a grant re-exposed | With the grant back, the test's own probe really did erase the history. The guard took the access away again, and the deploy then failed loudly ("type Sex already exists"): never reported as success. This is the attack the protection prevents |
| S5: a write grant passed on by a third role | Refused, exit 4. The grants that could be revoked stayed revoked; it names `fit_app` and `fit_other` |
| S6: `fit_app` a member of the owner role | Refused, exit 4 |
| S7: `fit_app` given `pg_write_all_data` | Refused, exit 4. Afterwards, the earlier erase in S6 made the next deploy fail, as in S4 |
| S8: `fit_app` a member of the owner role, with `INHERIT FALSE` | Without the fix (R2), its direct write was denied but writing after `SET ROLE` was allowed, and the guard passed. Now refused, exit 4 |
| S9: `fit_app` a member of `pg_write_all_data`, with `INHERIT FALSE` | Refused, exit 4. With the membership removed: deployed, exit 0 |

Also checked: the app role can't run `prisma migrate deploy`, and the app image has no Prisma CLI.

**Fourth pass (the N fixes): no critical or high finding.**

| ID | Severity | Finding | Status |
|---|---|---|---|
| R2 | Low | The final check missed membership that isn't inherited (`SET ROLE`), and a leftover PUBLIC grant | **Fixed** (`92a80f5`), verified live in S8 and S9 |
| R1 | Low | Saving and deleting the same plan at once can deadlock (opposite lock orders). Existed before this branch | **Open.** Ends as a 503 with nothing changed. Repro: two tabs, one saving a plan while the other deletes it. Fix: lock the plan row `FOR UPDATE` before the save's `deleteMany` |
| I-1 | Informational | Look-alike names that remain: the Braille blank U+2800 (a name of only U+2800 passes), a repeated combining mark, and look-alikes across scripts (Cyrillic "а") | **Open.** Only within a person's own private names. Repro: create "Café" then "Café" + U+2800 |
| I-2 | Informational | Tag characters outside a flag are kept, so a name could carry invisible ASCII text, which matters if names are ever given to a language model | **Open.** Repro: a name ending in U+E0041. Fix: keep tags only after U+1F3F4 |
| I-3 | Informational | A workout started from a plan just after the delete's lock query isn't locked by it. A cycle is only theoretically possible, and would end as a 503 | **Open.** Accepted |

**Remaining from 2l (unchanged):**
- anyone who can run the migrate image with another command can call Prisma directly (operational access, G3);
- finished workouts can be edited by their owner (K-04);
- the remembered next gym is cleared only on sign-out.
- **New, for G2:** a provider whose administrator role holds `pg_write_all_data` makes the migrate step refuse, on purpose. That needs to be part of the hosting choice.

### Test results, actual

| Check | Code | Result |
|---|---|---|
| Full guarded regression | `e35f76d` (all app code) | **56 suites ran: 56 passed, 0 failed, 0 blocked.** Excluded: 5 on-demand suites (`migration-snapshot`, `migration-verify`, `profile-migration-snapshot`, `profile-migration-verify`, `demo-account-e2e`). Includes `gyms-api` 23/23, `gyms-e2e`, `csp-e2e` (3 engines), `barcode`, `account-data` 26/26, `workout-sets`, `readiness-e2e`. `label-pdf-unconfigured` passed and no suite logged `ERR_PROXY` (RC-08). `safety-no-marker` 7 passed, 1 skipped (QA-05) |
| Previous full regression | `5c5d7d2` | 56 of 56 passed |
| Unit (vitest) | `e35f76d` | 71 files, **2,309 passed, 1 skipped** (the on-request evaluation runner) |
| Script tests | `92a80f5` | `migration-safety` 8/8, `mig-04` 103/103, `demo-account` 33/33, script audit 60/60 |
| Live migration guard, S1–S9 | `92a80f5` | As in the table above |
| Type check | `92a80f5` | Clean |
| `npm audit` | `92a80f5` | 0 vulnerabilities (all, and production only) |
| Physical phones | — | **Not tested.** Simulated widths only (E1) |

`92a80f5` changes only the migration guard's SQL and its test, neither of which is in the app build or the browser suites.

**Process note:** in this round, a negative-control run once swapped an older `gyms.ts` into the working tree, and an interruption left it there. It was restored, byte-identical, from a saved copy, and the seven fix groups were checked present before continuing. Negative controls now use disposable copies only: the migration guard's runs used one.

### Gates (dependency order): unchanged from 2l, with these notes

- **MIG-GYM (gate 4): not approved.** Its content changed this round (the `templateExerciseId` column), so the owner's review must cover the current file. It's unapplied anywhere but the throwaway cluster.
- **GYM-ACCEPT (gate 7): not accepted.**
- **The migrate step (G1, G3) now refuses** unless the migrator owns the migration history and no other role can write it.

**Verdict: NOT READY.** The branch is ready for independent review. Owner approvals A1–A4, B2/B1b, MIG-FB, MIG-GYM, NOTICE-B, UX-01, GYM-ACCEPT, E1, C1/C2, G1, G2–G7 and the security sign-off are still open.

## 2n. Release candidate: technical remediation closed

**Code frozen at `32c3914`** on `feature/multi-gym-exercise-alternatives` (documentation commits only after it). **Technical verdict: TECHNICALLY READY.** The owner's approvals, acceptances and physical-device tests remain, in `docs/RELEASE_ACCEPTANCE.md`, the one consolidated acceptance package.

| Finding | Status | Fix commits | Evidence |
|---|---|---|---|
| 1. Machine removal vs choice | **FIXED, CLOSED** | `99c68f6`, `ebabcee` | `gyms-api` concurrency and forced lock orderings |
| 2. Swap retry with `updatePlan` | **FIXED, CLOSED** | `99c68f6`, `ebabcee` | `gyms-api` retries |
| 3. The intended plan entry | **FIXED, CLOSED** | `99c68f6`, `ebabcee`, `6e77cd8` | `gyms-api` duplicate entries, repeat workout, refusals |
| 4. Gym-name uniqueness | **FIXED, CLOSED** | `99c68f6`, `ebabcee`, `6e77cd8` | `gyms-api` concurrent spellings; gyms unit 8 |
| 5. Migration safeguards and roles | **FIXED, CLOSED** | `4926fb9`, `5c5d7d2`, `e35f76d`, `92a80f5` (with `47bc004`, `b11564c`) | `migration-safety` 8/8, `mig-04` 103/103, live S1–S9 |
| 6. Food-photo matching | **FIXED, CLOSED** | `f468dd8` | `package-match` 11; `barcode` |
| 7. CSP violations | **FIXED, CLOSED** | `a0fcb9e`, `60fbc0f` | `csp-e2e`, 3 engines, with a positive control |

**Final verification at `32c3914`:**
- the tree is clean, and local equals `origin`;
- the seven fixes are present;
- MIG-GYM regenerated from the base schema is identical to the committed file, and the migrated throwaway database has no drift from the schema;
- the guard refuses on this checkout (exit 4);
- no secrets, credentials or temporary files are tracked.

**Regression evidence, preserved** in `FitWorkoutFoodTracker-backups\diagnostics\release-candidate-32c3914\`:
- the full regression at `e35f76d`, 56/56 (summary and every suite's log);
- the earlier full regression at `5c5d7d2`, 56/56;
- the live verification scripts.

**Known limitations** (non-blocking, not fixed; listed in `RELEASE_ACCEPTANCE.md` Part 1): R1, I-1, I-2, I-3, **FM-1 (new, low follow-up)**, K-04, OPS-1 and OPS-2.

FM-1: food-photo de-duplication keeps the first of identical-looking records, so a person's own identical food is hidden from the photo's candidates; it's still in the full search.

**Process change:** the manual guide's multi-gym steps are now **MG.1 to MG.15**, so they can't be confused with the email checklist G.1 to G.6.

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
| T-27 | 4.1 | **`e2e-smoke` failed once on this branch, cause unknown.** After Finish, the URL changed to the workout's history page, and "Repeat this workout" didn't appear in 30 seconds, with nothing in the server log. Not reproduced in 22 later runs, or in 200 finishes in Chromium with responses deliberately delayed, so the timing race first suspected isn't supported. The page and logger aren't changed on this branch, and this may or may not be related to T-25. **A person could hit it, as far as is known.** `e2e-smoke` now reports what's on screen if it recurs | NOT STARTED | P2 | None | Cause found, or the owner accepts it **Didn't recur in the integration regression, or in the focused runs around it. Finishing and repeating a workout is now tested in all three browsers, with diagnostics. Accepted by the owner as a non-blocker for development integration only. It stays open until resolved, or accepted for release.** |
| T-24 | 4.1 | `weight-progress`, `weight-e2e`, and the suites that open the dashboard or delete or export an account | COMPLETE for `fitdb_test` | P1 | None | `weight-progress` 22 of 22, `weight-e2e` in Chromium, Firefox and WebKit, `account-data` 26, `account-data-e2e`, `profile-minimization` 7, `profile-nulls` 16, `profile-minimization-e2e`, `eligibility`, `account-tokens` 32. **`e2e-smoke` passes, with one unexplained failure, T-27. Focused, and not a full regression** |
| T-26 | 4.0.6 | `workout-sets`, forcing each ordering of logging a set and finishing a workout, on `fitdb_test` | COMPLETE for `fitdb_test` | P0 | None | 25 of 25 at `09f0aa4`. Docs: `PHASE_4_0_6_READINESS.md` |
| T-25 | 4.0.6 | **`e2e-smoke` failed once at `ad015f0`, cause unknown:** a 30-second wait for the password field on the emailed link's page. Not reproduced in 25 reruns, the next regression, and 420 page loads. Memory wasn't low. Nothing shows what the page displayed | NOT STARTED | P1 | None | Cause found if it recurs, as the helper now reports what the page showed. Otherwise closed by the owner **Didn't recur in the integration regression.** |
| T-09 | 4.0.1b | **Not run:** dropping a CHECK on a live database, to show T38 then fails. The owner's authorization allowed only the approved migration to change the schema | DEFERRED | P2 | Owner, if wanted | **Partly covered:** NC31a and NC31b catch a removed constraint in the migration's text, T38 shows the live constraints refuse every invalid shape, and D5 and D6 show they stop the app's own bad writes |
| T-10 | 4.0.1b, 4.0.1c | **Not run:** restoring either `fitdb_test` backup, from before 4.0.1b and 4.0.1c. Only their archive listings were read | NOT STARTED | P2 | Owner, for a restore target | Restored into a separately approved database, with row counts compared to the snapshots |

## 4. Migrations

| ID | Phase | Description | Status | Priority | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|
| MIG-01 | 4.0.1b | `20261106120000_nullable_nutrition_targets`, Git blob `62b7459`. **Applied to `fitdb_test` only,** on 2026-11-06, with owner authorization | COMPLETE for `fitdb_test` | P0 | None | `migration-verify` passed. **Not applied to `fitdb`, `fitdb_test_other` or any production database,** which each need separate approval |
| MIG-02 | 4.0.1c | `20261106130000_nullable_profile_fields`: `sex`, `heightCm`, `currentWeightKg`, `goal`, `activityLevel`, `experience`, `workoutDaysPerWeek`. **Applied to `fitdb_test` only,** on 2026-11-06, with owner authorization | COMPLETE for `fitdb_test` | P1 | None | `profile-migration-verify` passed. **Not applied to `fitdb`, `fitdb_test_other` or any production database,** which each need separate approval. **Rollback is forward-only,** as `fitdb_test` now holds null rows, Annex H6 |
| MIG-03 | 4.0.4 | `20261106140000_account_tokens`, blob `8c1e6ca`: `AccountToken` and its enum, and nullable `User.termsVersion` and `termsAcceptedAt`. Additive. **Applied to `fitdb_test` only,** on 2026-11-06, with owner authorization | COMPLETE for `fitdb_test` | P0 | None | Preflight, backup and verification passed, section 2d. **Not applied to `fitdb` or anywhere else. `fitdb` needs its own decision and backup, after B-07 and C-08** |
| MIG-04 | 4.1 | `20261106150000_body_metrics`, blob `30a8dac`: `BodyMetric` and its enum. Additive. **Applied to `fitdb_test` only,** on 2026-11-07 UTC, with the owner's written authorization. Checked with no database beforehand: it directly follows MIG-03, depends on nothing MIG-03 made, and equals what Prisma generates from the schema change. Replaying all eight from empty isn't checked, as it needs a shadow database | COMPLETE for `fitdb_test` | P1 | None | Verified: 8 applied, MIG-04 last with the reviewed checksum, schema as reviewed, no drift, every table's row count unchanged, `BodyMetric` empty, and the marker's row unchanged. **Not applied to `fitdb` or anywhere else** |

**Backup taken before applying:** `C:\Users\Aseel\FitWorkoutFoodTracker-backups\fitdb_test-pre-4.0.1b-20261106T060140Z.dump`, custom format, 859,762 bytes. `pg_dump` exited 0, and `pg_restore --list` read it. **It hasn't been restored,** so the restore itself is untested (T-10).

**Backup before MIG-03:** `C:\Users\Aseel\FitWorkoutFoodTracker-backups\fitdb_test-pre-4.0.4-20261106T192540Z.dump`, custom format, 11,711,870 bytes. `pg_dump` exited 0, and `pg_restore --list` read every table and `_prisma_migrations`. **It hasn't been restored,** T-10.

**Backup before MIG-04:** `C:\Users\Aseel\FitWorkoutFoodTracker-backups\fitdb_test-pre-mig-04-20261107T041003Z.dump`, custom format, 12,264,894 bytes. `pg_dump` exited 0, and each of the 16 tables' row counts read from the archive equalled the database's. **It hasn't been restored,** T-10.

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
| S-07 | 4.0 | `POST .../sets` had no idempotency key, so a lost response could log a set twice | IN PROGRESS | P1 | K-01, R-13 | **Fixed, unmerged, on `feature/phase-4.0.6-readiness`, section 2g.** Tested on `fitdb_test` and in three browsers. A real phone's network drop is still R-13 |
| S-08 | 4.0 | Light-theme contrast defects, from the design's review | IN PROGRESS | P2 | UX-01 | **Charts fixed on `feature/ux-reliability-redesign` at `a524b44`:** the light weight trend and calorie bars were 1.2 to 1.3:1, now 5.6:1. All new tokens measured. **Left:** the design review's other items haven't been re-checked one by one, and nothing is merged |
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
| S-20 | 4.0.3, 4.0.4 | A loopback database named `fitdb_test` skips preflight's identity check, including with open registration, **though on `feature/phase-4.0.5-privacy` startup now requires its marker when the test-server flag is set.** Needs a deliberate misconfiguration. Low. **Narrowed on `feature/phase-4.0.5-privacy`:** a test server now has to confirm its database's own marker, in any mode | DEFERRED | P3 | H-01 | A `host=` redirect is now refused, at `ae5e10e`. **Left:** the marker isn't required when the flag is set. Accepted, or required |
| S-21 | 4.0.4 | Prisma's transaction limit doesn't interrupt a query waiting on a lock, so a held row could hold login, reset and change password as long | IN PROGRESS | P2 | None | **Fixed at `ae5e10e` and `e82cbd9`:** a lock limit, answering 503. Measured in section 2d: about 4 seconds, or about 8 for a queued request. **Left:** pool exhaustion under a long schema change is unmeasured, and deletion's own wait isn't limited |
| S-22 | 4.0.4 | An abandoned sign-up token holds its address until it expires and the next token is issued, as no background job exists | BLOCKED | P2 | R-06 | Covered by the retention rule. **No period is invented here.** The review rates this medium before the beta, and notes that purging already-expired rows on a timer needs no new period. Not built, as it adds a background job |
| S-23 | 4.0.4 | Throttles are in memory. At 50,000 keys, eviction can remove a `reauth:` key, and a restart clears all of them, which resets that guess limit. Low | NOT STARTED | P3 | None | Reauth keys kept apart, or accepted |
| S-24 | 4.0.4 | Development mail files hold live tokens, and are never aged out. `0o600` may not restrict them on Windows. Suites now remove theirs. Low, development only | NOT STARTED | P3 | None | Aged out, or accepted |
| S-25 | 4.0.4 | The password-changed notice isn't retried, and is lost on a restart. A full queue no longer drops it. A stalled request can also finish deletion or export after its session ends, if it has the current password, which gives nothing beyond logging in. Low | DEFERRED | P3 | None | Accepted, or fixed with a real provider, G-03 |
| S-26 | 4.0.5 | `next dev` with a local `fitdb`, on a machine others can reach, still opens registration under a draft, as `next dev` skips startup checks. Its mail stays in a local file, so nobody can finish signing up. Low | DEFERRED | P3 | None | Accepted, or a host check added |
| S-28 | 4.0.5 | One deliberate misconfiguration opens the draft gate: the test-server flag, a marked local `fitdb_test`, and no real `APP_ORIGIN`, behind a host others can reach. Addresses would be stored, and mail only reaches a local file or nowhere, so nobody could finish signing up. Low. Found in review, and the comment that overstated this is corrected | NOT STARTED | P3 | None | Test servers refuse a non-loopback Host, or the owner accepts it |
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
