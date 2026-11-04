# Architecture & Delivery Plan

This document answers the six pre-build questions from the product spec and records
the decisions behind the Phase 1 implementation.

---

## 1. Proposed architecture

The repository was empty, so a stack was chosen for a mobile-first web app that
needs authenticated, database-backed APIs now and AI and third-party integrations later.

| Layer | Choice | Reason |
|---|---|---|
| App framework | **Next.js 15 (App Router) + React 19 + TypeScript** | One deployable unit with server rendering and API route handlers. Server components read data directly, so pages load without client fetch waterfalls. |
| Styling | **Tailwind CSS v4** with CSS-variable design tokens | Light and dark themes come from one set of tokens. Components stay consistent. |
| Database | **PostgreSQL 16** | Relational data (users → plans → sessions → sets), transactions, and strong indexing. JSONB is available for AI-extraction drafts later. |
| ORM / migrations | **Prisma 6** | Typed queries and versioned SQL migrations. |
| Auth | Custom **server-side sessions** (Argon2id password hashes, random 256-bit tokens, SHA-256-hashed in the DB, httpOnly cookies) | No third-party identity dependency. Sessions can be revoked. Leaked DB rows don't contain usable tokens. |
| Validation | **Zod 4**, shared between client and server | The server is authoritative. The client reuses the same schemas. |
| Charts | **Recharts** | Lightweight SVG charts that follow theme tokens. |
| Tests | **Vitest** for domain logic. Playwright smoke script for end-to-end flows. | |

### Request flow

```
Browser (mobile-first React UI)
  │  page navigation                       │  mutations (fetch JSON)
  ▼                                        ▼
Server Components ──► src/lib/server/* ◄── Route handlers /api/*  (origin check → auth → zod → handler)
                       (data access, auth)       │
                              │                  ▼
                              └──────► Prisma ──► PostgreSQL
Pure domain logic (no I/O, unit-tested, used on client AND server):
  src/lib/overload.ts  src/lib/energy.ts  src/lib/units.ts  src/lib/time.ts
```

Key rules:
* Every query is scoped by `userId`. Cross-user access returns 404, so a resource's existence isn't revealed.
* Mutating API calls require a same-origin `Origin` header in addition to `SameSite=Lax` cookies (CSRF defence in depth).
* Secrets (DB URL, future `FDC_API_KEY`, AI provider key) are only read in `server-only` modules. Nothing sensitive is sent to the browser.
* Canonical units in storage are **kg, cm, seconds**. Conversion to lb/ft happens only at the UI edge, using exact constants (1 lb = 0.45359237 kg).
* Day and week boundaries use the user's IANA time zone, which the browser captures at onboarding.

---

## 2. Required APIs and dependencies

| Need | Dependency | Phase |
|---|---|---|
| Web framework / UI | `next`, `react`, `react-dom`, `tailwindcss` | 1 |
| DB access | `@prisma/client`, `prisma` (CLI), PostgreSQL ≥ 14 | 1 |
| Password hashing | `@node-rs/argon2` (Argon2id, OWASP parameters m=19 MiB, t=2, p=1) | 1 |
| Validation | `zod` | 1 |
| Charts | `recharts` | 1 |
| Generic foods | **USDA FoodData Central API** (free API key; search uses `POST /foods/search`) | 2 |
| Packaged foods / barcodes | **Open Food Facts API** (no key; descriptive `User-Agent` required) | 2 |
| Barcode decoding | Browser `BarcodeDetector` API where available, with `@zxing/browser` as fallback (on-device, free) | 2 |
| Object storage (photos, uploads) | S3-compatible bucket (e.g. AWS S3, Cloudflare R2), private, accessed via signed URLs | 3–4 |
| PDF text extraction | `pdfjs-dist` server-side for text PDFs. Scanned PDFs go to the vision model. | 3 |
| Vision / document / assistant AI | A multimodal LLM API (e.g. Anthropic Claude) with structured (JSON-schema / tool-use) output | 3–4 |
| Background jobs | DB-backed job table at first (Postgres `SKIP LOCKED`). A queue later if load requires it. | 3 |

---

## 3. Features that require paid AI services

| Feature | Why AI is needed | Cost driver | Free fallback |
|---|---|---|---|
| Camera meal analysis (G) | Identifying foods and estimating portions from a photo requires a vision model | Per-image tokens | Manual search and entry. Barcode scan. |
| PDF / image plan import (J) | Unstructured layouts need to be mapped to structured workouts and targets | Per-page tokens | Manual plan entry. Tesseract OCR for raw text, but layout understanding is weak. |
| AI fitness assistant (M) | Natural-language Q&A over the user's own data | Per-conversation tokens | The deterministic analytics already built (overload status, PRs, completion %) answer most of the example questions without AI. |

Design constraints for the AI features:
* AI output is always a **draft**, saved to an `import_drafts`-style table and shown for review. Nothing is written to user data without explicit confirmation (spec J.6).
* Calorie and macro values from photo analysis are labelled as **estimates with uncertainty**. Image-based portion estimation has substantial error, so every value stays editable.
* The assistant answers through **tool calls into the same server functions the UI uses** (e.g. `getExerciseHistory`, `computeRecords`). It must cite the stored data it used and say "no data" rather than infer history it doesn't have.

