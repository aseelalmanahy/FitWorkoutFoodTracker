# FitWorkoutFoodTracker: project master

**Canonical overview.** Read this first. Synchronized on 2026-11-09 with the code and git, by an audit of every document.
- Current state and next steps: [PROJECT_STATUS.md](PROJECT_STATUS.md).
- What exists: [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md).
- What's next: [ROADMAP.md](ROADMAP.md).
- Decisions, risks and defects: [DECISION_REGISTER.md](DECISION_REGISTER.md).
- Every document and its authority: [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md).

## 1. What it is

A web application (installable as a PWA) for one adult to:
- plan and log strength training, and see their progress;
- log food with nutrition values that come from named sources;
- follow their body weight toward a goal.

It is **pre-beta**: nothing is deployed, and no real users exist ([PROJECT_STATUS.md](PROJECT_STATUS.md)).

### Vision, labelled by who said it

| Point | Who | Source |
|---|---|---|
| "AI never invents calories, macros, weights, portions or ingredients. Missing nutrition stays null, never 0. No fitness calculation claims more precision than its method supports. No real users until the pre-beta safeguards are complete." | **Project rules** in CLAUDE.md, enforced in the code. No document records the owner stating them, but they bind all work | CLAUDE.md |
| Purpose: plan and record workouts, track strength, track food, follow progress toward goals; perhaps later, work with an authorized trainer | Claude's recommendation (PRODUCT_STRATEGY is "proposed") | PS:3, PS:11 |
| Positioning: "the tracker you can trust", which says where a number came from and when it doesn't know | Recommendation | PS:13 |
| User: one adult (18+), own training and food, own phone. Trainers are a later, separate audience | Recommendation. 18+ is built; the age is open question PS-Q1 | PS:17 |
| Not: medical advice, a coaching service, a social network, a trainer marketplace, a device-tracking platform | Recommendation | PS:19 |
| Problem: without a weight history and a goal, the app can't show whether the person is moving toward the goal | Recommendation, with no user research yet | PS:5–7 |
| The redesign (Slate & Mist), reliable food search, responsive layouts, better notes (UX-01) | **Owner approved**, 2026-11-07 | FD:389 |
| The PWA, camera barcode, plan import, package photos, in-app feedback | **Owner approved**, 2026-11-08 | BP:3, TR:438 |
| Multiple gyms, machine-specific history, exercise alternatives | **Owner approved**, 2026-11-08 | TR:487 |
| The owner's backlog: recovery, effort, movement, progress photos, GPS, followers, adaptive scanning | **The owner's ideas, kept, not approved** | FD:391, TR:299–307 |
| Personal-trainer platform (Initiative T) | The owner's request; deferred, "not to be implemented yet" | FD:147, PS:331–382 |
| Business or monetization | **Not decided** (PS-Q5). No plan is documented | PS:504 |
| Production in the cloud, independent of the owner's PC | **Owner decision**, 2026-11-09 | RA:1124 |

## 2. Architecture (as built)

