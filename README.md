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

Set `FDC_API_KEY` in `.env` to enable USDA search (free key: https://fdc.nal.usda.gov/api-key-signup).
Open Food Facts needs no key. Set `OFF_CONTACT` so requests identify your deployment.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build && npm start` | Production build and server |
| `npm test` | Unit tests for energy equations, overload/PR logic and time-zone handling |
| `npm run lint` | Type-check |
| `node scripts/e2e-smoke.cjs` | Playwright end-to-end smoke test of Phase 1 workouts against a running server (`BASE_URL`) |
| `npm run stub:food-apis` | Local stand-in for USDA/OFF (documented response shapes) for offline testing |
| `npm run test:api` | Nutrition API integration tests (21) against a running server using the stub (`BASE_URL`) |
| `node scripts/e2e-nutrition.cjs` | Playwright end-to-end test of Phase 2 nutrition flows |

### Running the integration and E2E suites

Use a **separate test database**. With the stub, the food cache would otherwise store stub data under real USDA/OFF ids in your dev database.
Playwright is a dev dependency (`npm ci` installs it). Browsers come from `npx playwright install chromium` (or a pre-installed `PLAYWRIGHT_BROWSERS_PATH`).

```bash
createdb fitdb_test
export DATABASE_URL="postgresql://fit:fitdev@localhost:5432/fitdb_test?schema=public"
npx prisma migrate deploy && npm run db:seed
npm run stub:food-apis &                       # :4010, documented USDA/OFF response shapes
FDC_BASE_URL=http://localhost:4010/fdc/v1 OFF_BASE_URL=http://localhost:4010/off FDC_API_KEY=stub \
  npm run build && npx next start -p 3000 &
BASE_URL=http://localhost:3000 npm run test:api
BASE_URL=http://localhost:3000 node scripts/e2e-nutrition.cjs
BASE_URL=http://localhost:3000 node scripts/e2e-smoke.cjs
```
Each suite registers new accounts. The server's in-memory sign-up throttle (10 per IP per 15 min) means you should
restart the server between suites.

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
