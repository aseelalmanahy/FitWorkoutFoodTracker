# Phase 4.0.0a: Test-Target Guard

Stops automated tests from writing to anything other than a designated local test database, through a marked local server. It's test-environment hardening, so product behaviour doesn't change. Application code and the Prisma schema are untouched.

**Status: on a feature branch, for independent review. Not merged. Phase 4.0 remains unfinished, and Phase 4.0.1 isn't authorized.**

## The problem

`BASE_URL` defaulted to `http://localhost:3000`, and most scripts never checked it. The old guard checked `DATABASE_URL` only, and only in two suites. So a test could register users on any server it was pointed at. A local app can also silently use `.env`, which is the development database, when `DATABASE_URL` isn't set for the server process.

## What can write

| Scripts | How they write | Protection |
|---|---|---|
| `e2e-smoke`, `e2e-nutrition`, `e2e-hardening`, `e2e-label-pdf`, `e2e-label-scan`, `e2e-meal` | Browser sign-ups, workouts and nutrition, plus `fetch` | `requireSafeTarget`, `verifyServer`, `guardContext` |
| `nutrition-api.test`, `release-workflow.test` | API, plus Prisma directly | `requireSafeTarget`, with `verifyServer` as the first step of the `before` hook |
| `provider-config.test`, `provider-malformed.test`, `provider-protection.test` | API sign-ups, foods and entries | Same |
| `live-provider-check` | API, and deletes its own users by Prisma | Shared static checks, plus its existing stricter server verification |
| `usda-missing-nutrients.test` | Starts its own app, then API and Prisma | Shared database check, and `verifyServerIdentity` after each start |
| `live-provider-check.safety.test` | Starts its own apps, changes the marker | Shared database check, with its existing guards |
| `mark-test-database` | The marker comment only | Its existing guard. Not changed |

**Read-only or no outbound requests, checked by the meta-test or by reading:** `stub-food-apis`, `stub-label-provider`, `test-db-guard.test`, `live-check.units.test`. Every file in `scripts/` must be classified in `scripts/test-target-guard.test.cjs`, so a new script fails the test until someone decides.

## How the guard works

`scripts/lib/test-target-guard.cjs` has two steps. Requiring it does nothing.

**1. `requireSafeTarget()`, static, with no I/O.** Exit 4 on any problem.

- `BASE_URL` must be set and written exactly as `http://localhost[:port]`, `http://127.0.0.1[:port]` or `http://[::1][:port]`. The raw text is matched as well as the parsed URL, as parsers turn `http://127.1`, `http://2130706433` and `http:\\localhost` into loopback.
- `DATABASE_URL` must pass the existing `validateTargetUrl`, and its name must be exactly `fitdb_test` or `fitdb_test_other`.
- The environment must have no proxy variables, `NODE_ENV=production`, `NODE_PATH`, preloading `NODE_OPTIONS` or the retired `LIVE_CHECK_ALLOW_DATABASE`. Stub URLs must be on loopback.

It also replaces global `fetch` with one that refuses everything until step 2 passes.

**Hooks don't wait for each other.** `node:test` started a suite's fixture hook while an earlier verification hook was still running, which the fetch gate caught during this milestone's own test run. The gate doesn't cover direct Prisma calls, so every `before` hook must start by awaiting `verifyServer()`, which runs once. The meta-test enforces this.

**2. `verifyServer()`, before any write.** Exit 4 on any problem. Only a read-only GET and a read-only query.

- `localhost` must resolve only to loopback on this machine.
- `GET /api/health/db-identity`, with redirects off, must report the exact marker of that database. The server is checked first, so a wrong server causes no database connection.
- This process reads the database at `DATABASE_URL` itself, and the fingerprints must be equal. **This is what catches a local app using `.env`,** and a different database labelled with the right marker.

**While tests run:** `fetch` refuses anything off loopback, and doesn't follow redirects to another origin. `guardContext` aborts browser requests off loopback. No allowlist or bypass flag exists, by design.

**The existing identity endpoint was sufficient, so no application change was needed.** It returns only a hash and a marker. `next start` needs `EXPOSE_DB_IDENTITY=1`, as before, and otherwise the guard refuses.

## Other changes

- `BASE_URL` no longer has a default anywhere. **Every guarded script now also needs `DATABASE_URL` set,** including E2E scripts that never query directly.
- `LIVE_CHECK_ALLOW_DATABASE` is gone. It let the live check use a database not named as a test database. No test used it.
- `requireTestDatabaseUrl` is removed, as its name check accepted any name containing "test", such as `latest`.
- The live check's identity request no longer follows redirects.

## Limitations

These aren't closed by this milestone.

| Limitation | Why it remains |
|---|---|
| **A process that deliberately lies** can pass, if it returns a copied fingerprint and marker, and forwards writes elsewhere | The check proves configuration, not honesty. It stops accidents, not an attacker on this machine |
| **Time of check to time of use:** the server could be replaced after verification | Verification runs once per script |
| **A tunnel** from a loopback port to a remote server | It would pass only if the remote server's fingerprint matched the local database, which it wouldn't. The remote endpoint is also off in production builds |
| **`localhost` in browsers** may resolve differently from Node | The check covers Node's resolver. Use `127.0.0.1` for the strictest result |
| **WebSockets** from a browser aren't covered by `guardContext` | Playwright routes them separately. No test or app code uses one outside `next dev` |
| **Server provider settings** can't be seen from outside | The guard can't prove the app uses stubs rather than a real provider or a real key. That stays with whoever starts the server |
| **Scripts run outside this repository,** or a direct `psql` or Prisma CLI | Out of scope. Migrations and seeds aren't guarded here |
| **The meta-test reads source text** | Runtime gates back it up: `fetch` and `guardContext` refuse before verification. A determined rewrite could still get past the text check |
| **`mark-test-database`** still accepts any local name containing "test" | Not changed. A marker on another name doesn't help, as the guard requires the two exact names |
| **A database mislabelled by hand** as `fitdb_test`, on the right server and URL | Only if someone deliberately renames it. Names are the only remaining evidence |

## Running

```bash
npm run test:guard   # no app or database needed
```

The app-based suites need the server and the test process to have the same `DATABASE_URL`. See the README.
