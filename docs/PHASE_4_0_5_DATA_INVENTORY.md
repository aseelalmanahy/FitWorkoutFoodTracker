# Phase 4.0.5: data-flow inventory

What the app stores and sends, read from the code. `src/lib/data-inventory.json` holds the checkable part, and `src/lib/data-inventory.test.ts` compares it with the code. **This is a record of what's built. It isn't a legal assessment,** and unknowns stay unknown until they're decided.

## What's stored

| Category | Models | Contents |
|---|---|---|
| Account | `User`, `Session`, `AccountToken` | Email, password hash, session hashes, hashed emailed links, notice version and time |
| Profile | `Profile`, `BodyMetric` | Name and date of birth. Optional: sex, height, weight, goal weight, goal, activity, experience, training days, units, time zone, and dated weight entries |
| Training | `Exercise`, `WorkoutTemplate`, `TemplateExercise`, `ScheduleSlot`, `WorkoutSession`, `SessionExercise`, `SetEntry` | Custom exercises, plans, schedule, workouts, sets, repetitions, weights |
| Nutrition | `Food`, `FoodServing`, `FoodEntry`, `NutritionTarget` | Custom foods, diary entries, targets |

Field-level export and deletion rules stay in `src/lib/account-data-map.json`, and aren't repeated. Whether any of this is health data is a legal question (R-01). `possiblyHealthRelated` lists the fields that question is about.

## Where it goes

| Destination | What it receives | State |
|---|---|---|
| USDA FoodData Central (`api.nal.usda.gov`) | Food search text and food ids | Built |
| Open Food Facts (`world.` and `search.openfoodfacts.org`) | Food search text and barcodes | Built |
| Anthropic | Label and meal **photos** | **Conditional.** The code sends them when its settings are present, and startup refuses those settings on a real deployment today |
| Hosting provider | Everything the server handles, and its logs | **Unknown,** Decision 5 |
| Database provider | Everything stored | **Unknown,** Decision 5 |
| Email provider | Addresses, and the links sent to them | **Unknown,** Decision 5 |

**The mail file stub holds addresses and live links,** on development and designated test databases only. Startup refuses it anywhere else.

## How long

| What | Period | State |
|---|---|---|
| Sign-in session | 30 days | Built. **An expired row stays until its owner returns, logs out or deletes the account** |
| Device cookie | 90 days | Built. It holds no password, and stops working when the password changes |
| Sign-up link | 24 hours | Built, a judgement (G-04). **An expired row stays until the next link is requested** (S-22) |
| Password reset link | 60 minutes | Built, a judgement (G-04) |
| Backups | **Unknown** | Decision 12 |
| Logs | **Unknown** | Decision 5 |
| Unused accounts | **Unknown** | R-06 |

## What verifies this

| What | Source | A difference fails when |
|---|---|---|
| Models | `Prisma.dmmf`, which needs no database | One is added, removed or missing from the data map |
| Fields named here | The same | One doesn't exist |
| Call sites | Every non-test file under `src/`, and `next.config.ts`, scanned for network APIs and network packages | A new file uses one, a listed file no longer does, or the server and browser lists are mixed up |
| Hosts | `http(s)://` literals in the same files | A new host appears, or a listed one is gone |
| Mail | `MailTransport` implementations, and `mailTransport()` as the only factory | A new one appears, or a second factory does |
| Dependencies | `package.json` | A new one isn't classified |
| AI settings | `AI_SETTINGS` in `production-config.ts` | One isn't listed |
| Periods marked built | The constants that set them | A constant changes |
| The notice | Its processor and period lists, and its text | It stops matching this inventory |

**Each check is shown failing on a fixture,** and minimum counts stop a check passing by finding nothing.

## What it can't see

**This is a tripwire, not proof.** It can't detect a host known only at run time, base URLs from the environment (`FDC_BASE_URL`, `OFF_BASE_URL`, and `ANTHROPIC_BASE_URL`, which the SDK reads with no mention in `src`), SDK defaults, calls inside dependencies (Next.js, Prisma, the SDK), build-time fetches, what a listed call really sends, the host's own processing, access logs, backups, DNS, or anything under `scripts/`.

**Comments are skipped by simple rules,** so a line of code inside an unusual comment could be missed, and text in a string can match. A match only requires the file to be listed, and the list is reviewed by reading. **Aliased calls are only partly caught:** `const f = fetch` is, and a function handed `fetch` as an argument isn't. A listed package's own use of another network library, such as the SDK's, can't be seen.

**Read by hand:** `src/lib/server/foods/http.ts` logs provider errors, with their text sanitized. Console output otherwise goes through `safe-log.ts`.
