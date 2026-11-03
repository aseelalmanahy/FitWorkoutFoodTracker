# FitWorkoutFoodTracker

A mobile-first training, nutrition and progress tracker. The product spec is delivered in four phases.
**Phase 1 (training foundation) is implemented.** The architecture, data model, required APIs and the
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

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build && npm start` | Production build and server |
| `npm test` | Unit tests for energy equations, overload/PR logic and time-zone handling |
| `npm run lint` | Type-check |
| `node scripts/e2e-smoke.cjs` | Playwright end-to-end smoke test against a running server (`BASE_URL`) |

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