---

## 4. Features that can use free or open data

| Source | Use | Licence and terms to respect |
|---|---|---|
| **USDA FoodData Central** | Generic and whole foods (Foundation, SR Legacy, Survey/FNDDS) | Data is public domain (CC0 1.0). The API key comes from api.data.gov, whose default rate limit is about 1,000 requests/hour per key. Keep the key server-side and cache results. |
| **Open Food Facts** | Packaged foods, barcode lookup | Database under **ODbL**, contents under the Database Contents Licence, images CC BY-SA. Requires visible attribution, a share-alike obligation for redistributed derived databases, and an identifying `User-Agent`. Published read-rate limits are per minute and stricter for search than for product lookup. Cache by barcode. |
| On-device barcode decoding | Reading EAN/UPC codes from the camera | Free |
| Deterministic formulas | BMR/TDEE, overload, PRs, weight trend | n/a |

Each stored food will keep `source` (`USDA`, `OFF`, `CUSTOM`, `AI_ESTIMATE`), the source identifier (FDC ID / barcode), and a fetch timestamp. This supports attribution and later refreshes.

---

## 5. Database structure

### Implemented (Phase 1) — see `prisma/schema.prisma`

```
User 1─* Session                (hashed session tokens, expiry)
User 1─1 Profile                (DOB, sex, height, weight, goal, activity, experience,
                                 days/week, units, time zone, calorie override)
User 1─* Exercise               (custom exercises; userId NULL = built-in library, 47 seeded)
User 1─* WorkoutTemplate 1─* TemplateExercise *─1 Exercise
                                 (ordered; target sets, rep range, weight, rest, notes)
User 1─* ScheduleSlot *─1 WorkoutTemplate
                                 (weekday 0=Mon…6=Sun, position; no slot = rest day)
User 1─* WorkoutSession 1─* SessionExercise 1─* SetEntry
         (IN_PROGRESS|COMPLETED,   (ordered, notes,   (setNumber, reps, weightKg,
          started/ended, notes,     rest seconds)      isWarmup, rpe)
          optional templateId)
```

Design notes:
* **Derived metrics (volume, PRs, e1RM, overload status) are computed, not stored.** Editing or deleting a past set therefore can't leave stale records. The queries are indexed (`SessionExercise.exerciseId`, `WorkoutSession(userId, startedAt)`). If history grows large enough to need it, a materialised per-exercise summary table can be added without changing the API.
* Templates and sessions are decoupled. Deleting a plan keeps logged workouts (`templateId → NULL`).
* Built-in exercises can't be deleted while referenced (`onDelete: Restrict`).

### Implemented in Phase 2

```
Food (source USDA|OPEN_FOOD_FACTS|CUSTOM, sourceId, userId NULL = shared cache,
      per-100 g/ml kcal/protein/carbs/fat/fiber as Decimal, NULL = not reported)
  1─* FoodServing (label, amount in g/ml)
User 1─* FoodEntry (local date, meal, foodId → SetNull, per-100 snapshot,
                    serving label/amount, quantity, totals)
User 1─* NutritionTarget (effectiveFrom date, kcal, protein/carbs/fat g, SUGGESTED|MANUAL)
```
`Food.origin` (Phase 2.2) records the provider host that produced a cached row. Rows are reused only when it matches the configured endpoint, so stub or foreign data is never served as live.
Unique constraints: `Food(source, sourceId)`, `FoodServing(foodId, label)`, `NutritionTarget(userId, effectiveFrom)`.

### Planned tables (Phases 3–4)

| Table | Purpose |
|---|---|
| `FavoriteMeal` / `FavoriteMealItem` | Saved meals for one-tap logging |
| `BodyMetric` | userId, measuredAt, kind (weight, waist, hips, chest, arm, thigh…), value (SI) |
| `ProgressPhoto` | userId, takenAt, object-storage key (private, signed URL), pose |
| `Upload` / `ImportDraft` | Uploaded file metadata, AI-extracted JSON draft, status (pending → reviewed → applied/discarded) |
| `AssistantThread` / `AssistantMessage` | Conversation history, with references to the data the tools returned |

---

## 6. Implementation phases

| Phase | Scope | Status |
|---|---|---|
| **1** | Auth, profile (with calorie estimate), exercise library, plans, weekly schedule, workout logging, history, progressive-overload analysis, PRs, per-exercise charts, Phase-1 dashboard | **Implemented** |
| 2 | Nutrition dashboard, USDA and OFF search, barcode lookup (by number), custom foods, macro targets (effective-dated), food logging, nutrition history | **Implemented** (see `PHASE_2_PROGRESS.md`). Not yet: camera barcode scanning, favourite meals, adaptive calorie adjustment |
| 3 | Camera meal analysis, PDF/image plan import with a review/edit/approve workflow | Planned |
| 4 | Body metrics and photos, weight trend, weekly/monthly/long-term dashboard, AI assistant | Planned |

---

## Scientific basis of computed values

