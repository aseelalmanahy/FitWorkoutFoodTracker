# FitWorkoutFoodTracker

A mobile-first training, nutrition and progress tracker. The product spec is delivered in four phases.
**Phase 1 (training) and Phase 2 (nutrition tracking) are implemented.** Phase 2 progress and test evidence are in
[`PHASE_2_PROGRESS.md`](PHASE_2_PROGRESS.md). The architecture, data model, required APIs and the
plan for Phases 2–4 are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Phase 1 features

- **Accounts:** email and password sign-up and log-in. Argon2id hashing, server-side sessions, CSRF origin checks, login throttling.
- **Profile:** date of birth, sex, height, weight, goal weight, goal, activity level, experience, days per week, lb/kg units.
  Shows a live **Mifflin-St Jeor BMR / TDEE** estimate and a suggested calorie target, with a user override. All values are labelled as estimates.
- **Workout plans:** pick exercises (47 built-in, or create custom ones). Set target sets, rep range, weight, rest and notes. Reorder, edit, delete.
- **Weekly schedule:** assign plans to weekdays and move them between days. Days with no plan are rest days.
- **Workout logging:** each set row shows the **previous performance** for that set and is pre-filled from it, so a tap logs the same weight and reps.
  Includes a warm-up flag, inline editing of logged sets, a rest timer (±15 s, skip), exercise notes and reordering.
- **Progressive overload:** a live status per exercise (improved, matched, down, mixed or baseline), with the reason (weight ↑, reps ↑ at same weight, volume ↑ …).
- **Personal records:** heaviest weight, best estimated 1RM (Epley, ≤12 reps), most reps in a set, best session volume.
- **History:** grouped by month, with duration, sets, volume and PRs per workout. **Repeat** any workout as the template for the next one.
- **Progress:** per-exercise charts of top weight, e1RM, volume and reps, plus PR cards and a session-by-session comparison.
- **Dashboard:** today's scheduled workout, weekly completion ring, sets, volume, time, and recent PRs.
- Light and dark themes (follows the system by default; can be overridden in Profile).

## Phase 2 features

- **Targets:** a suggested calorie target (Mifflin-St Jeor BMR × activity factor) plus protein, carbohydrate and fat targets derived from the profile, or your own targets.
  Carbohydrate is calculated from the remaining energy, so 4P + 4C + 9F always matches the calorie target. Targets are effective-dated: changing them never alters past days.
  Manual targets are never overwritten by profile changes.
- **Food search:** your custom foods, **USDA FoodData Central** (generic foods) and **Open Food Facts** (packaged foods), searched in parallel.
  Results show per-100 g/ml values and serving sizes. Missing values are shown as "—" and are never assumed to be 0. An 8–14 digit query does a barcode lookup.
  If one source fails or times out, the other results still show. External foods are cached once per source id.
- **Logging:** add foods to breakfast, lunch, dinner or snacks. Choose a serving or enter grams/ml, adjust the quantity, add several foods in a row, then edit or delete entries.
  Each entry stores a nutrition snapshot, so history stays accurate even if a source's data changes later.
- **Dashboard:** calories target / consumed / remaining (shown as "over" when exceeded, never negative), macro progress bars, meal groups, daily totals, and day navigation.
- **History:** weekly averages (over logged days), calories vs. each day's historical target, protein consistency (days ≥ 90 % of target), an 8-week trend, and week navigation.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL · Prisma 6 · Zod 4 · Recharts · Vitest

## Getting started

```bash
# 1. PostgreSQL 14+ running locally, then:
cp .env.example .env            # edit DATABASE_URL
npm install
npx prisma migrate deploy       # or: npm run db:migrate (dev)
npm run db:seed                 # built-in exercise library
npm run dev                     # http://localhost:3000
```