| Layer | Actual | Source |
|---|---|---|
| **App** | Next.js 15.5 (App Router), React 19.1, TypeScript 5.9, Tailwind 4, Zod 4, Recharts. Node 24.21 | `package.json`, `.nvmrc` |
| **Code layout** | Server components read through `src/lib/server/*`; domain logic in `src/lib/*`; UI in `src/components/*`. 34 pages, 56 API routes | `src/` |
| **API pattern** | `route`, `accountRoute`, `adminRoute` and `publicRoute` wrappers: origin check on writes, session, the profile and age gate, body-size limits, error mapping. Another user's records answer 404 | `src/lib/server/api.ts` |
| **Database** | PostgreSQL through Prisma 6.19: 19 models, 10 migrations. Migrations reach databases that keep data **only** through the guarded step (`scripts/migrate-approved.cjs`, `prisma/approved-migrations.json`). MIG-FB and MIG-GYM aren't yet approved there | `prisma/` |
| **Authentication** | Argon2id passwords. Server-side sessions (only the SHA-256 of a random token is stored), with HttpOnly, SameSite=Lax and Secure cookies, for 30 days. Link-first registration (emailed one-time links); password reset. **Registration is closed on any real deployment while the privacy notice is a draft**, and needs an allowlist after that | `src/lib/server/auth.ts`, `production-config.ts` |
| **Startup preflight** | The production server refuses to start on an unsafe configuration: weak database password, non-HTTPS origin, test settings, or **any paid-AI setting** | `src/instrumentation.ts`, `production-config.ts` |
| **Food data** | USDA FoodData Central and Open Food Facts, server-side, with budgets and a circuit breaker. The browser calls no third party (CSP `connect-src 'self'`) | `src/lib/server/foods/*` |
| **AI and images** | **On-server, no paid service:** tesseract.js OCR (labels, plan screenshots, package words) and a pinned CLIP model (meal names), baked into the image. **In the browser:** pdf.js and DOCX/XLSX parsing, and camera barcode reading (zxing-wasm). Anthropic adapters exist for Track A and are refused in production. Images are validated, re-encoded and **never stored** | `src/lib/server/labels`, `meals`, `images` |
| **Email** | Resend over HTTPS, all-or-nothing settings; a file stub in development and test. Never used for real yet | `src/lib/server/mail/*` |
| **PWA** | Manifest plus a service worker caching static files and an offline page only. No personal data is cached; no offline data use | `src/app/manifest.ts`, `public/sw.js` |
| **Security headers** | Nonce CSP and HSTS (middleware); X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy (camera on its own origin), COOP, CORP, noindex | `src/middleware.ts`, `next.config.ts` |
| **Image and deployment** | Dockerfile (stages deps, build, migrate, runner; the heap pinned at 768 MB). Compose: the app (2 GB limit, read-only, no capabilities) behind Caddy (HTTPS, 8 MB bodies). The single-server overlay adds PostgreSQL 18 with TLS only and least-privilege roles. `deploy.sh` (backup, guarded migrations and seed, health, smoke, automatic rollback). `backup.sh` and `restore.sh` (age encryption to the owner's key). `cloud-init.yml` | `Dockerfile`, `deploy/` |
| **CI** (GitHub Actions) | `g1-linux.yml` (production image check), `staging-rehearsal.yml` (the whole stack from an empty database), `release-image.yml` (manual publish to GHCR). **No CI runs the unit tests, the type check or the browser suites** (TD-CI) | `.github/workflows/` |
| **Tests** | Vitest: 71 files, 2,309 tests. 33 script suites and 22 Playwright E2E scripts (Chromium, Firefox, WebKit), run by `scripts/run-guarded-suites.cjs` against **marked local test databases only** (the test-target guard) | `scripts/`, `src/**/*.test.ts` |

### Environments

| Environment | Where | Data | State |
|---|---|---|---|
| Development | owner's PC, `fitdb` | development | 4 migrations |
| Test | owner's PC, `fitdb_test` (+ `_other`, `_isolated`) | synthetic, demo account | `fitdb_test` at 10 migrations |
| Review | owner's PC, `fitdb_review`, servers 3002/3003 | **real** (the owner's) | 8 migrations |
| Staging | a Hetzner CX23 (planned) | synthetic only, `*_staging` | **not created**; rehearsed in CI |
| Production | a Hetzner CX33 (planned) | real, starts empty | **not created** |

### Known architectural limits

- **One app instance only.** Rate limits, throttles and the export slot are in memory, per process (S-02, S-17, S-23).
- **Exports are buffered**: 50,000 rows at most, one at a time (EXP-01; EXP-02 is the streamed follow-up).
- **No external monitoring yet** (G6). Backups and restore are rehearsed in CI, not operational.
- Single-server option A means one machine holds the app and the database: recovery relies on the encrypted offsite backups.

**Where the older ARCHITECTURE.md differs from the code** (kept as the historical design):
- it describes BMR/TDEE calorie targets, which were removed (PD-D9);
- it shows Phases 3–4 as planned;
- it gives PostgreSQL 16, where Compose uses 18;
- it says there's no email or reset;
- it plans models that don't exist (ProgressPhoto, FavoriteMeal, assistant, import drafts);
- it omits gyms, feedback and account tokens.

## 3. Phases 1–4

**Status scale:** Proposed, Approved, Implemented, Tested, Integrated, Deployed, Owner accepted.
- **Integrated** = on the release candidate (and on `main` where the row says so).
- **No phase is Deployed or Owner accepted.**

