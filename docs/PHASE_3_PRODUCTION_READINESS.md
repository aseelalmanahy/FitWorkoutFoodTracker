# Phase 3: Production Readiness

**Assessment: not ready for production.** The code is tested with stubs, but no AI model, real phone, real PDF or production environment has been tested. AI features stay off until the requirements below are met, and the rest of the app works without them.

**How to read the evidence:**

- **Verified:** an automated test or direct inspection on this code, on a Windows development PC.
- **Measured earlier:** a number from an earlier milestone, not repeated for this assessment.
- **Assumption:** believed true, not tested. Treat it as unknown.

## Blocking for development merge

Nothing known, subject to independent review of the source. Automated results are in the Phase 3.6 report.

## Blocking for production deployment

Listed roughly in the order to do them. **No AI feature should be switched on until items 1 to 5 are done.**

| # | Requirement | Current state | What's needed |
|---|---|---|---|
| 1 | Provider spending limit | **Not configured.** The app's own limits are in memory and reset on restart | A hard monthly limit in the provider's console. It's the only ceiling that survives restarts and spans instances |
| 2 | Model choice and accuracy | **Never tested.** No model is set, and all testing used stubs | A paid test on real labels and meals with known answers, once approved |
| 3 | Provider cost | **Estimates only** | Measure tokens per scan in the same test, and set the daily limits from the results |
| 4 | Real prompt injection | **Unmeasured.** Validation limits what a response can do, but not whether a model is misled into a wrong name or value | Run hostile labels and photos against the chosen model |
| 5 | Privacy notice and retention | **No privacy notice exists.** No route deletes an account. Photos go to a third party | See below |
| 6 | Real phones | **Untested.** Only desktop browser engines at a phone-sized viewport | See below |
| 7 | Real PDFs | **Untested.** All PDFs were generated fixtures | See below |
| 8 | Instance count | **Limits are per process** | Run exactly one instance, or do the work below |
| 9 | Reverse proxy and TLS | **Not configured or tested** | See below |
| 10 | Memory | **Linux unmeasured** | See below |
| 11 | Monitoring and alerts | **None.** Logs go to the console only | See below |
| 12 | Security headers | **No Content-Security-Policy or HSTS** | See below |
| 13 | Node version | **Not pinned** | See below |
| 14 | Dependency findings | **3 high, reviewed below** | Decide on the Prisma upgrade |
| 15 | Lint | **`npm run lint` runs only the TypeScript compiler.** ESLint isn't installed or configured | Decide whether to add it, as it's a new dev dependency |

## Requirements in detail

### AI accuracy

All of this needs paid requests, so approval first.

- **Labels:** at least per-serving, per-100 g, per-100 ml, household servings, two-column, curved, glare and low-resolution labels, compared field by field against known values.
- **Meals:** single foods, mixed dishes and non-food photos.
- **Validation rejection rate:** how often the strict meal check discards a real response. Each rejection uses a scan. A high rate means a poor experience and wasted spending, and the fix would be the prompt or the allowlist, never relaxing the safety rules.
- **Stop criterion:** agree an acceptable error rate before running the test.

### Real phones

iPhone Safari with HEIC, Android Chrome, 48 MP and larger photos on low-memory devices, the camera input, wide-colour photos, and whether two encoding passes keep small print readable. Also the sheet layout and locks on touch screens. WebKit in Playwright isn't iOS Safari.

### Real PDFs

Manufacturer spec sheets, scans, unusual fonts, CJK text, JBIG2 and JPEG 2000 images, which no fixture exercised, and non-English labels, which fall back to scanning. Also how a large PDF behaves in a phone's memory.

### Provider cost and spending

| Control | Status |
|---|---|
| No default model | **Verified.** Each feature is off without its own model setting |
| No automatic requests | **Verified.** A request needs a click, and choosing a file sends nothing |
| No automatic retries | **Verified.** `maxRetries: 0`, and one attempt on 429, 500 and 529 |
| One request per scan | **Verified,** including two clicks in one task |
| Meal and label scans share a budget | **Verified** |
| Failed requests count against it | **Verified** |
| Output capped | **Verified.** 4,096 tokens for labels, 1,500 for meals |
| Credentials stay on the server | **Verified** by scanning the client bundle for the environment's values |
| Provider-side spending limit | **Not configured** |
| Spending alerts | **Not configured** |
| Durable budget across restarts and instances | **Not implemented** |

**Default limits:** 30 scans per user and 300 overall, per rolling 24 hours, per process. On the worst-case estimates in the design document, 300 scans is about $30 a day on Opus 5.5. That's an estimate. A restart resets the count, so repeated restarts could exceed it, which is why item 1 comes first.

**Cancellation:** a provider request is cancelled at its 60-second deadline. It's not cancelled when the user leaves the page, so an abandoned scan still costs what it costs.

### Multi-instance rate limiting

These all live in memory, per process, and reset on restart:

| State | File | Effect with N instances |
|---|---|---|
| Login throttle | `login-throttle.ts` | Attackers get N times the attempts |
| Food API budgets and circuit breaker | `foods/guard.ts` | N times the upstream calls |
| Search cache | `foods/usda.ts`, `openfoodfacts.ts` | Lower hit rate, otherwise harmless |
| Image upload limits and slots | `images/upload-limits.ts` | N times the uploads and memory |
| Decode queue | `images/validate.ts` | Per-process by nature, so this one stays |
| Scan budget | `labels/limits.ts` | **N times the spending** |

**To run more than one instance, one of these:**

