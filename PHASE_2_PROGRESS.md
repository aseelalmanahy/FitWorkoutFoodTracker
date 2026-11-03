# Phase 2 — Nutrition Tracking: Progress

_Last updated: 2026-11-03_

## 0. Repository audit (completed)

State at start of Phase 2: commit `419b4a6` (Phase 1).

| Area | Findings | Phase 2 reuse |
|---|---|---|
| Stack | Next.js 15 App Router, React 19, TS strict, Tailwind 4, Prisma 6, PostgreSQL 16, Zod 4, Recharts, Vitest | Same stack. No new runtime dependencies planned. |
| Auth | `src/lib/server/auth.ts`: DB sessions, `getCurrentUser`, `requireUser`; `requireProfile` in `src/lib/server/profile.ts` | All nutrition pages/APIs use these |
| API conventions | `route()` / `parseBody()` / `HttpError` / `notFound()` in `src/lib/server/api.ts`: origin check → auth → zod → JSON; errors `{error, details?}`; cross-user access → 404 | Reused for every endpoint |
| Validation | `src/lib/validation.ts` (shared client/server zod) | Nutrition schemas added alongside |
| Energy logic | `src/lib/energy.ts`: Mifflin-St Jeor BMR, TDEE multipliers, `suggestCalories` (capped deficit/surplus, floor) | Extended with macro targets, not replaced |
| Profile | `Profile.calorieTargetOverride` (Phase 1 manual kcal) | Used to seed the first nutrition target; target editing moves to Nutrition |
| Time | `src/lib/time.ts`: tz-aware `localParts`, `localWeekRange`, `zonedMidnight` | Local calendar dates for food entries |
| UI kit | `src/components/ui.tsx` (Button, Card, Field, Input, Select, ProgressBar, Stat, EmptyState…), bottom nav already has `/nutrition` | Reused |
| Nutrition today | `/nutrition` = placeholder showing calorie estimate only | Replaced by real dashboard |
| Tests | Vitest unit tests (26), Playwright smoke script `scripts/e2e-smoke.cjs` | Extended |
| Lint | `npm run lint` = `tsc --noEmit`. ESLint is not configured. | Same |

**Environment constraint:** the session's network policy blocks `api.nal.usda.gov`, `world.openfoodfacts.org` and `search.openfoodfacts.org`
(proxy `connect_rejected`). Live calls to these APIs therefore can't be executed here. The clients follow the documented
response formats. They are tested with unit-test payloads and, end to end, against local stub servers through the
`FDC_BASE_URL` / `OFF_BASE_URL` env overrides.

## Task checklist

| # | Task | Status |
|---|---|---|
| 1 | Prisma models: Food, FoodServing, FoodEntry, MealType, NutritionTarget, FoodSource + migration | ✅ |
| 2 | Pure nutrition logic: serving scaling, totals, macro targets, target-by-date, history aggregation + unit tests | ✅ |
| 3 | External clients: USDA FDC + Open Food Facts (search, detail, barcode), timeouts, missing values, caching + unit tests | ✅ |
| 4 | Food APIs: search (merged sources + local), resolve/cache external food, custom food, barcode, recent | ✅ |
| 5 | Nutrition target APIs: get effective target, set manual, apply suggestion, history-preserving, profile integration | ✅ |
| 6 | Food entry APIs: create/edit/delete, day summary, history | ✅ |
| 7 | UI: nutrition dashboard (date nav, targets, progress, meals, totals, edit/delete) | ✅ |
| 8 | UI: add-food flow (search, select, serving, quantity, multi-add, custom food) | ✅ |
| 9 | UI: targets editor | ✅ |
| 10 | UI: history (daily totals, weekly averages, kcal trend, protein consistency, navigation) | ✅ |
| 11 | Integration/E2E tests: auth, isolation, CRUD, totals, history, external failures (stubbed), Phase 1 regression | ✅ |
| 12 | Full checks (typecheck, unit, build, migrations), docs, final report | ✅ |

