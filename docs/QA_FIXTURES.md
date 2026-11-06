# QA fixture accounts

10 synthetic accounts with varied history, on `fitdb_test` only, to see how the app behaves with realistic data. **Nothing runs this automatically.**

## Using them

```sh
node --env-file=.env.test scripts/qa-fixtures.cjs --create  --confirm=fitdb_test   # refuses if they already exist
node --env-file=.env.test scripts/qa-fixtures.cjs --status  --confirm=fitdb_test   # counts only
node --env-file=.env.test scripts/qa-fixtures.cjs --cleanup --confirm=fitdb_test   # removes them, and their credentials file
node --test scripts/qa-fixtures.test.cjs                                           # the data rules and refusals, with no database
node --env-file=.env.test scripts/run-guarded-suites.cjs qa-fixtures-e2e           # needs a production build, and --create first
```

**Passwords are in `qa-test-accounts.local.md`,** at the repository's root. Git ignores it, and the script checks that before writing. It's plain text, and Node's file modes don't restrict access on Windows. The passwords work nowhere else, and are made fresh on each `--create`.

**To log in by hand, the app has to be running against `fitdb_test`.** A plain `npm run dev` reads `.env`, which is a different database, so these accounts won't exist there.

**`next dev` and a production build share `.next`.** Running `next dev` while a guarded suite needs that build makes the suite fail to start.

## The accounts

| # | Address | Scenario | Sessions | Sets | Food entries | Targets |
|---|---|---|---|---|---|---|
| 1 | `qa-fixture-01-beginner@test.dev` | Beginner, incomplete profile, no food entries | 3 | 18 | 0 | 0 |
| 2 | `qa-fixture-02-intermediate@test.dev` | Intermediate, 8 weeks, imperial units | 23 | 253 | 173 | 1 |
| 3 | `qa-fixture-03-advanced@test.dev` | Advanced strength, 6 months, RPE | 99 | 1,386 | 153 | 1 |
| 4 | `qa-fixture-04-weight-loss@test.dev` | Weight loss, daily food, no workouts | 0 | 0 | 307 | 2 |
| 5 | `qa-fixture-05-muscle-building@test.dev` | Muscle building, 4 months | 62 | 868 | 459 | 2 |
| 6 | `qa-fixture-06-maintenance@test.dev` | Maintenance, stopped target, food still logged | 23 | 253 | 229 | 2 |
| 7 | `qa-fixture-07-busy-professional@test.dev` | Short sessions, calories-only target, UTC+13 | 15 | 72 | 94 | 1 |
| 8 | `qa-fixture-08-home-workouts@test.dev` | Bodyweight and bands, custom exercises, no food entries | 27 | 261 | 0 | 0 |
| 9 | `qa-fixture-09-returning-user@test.dev` | About 10 weeks away, target stopped then restarted | 27 | 297 | 238 | 3 |
| 10 | `qa-fixture-10-long-term@test.dev` | 18 months, one workout in progress | 269 | 3,553 | 2,062 | 7 |

Rows are generated from a seeded generator and the time of creation (`scripts/lib/qa-fixture-data.cjs`), so dates follow the day they're created, and the same inputs give the same rows.

**Limits:**

- **Inserted directly, so these skip sign-up,** its limits and its validation, on this database only. They show how the app reads data, and prove nothing about sign-up, which `account-tokens` tests. Acceptance fields stay null.
- **The foods and their values are made up for testing,** and aren't a nutrition reference.
- **No profile-less or under-18 account is among the 10.** The app hides everything behind onboarding for the first, and the scenarios need their data visible. Existing suites cover those two states. The browser test does confirm a fixture can't save an under-18 date through the real route.
- **Records, volume and weekly stats aren't stored,** and are left for the app to calculate. Food entry totals are stored, as the app stores them when logging.
- **Time zones use a fixed offset for session hours,** so a daylight-saving change can move a time by an hour, though not its date.

## Safety

Before any write, and before Prisma is loaded: exact flags, `databaseUrlProblem`, `environmentProblems`, the name exactly `fitdb_test`, and not `NODE_ENV=production`. Then the database's own name, loopback address and test marker, and again on the connection doing the writing. Create and cleanup each run in one transaction, and roll back if any row outside the fixture changes in any model.

**Cleanup matches a fixed list of addresses, and ids from the credentials file, never a pattern,** as other suites create `@test.dev` accounts too. If it finds an account it can't match, or only some of them, it refuses. It removes login sessions these accounts gained, and their links by user and by address. **It removes nothing shared:** built-in exercises are only referenced, and the foods are the accounts' own. If the credentials file is lost, cleanup refuses, and the accounts need removing by a reviewed one-off.

**Residual risk:** a tunnel to a remote server could look like loopback. Only the exact name and marker stop that.

## Results, 2026-11-06

`qa-fixtures-e2e`, one browser at a time, with available memory staying above 12 GB.

**258 of 258 checks passed:** all 10 accounts in Chromium across login, profile, schedule, history and paging, exercise details, progress, nutrition, targets and empty states. Firefox and WebKit on accounts 1 and 10. Isolation in four pairs, by page and API, with the other account's rows confirmed unchanged. Displayed values compared with stored data: totals, page sizes, a day's calories, bodyweight sets, units, and missing macros.

**Large history:** account 10's slowest page, `/progress`, loaded in under 100 ms against a local database, with one user and no real network. That says nothing about a deployed server.

**Application defects: none that fail a check.** One inconsistency: `GET /api/exercises/{id}/previous` answers 200 with `{ previous: null }` for another account's exercise, where `/history` answers 404. It reads only the caller's sessions, so nothing leaks, and an unknown id gets the same answer.

**Earlier failures in this test, all in the test:** expecting raw `2100` where the page rightly shows `2,100`, looking for plan names as visible text when they're in select options, expecting 404 from that route, and leaving a page while WebKit was still fetching. WebKit's reports stopped once the test let those requests finish, which is what confirmed that cause. **WebKit still needs its Secure session cookie re-added without that flag over `http://localhost`,** so its session handling is only exercised on real devices (T-15).
