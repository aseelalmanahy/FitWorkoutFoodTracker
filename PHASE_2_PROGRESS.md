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

---

# Phase 2.4 — Provider protection and error handling (2026-11-03)

Scope: audit findings D3, S2, D7. No schema change. No Phase 3 work.

## D3 — Provider rate limiting & backoff (fixed)
New `src/lib/server/foods/guard.ts`: in-memory sliding windows, the same approach as the Phase 1 login throttle. Wired in through `guardedFetchJson` in `http.ts`, so **only requests that actually reach a provider** are charged (cached results are free). The user id flows from the search, resolve and barcode routes and from logging (`getLoggableFood`).

| Operation | Per user | Global (whole app) | Provider's published limit |
|---|---|---|---|
| USDA (search + detail) | 20/min, 150/h | 900/h | 1,000/h per api.data.gov key |
| OFF search | 4/min | 10/min | 10/min |
| OFF product (barcode / resolve) | 20/min | 90/min | 100/min |

- Per-user exhausted → `user_rate_limited` (resolve/barcode: **429** + `Retry-After`; search: per-source error with `retryAfterSec`, other sources still answer).
- Global exhausted → `unavailable` (503 + `Retry-After`).
- **Circuit breaker** per operation: a provider 429 → open for Retry-After (default 60 s), doubling on consecutive 429s, max 15 min. 3 consecutive failures (5xx/network/timeout/invalid body) → 30 s, doubling, max 5 min. A 404 or a success closes it and resets. While open: fail fast, no provider call.
- `FOOD_RATE_LIMIT_MULTIPLIER` (test-only) scales budgets for the general suites.
- **Limitation (documented in guard.ts, ARCHITECTURE, here):** state is per process. N instances → N × budget. Redis is not introduced yet.
- **UX trade-off observed:** the nutrition E2E at default limits passed, but only 4 of the session's 6 searches reached OFF. The other 2 were limited per user, and the UI showed the remaining sources. OFF's own 10/min app-wide search limit is the binding constraint.

## S2 — Configuration error handling (fixed)
- Missing `FDC_API_KEY` and provider 401/403 → client message "This food database is currently unavailable. Try again later.", client-facing kind `unavailable` (internal `not_configured` is never exposed).
- Detail logged server-side: `[foods] USDA configuration error: FDC_API_KEY is not set; USDA search is disabled` (at most once a minute), or `provider rejected the request credentials (HTTP 401)`. The key value is never logged: the sentinel-key run found 0 occurrences in logs and responses.

## D7 — OFF energy normalisation (tests added; ambiguous case blocked on live data)
Current behaviour, now pinned by tests:
1. `energy-kcal_100g` present → used as is (regardless of `energy_unit`).
2. Else `energy-kj_100g` → ÷ 4.184.
3. Else `energy_100g` with `energy_unit` "kJ" or absent → treated as kJ, ÷ 4.184.
4. Else `energy_100g` with `energy_unit` "kcal" (or "kj"/"Cal"/other) → **kcal left missing** (not guessed).

**Blocked:** whether OFF stores `energy_100g` in kJ even when `energy_unit` is "kcal" can't be confirmed without live data. Case 4 stays conservative (missing rather than possibly 4.184× wrong). Not claimed fixed.

## Tests added
- `src/lib/server/foods/guard.test.ts` (new, 15): per-user limit and retry-after, user isolation, window reset, rejected attempts not charged, USDA minute+hour caps, per-op separation, global caps (OFF 10/min, USDA 900/h), multiplier, 429 backoff with Retry-After, exponential/capped backoff, failure threshold and reset on success, 404/config not counted as failures, per-op circuits, Retry-After parsing.
- `src/lib/server/foods/clients.test.ts` (+11): S2 generic message / server-side log / once-a-minute log / key never in errors or logs (401, 403); fail-fast after 429 and after 3 failures (fetch not called); cached results free; D7 energy variants. One existing test resets the guard after its 429 case (it checks error mapping, and fail-fast is now tested separately). No assertions removed.
- `scripts/provider-protection.test.cjs` (new, 7, default budgets): OFF per-user search limit (5th never reaches provider), cached/other-provider still work, other users unaffected, global OFF cap → unavailable, product per-user limit → 429 + Retry-After (shared by barcode and resolve), provider 429 → circuit stops calls for everyone (1 provider hit), 3 provider 500s → circuit (4th not sent).
- `scripts/provider-config.test.cjs` (new, 1): server without key → generic message, 503, no key/config words in bodies, detail in server log.
- `scripts/stub-food-apis.cjs`: `STUB_LOG_FILE`, `ratelimit` → 429 Retry-After 30, barcode `0000000000500` → 500.

## Results (all executed)
| Check | Result |
|---|---|
| `npm run lint` (tsc) | exit 0 |
| `npx vitest run` | 6 files, **101/101** |
| `npm run build` | exit 0 |
| `node --test scripts/nutrition-api.test.cjs` (multiplier 100) | **31/31** |
| `node --test scripts/provider-protection.test.cjs` (default budgets) | **7/7** (first run 6/7: test used an already-cached USDA id; fixed the test to use an uncached id) |
| `node --test scripts/provider-config.test.cjs` (no key) | **1/1** (same first-run test fix) |
| Sentinel-key log scan (success, 500 ×3, 429, circuit-open paths) | 0 occurrences in logs and responses |
| `node scripts/e2e-nutrition.cjs` (multiplier 100 / default) | exit 0 / exit 0 |
| `node scripts/e2e-smoke.cjs` (Phase 1) | exit 0 |
| `prisma validate` / `migrate status` (dev, test) / fresh deploy / drift diff | valid / up to date / 4 applied / no difference |

## Remaining
- Live USDA/OFF verification still blocked (egress policy, no `FDC_API_KEY`). D7 case 4 depends on it.
- In-memory limits are single-instance (see above).

---

# Phase 2.4.1 — Circuit-breaker accounting for malformed responses (2026-11-03)

**Gap (code review):** `guardedFetchJson` recorded *success* as soon as the body parsed as JSON. The structural checks ran afterwards in the clients, so well-formed JSON with an unexpected structure **reset** the failure count instead of incrementing it, and could never open the circuit.

**Fix:** `guardedFetchJson` now takes a required `ResponseValidator`. Success is recorded only after the validator accepts the body. Otherwise an `invalid_response` failure is recorded and thrown.

| Operation | Validator | Malformed means |
|---|---|---|
| USDA search | `isUsdaSearchResponse` | not an object with a `foods` array |
| USDA detail | `isUsdaFoodResponse` | not an object with `fdcId` and a non-empty `description` |
| OFF search | `isOffSearchResponse` | not an object with a `products` array |
| OFF product | `isOffProductResponse` | not an object with `status` 0, or `status` 1 plus a `product` object |

Deliberately **not** counted:
- OFF `status: 0` (product not found): a healthy answer.
- A well-formed OFF product without a name: incomplete crowd-sourced data. It's still reported to the caller as before, but counting it would let a few incomplete products disable barcode lookup for everyone.

Budgets, schema and circuit thresholds are unchanged.

