# Feature inventory

**Canonical: what exists, and how far.** Verified on 2026-11-09 against the code of the release candidate (`feature/multi-gym-exercise-alternatives`; application code at `d7d278d`), not against older documents. Future and proposed features are in [ROADMAP.md](ROADMAP.md). Decisions behind them are in [DECISION_REGISTER.md](DECISION_REGISTER.md).

## Status levels

Seven levels, used everywhere in the canonical documents:

| Level | Meaning |
|---|---|
| **Proposed** | Recommended or requested, not approved |
| **Approved** | The owner approved it (a recorded statement) |
| **Implemented** | Code exists on the candidate branch |
| **Tested** | Automated tests or a CI run cover it, and passed |
| **Integrated** | On the candidate branch. **On `main` only where this file says so** (`main` ends at Phase 4.0.4) |
| **Deployed** | Running on a real server: **nothing is** |
| **Owner accepted** | The owner confirmed it after using it: **nothing is** |

### How features are counted

- One row per user-visible capability or platform property in the tables below.
- **Implemented** means code on the candidate branch at `d7d278d`, with at least one automated test or CI check, unless the row says "no test".
- **Partial** means part of the capability exists. The row says which part.
- **Not implemented** means no code.

| Area | Implemented | Partial | Not implemented |
|---|---|---|---|
| Workouts | 16 | 2 | 0 |
| Nutrition | 16 | 0 | 0 |
| Progress | 3 | 2 | 3 |
| Accounts | 10 | 1 | 0 |
| Platform | 11 | 2 | 1 |
| **Total (67 rows)** | **56** | **7** | **4** |

**None of the 67 is Deployed or Owner accepted.** Rows marked *(main)* also exist on `main` (Phase 4.0.4), possibly in an earlier form. Every other row is only on the candidate branch.

**Main sources:** `prisma/schema.prisma` (19 models, 10 migrations), `src/app` (34 pages, 56 API routes), `src/lib`, `src/components`. Tests: 71 unit files (Vitest), 33 `scripts/*.test.cjs`, 22 `scripts/e2e-*.cjs`.

## Workouts

| Feature | Status | Evidence | Tests |
|---|---|---|---|
| Built-in exercise library (47) *(main)* | Implemented, tested | `prisma/seed.ts`. Since `267a6ea` the migrate image seeds it on a fresh database (DEP-01) | `movement-patterns.test.ts`; the staging rehearsal checks for 47 |
| Custom exercises *(main)* | Implemented, tested | `Exercise.userId`, `/api/exercises` | hardening and PWA e2e (API hits) |
| Workout plans (templates) *(main)* | Implemented, tested | `/workouts/plans/*`, `plan-editor.tsx` | `e2e-hardening`, `e2e-responsive`, `staging-journey` |
| Weekly schedule *(main)* | Implemented, tested | `/workouts/schedule`, `ScheduleSlot` | as for plans |
| Sessions, sets, reps, weight *(main)* | Implemented, tested | `workout-logger.tsx`, `SetEntry`. Idempotent set logging (4.0.6) is on the candidate only | `workout-sets.test.ts`, `workout-sets.test.cjs` |
| Notes (session, exercise, plan) *(main)* | Implemented, tested | `notes` fields; the note saver from UX-01 | `note-saver.test.ts` |
| Effort rating (RPE) | **Partial** | `SetEntry.rpe` is validated (1–10) and stored through the API and plan import. **There is no input in the workout logger** | set-level unit tests only |
| Rest timer *(main)* | Implemented, **no test found** | `workout-logger.tsx` (default 90 s, ±15 s, skip) | none |
| Workout history *(main)* | Implemented, tested | `/workouts/history`, `/[id]` | `e2e-readiness`, `e2e-demo-account` |
| Progressive overload | **Partial**, by design | `src/lib/overload.ts` compares each session with the previous one (improved, same, mixed). It **doesn't prescribe the next weight** | `overload.test.ts` |
| Personal records *(main)* | Implemented, tested | `computeRecords`: heaviest, Epley e1RM (1–12 reps), most reps, best volume; computed, not stored | `overload.test.ts` |
| Exercise progress charts *(main)* | Implemented | `/progress/[exerciseId]`, Recharts | no chart-specific test |
| Gyms | Implemented, tested | `/workouts/gyms`, `GymLocation` (MIG-GYM), `WorkoutSession.gymLocationId` | `gyms.test.ts`, `gyms-api.test.cjs` (23), `e2e-gyms` |
| Gym equipment and named machines | Implemented, tested | `GymEquipment`, machine routes | as for gyms |
| Machine-specific history | Implemented, tested | `SessionExercise.gymEquipmentId`; the progress page keeps machines apart | as for gyms |
| Exercise alternatives and swaps | Implemented, tested | `movement-patterns.ts` (a reviewed table, nothing generated), the `/alternatives` and `/substitute` routes, `swap-sheet.tsx`. Completed sets are kept, and the plan is updated only when asked | `movement-patterns.test.ts`, `gyms-api`, `e2e-gyms`; demo round trip 12/12 |
| Plan import from documents (PDF, DOCX, XLSX, CSV, TXT) | Implemented, tested | `plan-import.tsx`, `src/lib/workout-import/*`. Parsed **in the browser**; only the confirmed plan is saved | `documents`/`parse` unit tests, `workout-import-api.test.cjs`, `e2e-workout-import` |
| Plan import from screenshots | Implemented, tested | `/api/workouts/import/ocr`: local OCR on the server, with no network request | `e2e-workout-import` |