## Task log

_(appended after each task)_

### Task 1 — Database models ✅
- Modified `prisma/schema.prisma`: enums `FoodSource`, `BasisUnit`, `MealType`, `TargetSource`; models `Food`, `FoodServing`, `FoodEntry`, `NutritionTarget`; back-relations on `User`.
- Created migration `prisma/migrations/20261103164718_nutrition/` (4 tables).
- Design: nutrients are `Decimal` (exact), stored per 100 g/ml with NULL = not reported. `Food @@unique([source, sourceId])` prevents duplicate cached foods. Entries snapshot per-100 nutrition so history doesn't change when a cached food is refreshed. Targets are effective-dated (`@@unique([userId, effectiveFrom])`).
- Tests: `prisma migrate dev` applied ✅; `tsc --noEmit` ✅; existing 26 unit tests ✅ (no Phase 1 regression).

### Task 2 — Pure nutrition logic ✅
- Created `src/lib/nutrition.ts`: serving scaling (`entryNutrients`), totals with incomplete-nutrient flags, `remaining` (over-target is reported as `over`, never as negative remaining), capped progress, ISO calendar-date helpers, `targetForDate` (effective-dated), `carbsFromRemainder`, `summarizePeriod` (averages over logged days, protein consistency ≥ 90 % of target, historical per-day targets).
- Modified `src/lib/energy.ts` (additive only): `suggestMacros`. Protein 1.6 g/kg (2.0 g/kg for fat loss, goal-weight reference). Fat 25 % of energy with a floor of 0.5 g/kg. Carbs are the remainder. Guaranteed 4P+4C+9F ≤ kcal, within 4 kcal.
- Created `src/lib/nutrition.test.ts` (22 tests).
- Tests: `vitest run` → 48/48 passed ✅; `tsc` ✅.

### Task 3 — External food clients ✅
- Created `src/lib/server/foods/types.ts` (normalised food shape, `ExternalFoodError`, safe number parsing), `http.ts` (fetch with timeout and error mapping, TTL cache), `usda.ts`, `openfoodfacts.ts`.
- USDA: generic data types only (Foundation, SR Legacy, Survey) to avoid duplicating OFF packaged foods. The key is sent in the `X-Api-Key` header (never in URLs). Nutrients are mapped by FDC nutrient id with unit checks (kJ energy ignored) and Atwater-energy fallback. Portions and household measures become servings.
- OFF: full-text search (`/cgi/search.pl`) and barcode product lookup (`/api/v2/product/{code}`). The identifying User-Agent is configurable. g/ml basis. Exact kJ→kcal conversion only when kcal is absent. Unnamed products are dropped.
- Missing values are kept as `null` and never set to 0. Searches are cached in memory for 10 min per query.
- Modified `vitest.config.ts`: alias `server-only` to a stub so server modules are unit-testable.
- Created `src/lib/server/foods/clients.test.ts` (17 tests: normalisation, missing values, kJ, ml basis, header auth, cache, empty results, not-configured, timeout, HTTP 500/429, invalid body, network failure, barcode found/not-found/invalid).
- Tests: `vitest run` → 65/65 passed ✅; `tsc` ✅. **Live API calls not executed** (network policy blocks the hosts).