## Tests added
- `src/lib/server/foods/clients.test.ts` (+11): for each of the 4 operations, (a) 3 malformed → circuit opens, and the 4th/5th calls don't reach `fetch`; (b) 2 malformed → success → 2 malformed stays closed, and the 3rd consecutive opens it. Plus validator accept/reject tables, `status: 0` not counted, and nameless product not counted.
- `scripts/provider-malformed.test.cjs` (new, 4, fresh server, stub hit-counting): USDA detail ×3 malformed → next resolve 503, not sent. After the 30 s window, a valid search resets, then 3 malformed searches reopen it (shared across users). OFF search ×3 → 4th not sent. OFF product: 2 malformed + success + 2 malformed stays closed, the 3rd opens it, the next request is not sent.
- `scripts/stub-food-apis.cjs`: malformed triggers (`malformed` search query, USDA id 990000, OFF barcode 0000000000600) and generated never-cached valid products (barcodes `77` + 11 digits).

## Evidence that the tests detect the gap
- Unit: with the old ordering temporarily reintroduced, **8/8** new circuit tests failed. With the fix restored: 112/112.
- Integration: against a build of `697baa7` (git worktree), **0/4** passed. Against the fix: **4/4**.
- Two first-run failures were test mistakes, not code faults. Both the "success" step and the final probe used barcodes already cached in the test DB, which (correctly) are served without contacting the provider. Fixed by using generated, never-cached barcodes.

## Results (all executed)
| Check | Result |
|---|---|
| `npm run lint` (tsc) | exit 0 |
| `npx vitest run` | 6 files, **112/112** |
| `npm run build` | exit 0 |
| `provider-malformed.test.cjs` (fresh server) | **4/4** |
| `provider-protection.test.cjs` (fresh server) | **7/7** |
| `provider-config.test.cjs` (no key) | **1/1** |
| `nutrition-api.test.cjs` (multiplier 100) | **31/31** |
| `e2e-nutrition.cjs` / `e2e-smoke.cjs` | exit 0 / exit 0 |
| `prisma validate` / `migrate status` / drift diff | valid / up to date / no difference |

## Remaining limitations
- In-memory, per-process budgets and circuits (unchanged; Redis not introduced).
- USDA search and detail share one circuit (`USDA` operation), as before: malformed detail responses also pause search.
- Live USDA/OFF verification still blocked (egress policy, no `FDC_API_KEY`). Validators follow the documented response shapes only.

---

# Phase 2 — Final release-readiness verification (2026-11-03)

**Commit tested:** `7e4be426784dd1f7dfa898581ca2c888c645ae00` on `claude/ai-fitness-tracker-spec-r9uk32` (clean tree, equal to origin), plus the new test file listed below. No application code was changed.

**Conclusion: NOT READY — LIVE PROVIDER VERIFICATION BLOCKED.** No code defects remain open. Live USDA and Open Food Facts checks could not be performed.

## Environment (at time of test)
- Egress to `api.nal.usda.gov`, `world.openfoodfacts.org` and `search.openfoodfacts.org` is refused by the session proxy: `CONNECT` → 403 `connect_rejected` (latest 18:44:15Z). Control: `registry.npmjs.org` → 200.
- `FDC_API_KEY`: not set in the process environment, empty in `.env` (value never printed).
- Databases: dev `fitdb` (from `.env`) and test `fitdb_test` are separate. All suites ran against `fitdb_test`. Dev DB user count before/after: 0/0.

## 1. Verified and passed
| Check | Command | Result | Provider data |
|---|---|---|---|
| Clean install | `rm -rf node_modules .next && npm ci` | exit 0, 162 packages; Playwright 1.63.0 resolved locally | — |
| Type check | `npm run lint` (= `tsc --noEmit`) | exit 0 | — |
| ESLint | — | **not configured** (no dependency, no config) | — |
| Unit tests | `npx vitest run` | 6 files, **112/112** | mocked `fetch` |
| Production build | `npm run build` | exit 0 | — |
| Prisma validate | `npx prisma validate` | valid | — |
| Migration status | `npx prisma migrate status` (dev and test DB) | up to date / up to date | — |
| Fresh DB migration | `prisma migrate deploy` + `db seed` on new `fitdb_fresh` | 4 migrations applied, 47 exercises seeded | — |
| Schema drift | `prisma migrate diff --from-migrations … --to-schema-datamodel … --exit-code` | No difference, exit 0 | — |
| Nutrition API integration | `node --test scripts/nutrition-api.test.cjs` | **31/31** | **local stub** |
| Release workflow (new) | `node --test scripts/release-workflow.test.cjs` | **8/8** | **local stub** (USDA banana) + custom foods |
| Provider protection | `node --test scripts/provider-protection.test.cjs` (fresh server, default budgets) | **7/7** | **local stub** |
| Malformed responses | `node --test scripts/provider-malformed.test.cjs` (fresh server) | **4/4** | **local stub** |
| Provider configuration | `node --test scripts/provider-config.test.cjs` (no key) | **1/1** | **local stub** (OFF) |
| Phase 2 E2E | `node scripts/e2e-nutrition.cjs` | exit 0, 13 steps, ALL UI CHECKS PASSED | **local stub** |
| Phase 1 E2E | `node scripts/e2e-smoke.cjs` | exit 0, ALL PHASE 1 CHECKS PASSED | — |
| Secret handling | sentinel `FDC_API_KEY`; success/500/429/timeout/circuit/not-configured paths | sentinel in responses+pages (53 KB): 0; server log: 0; `.next/static`: 0; provider URLs: 0. `FDC_API_KEY` string in client bundles: 0 | **local stub** |
| Key server-side only | code inspection | read only in `src/lib/server/foods/usda.ts`; all 14 `src/lib/server` modules import `server-only`; no `NEXT_PUBLIC_*`; no client component imports server food modules | — |
| Committed secrets | `git log --all --diff-filter=A`, `git grep` for key/secret/token literals | only `.env.example` ever committed; no secret literals | — |

### Task 4 workflow coverage (all automated, against stub provider data)
1–2 search + detail/servings (release-workflow 1). 3, 5, 14 all four meals, several foods in one meal, serving scaling (release-workflow 2). 6–7 daily and per-meal totals, and remaining for kcal/protein/carbs/fat with exact values (release-workflow 3). 4 edit quantity/meal + delete (release-workflow 4; nutrition-api). 8–9 per-day history with that day's own target, weekly averages, protein consistency, 56-day trend window (release-workflow 6). 10 manual targets (release-workflow 3; nutrition-api). 11 suggested targets follow profile changes, past days keep the old suggestion (release-workflow 7). 12 backdated entries (release-workflow 5; nutrition-api D4). 13 custom-food validation (nutrition-api D2). 15 isolation of entries, custom foods and targets (release-workflow 8; nutrition-api).

### Task 5 provider protection (all automated, against stub provider data or mocked `fetch`)
Per-user limits, global budgets, Retry-After header and parsing, provider 429 handling, timeouts (8 s client timeout vs 15 s stub delay), circuit breaker (failures, 429, malformed ×3), reset on success, blocking while open (provider hit counts), cached results not consuming budget, generic configuration errors without secrets. Rate limits are unchanged.

## 2. Verified and failed
None in application code. The new `release-workflow` suite failed 2/8 on its first run because of **an error in my test expectation**, not a defect. The test set a manual target on the same day as the seeded suggestion, which (by design, one row per effective date) replaced the seed. The backdated days were then correctly covered by that first (manual) target. The expectations were corrected, and the seed and suggestion paths are still asserted (release-workflow 2 and 7). Re-run: 8/8.