## Nutrition

| Feature | Status | Evidence | Tests |
|---|---|---|---|
| USDA FoodData Central *(main)* | Implemented, tested | `foods/usda.ts`. Needs `FDC_API_KEY`, otherwise "not configured" | `clients.test.ts`, `usda-missing-nutrients`, `nutrition-api` (stubbed) |
| Open Food Facts *(main)* | Implemented, tested | `foods/openfoodfacts.ts`; the User-Agent comes from `OFF_CONTACT` | `openfoodfacts.test.ts` |
| Food search, ranking, budgets *(main)* | Implemented, tested | `foods/service.ts`, `rank.ts`, `guard.ts` (circuit breaker). UX-01 changed its behaviour (candidate) | `rank`, `search-*`, `guard`, `food-search-view` tests |
| Custom foods *(main)* | Implemented, tested | `Food.source=CUSTOM` | `custom-search.test.ts` |
| Serving sizes *(main)* | Implemented, tested | `FoodServing`, `portion-editor.tsx` | `nutrition.test.ts` |
| Barcode by entry *(main)* | Implemented, tested | `/api/foods/barcode/[code]`, check digits in `barcode.ts` | `barcode.test.ts`, `e2e-barcode` |
| **Barcode by camera** | Implemented, tested in browsers | `barcode-scan.tsx`, `barcode-detect.ts` (native detector, else zxing-wasm). Frames never leave the device | `e2e-barcode`. **Not tested on a real phone (E1)** |
| Meal types *(main)* | Implemented, tested | the `MealType` enum | `e2e-nutrition` |
| Calories and macros, daily totals *(main)* | Implemented, tested | `FoodEntry` per-100 snapshots; partial totals are marked (4.0.6) | `nutrition-api` (79), `e2e-nutrition` |
| Daily targets | Implemented, tested, **entered by the person** | Effective-dated `NutritionTarget`; carbs are the remainder. **The app computes no target**: BMR/TDEE were removed in 4.0.1 (Decision 9; `src/lib/energy.ts`) | `targets.test.ts`, `nutrition-targets` |
| Nutrition history *(main)* | Implemented, tested | `/nutrition/history`, weekly view | `e2e-nutrition`, `e2e-demo-account` |
| Nutrition label photo *(main, Phase 3 form: AI provider only)* | Implemented, tested. Off unless configured | `labels/extractor.ts`: on-server OCR (`LABEL_OCR=local`), or Anthropic. **Paid AI is refused in production** (`production-config.ts`) | label unit tests, `e2e-label-scan`, `label-local` |
| Label PDFs *(main, Phase 3 form)* | Implemented, tested | pdf.js **in the browser**; scanned pages go to on-server OCR | `pdf/*` tests, `e2e-label-pdf` |
| Meal photo identification *(main, Phase 3 form: AI provider only)* | Implemented, tested. Off unless configured | `meals/identifier.ts`: local CLIP model (`MEAL_RECOGNITION=local`, baked into the image) or Anthropic. **Food names only, never amounts or values** | meal unit tests, `e2e-meal`. G1: 1.7 s on Linux |
| Package photo, no barcode | Implemented, tested | `/api/foods/photo-text` reads the package's words, then candidates come from ordinary food search. **The photo never gives a value** | `package-text`, `package-match` tests |
| Missing nutrients stay null, never 0 | Implemented, tested | nullable columns throughout (a CLAUDE.md principle) | `missing-nutrients`, `usda-missing-nutrients`, `profile-nulls` |

## Progress

| Feature | Status | Evidence | Tests |
|---|---|---|---|
| Body-weight log | Implemented, tested | `/progress/weight`, `BodyMetric` (WEIGHT only; MIG-04), one entry a day | `weight-progress` (22), `e2e-weight` |
| Weight trend | Implemented, tested | `weight-trend.ts` (EWMA, 10-day time constant). J-05 (the method) is still an open owner decision | `weight-progress.test.ts` |
| Dashboard | Implemented, tested | today's plan, the week, recent records, the goal card | `e2e-smoke`, `e2e-demo-account` |
| Goals | **Partial** | `Profile.goal` and `goalWeightKg`, and a qualitative goal card (no predicted date, no percentage). J-04 (is a goal required?) is open | `weight-progress.test.ts` |
| Weekly summaries | **Partial** | the dashboard's week counts (`getWeekStats`). **No summary page or report** | none |
| Body measurements | Not implemented | `BodyMetricKind` holds WEIGHT only | — |
| Recovery and sleep | Not implemented | no model or route | — |
| Progress photos | Not implemented | no model or storage (images are never stored, by design) | — |

