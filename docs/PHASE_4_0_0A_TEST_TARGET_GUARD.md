# Phase 4.0.0a: Test-Target Guard

> **Synchronization note (2026-11-09):** Status update: this guard was **merged to `main` at `56606ee`** (TD-07). The status line below is from before the merge.

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
| `run-guarded-suites` | Starts apps for the other suites | Shared database check, and `verifyServerIdentity` before each suite |
| `live-check.identity.test` | Runs the live check against a mock server | Shared database check |
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

**While tests run, the verified origin is the boundary.** Another local port or address could be a different app on a different database, so being on loopback isn't enough. One destination policy decides for every request:

| Destination | Allowed when |
|---|---|
| Application | Exactly the verified `BASE_URL` origin. `localhost:3001` doesn't permit `localhost:3000` or `127.0.0.1:3001` |
| Provider stub | The script passes `{ labelStub: true }`, `LABEL_STUB_URL` is one exact loopback origin that isn't the app, it answers `GET /__health` with the stub's identity, and the path is one of its four control paths |
| Anything else | Forbidden |

- **Direct requests:** `fetch` refuses forbidden destinations, and doesn't follow a redirect to another origin.
- **Browsers:** `target.launchOptions(engine)` sends all traffic through a local forward proxy that applies the policy. **Playwright's routes don't see redirect targets, in any engine:** a 302 or a 307 POST from the app reached another server despite a route guard. The proxy sees every hop. `guardContext` remains as a second layer. WebSocket upgrades are refused, and so is any tunnel except one to the exact verified origin, which Playwright's `route.fetch()` needs.
- **Stubs:** the environment can't add a destination. Setting `LABEL_STUB_URL` does nothing unless the script asks for it, and even then it reaches only those control paths, none of which exists on the app.

No allowlist or bypass flag exists, by design. The food stub is called by the app, not by tests, so tests get no permission for it.

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
| **`localhost` in browsers** may resolve differently from Node | The proxy resolves it in Node, so the check and the request now agree. The proxy can't see DNS done elsewhere |
| **Suites that start their own app** (`usda-missing-nutrients`, the safety suite, the runner) don't use the fetch guard or proxy | They only call addresses of processes they started, and the live check needs real providers. They verify the database, not each destination |
| **`next dev`** hot reloading uses a WebSocket, which the proxy refuses | Pages still load, without live reload. Use `next start` for tests |
| **Server provider settings** can't be seen from outside | The guard can't prove the app uses stubs rather than a real provider or a real key. That stays with whoever starts the server |
| **Scripts run outside this repository,** or a direct `psql` or Prisma CLI | Out of scope. Migrations and seeds aren't guarded here |
| **The meta-test reads source text** | Runtime gates back it up: `fetch` and `guardContext` refuse before verification. A determined rewrite could still get past the text check |
| **`mark-test-database`** still accepts any local name containing "test" | Not changed. A marker on another name doesn't help, as the guard requires the two exact names |
| **A database mislabelled by hand** as `fitdb_test`, on the right server and URL | Only if someone deliberately renames it. Names are the only remaining evidence |

## Running

**These need no app or database, and nothing leaves the machine:**

```bash
npm run test:guard            # unit tests, negative controls, coverage meta-tests
npm run test:guard:browser    # real browsers against local mocks
```

**The suites need two migrated, marked local databases, `fitdb_test` and `fitdb_test_other`,** and a `.env.test` file, never committed, whose `DATABASE_URL` names `fitdb_test`. Then:

```bash
npm run build                 # set DATABASE_URL to the test database first
npm run test:suites           # everything below
npm run test:suites -- nutrition-api e2e-smoke   # or by name
```

`scripts/run-guarded-suites.cjs` refuses any other database, starts stubs and an app on free ports, proves each app is on `fitdb_test` before its suite runs, removes real provider keys from the environment, redacts credentials from its logs, and exits non-zero on any failure.

**It doesn't run everything,** so that no marker is written and the development database's comment isn't read:

| Suite | Runs | Doesn't run, and why |
|---|---|---|
| `safety-no-marker` | All of `live-provider-check.safety.test` except the next column. The runner also checks that the marker's row wasn't rewritten | "MISSING marker" and three "INVALID marker" tests, which change the marker. `live-check.identity` covers the same refusals with a mock |
| `db-guard-scoped` | All of `test-db-guard.test`, with `GUARD_SNAPSHOT_SCOPE=designated` | The before-and-after comparison doesn't cover other databases, as the development database's comment isn't read |
| Not included | `live-provider-check` against real providers | Needs real keys and separate approval |