### Task 4 — Food service & APIs ✅
- Created `src/lib/server/foods/service.ts`: DTO mapping (Decimal→number), `upsertExternalFood` (dedupe on `source+sourceId`, servings replaced in a transaction), `resolveExternalFood` (30-day cache, falls back to the cached copy if a refresh fails), merged `searchFoods` (custom + USDA + OFF in parallel, per-source errors, barcode-style queries routed to the OFF product lookup, cached-food ids attached), `recentFoods`.
- Created routes: `GET /api/foods/search`, `POST /api/foods/resolve`, `GET /api/foods/barcode/[code]`, `GET /api/foods/recent`, `GET|POST /api/foods` (custom foods, entered per serving and stored per 100), `GET|DELETE /api/foods/[id]`.
- Modified `src/lib/validation.ts` (additive): nutrition zod schemas.
- Created `scripts/stub-food-apis.cjs`: local server returning documented FDC/OFF response shapes (plus `timeout` and `error` triggers) for automated tests.
- Tests (manual curl against dev server + stub): search ✅, source error isolation (`errors[]` with 200) ✅, barcode query ✅, resolve + cache ✅, unknown id → 404 ✅, short query → 400 ✅, unauthenticated → 401 ✅. Automated coverage follows in Task 11.

### Task 5 — Nutrition targets ✅
- Created `src/lib/server/nutrition/targets.ts`: `getTargets` seeds the initial target lazily from the profile (the Phase 1 `calorieTargetOverride` → MANUAL, otherwise the suggestion → SUGGESTED), starting at the earliest logged day. Also `setManualTarget` (carbs derived from the remainder; protein+fat energy over the kcal target → 400), `applySuggestion`, and `syncSuggestedTarget` (on profile change, only SUGGESTED targets follow; MANUAL targets are never overwritten). Changes upsert a row effective **today**, so past days keep their target.
- Created routes `GET|PUT /api/nutrition/targets`, `POST /api/nutrition/targets/suggestion`.
- Modified `src/app/api/profile/route.ts` (one call added: `syncSuggestedTarget` after save).
- Tests (curl): seeded target ✅, inconsistent manual target → 400 ✅, manual target with derived carbs (2300/160/70 → 257 g) ✅.

### Task 6 — Food entries, day summary, history ✅
- Created `src/lib/server/nutrition/entries.ts` and `src/lib/server/nutrition/profile.ts`. Entries snapshot per-100 nutrition and recompute from that snapshot on edit. Raw g/ml logging uses `servingId: null`. A serving must belong to the entry's food. Dates are limited to 2000-01-01 … tomorrow (local). Ownership uses `where: {id, userId}` (other users get 404).
- `daySummary`: meals (breakfast/lunch/dinner/snacks) with per-meal totals, day totals with incomplete flags, that day's historical target, remaining/over and progress.
- `history`: SQL `groupBy` per date with each day's own target, plus `summarizePeriod`.
- Created routes `POST /api/nutrition/entries`, `PATCH|DELETE /api/nutrition/entries/[id]`, `GET /api/nutrition/day`, `GET /api/nutrition/history`.
- Tests (curl): 1.5 × 100 g banana = 133.5 kcal ✅; edit to 200 g raw + meal change = 178 kcal ✅; day totals/remaining ✅; history average ✅; delete 200 then 404 ✅.

### Tasks 7–10 — UI ✅
- Created components in `src/components/nutrition/`: `macro-bar.tsx` (bar capped at 100 %, explicit "over target" state), `date-nav.tsx`, `sheet.tsx`, `portion-editor.tsx` (serving/grams/quantity/meal with live preview; missing values shown as "—" and not counted as 0), `meal-list.tsx` (meal groups, per-entry contributions, edit/delete sheet), `food-search.tsx` (debounced search, source filters, recent foods, grouped results with attribution, incomplete/no-data badges, per-source errors, multi-add, custom-food form), `targets-editor.tsx` (carbs derived, energy check shown, apply suggestion), `history-charts.tsx`.
- Created pages: `/nutrition` (replaced the Phase 1 placeholder with the dashboard), `/nutrition/add`, `/nutrition/targets`, `/nutrition/history`.
- Modified `src/components/profile/profile-form.tsx`: removed the Phase 1 calorie-override checkbox (targets are now managed in one place, Nutrition → Targets) and added a link there. The stored override is preserved and used to seed the first target.
- Modified `src/lib/nutrition.ts` (additive): display formatters, `relativeDayLabel`.
- Created `scripts/e2e-nutrition.cjs` (Playwright).
- Tests: `e2e-nutrition.cjs` against the **production build** + stub APIs → **ALL UI CHECKS PASSED**. Covers: targets, search → select → add, serving change (1.5 × 100 g), multiple foods across meals, raw grams, OFF packaged food, incomplete badge, source-error message, custom food, totals (764 kcal / 84.6 g P), edit (→ 599), delete (→ 518.5 shown as 519), over-target display without negative remaining, previous-day navigation, weekly averages, week navigation, Phase 1 workouts page. No browser console errors.
- Fixes from visual review: an empty-results message when sources fail, and a "days so far" label in the current week.
- Note: the first run failed because the Next.js **dev** indicator overlapped the sheet's Delete button. Running against a production build resolved it (not an app bug).