## 3. Not verified
- Behaviour of the real providers' responses: normalisation of real USDA/OFF payloads, real missing-nutrient patterns, OFF `energy_unit` semantics (D7 case 4), real 429/Retry-After values, real latency and timeouts.
- Multi-instance behaviour of the in-memory limits and circuits (single instance by design).

## 4. Blocked by environment or credentials
| Required live check | Blocker |
|---|---|
| USDA search "banana", Foundation detail, Atwater energy ids (2047/2048), protein/carbs/fat, nulls, error handling | egress to `api.nal.usda.gov` refused (403); `FDC_API_KEY` not set |
| OFF search "Nutella", barcode 3017624010966, serving and nutrition normalisation, kJ-only conversion, nulls, nonexistent barcode, errors/rate limits | egress to `world.openfoodfacts.org` / `search.openfoodfacts.org` refused (403) |

To unblock: allow those hosts in the environment's network settings, and provide `FDC_API_KEY` as an environment secret.

## Files changed in this verification
- `scripts/release-workflow.test.cjs` (new): end-to-end workflow assertions with hand-computed values.
- `PHASE_2_PROGRESS.md`: this section.

## Defects
Found: none. Fixed: none (no application code changes).

---

# Phase 2.5 — Live provider verification handoff (2026-11-04)

**Code under test:** `383fca2` (no application code changes in this step).

## Status: live USDA and Open Food Facts verification is still NOT VERIFIED

The developer reports a working local setup on their Windows machine: PostgreSQL running, migrations applied, Prisma Client generated, seed done (47 exercises), app started and manually tried, and `FDC_API_KEY` in the local `.env`. That report is recorded as **user-reported**. The assistant could not observe it, because the verification session runs in a cloud container that can reach none of the following:
- **Local machine:** the project folder (DESKTOP-PLGDCGO) is on the Remote Control list but marked *not available to cloud sessions*. The likely cause is that the Claude app needs updating.
- **Key:** `FDC_API_KEY` is absent in the container (correct: the key stays local).
- **Providers:** egress to `api.nal.usda.gov`, `world.openfoodfacts.org` and `search.openfoodfacts.org` is refused by the container's proxy (403).

## Live checks still required (to be run on the developer's machine)
New script `scripts/live-provider-check.cjs` drives the running app through its own API, so it uses the existing server-side provider clients with no bypass. It never prints the key and only uses it to confirm no response contains it.

| ID | Live check |
|---|---|
| USDA-1..3 | searches "banana", "chicken breast", "white rice": results, generic data types only, plausible values |
| USDA-4 | food detail (resolve): fdcId preserved, servings incl. 100 g, nutrients numbers or null |
| USDA-5 | Foundation food: energy present (Atwater 2047/2048 path) |
| USDA-6 | missing nutrients reported as null |
| USDA-7 | invalid searches: 1-char → 400, nonsense → empty without error, unknown fdcId → 404/502 |
| OFF-1 | search "nutella" |
| OFF-2 | barcode 3017620422003: name, serving, nutrition |
| OFF-3 | nonexistent barcode → 404, barcode-style search → empty |
| OFF-4 | energy vs 4P+4C+9F sanity (kJ-only conversion stays unit-tested) |
| PROT-1 | per-user OFF search limit stops the 5th search before the provider |
| FLOW-1 | log a live USDA food with a serving → totals; edit ×2; other user 404 / sees 0; delete → 0 |
| FLOW-2 | log a live OFF product by grams; history day keeps its target |
| SEC-1 | key absent from every API response |

Run: `node --env-file=.env.test scripts/live-provider-check.cjs` with the app running against a marked local test database (see README; superseded details in the engineering review below). Report: `live-provider-report.json` (git-ignored, no secrets). Release evidence requires **LIVE VERIFICATION: PASSED** (exit 0).

**Deliberately not tested live:** provider 429s, provider outages, timeouts and malformed responses. Triggering them on purpose would mean abusing the real services. They stay covered by stub and mock tests only.

**Script safeguards** (all self-tested in the cloud container against the local stub — NOT live tests):

| Safeguard | Self-test | Result |
|---|---|---|
| Refuses a non-local `BASE_URL` | `BASE_URL=https://example.com` | REFUSED, exit 4, nothing created |
| Refuses a non-test database | `DATABASE_URL=…/fitdb` (dev DB) | REFUSED, exit 4, 0 users created |
| Can't pass with stub data (fail-closed live evidence) | server on stub, sentinel key | 14 PASS, 1 NOT RUN, but **NOT LIVE** for 4 reasons: banana 1 result; nutella 1 result; both food origins `localhost:4010`. Exit 3 |
| Cleanup after failing checks | server without USDA key | 4 FAIL, NOT LIVE; users/entries/custom foods/targets left: 0/0/0/0 |
| Cleanup after Ctrl+C | SIGINT during sign-up (×3) and after 2/6/10 passing checks (×3) | exit 130; users and entries left: 0 every time |
| Key never printed | sentinel `FDC_API_KEY` | 0 occurrences in stdout and report |
| **Server and script on different databases** | server `fitdb_test`, script `fitdb_test_other` | **REFUSED before any write, exit 4**; row counts in both DBs unchanged (regression test below) |
| Server can't prove its database | identity endpoint disabled / server unreachable | REFUSED, exit 4, no rows |
| **Missing test-database marker** | marker removed | REFUSED before any write, exit 4, 0 rows in both DBs |
| **Invalid test-database marker** | garbage value; marker naming another DB (restored copy); wrong version | REFUSED before any write, exit 4, 0 rows in both DBs |

**Defect found and fixed during this self-test:** Ctrl+C during sign-up first left 1 user behind (a sign-up request in flight completed after cleanup), and a later race let the main flow exit before the signal handler's deletion ran. Fixed: in-flight requests are tracked and awaited before deletion, no new requests start after an interrupt, and cleanup is a single shared promise. Re-tested at 6 interrupt points: 0 rows left each time. A further gap was found in review: the database guard used only the *script's* `DATABASE_URL`, so a server started with a different database would receive writes, with the mismatch noticed only afterwards.

**Fix (pre-write server database verification):** new read-only endpoint `GET /api/health/db-identity` (`src/app/api/health/db-identity/route.ts`, `src/lib/server/db-identity.ts`). It returns only `{ fingerprint }`: a SHA-256 of the connected database's name, its OID and the cluster start time (epoch seconds, independent of the session time zone). It has no auth, does no writes and never returns names or credentials, and in production builds it returns 404 unless `EXPOSE_DB_IDENTITY=1`. The script computes the same fingerprint from its own test-named database (read-only query) and refuses (exit 4) unless the server's matches. It also refuses if the endpoint is unreachable, disabled or errors. This runs before the first sign-up. The post-run mismatch check stays as defence in depth.

**Regression test** `scripts/live-provider-check.safety.test.cjs` (self-contained: own stub and app servers, counts every `User`/`Session`/`FoodEntry`/`NutritionTarget`/custom-food row in **both** databases before and after) → **5/5 pass**:
1. mismatched DBs → exit 4, "does not match", no "Verified"/PASS/Cleanup output, **0 rows created in either DB**;
2. identity endpoint disabled → exit 4, 0 rows;
3. server unreachable → exit 4, 0 rows;
4. non-test DB name / non-local `BASE_URL` → exit 4, 0 rows;
5. matching DB → "Verified before any write" printed before any check; run continues (stub → NOT LIVE, exit 3); every created row removed.