## Accounts

| Feature | Status | Evidence | Tests |
|---|---|---|---|
| Registration, link-first *(main)* | Implemented, tested. **Closed on any real deployment** | `production-config.ts` `noticeGateOpen` (closed while the notice is a draft) and `REGISTRATION_ALLOWLIST` | `register` route test, `production-security` |
| Email proof (the sign-up link is the verification) *(main)* | Implemented, tested against a stand-in | `AccountToken` (SHA-256), one use, 24 h. **No real email has ever been sent** (C1/C2) | `account-tokens` (32) |
| Login and logout *(main)* | Implemented, tested | Argon2id; server sessions (SHA-256 of a 256-bit token) | `login` route test (55), `e2e-smoke` |
| Password reset *(main)* | Implemented, tested against a stand-in | 60-minute single-use link | `account-tokens` |
| Password change *(main)* | Implemented, tested | `/api/account/password`; ends other sessions | `e2e-account-data`; rotated the demo password 2026-11-09 |
| Profile and onboarding *(main)* | Implemented, tested | most fields optional (4.0.1c) | `profile-*` tests |
| Adults only (18+) *(main)* | Implemented, tested | `eligibility.ts`; a restricted account can still export and delete | `eligibility.test.ts`, `e2e-eligibility` |
| Data export *(main)* | Implemented, tested | password required, JSON. **At most 50,000 rows, one at a time** (EXP-01) | `account-data` (26), `e2e-account-data`, G1 |
| Account deletion *(main)* | Implemented, tested | password required, immediate | `account-data`, `privacy-cleanup` |
| Privacy notice and consent record | **Partial** | `/privacy` and `/terms` render `draft-2026-11-08`, with `[TO CONFIRM]` gaps. Acceptance is recorded at sign-up. **No final notice** (NOTICE-B) | `data-inventory.test.ts`, `privacy-consent`, `e2e-privacy` |
| In-app feedback and admin review | Implemented, tested | `/feedback`; `/admin/feedback` (admins from `ADMIN_USER_IDS`); redacted export (MIG-FB) | `feedback.test.ts`, `feedback-api` (8) |

## Platform

| Feature | Status | Evidence | Tests |
|---|---|---|---|
| Responsive layout and the Slate & Mist design (UX-01) | Implemented, tested | mobile-first shell, `bottom-nav.tsx` | `e2e-responsive` (13 views × 4 widths × 2 themes) |
| Installable PWA | Implemented, tested in browsers | `src/app/manifest.ts`; `public/sw.js` caches static files and an offline page only. **The icons are temporary** | `pwa.test.ts`, `e2e-pwa`. **Not on a real phone** |
| Offline data use | Not implemented | the service worker never caches pages, APIs or personal data (deliberate) | — |
| Accessibility | **Partial** | ARIA and roles in 45 files, primitives in `ui.tsx`. **No audit and no screen-reader test** | none automated |
| Authentication and sessions *(main)* | Implemented, tested | `server/auth.ts`: HttpOnly, SameSite=Lax, Secure in production, 30 days | staging rehearsal checks the cookie flags |
| Authorization and per-user isolation *(main)* | Implemented, tested | the `route`, `accountRoute`, `adminRoute` and `publicRoute` wrappers; another user's records answer 404 | isolation tests in `nutrition-api`, `gyms-api` and others |
| Rate limits *(main)* | Implemented, tested. **In memory, per process** | login throttle, food-provider budgets, scan and upload allowances | login and guard tests |
| CSP and security headers *(main, extended later)* | Implemented, tested | nonce CSP, HSTS (`middleware.ts`, `security-headers.ts`), `next.config.ts` | `e2e-csp` (28 pages × 3 browsers), `smoke.sh` |
| Email transport | Implemented, tested against a stand-in | Resend over HTTPS, all-or-nothing settings | `resend.test.ts`. **Never sent for real** |
| AI providers (Anthropic) | Implemented, **refused in production** | `labels/anthropic.ts`, `meals/anthropic.ts`; the production preflight rejects any AI setting | provider unit tests |
| Image validation and on-server reading | Implemented, tested | `images/validate.ts` (sharp, re-encode, no metadata); tesseract.js; the CLIP model | validate tests, G1 6c/6d |
| Deployment (Docker, Compose, Caddy, deploy/rollback) | Implemented, tested in CI. **Not deployed** | `Dockerfile`, `deploy/**` | G1 17/17; staging rehearsal 108/108 |
| Encrypted backups and verified restore | Implemented, tested in CI. **Not deployed** | `deploy/backup.sh`, `restore.sh` (age); `scripts/restore-check.cjs` | rehearsal; B2 on the real review backup |
| Monitoring | **Partial** | `/api/health` (with a database query), the Docker health check and Caddy's. **No external monitoring or alerting** (G6) | `smoke.sh` |