### Task 11 — Integration & E2E tests ✅
- Created `scripts/nutrition-api.test.cjs` (node:test, 21 tests, real server + PostgreSQL + Prisma checks). Covers: auth required on all 14 nutrition endpoints; cross-origin rejection; merged search with source ids; validation; empty results; barcode queries; per-source HTTP failure isolation; timeouts (bounded < 12 s); missing values kept null; cache dedupe across users; targets (seeding, manual, derived carbs, inconsistency → 400); manual targets survive profile changes; suggested targets follow profile changes; entry scaling (1.5 × 100 g = 133.5 kcal; 2 × 15 g Nutella = 161.7 kcal; 37 g = 32.93 kcal); entry validation; day/macro totals with meal grouping; edit recompute; snapshot stability when the cached food changes; over-target; **user isolation** (B can't read, search, log, edit or delete A's foods or entries; B's day/history/targets/recent are unaffected); historical reporting with per-day targets; delete; custom-food deletion keeps the entry snapshot.
- Added npm scripts `test:api`, `test:e2e`, `stub:food-apis`.
- Results (production build on :3200, stub APIs on :4010): `node --test scripts/nutrition-api.test.cjs` → **21/21 pass** (one test-setup bug fixed first: the test moved the only target row). `e2e-nutrition.cjs` → **ALL UI CHECKS PASSED**. Phase 1 regression `e2e-smoke.cjs` → same results as the Phase 1 baseline (badges Improved/Improved/Down, 5 PRs, isolation 404s, no browser errors).
- Observed: running the API tests then the smoke test from one IP hits the Phase 1 registration throttle (10/15 min → 429). This is expected behaviour, and the server was restarted between suites.

### Task 12 — Full checks & docs ✅
| Check | Command | Result |
|---|---|---|
| Type check / lint | `npm run lint` (`tsc --noEmit`; the project has no ESLint) | ✅ no errors |
| Unit tests | `npx vitest run` | ✅ 5 files, **65/65** passed (26 Phase 1 + 39 Phase 2) |
| Production build | `npx next build` | ✅ compiled successfully |
| Migrations, fresh DB | `prisma migrate deploy` on an empty database + seed | ✅ 3 migrations applied; seed ok |
| Schema drift | `prisma migrate diff --from-migrations … --to-schema-datamodel …` | ✅ "No difference detected" |
| API integration | `node --test scripts/nutrition-api.test.cjs` (final build) | ✅ **21/21** |
| Nutrition UI E2E | `node scripts/e2e-nutrition.cjs` (final build) | ✅ ALL UI CHECKS PASSED |
| Phase 1 regression | `node scripts/e2e-smoke.cjs` (final build) | ✅ same outcome as the Phase 1 baseline, no browser errors |

- Docs updated: `README.md`, `docs/ARCHITECTURE.md`, `.env.example`.

## Known issues / not done
1. **Live USDA / Open Food Facts calls were not executed.** This environment's network policy blocks `api.nal.usda.gov`, `world.openfoodfacts.org` and `search.openfoodfacts.org`. The clients were built to the documented formats and tested with mocked fetch and a local stub only. Verify against the live APIs with a real `FDC_API_KEY` before release.
2. Open Food Facts full-text search uses the legacy `/cgi/search.pl` endpoint, which OFF rate-limits strictly (search requests per minute per IP). Results are cached in memory for 10 minutes. A shared cache (DB/Redis) is advisable for multi-instance deployments.
3. Search-result cache and the Phase 1 rate limiter are in-memory (single instance).
4. Barcode support covers lookup by typed number (`/api/foods/barcode/[code]` and digit queries). Camera scanning isn't built, though the data model and endpoint support it.
5. Not in Phase 2 scope (unchanged): favourite meals, adaptive calorie adjustment from weight trend, and all AI features.
6. `npm audit`: the pre-existing `deepmerge-ts` advisory in the Prisma CLI (dev-time only) is still present. No new dependencies were added in Phase 2.

---

# Phase 2.1 — Stabilization & verification pass (2026-11-03)

Scope: stabilization only. No Phase 3 work and no feature rewrites.

## Fixed
| # | Issue | Fix |
|---|---|---|
| 1 | E2E scripts `require('playwright')` but Playwright wasn't a project dependency. It only resolved via a machine-global `NODE_PATH` (`/opt/node-tools`). | Added `playwright@1.63.0` (exact pin, matching the pre-installed Chromium build `chromium-1243`) to `devDependencies`. `package-lock.json` updated by `npm install`. Verified with `rm -rf node_modules && npm ci`, then running with `NODE_PATH` unset: it resolves `./node_modules/playwright` 1.63.0. |
| 2 | `scripts/e2e-smoke.cjs` (Phase 1) printed results but asserted nothing, so it exited 0 even on wrong results. | Added `node:assert` checks (login redirect, overload badges Improved/Improved/Down, 5 PRs, headlines, 200/404/404 isolation codes, no browser errors). The test is stricter, not weaker. |
| 3 | Local dev DB contained USDA/OFF food rows written by the **stub** during earlier test runs. The 30-day food cache would have served this stub data under real source ids. | Purged 3 stub-derived external food rows and 38 `@test.dev` test accounts from the local dev DB (all users were test accounts). Created a dedicated `fitdb_test` database for the suites, and the README now requires a separate test DB. |

## Regression tests added (no bug found)
- `recent foods stay distinct and complete when one food is logged many times`: guards against `distinct` + `take` dropping foods. It passed without code changes.
- `concurrent first requests seed exactly one target`: 8 parallel first requests → all 200, exactly 1 target row. It passed without code changes.

## Verification results (all executed in this pass)
| Check | Command | Result |
|---|---|---|
| Clean install | `rm -rf node_modules .next && npm ci` | ✅ completed; Prisma client generated |
| Type check | `npm run lint` (= `tsc --noEmit`) | ✅ exit 0 |
| ESLint | — | ⚠️ not configured in this project (no ESLint dependency or config). `npm run lint` is type-check only. Not added in a stabilization pass. |
| Unit tests | `npx vitest run` | ✅ 5 files, 65/65 |
| Production build | `npm run build` | ✅ exit 0, "Compiled successfully" |
| Migration status (dev DB) | `npx prisma migrate status` | ✅ "Database schema is up to date!" |
| Migrations on an empty DB | `prisma migrate deploy` + `db seed` on new `fitdb_fresh` | ✅ 3 migrations applied, seed ok |
| Schema drift | `prisma migrate diff --from-migrations … --to-schema-datamodel … --exit-code` | ✅ "No difference detected.", exit 0 |
| API integration (stub, test DB) | `node --test scripts/nutrition-api.test.cjs` | ✅ 23/23 (21 existing + 2 new) |
| Phase 2 UI E2E (stub, test DB, clean install, no NODE_PATH) | `node scripts/e2e-nutrition.cjs` | ✅ exit 0, 13 steps, "ALL UI CHECKS PASSED" |
| Phase 1 E2E (assertions added) | `node scripts/e2e-smoke.cjs` | ✅ exit 0, "ALL PHASE 1 CHECKS PASSED" |
| Dev DB untouched by suites | `SELECT count(*) FROM "User"` on `fitdb` after the runs | ✅ 0 |
| Real configuration, no stub (actual `.env`, real OFF URL) | curl against `next start` | ✅ graceful degradation: search → 200 with `errors: [USDA not_configured, OFF network]` in < 50 ms; barcode → 200 + OFF network error; uncached resolve → 502 `{source, kind: "network"}`; cached food still resolves |
| npm audit | `npm audit` | Unchanged: only the pre-existing `deepmerge-ts` (Prisma CLI) advisory. Playwright adds none. |

## NOT verified
- **Live USDA FoodData Central and Open Food Facts.** No live search, barcode lookup, live missing-value handling, live timeouts or live API failures could be run:
  1. The environment's egress proxy refuses CONNECT to `api.nal.usda.gov`, `world.openfoodfacts.org` and `search.openfoodfacts.org` (HTTP 403, `connect_rejected`), confirmed again in this pass.
  2. `FDC_API_KEY` is empty in `.env`. No key is configured anywhere in this environment.

  Mocked/stub results are **not** proof of live behaviour. The only live-path evidence is that the app degrades correctly when the hosts are unreachable or the key is missing.

## Remaining blockers
1. Network policy: allow `api.nal.usda.gov` and `world.openfoodfacts.org` (optionally `search.openfoodfacts.org`).
2. Credential: a USDA FoodData Central API key in `FDC_API_KEY` (free: https://fdc.nal.usda.gov/api-key-signup). Optional: `OFF_CONTACT` for the OFF User-Agent.
3. Once both are in place, a live check should confirm: `GET /api/foods/search?q=banana` returns USDA results with `errors: []`; `GET /api/foods/barcode/3017624010966` returns Nutella; a USDA Foundation food maps energy via the Atwater ids; and the OFF `cgi/search.pl` endpoint still answers in the documented shape.

---

# Phase 2.2 — Live provider verification (2026-11-03)

## Live provider tests: NOT executed
Every live request was refused by the environment's egress proxy before reaching the provider. **No live request succeeded, so the live integration is NOT verified.**

| Provider | Request | Result |
|---|---|---|
| USDA FDC | `GET https://api.nal.usda.gov/fdc/v1/foods/search?query=banana&pageSize=1` | no HTTP response: proxy `CONNECT` → 403 (`connect_rejected`, latest 17:26:07Z) |
| Open Food Facts | `GET https://world.openfoodfacts.org/api/v2/product/3017624010966.json?fields=code` (barcode) | no HTTP response: proxy `CONNECT` → 403 |
| Open Food Facts | `GET https://search.openfoodfacts.org/search?q=nutella` | no HTTP response: proxy `CONNECT` → 403 |
| control | `GET https://registry.npmjs.org/` | 200 (proxy itself works) |

The USDA credential is also missing: `FDC_API_KEY` is empty in `.env` and unset in the process environment.

## Defects found and fixed
1. **Stub/foreign cache data could be served as live provider data (item 10).** Reproduced: a stub-mode server cached USDA 173944, then a server with the real configuration (no key, real hosts) returned that row with 200 from `/api/foods/resolve`.
   - Fix: nullable column `Food.origin` (migration `20261103172723_food_origin`) set on every provider fetch. Cached rows are reused (including the stale-on-outage fallback) only when the origin matches the configured endpoint. Untrusted rows are hidden from `GET /api/foods/[id]`, recent foods and search `foodId`. Logging from an untrusted id refreshes it from the configured provider first. Editing servings of an untrusted row → 409. Legacy rows (origin NULL) are refetched once.
   - Re-verified after the fix: real config → resolve 503 (not configured, not served), `GET /api/foods/{id}` 404, logging 503, recent `[]`. Existing entries keep their snapshot.
   - New integration test: `cached rows from another endpoint (e.g. a stub) are never served as provider data`.
2. **Race on first nutrition use (intermittent 409).** 8 parallel first requests → one hit a P2002 on `NutritionTarget(userId, effectiveFrom)`. The Phase 2.1 run passed only by timing. Fix: `upsertWithRetry` in `targets.ts` (the loser retries; the retry updates the winner's row). Verified 3 consecutive runs, all 200, one row. Prisma still logs the caught first attempt at error level (harmless).
3. **Hardening:** added `import "server-only"` to `usda.ts`, `openfoodfacts.ts`, `http.ts` so a client import fails the build.
   - Added `STUB_LOG=1` request logging to `scripts/stub-food-apis.cjs` (URL plus key-header *presence* only).
   - New regression test: concurrent resolves of one uncached food → one row. It passed; no defect.

## Verified locally (not live)
- **Key handling:** with a random sentinel `FDC_API_KEY`, the sentinel was absent from 74 KB of pages and API responses, `.next/static` bundles and server logs. `FDC_API_KEY` doesn't occur in client bundles. The provider received it only as the `X-Api-Key` header, never in a URL. There are no `NEXT_PUBLIC_*` variables.
- **Unavailable provider (real failure, real hosts):** search → 200 with `errors: [USDA not_configured, OPEN_FOOD_FACTS network]` in < 50 ms. Barcode → 200 with OFF network error. Uncached resolve → 502/503.
- **Isolation with one real failure:** USDA→stub, OFF→real (blocked). Search → 200 in 0.16 s with USDA results plus `OPEN_FOOD_FACTS network` error.
- **Timeouts, 429 rate limits, 5xx, invalid JSON, incomplete nutrients:** covered only by mocked unit tests and the stub. **Not verified against live providers.**

## Checks after fixes
- lint (tsc) exit 0; vitest 65/65; build exit 0
- migrate status up to date; 4 migrations apply to an empty DB; drift diff exit 0
- API integration 25/25; Phase 2 E2E passed; Phase 1 E2E passed

## Remaining blockers
1. Allow egress to `api.nal.usda.gov`, `world.openfoodfacts.org` (and `search.openfoodfacts.org` if used).
2. Provide `FDC_API_KEY` as an environment secret (not committed). Optionally set `OFF_CONTACT`.
3. Then run the live checklist: USDA search `banana` (expect SR Legacy/Foundation hits, `errors: []`); USDA Foundation food detail (Atwater energy ids 2047/2048); OFF search `nutella`; OFF barcode `3017624010966`; an OFF product lacking fiber (expect `fiber: null`); a nonexistent barcode `00000000000000` (expect empty result).

---

# Phase 2.3 — Data-integrity fixes from the Phase 2 audit (2026-11-03)

Scope: audit findings D1, D2, D4, D5 and investigation of D6. No schema change. No Phase 3 work.

| Finding | Fix | Evidence |
|---|---|---|
| **D1** Provider values unvalidated → numeric overflow 500 (reproduced: 54,000,000 kcal/100 g) | `implausibleNutrients` / `sanitizePer100` in `src/lib/nutrition.ts`: energy ≤ 950 kcal/100 (pure fat ≈ 900 + 5 %); each mass nutrient ≤ 100 g/100 g (150 g/100 ml for dense liquids); an impossible macro sum makes those macros unknown. Applied in both normalizers and again in `upsertExternalFood`. Implausible → `null` (shown as missing, food flagged incomplete). Provider serving sizes > 5000 g/ml dropped. `api.ts` maps PostgreSQL 22003 overflow to **422** as defense in depth. | Barcode `1234567890123` (stub product with that value) → 200, `kcal: null`, logged entry `kcal: null` with totals flagged incomplete |
| **D2** Custom foods unvalidated (reproduced: 12,500 kcal & 250 g protein/100 g accepted; 0.001 g serving → 500) | `customFoodSchema`: serving size 0.1–5000; `superRefine` checks the derived per-100 values with the same limits → **400** with an explanatory message | 12,500 kcal → 400; 250 g protein → 400; 0.001 g → 400 (was 500); oil at 800 kcal/100 ml still accepted |
| Entry total overflow (found while fixing D1) | `assertEntryAmount`: consumed amount ≤ 100,000 g/ml per entry, on create and edit → 400 | 5000 × 100 g → 400 |
| **D4** Backdated entry before the first target showed no target | `getTargets` extends the **first** target's `effectiveFrom` back to the earliest entry (guarded `updateMany`, idempotent). Later targets are untouched. This also repairs existing data on next read. | Past day gets the seeded target; a manual change today doesn't alter it; days before any entry still have none |
| **D5** Serving ids regenerated on every refresh | `upsertExternalFood` syncs servings in place by label: unchanged ids are kept, changed amount/order updated, new ones created, removed ones deleted. Logging with a removed serving id → **409** `{reason: "serving_removed"}`; another food's serving → 400 | Ids kept across a forced refresh; an add with a pre-refresh serving id → 200; a removed serving → 409 |
| **D6** Suspected concurrent food-creation race | **Not a real risk.** Prisma query log shows the upsert compiles to a native `INSERT … ON CONFLICT ("source","sourceId") DO UPDATE` (atomic). It row-locks the food until commit, which serializes the serving sync. No retry added. | Regression test (20 parallel creates + 20 parallel refreshes per provider) passes on the **baseline** and on the fix. 5 consecutive runs, 0 unique-key errors in the server log |

**Baseline cross-check:** the new D1, D2, entry-amount, D4 and D5 tests were run against a build of `f64575c` (git worktree, same test DB) and **failed**. D6 passed there too, confirming no race existed.

## Tests added
- Unit (`src/lib/nutrition.test.ts`, +7): real extremes accepted (oil, sugar, whey); 54,000,000 kcal rejected; 12,500 kcal / 250 g protein rejected; 950/951 boundary; impossible macro sum; ml vs g limits; negatives.
- Unit (`src/lib/server/foods/clients.test.ts`, +3): OFF 54,000,000 kcal → null with other values kept; USDA 250 g protein → null; serving sizes > 5000 dropped.
- Integration (`scripts/nutrition-api.test.cjs`, +6): D1, D2, entry-amount limit, D4, D5 (refresh during an add), D6 (heavy concurrency).
- Stub data (`scripts/stub-food-apis.cjs`): product `1234567890123` with the reproduced D1 value.

## Results (all executed)
| Check | Result |
|---|---|
| `npm run lint` (tsc) | exit 0 |
| `npx vitest run` | 5 files, **75/75** |
| `npm run build` | exit 0 |
| `node --test scripts/nutrition-api.test.cjs` (prod build, test DB, stub) | **31/31** |
| D6/concurrency tests × 5 runs (server restarted each run) | 15/15; 0 unique-key errors |
| `node scripts/e2e-nutrition.cjs` | exit 0, 13 steps, ALL UI CHECKS PASSED |
| `node scripts/e2e-smoke.cjs` (Phase 1) | exit 0, ALL PHASE 1 CHECKS PASSED |
| `prisma migrate status` (dev + test DB) | up to date |
| `prisma migrate deploy` on an empty DB | 4 migrations applied |
| `prisma migrate diff … --exit-code` / `prisma validate` | No difference (exit 0) / valid |

## Still open (from the audit, not in this task)
- D3 / S1: no per-user rate limit on provider calls.
- S2: user-facing "FDC_API_KEY missing" message.
- D7: OFF `energy_unit` fallback (needs live data).
- Live USDA/OFF verification: still blocked (egress policy + missing `FDC_API_KEY`).