1. **Redis or similar,** with atomic increments for the login, budget and upload counters. It's the usual answer, but a new infrastructure dependency that needs approval. Decide whether to fail closed if it's down: spending limits should.
2. **PostgreSQL,** which needs no new service: a `ScanUsage` table for the budget, checked in a transaction. It's suitable for scans, as they're slow and few. It would add a query to every login and upload if used for those too, so measure first. It needs a migration.
3. **One instance only,** which is reasonable for a first deployment. Scale the single host until there's a reason not to. **Recommended,** together with the provider's spending limit.

Sticky sessions aren't a solution: they'd split the budget across instances all the same.

### Memory

**Measured earlier on Windows:** a peak of 788 MB per process, so at least 1 GB, and 1.5 GB recommended. **Assumption:** that Linux is similar. sharp's documentation warns about glibc's allocator, so measure on the target. Decoding uses native memory, so set the limit on the container, not with `--max-old-space-size`.

### Node version

Tested here on Node 24.21. `package.json` has no `engines` field, and there's no `.nvmrc`. Pin the deployment to a version tested on, and run the test suite on the target's operating system. Native packages (sharp, argon2, Prisma's engine) must be installed for that platform. **Linux is an assumption.**

### Reverse proxy

- **`APP_ORIGIN`** must be set to the exact public origin. Without it, the Origin check relies on the Host header.
- **`TRUST_PROXY_HOPS`** must match the real number of proxies. Too high lets clients forge their address, and too low makes everyone look like the proxy, so login throttling hits everyone at once.
- **Request bodies:** allow about 8 MB on `/api/images/validate`, `/api/nutrition/label-scans` and `/api/nutrition/meal-identifications`, and something small elsewhere. The app enforces its own limits, and the proxy should refuse larger ones first.
- **Timeouts:** at least 90 seconds on the scan routes, as a provider request can take 60, and uploading 30.
- **Don't cache `/api/`,** and don't buffer uploads to disk, as photos aren't meant to be stored.
- **`EXPOSE_DB_IDENTITY`** must stay unset in production. **`NODE_ENV=production`** must be set: that's what disables that route by default.
- **TLS:** session cookies are Secure, so sign-in needs HTTPS.

### Security headers

The app sends `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy`, but no Content-Security-Policy or Strict-Transport-Security. React escapes provider text, which is tested with injection fixtures, so CSP would be a second layer. It needs care, as pdf.js uses a worker and WebAssembly, and Next uses inline scripts. Test it in all three browsers.

### Abuse limits

`POST /api/foods` and `POST /api/nutrition/entries` have no rate limit. A signed-in user could fill the database, though each request is small and limited to 256 KiB. Add per-user limits, or storage alerts.

### Privacy and retention

- **Notice:** before the first scan, say that photos go to the named AI provider, what the provider's retention is, and that a photo can show someone's surroundings. Check Anthropic's current terms, as the design document's summary is from when it was written.
- **Consent:** decide whether a first-use consent is required where the service operates. This needs legal review, as health-related data can have special status.
- **Account deletion and export:** no route exists for either. Rows cascade from `User` in the schema, so deletion is straightforward to add. **Food diaries are personal data.**
- **Logs:** coded failures only for AI features, and Prisma errors are reduced to type and code. Other unexpected errors are logged whole, so set a log retention period.
- **Open Food Facts** is under ODbL, which has attribution duties. The search page credits it. Check that's sufficient.

### Dependency findings

`npm audit`: **3 high, all one issue,** and none fixable without a major upgrade.

| Package | Path | Finding |
|---|---|---|
| `deepmerge-ts` 7.1.5 | `prisma` → `@prisma/config` → `deepmerge-ts` | Stack exhaustion when merging recursive object graphs (GHSA-ggr8-5vv4-36mx) |

- **Reachability:** `deepmerge` appears nowhere in the built server output, and `@prisma/client`'s runtime only names `@prisma/config` in embedded package metadata. It's used by the Prisma CLI when reading its config, which isn't reachable from a request. **The exposure looks low: this is from inspecting the build, not from a formal analysis.**
- **Note:** `npm audit --omit=dev` still lists it, as `@prisma/client` has `prisma` as a peer dependency.
- **Fix available:** Prisma 7, a major upgrade, not made here. It needs approval, a compatibility review, and a re-run of everything.

### Monitoring and alerting

None exists. Needed before switching on paid features:

- **Spending:** daily scan count against the limit, and provider spend, alerting well before the limit.
- **Scan failures:** the rate of each coded failure. A rise in `invalid_response` means the model or validator needs attention, and `misconfigured` needs an operator now.
- **Stuck slots:** uploads returning 429 for everyone can mean work that never ended, which only a restart clears.
- **Server:** errors, memory against the container limit, restarts and database connections.
- **Backups:** nothing here covers database backups or restores.

## What was checked, and how far it goes

| Area | Status |
|---|---|
| Sign-in, Origin and ownership on every Phase 3 route | **Verified** |
| Cross-user isolation for foods, entries and idempotency keys | **Verified** |
| Image sanitizing, and what reaches the provider | **Verified** against the stub provider |
| PDF processing stays in the browser | **Verified** |
| Upload limits, timeouts and concurrency accounting | **Verified** with stubs. Heavy load on real hardware **not tested** |
| Malformed provider responses | **Verified** with stubs |
| What real models return | **Unknown** |
| USDA and Open Food Facts response shapes | **Verified by stub only in Phase 3.** An earlier live check is recorded in `PHASE_2_PROGRESS.md`, and wasn't repeated here |
| Behaviour under real network conditions | **Simulated** by dropping responses in the browser |