| Value | Method | Caveat shown to the user |
|---|---|---|
| BMR | Mifflin-St Jeor (Mifflin et al., *Am J Clin Nutr* 1990;51:241-7): 10·kg + 6.25·cm − 5·age + 5 (men) / −161 (women) | In Frankenfield et al. (*J Am Diet Assoc* 2005;105:775-89) it predicted RMR within ±10 % for most, not all, adults. |
| TDEE | BMR × activity factor (1.2 / 1.375 / 1.55 / 1.725 / 1.9) | Activity factors are coarse and add further uncertainty. |
| Starting target | Fat loss: −15 % of TDEE, capped at −500 kcal/day, never below max(BMR, 1,200 kcal women / 1,500 kcal men). Gain: +10 %, capped at +350 kcal. Maintenance/strength: TDEE. | User can override. Described as a starting point. |
| Macro targets (Phase 2) | Protein 1.6 g/kg (Morton et al., *Br J Sports Med* 2018); 2.0 g/kg when losing fat, referenced to goal weight if lower (Helms et al., *JISSN* 2014). Fat 25 % of energy, floor 0.5 g/kg. Carbohydrate = remaining energy ÷ 4. | Consistent by construction: 4P + 4C + 9F ≤ kcal, within 4 kcal. User-editable. |
| Entry nutrition (Phase 2) | per-100 value × (servings × serving g/ml) ÷ 100, rounded to 0.01 at storage, totals summed from stored values | Missing source values stay NULL and are flagged as incomplete in totals |
| Adaptive adjustment (Phase 2/4) | Back-calculate observed TDEE from mean intake and the change in *trend* weight over 2–4 weeks, using ≈7,700 kcal/kg as an approximation of tissue energy density | The energy density of weight change varies with body composition and adaptation (Hall, *Int J Obes* 2008). Adjust in small steps. |
| Weight trend (Phase 4) | Exponentially weighted moving average of daily weigh-ins | Daily scale weight fluctuates with water and gut content. Change is reported from the trend, not single readings. |
| Volume load | Σ load × reps over working sets (warm-ups excluded) | For unloaded bodyweight movements, total reps are compared instead. |
| Estimated 1RM | Epley: w × (1 + reps/30), computed only for 1–12 reps | Prediction error grows with rep count (LeSuer et al., *JSCR* 1997). Labelled "est." |
| Overload status | Compare with the most recent previous session for that exercise: top load ↑ → improved. Same load: reps at that load ↑/↓. Then total volume ↑/↓. Lower load with higher volume → "mixed". | Status describes a performance change. It isn't a training prescription. |
| Personal records | Heaviest working weight, best e1RM, most reps in one set, best session volume. A record is flagged only when it **strictly** beats all earlier sessions. The first session is the baseline. | |

---

## Security posture (Phase 1)

* Argon2id password hashing. Equal-cost verification for unknown emails (no user enumeration through timing).
* Session cookie: `httpOnly`, `SameSite=Lax`, `Secure` in production, 30-day expiry. Server-side revocation on logout.
* Login throttling (`src/lib/server/login-throttle.ts`): 10 failures per client and account, and 100 per client, per 15 minutes. An account is never locked: after 5 failures, attempts from clients it hasn't seen are spaced 1 to 30 s apart, about 40 per 15 minutes, and a browser with a valid signed device cookie from an earlier login skips that queue. At most 16 password checks and registration hashes run at once, with 2 kept for known devices. Login and registration bodies are limited to 4 KB. Per-client limits need `TRUST_PROXY_HOPS`, because `X-Forwarded-For` proves nothing without a trusted proxy. Registration uses the same client identity, and without it all callers share one limit of 10 per 15 minutes. State is in memory per process, so multi-instance deployments need a shared store.
* Same-origin `Origin` header required on all mutating API calls. With `APP_ORIGIN` set it must match exactly. `X-Forwarded-Host` is read only when `TRUST_PROXY_HOPS` is set.
* Security headers: `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy, and a permissions policy (camera allowed for self only).
* All input is validated server-side with Zod, and numeric ranges are bounded.

* External food providers (Phase 2.4, `src/lib/server/foods/guard.ts`): per-user and global budgets per provider operation, charged only on cache misses.
  USDA 20/min and 150/h per user, 900/h globally (key quota 1,000/h). OFF search 4/min per user, 10/min globally. OFF product 6/min per user, 12/min globally (documented limit: 15/min per IP).
  A circuit breaker opens on a provider 429 (Retry-After, default 60 s, doubling, max 15 min) or after 3 consecutive failures (30 s, doubling, max 5 min).
  Configuration errors are logged server-side and shown to clients as a generic "unavailable".

### Known limitations and follow-ups
* Provider budgets and circuit state are in memory, per process. With N instances the effective global rate is N × budget. Move them to a shared store (e.g. Redis) before scaling out.
* The rate limiter is in-memory (single instance). Move it to Redis or the DB before horizontal scaling.
* There is no email verification or password reset yet. These need a transactional email provider.
* `npm audit` reports an advisory in `deepmerge-ts`, used only by the Prisma **CLI's** config loader (a dev-time tool, not reachable from user input). It clears when the project upgrades to Prisma 7.