Set `FDC_API_KEY` in `.env` to enable USDA search (free key: https://fdc.nal.usda.gov/api-key-signup). USDA search uses `POST /foods/search`, because `GET` with a `dataType` filter intermittently returned HTTP 400.
Open Food Facts needs no key. Set `OFF_CONTACT` so requests identify your deployment. Its docs ask for a contact email in the User-Agent.

**Before public deployment:**

1. Set `APP_ORIGIN` to the public origin, such as `https://app.example.com`. CSRF checks then rely on no forwarded header.
2. If the app runs behind reverse proxies, set `TRUST_PROXY_HOPS` to their exact number, and make sure the app can only be reached through them. Each proxy must append the caller's address to `X-Forwarded-For`, and replace any `X-Forwarded-Host` the caller sent.
3. Run one instance. Limits are held in memory per process, so they multiply across instances and reset on restart.
4. Confirm it works by sending forged `X-Forwarded-For` and `X-Forwarded-Host` headers through the deployed proxy. These settings are prerequisites, and nothing in this repository can verify them.

Without `TRUST_PROXY_HOPS`, forwarded headers are ignored. Login then has no per-client limits, only per-account spacing (returning browsers skip it), and all registrations share one limit of 10 per 15 minutes. That is safe but restrictive: anyone can use up the registration limit and block sign-ups for up to 15 minutes, and a sustained flood can slow logins from new browsers.

**Moving to several instances:** the login records, password-check slots and registration counters all need a shared store. Counting an attempt and checking its limit must be one atomic step, or parallel requests will get past the limits. Records also need to expire, and to stay bounded as they do today.

Open Food Facts text search uses [Search-a-licious](https://search.openfoodfacts.org/docs) (`search.openfoodfacts.org`), because the legacy `/cgi/search.pl` returns intermittent HTTP 503s and `/api/v2/search` has no full-text search. Search results are previews and may lack nutrients or servings. Selecting one loads the full product from the product API, as barcode lookup does. Budgets stay within the documented per-IP limits: search 10/min app-wide and 4/min per user, product lookups 12/min app-wide and 6/min per user.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build && npm start` | Production build and server |
| `npm test` | Unit tests for energy equations, overload/PR logic and time-zone handling |
| `npm run lint` | Type-check |
| `node scripts/e2e-smoke.cjs` | Playwright end-to-end smoke test of Phase 1 workouts against a running server (`BASE_URL`, `DATABASE_URL`) |
| `npm run stub:food-apis` | Local stand-in for USDA/OFF (documented response shapes) for offline testing |
| `npm run test:guard` | Test-target guard tests. Needs no app or database |
| `npm run test:api` | Nutrition API integration tests (31) against a running server using the stub (`BASE_URL`, `DATABASE_URL`) |
| `node scripts/e2e-nutrition.cjs` | Playwright end-to-end test of Phase 2 nutrition flows |
| `node --test scripts/live-provider-check.safety.test.cjs` | Database-safety tests for the live check (needs a build and the `fitdb_test` + `fitdb_test_other` databases) |

### Live provider check (real USDA + Open Food Facts)

Every automated suite in this repository uses mocked `fetch` or the local stub, so none of them proves the real
providers work. `scripts/live-provider-check.cjs` is the live check. It needs Node.js 20.6 or later (for `--env-file`)
and is written for Windows PowerShell as well as bash.

**1. Create a dedicated test database and a `.env.test` file.** `.env.test` is git-ignored, like every `.env*` file except
`.env.example`. Put your real key in it, never in `.env.example`:

```
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/fitdb_test"
FDC_API_KEY="your-key"
```

Then create, migrate and mark the database once. Marking is deliberate: the database must be local, its name must contain
`test`, and `--confirm` must repeat the exact name.

```powershell
# PowerShell (bash is identical apart from the prompt)
createdb -U USER fitdb_test                    # or create it in pgAdmin
node --env-file=.env.test node_modules/prisma/build/index.js migrate deploy
node --env-file=.env.test scripts/mark-test-database.cjs --confirm fitdb_test
```

**2. Start the app against the test database** (your `.env` still points at the dev database; a process environment
variable overrides it):

```powershell
# PowerShell
$env:DATABASE_URL = "postgresql://USER:PASSWORD@localhost:5432/fitdb_test"; npm run dev
```
```bash
# bash
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/fitdb_test" npm run dev
```

**3. In a second terminal, run the check:** `node --env-file=.env.test scripts/live-provider-check.cjs`

What it does and guarantees:
- **Same code path as the app:** it uses the app's own API, so the provider calls go through the existing server-side
  clients. The key and the database password are redacted from everything it prints and from its report.
- **Refuses before any write** (exit 4) unless all of these hold:
  - `BASE_URL` is set, and is exactly a loopback origin;
  - the database is `fitdb_test` or `fitdb_test_other`;
  - the **running server's database** is proven to be the same database, via an opaque fingerprint from
    `GET /api/health/db-identity`;
  - that database carries a **valid test-database marker**, as reported by the server.

  The endpoint is on under `npm run dev`; for `npm start`, set `EXPOSE_DB_IDENTITY=1`. It returns only a hash and the
  marker. It never returns other database comments, names or credentials.
- **Cleans up after itself:** it deletes the throwaway `live-check-*@example.test` users (and, by cascade, their entries,
  targets, sessions and custom foods) after success, failure, crashes, request timeouts and Ctrl+C / termination. If a
  request was aborted, a second sweep runs after `LIVE_CHECK_CLEANUP_GRACE_MS` (default 15 s) to catch late writes.
- **Checks missing nutrients independently (USDA-6):** it compares the app's values for real USDA foods with a raw USDA
  response fetched with USDA's public `DEMO_KEY`, never your key. Absent nutrients must be null, and a reported 0 must
  stay 0. USDA-6 reports NOT RUN if no food with a genuinely absent nutrient is found, or if the `DEMO_KEY` oracle is
  rate-limited or unreachable. Set `LIVE_CHECK_USDA_ORACLE=off` to skip it.
- **Verdict:** `LIVE VERIFICATION: PASSED` (exit 0) needs, for BOTH providers, a server-recorded origin of the real host
  (`api.nal.usda.gov` / `world.openfoodfacts.org`) and a successful search with a realistic result count, plus 0 FAIL and
  0 NOT RUN. Any contradiction gives NOT LIVE (exit 3). Missing evidence or any failure gives INCOMPLETE OR FAILED (exit 1).
  Exit 2 means cleanup needs manual attention.
- **Run it at most about once a minute:** PROT-1 needs the app-wide Open Food Facts search budget (10/min) to be free.
- **Report:** it writes `live-provider-report.json` (git-ignored, no secrets).

### Running the integration and E2E suites (stub, not live)

**Every write-capable script refuses to run (exit 4) unless `BASE_URL` is set to a loopback origin, `DATABASE_URL` is a designated local test database (`fitdb_test` or `fitdb_test_other`), and the running server proves it's using that database and that it's marked.** There are no defaults and no bypass. For `next start`, set `EXPOSE_DB_IDENTITY=1`. See [`docs/PHASE_4_0_0A_TEST_TARGET_GUARD.md`](docs/PHASE_4_0_0A_TEST_TARGET_GUARD.md).

Use the **test database**, never the dev database. `nutrition-api` and `release-workflow` also query the database directly, so set `DATABASE_URL` for the test process too. They refuse to run (exit 4) unless it is a local database with `test` in its name. With the stub, the food cache would otherwise store stub data under real
USDA/OFF ids in your dev database. Playwright is a dev dependency (`npm ci` installs it); browsers come from
`npx playwright install chromium`. Build first: `npm run build`.

Server-based suites (`nutrition-api`, `release-workflow`, `provider-*`, E2E) need a running app pointed at the stub. Set the
variables for the **server process** itself. (`VAR=x npm run build && npx next start` sets them for `npm run build` only.)

```bash
# bash — terminal 1: stub; terminal 2: app (restart it between suites: sign-ups are limited to 10 per IP per 15 min)
node scripts/stub-food-apis.cjs 4010
export DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/fitdb_test" FDC_BASE_URL=http://localhost:4010/fdc/v1 \
  OFF_BASE_URL=http://localhost:4010/off FDC_API_KEY=stub FOOD_RATE_LIMIT_MULTIPLIER=100 EXPOSE_DB_IDENTITY=1
npx next start -p 3000
# terminal 3, with the same DATABASE_URL as the server
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/fitdb_test" BASE_URL=http://localhost:3000 npm run test:api
```
```powershell
# PowerShell — terminal 2 (app)
$env:DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/fitdb_test"; $env:FDC_BASE_URL="http://localhost:4010/fdc/v1"
$env:OFF_BASE_URL="http://localhost:4010/off"; $env:FDC_API_KEY="stub"; $env:FOOD_RATE_LIMIT_MULTIPLIER="100"; $env:EXPOSE_DB_IDENTITY="1"; npx next start -p 3000
# terminal 3, with the same DATABASE_URL as the server
$env:DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/fitdb_test"; $env:BASE_URL="http://localhost:3000"; npm run test:api
```

Notes for the other server-based suites:
- `provider-protection.test.cjs` and `provider-malformed.test.cjs` need a *fresh* server with default budgets (no multiplier)
  and the stub started with `STUB_LOG_FILE`.
- `provider-config.test.cjs` needs a server without `FDC_API_KEY`, with `SERVER_LOG_FILE` pointing at its log.

**Self-contained database-safety suites** start their own stub and app servers on free ports and clean up all processes.
They need two migrated local test databases. They refuse to run (and change nothing) unless the URLs are local, the names
are the designated test databases, and `SAFETY_DB_CONFIRM` repeats the first database's exact name:

```powershell
$env:SAFETY_DB_URL="postgresql://USER:PASSWORD@localhost:5432/fitdb_test"; $env:SAFETY_DB_CONFIRM="fitdb_test"
$env:SAFETY_OTHER_DB_URL="postgresql://USER:PASSWORD@localhost:5432/fitdb_test_other"
node --test scripts/live-check.units.test.cjs scripts/test-db-guard.test.cjs scripts/live-provider-check.safety.test.cjs scripts/usda-missing-nutrients.test.cjs
```
`live-provider-check.safety.test.cjs` unmarks and re-marks `SAFETY_DB_URL`'s database while it runs. It leaves it validly
marked.

## Project layout

```
prisma/                 schema, migrations, seed
src/app/(auth)/         login, register
src/app/(app)/          authenticated shell: dashboard, workouts, nutrition, progress, profile
src/app/api/            REST route handlers (JSON, zod-validated, user-scoped)
src/lib/                pure domain logic: overload.ts, energy.ts, units.ts, time.ts, validation.ts
src/lib/server/         server-only: db, auth/sessions, API wrapper, data access
src/components/         UI kit, workout logger, plan/schedule editors, charts
```