| Phase | Delivered | Status | Remaining to accept | Evidence |
|---|---|---|---|---|
| **1** Training: accounts, profile, plans, schedule, logging, progress | yes | Tested; **on `main`** | — | TR:16; PR #1 |
| **2** Nutrition: providers, foods, targets (2.5 live check) | yes | Tested (live check 15/15, 2026-11-04); on `main` | — | TR:17, PHASE_2_PROGRESS.md |
| **3** (3.1–3.6) Image input, label scan and review, PDF, meal photo, provenance | yes, for development (stub providers) | Tested; on `main` | the 15 production blockers in PHASE_3_PRODUCTION_READINESS.md, since resolved or superseded by the on-server readers and 4.0.x | TR:18 |
| **4.0.0a** Test-target guard | yes | Tested; on `main` (`56606ee`) | — | TR:21 |
| **4.0.1** (A, 1b, 1c) Eligibility, gate, automatic targets removed, nullable targets and profile | yes | Tested; on `main` | legacy rows S-05, S-06 | TR:22–24 |
| **4.0.2** Deletion and export | yes | Tested; on `main` (`b79331d`) | E-06 export fallback wording | TR:25 |
| **4.0.3** Production foundation | yes (code); the operational parts are prepared | Tested locally; on `main` (`de4607f`) | real restore and roles: superseded by RA Parts 9–11 | TR:26 |
| **4.0.4** Email-proven access | yes | Tested against a stand-in; on `main` (`eaeff34`) | real email (C1/C2) | TR:27 |
| **4.0.5** Privacy notice, terms, consent record, data inventory | yes; the notice is a **draft** | Tested; candidate only | NOTICE-B, R-01 | TR:28 |
| **4.1** Weight log and goal card | yes | Tested; candidate only | U-04 acceptance; J-04, J-05, J-06 | TR:29, PHASE_4_1_PROGRESS.md |
| **4.0.6** Readiness: null nutrition, partial totals, idempotent sets | yes | Tested; candidate only | K-04 decision; R-02, R-03, R-12 | TR:30, PHASE_4_0_6_READINESS.md |
| **Phase 4 integration** (`integration/phase-4`) | yes | Tested (41/41 guarded at `1e9bcb6`) | the merge to `main` (separate approval) | PHASE_4_MERGE_READINESS.md |
| **UX-01** Usability and redesign | yes | Tested (responsive matrix, contrast); candidate | **UX-01U, owner acceptance** | TR:288–306 |
| **Demo account** | yes, on `fitdb_test` | Tested; gyms added 2026-11-09 | U-04 | RA Part 10 |
| **Release completion** (SEC, FOOD, EMAIL, AI, MOBILE, DEPLOY, QA, RC) | yes | Tested (46/46 at `a6431ff`) | C1/C2; RC-01, RC-03, RC-05 | TR 2j |
| **Beta capabilities** (BETA-1..5: PWA, barcode, plan import, package photo, feedback) | yes, **ahead of Phase 4.2** | Tested in browsers | E1 real phones; MIG-FB for the cloud | TR 2k, BP |
| **Multi-gym, alternatives, food-photo changes** | yes | Tested (56/56 at `e35f76d`; three independent reviews; no critical or high finding) | **GYM-ACCEPT**; MIG-GYM for the cloud | TR 2l–2n, RA Part 1 |
| **Release execution** (local gates, G1, EXP-01, B2, B1b, migrations on `fitdb_test`) | yes | Tested; final regression at `caca244` | — | RA Parts 7–10 |
| **Staging readiness** (cloud stack) | yes | Tested in CI (108/108; G1 17/17) | the owner's purchases; then a real staging deploy | RA Part 11 |
| **4.2** Real-user beta | — | **Proposed; not started** | everything in ROADMAP §A | PS:250, TR:31 |
| **4.3, 4.4** | partly delivered early (PWA, barcode, swaps); the rest proposed | — | — | ROADMAP §C |

## 4. How work is done here

- **New features go through product review first.** That means the `product-strategy-agent` and the owner's approval ([DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md)).
- **Each phase ends with a UI demonstration and the owner's own acceptance.**
- **Approvals cover only what they name.** Migrations, deployments, merges, paid requests and purchases each need their own explicit approval (CLAUDE.md).
- **Tests run only against marked local test databases.** That's the test-target guard ([PHASE_4_0_0A_TEST_TARGET_GUARD.md](PHASE_4_0_0A_TEST_TARGET_GUARD.md)).
- **Evidence documents are append-only history.** The tracker and RELEASE_ACCEPTANCE are records: their latest sections supersede earlier ones, which are kept, not rewritten.