**Negative control:** with the verification call removed, test 1 **fails**. The script reached the writes, created 3 users in the server's database and exited 2 at cleanup ("Cleanup MISMATCH"). This proves the test detects the original problem. The file was restored byte-for-byte, and those 3 test users were removed from `fitdb_test`.

**Explicit test-database marker (final safety improvement):** a database name containing `test` is not treated as sufficient proof. A dedicated test database must be marked deliberately with `scripts/mark-test-database.cjs --confirm <name>`, which requires repeating the exact database name. The marker is a PostgreSQL database comment, `fitworkoutfoodtracker:test-database:v1:<database name>`. No schema change and no migration: migrations never set it, so dev and production databases can't be marked by accident. The server reports it through `GET /api/health/db-identity` (`{ fingerprint, testMarker }`, read from the server's own connection). The script refuses (exit 4, nothing written) when the marker is missing, or when it is invalid (any value other than the exact marker for this database name: garbage, a marker naming another database as in a restored copy, or a different version).

**Safety regression suite** `scripts/live-provider-check.safety.test.cjs` → **10/10 pass** (the 5 tests above plus):
6. the provisioning script refuses without the exact `--confirm` name (4 variants), and the marker is unchanged;
7. **missing marker** → endpoint reports `testMarker: null`; exit 4; no "Verified"/PASS/Cleanup output; 0 rows in either DB;
8–10. **invalid marker** (garbage / other database's marker / wrong version) → exit 4; 0 rows in either DB.

**Negative control (marker):** with only the marker checks removed from the script, tests 7–10 **all fail**. Each run passed verification, created 3 users and ran to completion (exit 3 instead of 4). The script was restored byte-for-byte. Final marker state: `fitdb_test` marked, `fitdb` and `fitdb_test_other` unmarked; 0 `live-check` users in all three.

**Residual limits of the safeguards:**
- Anyone with owner rights on a database could deliberately mark it. The marker prevents accidents, not intentional misuse.
- Live evidence relies on the server-recorded `Food.origin` host. A mock served at the real hostname (e.g. via a hosts-file override) could still defeat it.
- Cached provider foods fetched during the run stay in the test database's shared food cache (real provider data, not test records).

## Regression results in the cloud container (mocks and local stub only — not live)
| Check | Result |
|---|---|
| `npm run lint` (`tsc --noEmit`; ESLint not configured) | exit 0 |
| `npx vitest run` | 112/112 |
| `npm run build` | exit 0 |
| `prisma validate` / `migrate status` (dev, test) / drift diff | valid / up to date / no difference |
| `nutrition-api.test.cjs` | 31/31 |
| `release-workflow.test.cjs` | 8/8 |
| `provider-protection.test.cjs` | 7/7 |
| `provider-malformed.test.cjs` | 4/4 |
| `provider-config.test.cjs` | 1/1 |
| `e2e-nutrition.cjs` | passed |
| `e2e-smoke.cjs` (Phase 1) | passed |

## Release readiness
**NOT READY — LIVE PROVIDER VERIFICATION BLOCKED.** No code defects are known. Phase 2 becomes release-ready once `scripts/live-provider-check.cjs` reports **LIVE VERIFICATION: PASSED** on a machine with real network access and the real key. Any FAIL must be investigated before release.

Files changed: see the complete list at the end of the engineering review below.

# Phase 2.5 — Engineering review of the live-check and database-safety code (2026-11-04)

**Base:** `383fca2`. Every change is uncommitted in the working tree. The only artifact pushed is `PHASE_2.5_REVIEW.diff` on branch `phase-2.5-review`. `main` is unchanged.
**Scope:** every line of the Phase 2.5 files. This section supersedes the earlier safety-suite counts (5/5, 10/10) and the "no code defects are known" statement above.

**Test categories used below:**
- **STUB:** runs against `scripts/stub-food-apis.cjs` on a local port.
- **MOCK:** in-process unit tests, no network.
- **LIVE:** real USDA / Open Food Facts. **No LIVE test was run.** Live verification is still NOT VERIFIED (see "Not run").

## Issues found and fixed
| # | Issue | Fix | Regression test (category) | Negative control |
|---|---|---|---|---|
| R1 (critical) | The safety suite marked `SAFETY_DB_URL` as a test database with no validation, falling back to a default URL. Any database it was pointed at (dev, a remote host) would have been marked and then written to. `mark-test-database.cjs` checked only the `--confirm` value. | New `scripts/lib/test-db-guard.cjs`. `validateTargetUrl` requires a postgres protocol, a host of `localhost`/`127.0.0.1`/`::1`, no `host=` override, a name of `[A-Za-z0-9_]+` containing `test`, and a confirmation equal to the exact name. `assertConnectedTarget` then requires `current_database()` to equal the expected name and `inet_server_addr()` to be loopback or a local socket. Both the mark script and the suite use the guard, before connecting and again after connecting. The suite has no default URLs (`SAFETY_DB_URL`, `SAFETY_DB_CONFIRM`, `SAFETY_OTHER_DB_URL` are required), refuses in `before()` before creating any client, and re-validates before every marker write. | `test-db-guard.test.cjs` (6), against the real local PostgreSQL: unit rejections (15 bad configurations); the mark CLI refuses 9 unsafe configurations; the safety suite refuses 7 unsafe configurations. Each case is compared against a snapshot of every database comment in the cluster plus user counts in every `fitdb*` database, unchanged before and after. | (a) suite configuration check removed → suite-level test fails. (b) mark-script validation removed → CLI test fails, and the snapshot catches the change. Both restored byte-for-byte. |
| R2 | USDA-6 accepted any value (null or a number), so it proved nothing. | New `scripts/lib/usda-nutrient-oracle.cjs`. USDA-6 picks up to 4 search results, resolves each through the app, then fetches the raw USDA `/food/{id}` independently with the public `DEMO_KEY`, never the user's key. Each nutrient is classified as absent, zero or present, with the app's plausibility rules mirrored. **PASS** requires at least one genuinely absent nutrient that is null in the app, and no mismatch: absent→0, zero→null and wrong values all FAIL. **NOT RUN** (never PASS) when the oracle is unavailable or disabled, or when no example has an absent nutrient. | `missing-nutrients.test.ts` (10, MOCK); `live-check.units.test.cjs` oracle tests (6, MOCK); `usda-missing-nutrients.test.cjs` (4, STUB + local oracle): API search, detail, entry and day totals keep nulls; USDA-6 PASS on faithful data; FAIL on tampered data; NOT RUN when the oracle is down or off; the oracle receives `DEMO_KEY` only. | (c) comparison ignored → FAIL test fails. (d) absent→0 in normalization → Vitest and API tests fail. Both restored. |
| R3 | A failed provider search was counted as "0 results", which produced a false **NOT LIVE** (a contradiction) instead of missing evidence. | The verdict was extracted to `scripts/lib/live-verdict.cjs`. A failed search is reported as missing evidence → INCOMPLETE OR FAILED (exit 1). PASSED requires real-origin evidence from **both** providers, every check PASS, no NOT RUN and no early stop. | `live-check.units.test.cjs` verdict tests (5, MOCK) | (e) failed search counted as 0 → test fails. |
| R4 | Cleanup reliability: requests had no timeout, so a hung provider or server could block the run, and cleanup, forever. A request aborted client-side can still finish its write server-side after cleanup has run. | Each request gets an AbortController with a timeout (`LIVE_CHECK_REQUEST_TIMEOUT_MS`, default 60 s). Aborts are counted at the moment of abort. Cleanup awaits in-flight requests, sweeps, and if anything was aborted, sweeps again after `LIVE_CHECK_CLEANUP_GRACE_MS`. Remaining-row counts are verified (exit 2 on a mismatch). There is a single shared cleanup promise. Signals handled: SIGINT, SIGTERM, SIGHUP, SIGBREAK. | Safety suite: request TIMEOUT with a late server-side write → removed by the second sweep (STUB, through a delaying proxy); SIGTERM during a hung request → exit 130, 0 rows. | (f) second sweep removed → the late-write test fails. |
| R5 | Abort counter race: the counter was incremented after `allSettled`, so a late write could escape the second sweep. | The counter is now incremented in the timer callback and in the interrupt-abort loop. | Covered by the R4 tests. | Covered by (f). |
| R6 | Credential exposure: errors from Prisma or the guard could include the `DATABASE_URL` password, in output and in the report file. | `out`/`err` and the JSON report redact the API key plus the URL password, in both encoded and decoded forms. `mark-test-database.cjs` redacts as well. | `test-db-guard.test.cjs`: a wrong password equal to the database name must not appear on the normal output path or the error path; plus a redaction unit test. | (k-err) and (k-out): removing either path's redaction → test fails. The first version of this test was too weak and missed (k-err); it was strengthened. |
| R7 | `.gitignore` ignored only `.env` and `.env.local`. `.env.test` (which the README tells users to create, and which holds a DB password) and `.env.production` could have been committed. | `.env`, `.env.*`, `!.env.example`, plus `live-provider-report.json`. | `live-check.units.test.cjs` hygiene test (`git check-ignore`). | The test failed against the old `.gitignore`. |
| R8 | The unauthenticated `GET /api/health/db-identity` echoed **any** database comment verbatim, an information leak. | Only marker-family values (≤200 chars) are echoed; any other comment is reported as `"<non-marker comment>"`. The script still refuses on it. | Safety suite test 8 (garbage marker) asserts the endpoint returns `"<non-marker comment>"` and that the run exits 4. | Raw echo restored and rebuilt → test 8 fails (11/12); restored (checksum OK) and rebuilt → 12/12. |
| R9 | Test reliability: a nested `node --test` inherited `NODE_TEST_CONTEXT` and exited 0 even on failure, so suite-level assertions could silently pass. Fixed ports (3300/4010) could collide; `npx next` and POSIX-only kills don't work on Windows; a foreign server on the port could be mistaken for ours. | New `scripts/lib/test-servers.cjs`: removes `NODE_TEST_CONTEXT`/`NODE_PATH`; uses free ports with an in-use check; launches `node node_modules/next/dist/bin/next`; kills process groups on POSIX and uses `taskkill /T /F` on Windows; readiness fails fast if our child exits; all children are killed on exit and on signals. | Every STUB suite uses it; the leftover-process check after the runs found none. | The `NODE_TEST_CONTEXT` effect was observed directly (a failing child reported exit 0). The Windows paths could not be exercised here. |
| R10 | Test bug: the delaying proxy could lose the request body after a client abort. | The body is buffered on `end`, then forwarded. | Safety-suite timeout test. | — |
| R11 | OFF-3's "nonexistent" barcode `0000000000017` has a valid EAN-13 check digit, so a real product could carry it. | `0000000000018` (invalid check digit). | Runs in safety test 5 (STUB). Real-provider behaviour is unverified (LIVE). | — |
| R12 | PROT-1 reported PASS/FAIL when the limit could not be exercised. | Reports NOT RUN, which blocks PASSED. | Verdict unit test (NOT RUN blocks PASSED). | — |
| R13 | FLOW-1 checked only that another user can't read an entry, not that they can't delete it. | Adds the other user's DELETE → must be 404. | Runs in safety test 5 (STUB). | — |
| R14 | README: an unparseable `<test env>` placeholder; a contradictory ".env same as server" instruction; env vars that applied only to `npm run build`, not the server; the dev password literal; a stale test count (21 → 31). | Rewritten with the `.env.test` workflow, PowerShell and bash commands, `USER:PASSWORD` placeholders, the Node ≥20.6 requirement, and the safety-suite commands. | Manual review; grep: no password literal, no `<test env>`, no `(21)`. | — |

## Regression run (this review; after the final rebuild)
| Command | Category | Result |
|---|---|---|
| `npm run lint` (`tsc --noEmit`; ESLint is not configured) | — | exit 0 |
| `npx vitest run` | MOCK | 7 files, **122/122** |
| `npm run build` | — | exit 0 |
| `prisma validate`; `migrate status` (fitdb, fitdb_test, fitdb_test_other); `migrate diff --from-schema-datasource --exit-code` (fitdb, fitdb_test) | — | valid; up to date ×3; no drift ×2 |
| `node --test scripts/nutrition-api.test.cjs` | STUB | **31/31** |
| `node --test scripts/release-workflow.test.cjs` | STUB | **8/8** |
| `node --test scripts/provider-protection.test.cjs` (default budgets) | STUB | **7/7** |
| `node --test scripts/provider-malformed.test.cjs` | STUB | **4/4** |
| `node --test scripts/provider-config.test.cjs` (no key) | STUB | **1/1** |
| `node --test scripts/live-check.units.test.cjs` | MOCK | **12/12** |
| `node --test scripts/test-db-guard.test.cjs` | real local PostgreSQL | **6/6** |
| `node --test scripts/live-provider-check.safety.test.cjs` | STUB + real local PostgreSQL | **12/12** |
| `node --test scripts/usda-missing-nutrients.test.cjs` | STUB + local oracle | **4/4** |
| `node scripts/e2e-nutrition.cjs` | STUB (Playwright) | ALL UI CHECKS PASSED |
| `node scripts/e2e-smoke.cjs` (Phase 1) | Playwright | ALL PHASE 1 CHECKS PASSED |

The first nutrition-api run gave 30/31. The failure was in my runner, not the app: the test reads `FDC_BASE_URL` in its own process and the runner hadn't passed it. With it passed, the suite gave 31/31.

Database state after the runs: `fitdb_test` marked; `fitdb` and `fitdb_test_other` unmarked; 0 live-check or missing-nutrients users in `fitdb` and `fitdb_test`; no leftover server processes.

## Not run
- **LIVE USDA / Open Food Facts:** the container's proxy blocks both providers (403) and `FDC_API_KEY` is not present. The live check, including the real USDA-6 oracle against `api.nal.usda.gov` with `DEMO_KEY`, must run on the developer's machine.
- **Windows-specific paths** (`taskkill`, SIGBREAK, PowerShell commands): no Windows host was reachable. The SIGTERM test is skipped on win32 by design.
- **USDA-6's "no absent-nutrient example → NOT RUN" branch** is not covered end to end, only by reading the code.

## Risks and limitations
- Whether real USDA search results contain a food with a genuinely absent nutrient is unknown until a live run. If none does, USDA-6 is NOT RUN, which blocks PASSED.
- The oracle uses `DEMO_KEY`, which USDA rate-limits heavily per IP. Exhausting it gives NOT RUN, never a false PASS.
- The marker prevents accidents, not deliberate misuse by a database owner.
- Live evidence relies on the server-recorded `Food.origin` host. A mock served at the real hostname (a hosts-file override) is not detected.
- "Local" means loopback or a local socket. A local PostgreSQL that proxies to a remote server would pass the address check.

## Release readiness
**NOT APPROVED. NOT READY: LIVE PROVIDER VERIFICATION BLOCKED.** The stub and mock suites passing doesn't prove the provider integration works. Release evidence still requires `LIVE VERIFICATION: PASSED` from `scripts/live-provider-check.cjs` on a machine with real network access and the real key.

## Files changed vs `383fca2`
- **New:** `scripts/live-provider-check.cjs`, `scripts/live-provider-check.safety.test.cjs`, `scripts/mark-test-database.cjs`, `scripts/lib/test-db-guard.cjs`, `scripts/lib/live-verdict.cjs`, `scripts/lib/usda-nutrient-oracle.cjs`, `scripts/lib/test-servers.cjs`, `scripts/test-db-guard.test.cjs`, `scripts/live-check.units.test.cjs`, `scripts/usda-missing-nutrients.test.cjs`, `src/app/api/health/db-identity/route.ts`, `src/lib/server/db-identity.ts`, `src/lib/server/foods/missing-nutrients.test.ts`.
- **Modified:** `.gitignore`, `README.md`, `PHASE_2_PROGRESS.md`.

# Phase 2.5 — Live verification status update (2026-11-04)

## Status: Phase 2.5 live verification is INCOMPLETE. It has not passed.

The live check has **not** been rerun since the script changes below, so those changes are not yet verified against the real providers.

## Latest full live-check run (before the script changes)
Report time 2026-11-04 19:12 UTC, against the local `fitdb_test` database. Verdict: `INCOMPLETE OR FAILED`. **11 passed, 2 failed, 2 not run.**

| Result | Checks |
|---|---|
| Passed (11) | USDA-1 to USDA-7 (all seven USDA checks), OFF-1, OFF-3, FLOW-1, SEC-1 |
| Failed (2) | OFF-2, PROT-1 |
| Not run (2) | OFF-4, FLOW-2 |

## Remaining findings
- **OFF-2:** the old Nutella barcode `3017624010966` returned 404, which left no Open Food Facts product for the checks that depend on it.
- **PROT-1:** recorded as FAIL with `first 4: http,ok,ok,ok`, but the result was inconclusive because of a provider error. The check stopped before judging the 5th search, so the per-user limit was not verified live.
- **OFF-4 and FLOW-2:** did not run because they depend on the OFF-2 product.

## Changes since that run
- **Replacement barcode:** one direct read-only Open Food Facts request confirmed that `3017620422003` returns Nutella (539 kcal per 100 g).
- **`scripts/live-provider-check.cjs`:** OFF-2 now uses `3017620422003`.
- **PROT-1 verdict logic:** revised in `scripts/live-provider-check.cjs` and `scripts/lib/live-verdict.cjs`, with new tests in `scripts/live-check.units.test.cjs`. A provider error among the first four searches is now context. PASS requires the 5th search to get `user_rate_limited` from the app's guard. Outcomes that can't separate the local limit from an upstream or app failure report NOT RUN.
- **Unit tests:** `node --test scripts/live-check.units.test.cjs` passed 17/17. These tests don't exercise the real providers.
- **Scope:** no application code changed in this script update. The old barcode stays in the stub fixtures and historical test records.
- **Git:** nothing is staged or committed.

## Next step
Rerun `node --env-file=.env.test scripts/live-provider-check.cjs` against the marked local test database. Phase 2.5 live verification can only be recorded as passed if that run reports `LIVE VERIFICATION: PASSED`.

# Phase 2.5 — Live run and USDA diagnostic status (2026-11-04)

This section supersedes the earlier status above as the current state. Earlier sections stay as the historical record.

## Status: Phase 2.5 live verification is INCOMPLETE. It has not passed, and the cause of the USDA HTTP 400 is unknown.

## Latest live-check run
Report time 2026-11-04 19:29 UTC, against the local `fitdb_test` database. Verdict: `INCOMPLETE OR FAILED`. **13 passed, 2 failed, 0 not run.**

| Result | Checks |
|---|---|
| Passed (13) | USDA-1, USDA-3, USDA-4, USDA-5, USDA-6, OFF-1, OFF-2, OFF-3, OFF-4, PROT-1, FLOW-1, FLOW-2, SEC-1 |
| Failed (2) | USDA-2 (`chicken breast` search), USDA-7 (nonsense query) |

- **USDA-2 and USDA-7:** both returned HTTP 400 from USDA. The report holds only the generic client error, so USDA's error text from this run wasn't captured.
- **Open Food Facts:** all OFF checks passed, using barcode `3017620422003`. PROT-1 recorded `http, http, ok, http, user_rate_limited`, so the limit rejected the 5th search, but OFF search returned HTTP errors on three of the first four.

## Diagnostic status
- **Server-side logging is in place** in `src/lib/server/foods/http.ts`. When USDA returns an HTTP error that reaches the generic error path, the server logs one line with the status, the request path and sanitized provider text.
- **Limits:** at most 8 KB of the response body is read and the rest is cancelled. The logged text is at most 300 characters, with the configured key, URLs, credentials and long tokens removed.
- **Client responses are unchanged:** they keep the generic error and receive no provider text.
- **Coverage so far:** this logging has been tested only with mocked responses in `src/lib/server/foods/http.test.ts`. It has not yet captured a real USDA error.

## Next step
Another live run is pending. Restart the app against the marked local test database, capture its server output, and rerun `node --env-file=.env.test scripts/live-provider-check.cjs`. Phase 2.5 live verification can only be recorded as passed if that run reports `LIVE VERIFICATION: PASSED`.

# Phase 2.5 — Latest live-provider run (2026-11-04)

This section is the current state and supersedes the earlier status sections above, which stay as the historical record.

## Status: Phase 2.5 live verification is INCOMPLETE. It has not passed.

Report time 2026-11-04 20:03:02 UTC (`live-provider-report.json`), against the local `fitdb_test` database. Verdict: `INCOMPLETE OR FAILED`. **13 passed, 2 failed, 0 not run.**

| Result | Checks |
|---|---|
| Passed (13) | USDA-1, USDA-3, USDA-4, USDA-5, USDA-6, USDA-7, OFF-2, OFF-3, OFF-4, PROT-1, FLOW-1, FLOW-2, SEC-1 |
| Failed (2) | USDA-2 (`chicken breast` search, HTTP 400), OFF-1 (`nutella` search, HTTP 503) |

Missing evidence: no successful Open Food Facts search to check result volume. Both providers' food origins were recorded as the real hosts.

## Observed facts (from the report and sanitized server log)

**USDA-2**
- Time: 2026-11-04 20:02:57.493 UTC. Status: HTTP 400. Path: `/fdc/v1/foods/search`.
- API-gateway request ID: `x-api-umbrella-request-id=d1l0k527ssqkj3ribod0`.
- Other response headers: `via=https/1.1 api-umbrella (ApacheTrafficServer [cMsSf ])`, `x-cache=MISS`, `age=2`, `content-type=text/html`, `x-ratelimit-limit=3600`, `x-ratelimit-remaining=3578`.
- Error excerpt: `400 Bad Request 400 Bad Request nginx`.
- The other USDA checks in this run (USDA-1, USDA-3 to USDA-7) passed.

**OFF-1**
- Time: 2026-11-04 20:02:59.830 UTC. Status: HTTP 503. Path: `/cgi/search.pl`.
- Error summary: an HTML page titled `Page temporarily unavailable - Open Food Facts`. Response headers include `server=nginx`; no request ID was returned.
- A second search failed the same way at 20:03:01.873 UTC (the 4th PROT-1 search). PROT-1 still passed: `ok, ok, ok, http, user_rate_limited`.
- OFF product lookups (OFF-2, OFF-3) behaved as expected in this run.

**Other observations**
- Temporary users: the script removed all 3 and reported 0 users, entries, custom foods and targets remaining.
- Secrets: the API key and database password don't appear in the report or server log.
- Diagnostics: provider HTTP errors now log for both USDA and Open Food Facts, except normal 404s, with the timestamp, path, status, allowlisted tracing headers and a sanitized excerpt.

## Possible explanations (not confirmed)
- **USDA-2:** the gateway headers suggest the 400 passed through the API gateway, which would make a local proxy or VPN unlikely. The remaining quota suggests rate limiting isn't the cause. Which nginx produced the 400, and why, is unknown.
- **`age=2`:** this sits oddly beside `x-cache=MISS` and might point to a stored error response, but one header doesn't establish that.
- **OFF-1:** the page and the fact that only searches failed suggest Open Food Facts' search service was temporarily unavailable.
- **Application:** nothing in this run identifies an application defect, but it doesn't rule one out.

## Next step
Report the USDA 400 to USDA/api.data.gov with the request ID above, then rerun the live check once Open Food Facts search has recovered. Phase 2.5 live verification can only be recorded as passed if a run reports `LIVE VERIFICATION: PASSED`.

# Phase 2.5 — Open Food Facts stabilization (2026-11-04)

This section is the current state and supersedes the earlier status sections above, which stay as the historical record.

## Status: Phase 2.5 live verification is INCOMPLETE. It has not passed.

These changes were made after the 2026-11-04 20:03 UTC live run and have not been through a full live check. A passing run against the dedicated test database is still required for both USDA and Open Food Facts.

## Implementation changes
- **Text search:** moved from the legacy `/cgi/search.pl` to Search-a-licious (`search.openfoodfacts.org/search`). `/api/v2/search` was not used because it has no full-text search. User input is reduced to plain words because `q` uses Lucene syntax.
- **Retry:** Open Food Facts search gets one retry after 400–600 ms for 502, 503 or 504 without `Retry-After`, and for network errors. It does not retry 429, 500, timeouts, malformed responses or 401/403. Product lookups and USDA are not retried.
- **Budgets:** product lookups changed from 20/min per user and 90/min globally to 6/min per user and 12/min globally, because the documented limit is 15/min per IP. Search stays at 4/min per user and 10/min globally, matching the documented 10/min per IP.
- **Retry accounting:** a retry passes the circuit and global budget again, but not the per-user budget. Each search counts once toward the circuit breaker.
- **Search hit mapping:** non-text names are never used as display names, array brands are supported, and hits without a valid product code are dropped. Missing nutrients stay null.
- **Temporary errors vs empty results:** a timed-out search with no hits is reported as an error, partial results from a timed-out search are not cached, and failures are not cached.
- **Selecting a hit:** a hit is only a preview, and selecting it loads the full product through the existing product API. An Open Food Facts hit without preview nutrients can now be opened. If the full product has no nutrition data either, the user gets a message and nothing can be logged.
- **Diagnostics:** provider HTTP errors log the timestamp, provider, path, status, allowlisted tracing headers and a sanitized excerpt, except normal 404s.

## Verification so far

| Evidence | Type | Result |
|---|---|---|
| `npm run lint` | Static | Passed |
| `npm test` | Mocked provider responses; no network or database | 169/169 passed |
| `node --test scripts/live-check.units.test.cjs` | Unit; no network or database | 17/17 passed |
| Pure guard tests copied from `scripts/test-db-guard.test.cjs` | Unit; no network or database | 3/3 passed |
| Live-check and marking script refusals | Placeholder URLs on a closed port | 7/7 refused, exit 4 |
| `npm run build` | Build, with a placeholder database URL | Passed |
| One direct Search-a-licious request for `nutella` | **Real provider**, outside the app's code | HTTP 200, 20 hits; 14 had nutrients, none had serving data |
| Full live check since these changes | **Real provider** | **Not run** |
| Server-based stub suites (`provider-protection`, `provider-malformed`, `nutrition-api`, `release-workflow`, E2E, safety suites) | Local stub and database | **Not run** since these changes; they need a database |

## Known limitations
- **Search-a-licious:** it publishes no rate limit or uptime commitment, and its API reports version 0.1.0. One successful request doesn't show it is reliable.
- **Search results:** previews can lack nutrients and servings, and liquids can show as per 100 g until opened. Ranking differs from the legacy endpoint.
- **Product budget:** 6 uncached product lookups per minute per user could be noticeable for someone scanning many new items. Cached foods don't use the budget.
- **Worst-case search time:** about 16.6 s if a slow 503 is followed by a retry that times out.
- **Selecting a hit without preview nutrients:** this client change has no automated UI test yet.
- **Budgets:** they are held in memory per server process, so multiple instances would multiply the effective rate.
- **USDA:** the intermittent HTTP 400 (for example request ID `d1l0k527ssqkj3ribod0`) is unexplained, and no code change addresses it.
- **User-Agent:** Open Food Facts asks for a contact email. The default uses a project URL until `OFF_CONTACT` is set.

## Remaining live verification
1. Run the server-based stub suites against the dedicated test databases.
2. Start the app against the marked `fitdb_test` database and capture its server output.
3. Run `node --env-file=.env.test scripts/live-provider-check.cjs`.
4. Record Phase 2.5 as passed only if that run reports `LIVE VERIFICATION: PASSED`.

# Phase 2.5 — Final verification (2026-11-04)

This section is the current state and supersedes the earlier status sections above, which stay as the historical record.

## Status: all technical checks pass, but release approval is BLOCKED by a development-database incident

**Live verification passed:** report time 2026-11-04 20:50:00 UTC, `LIVE VERIFICATION: PASSED`, 15 passed, 0 failed, 0 not run. The definition of done also requires the development database to be untouched, and that requirement was not met.

## Development-database incident
**What happened:** the first run of `nutrition-api.test.cjs` and `release-workflow.test.cjs` in this verification had no `DATABASE_URL` in the test process. Their default Prisma client fell back to `.env` and connected to the development database `fitdb`. The cause was the test harness, not application code.

**Write operations executed on `fitdb`** (worked out from the failure log and test code; `fitdb` was not opened afterwards to confirm):

| Operation | Row | Expected net effect |
|---|---|---|
| Upsert, then `deleteMany` | `Food` USDA `171477` | Row absent. If it existed before, its servings were removed and any entry's `foodId` set to null; entry snapshots remain |
| Upsert | `Food` USDA `424243` | An `ORPHAN` row was created, or an existing row's `origin` set to null. The app doesn't serve untrusted rows |
| `deleteMany` | `Food` OPEN_FOOD_FACTS `5000112637922` | Row absent if it existed. Same effect on servings and entries as above |

Other direct queries in those suites on `fitdb` were reads, failed on a foreign key, or matched no rows. No users, targets, workouts or schema were changed by these operations.

**Prevention:** both suites now refuse (exit 4) unless `DATABASE_URL` is a local test database and pass that URL to Prisma explicitly. A unit test checks those refusals and that no script opens a default Prisma client except the marking tool, which validates its target first. `test-db-guard.test.cjs` no longer connects to the development database to count its users.

**Still required:** the owner must review `fitdb` and decide on any repair. No repair was attempted.

## USDA HTTP 400: cause and fix
**Observed:** 48 interleaved requests from this computer, same key, with queries rotated:

| Request form | Succeeded |
|---|---|
| `GET` with `dataType`, encoded as the app did (`%2C`, `+`) | 5/12 |
| `GET` with `dataType`, literal commas and `%20` | 7/12 |
| `GET` without `dataType` | 12/12 |
| `POST` with `dataType` in the JSON body | 12/12 |

Every failure was the same nginx HTML 400 with API gateway headers and quota remaining.

**Conclusion:** the failures followed `GET` with a `dataType` query parameter, not the key, search term or encoding. Which server rejects it, and why only some of the time, remains unknown because it sits on the provider's side.

**Fix:** `searchUsda` now uses `POST /foods/search` with `dataType` as a JSON array, the form the API guide documents. The filter, results and client API are unchanged. The live check confirmed real results contained only the three requested data types.

## Open Food Facts
Search-a-licious passed live: `nutella` returned 20 results, of which 6 had no preview nutrients. Barcode `3017620422003` returned Nutella at 539 kcal per 100 g. The real product reported no serving size, so only 100 g was offered, which is the correct result, not a fabricated one. A new E2E check, using stub data, confirms hits without preview nutrients open the full product, and a product with no nutrition data can't be logged.

## Final test results (after the last code change)

| Check | Type | Result |
|---|---|---|
| `npm run lint` | Static | Passed |
| `npm test` | Mocked | 169/169 passed |
| `scripts/live-check.units.test.cjs` | Unit | 19/19 passed |
| `npm run build` | Build | Passed |
| `nutrition-api` | Stub + `fitdb_test` | 31/31 passed |
| `release-workflow` | Stub + `fitdb_test` | 8/8 passed |
| `provider-protection` | Stub + `fitdb_test` | 7/7 passed |
| `provider-malformed` | Stub + `fitdb_test` | 4/4 passed |
| `provider-config` | Stub + `fitdb_test` | 1/1 passed |
| `usda-missing-nutrients` | Stub + `fitdb_test` | 4/4 passed |
| `live-provider-check.safety` | Stub + `fitdb_test`, `fitdb_test_other` | 11 passed, 1 skipped (POSIX signal test on Windows), 0 failed |
| `test-db-guard` | `fitdb_test`, `fitdb_test_other` | 6/6 passed |
| `e2e-nutrition` | Stub + `fitdb_test` | All UI checks passed |
| `e2e-smoke` (Phase 1) | Stub + `fitdb_test` | All Phase 1 checks passed |
| `live-provider-check.cjs` | **Real USDA and Open Food Facts** + `fitdb_test` | 15/15 passed |

## Provider limitations
- **One live pass:** the `POST` fix has 12 clean direct requests and one clean live run behind it, which is good evidence but not a long-term reliability measure.
- **USDA:** the provider-side reason for the `GET` 400s is unknown, and `POST` could in principle behave differently later.
- **Search-a-licious:** it publishes no rate limit or uptime commitment, and previews can lack nutrients and servings.
- **Open Food Facts search:** earlier 503s came from the legacy endpoint. The new service has not been observed under failure.
- **SIGTERM cleanup test:** skipped on Windows, so that path is not verified on this platform in this run.

## Release readiness
Not ready for release approval until the development-database incident has been reviewed and closed by the owner. No known application defect blocks release.

# Phase 2.5 — Development-database incident closed; release readiness (2026-11-04)

This section is the current state and supersedes the BLOCKED status in the section above, which stays as the historical record. The test evidence recorded there remains valid: no application or test code changed after it was produced.

## Status: READY FOR RELEASE APPROVAL (not released)

## Incident
At about 20:39 UTC, a harness error on the first integration run gave `nutrition-api.test.cjs` and `release-workflow.test.cjs` no `DATABASE_URL`. Their default Prisma client fell back to `.env` and connected to the development database `fitdb`.

## Read-only findings (20:56 UTC, before the repair)
Queries ran in a read-only transaction, on loopback, with the database confirmed as exactly `fitdb`.

| Finding | Result |
|---|---|
| USDA `424243` | Present: `ORPHAN`, 1 kcal, `origin` null, 0 servings, 0 entries, created 2026-11-04 20:39:42.960 UTC |
| USDA `171477` | Absent |
| OPEN_FOOD_FACTS `5000112637922` | Absent |
| `FoodEntry` rows | 0 in total, so 0 with null `foodId` and 0 referencing these records |
| `Food` statistics | 2 inserted, 0 updated, 1 deleted |
| `FoodServing` statistics | 1 inserted, 0 updated, 0 deleted, 0 live |
| `FoodEntry` statistics | 0 inserted, 0 updated, 0 deleted |

**Interpretation (evidence, not proof):** the statistics fit the test creating `171477` and `424243` as new rows, deleting its own `171477`, and its other delete matching nothing. No earlier data loss was found. No pre-incident backup was examined, so the earlier contents of `fitdb` can't be proven exactly.

## Repair (owner approved)
One guarded transaction deleted the single row USDA `424243`, after confirming its source, id, name, null `origin`, creation time, and 0 entries and 0 servings. It required exactly one deleted row, otherwise it would roll back. No other development data was changed, and no migrations or seeds were run.

## Final verification
| Check | Result |
|---|---|
| Transaction | Committed, exactly 1 row removed |
| USDA `424243` and `ORPHAN` rows afterward | 0 |
| The three incident rows afterward | 0 |
| All 15 public tables, by row count and checksum, before and after the delete (`Food` excluding the removed row) | No other changes |
| `Food` rows afterward | 0 |

**Prevention:** suites that query the database directly now refuse (exit 4) unless `DATABASE_URL` is a local test database, and a unit test enforces this. `test-db-guard.test.cjs` no longer connects to the development database.

## Verified technical results
- Live check: `LIVE VERIFICATION: PASSED`, 15/15, real USDA and Open Food Facts, report time 2026-11-04 20:50:00 UTC.
- `npm run lint` passed, `npm run build` passed, `npm test` 169/169, `live-check.units` 19/19.
- Against stub providers and test databases: `nutrition-api` 31/31, `release-workflow` 8/8, `provider-protection` 7/7, `provider-malformed` 4/4, `provider-config` 1/1, `usda-missing-nutrients` 4/4, `test-db-guard` 6/6, `live-provider-check.safety` 11 passed and 1 skipped, `e2e-nutrition` and `e2e-smoke` passed.

## Remaining release risks
- **USDA:** the provider-side reason `GET` with `dataType` returned intermittent 400s is unknown. `POST` has 12 clean direct requests and one clean live run behind it.
- **Search-a-licious:** it publishes no rate limit or uptime commitment, its API reports version 0.1.0, and previews can lack nutrients and servings.
- **Single live pass:** the release evidence is one complete live run, so longer-term provider reliability isn't measured.
- **Windows:** the POSIX `SIGTERM` cleanup test was skipped.
- **Development database:** it was not literally untouched. It was repaired, and earlier contents can't be proven without a backup.
- **Configuration:** `OFF_CONTACT` is unset, so the Open Food Facts User-Agent has no contact email. The product budget of 6 lookups per minute per user may be noticeable to heavy users. Budgets are per server process.
