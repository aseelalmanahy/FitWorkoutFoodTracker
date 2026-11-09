# Walkthrough demo data

**The fictional account used for the 2026-11-09 application walkthrough, and what each part of it demonstrates.** Entirely fictional: no real person's name, email, credentials or health data. No password, token or key is in this file.

This is **not** the permanent demo account (`demo-account.local.md`, on `fitdb_test`), which was left untouched. Results: [APP_FEATURE_TEST_REPORT.md](APP_FEATURE_TEST_REPORT.md). Screens: [APP_SCREEN_INDEX.md](APP_SCREEN_INDEX.md).

## Where it lives

- **Database:** `fitdb_test_isolated` on the throwaway PostgreSQL cluster from `scripts/disposable-db.cjs` (127.0.0.1:55434, in a temporary folder). It's a marked test database that already held about 1,630 synthetic accounts from automated runs.
- **Lifetime:** `node scripts/disposable-db.cjs --stop` deletes the whole cluster, including this account. Nothing here is a backup, and nothing should depend on it surviving.
- **Credentials:** random, kept only in a scratch file for the session that created them. To use the account again, register a new one through the UI, or ask for a fresh run.

## The person

| Field | Value |
|---|---|
| Name | Maya Torres (fictional) |
| Email | `maya.torres@example.test` (a reserved domain that can't receive mail) |
| Date of birth | 12 April 1991 |
| Units | kg / cm |
| Goal | Fat loss, goal weight 64 kg |
| Nutrition target | 1,900 kcal, protein 130 g, fat 60 g, carbohydrate 210 g (calculated), from 2026-11-09 |

## What's in the account (final counts)

| Data | Count | How it was made | What it demonstrates |
|---|---|---|---|
| Gyms | 2 | UI | **Downtown Fitness**: barbells, dumbbells, machines, cables, bodyweight, plus machines named "Hammer Strength chest press", "Life Fitness leg press" and "Lat pulldown station". **Home garage**: dumbbells, bodyweight, kettlebells, bands. Alternatives are marked differently at each, and history can be filtered by gym |
| Gym equipment rows | 12 | UI | 9 kinds of equipment across the two gyms, plus 3 named machines |
| Workout plans | 6 | UI (2 typed, 4 imported) | **Upper A** and **Lower A** typed in the editor (Lower A's first exercise was later swapped to Bulgarian Split Squat with "update my plan"). Two plans from the **screenshot import** and two from the **PDF import** of "Coach Dana – Week 7 block" (Tuesday push, Saturday pull) |
| Schedule slots | 7 | UI | Mon Upper A, Wed Lower A, Fri Upper A, and the imported Tuesday and Saturday plans (twice each, because the same plan was imported twice) |
| Custom exercise | 1 | UI | "Goblet Squat" (created in the plan editor; saved with the default muscle, Chest) |
| Completed workouts | 20 | **17 seeded**, 3 UI | Six weeks of Mon/Wed/Fri training from 2026-09-28, with one missed Wednesday. Every other Friday is at Home garage with dumbbell variants. Leg Press is always on the named machine. The 3 UI workouts (9 Nov): Upper A at Downtown (with a Lat Pulldown → Pull-Up swap and notes), Lower A at Home garage (Back Squat → Bulgarian Split Squat), and an empty workout with Leg Press on the named machine |
| Sets | 255 | 233 seeded, 22 UI | Enough for charts, PRs, and Improved, Matched and Down comparisons |
| Weigh-ins | 41 | **38 seeded**, 3 UI | 21 Sep to 9 Nov, trending from about 69.8 to 67.4 kg, with daily noise and skipped days. The 3 UI entries (7, 8, 9 Nov) include past dates |
| Food entries | 17 | UI | Two days, 8 and 9 November. Live USDA foods (banana, oats, Greek yogurt, chicken, rice, salmon, potato, eggs, toast, turkey wrap, sirloin, sweet potato, pizza), live Open Food Facts (Coca-Cola by barcode, Sabra hummus), and two of Maya's own foods |
| Custom foods | 2 | UI | "Overnight oats (Maya's recipe)" (typed in), and "Maya's Granola (synthetic)" (from a **label scan**, with one misread value corrected) |
| Nutrition target | 1 | UI | Effective from 9 Nov, so 8 Nov shows "Not set" |
| Feedback | 1 | UI | An improvement request sent from the Nutrition page |

**Why some data is seeded:** the app only logs workouts "now", so six weeks of past workouts and weigh-ins were added directly to the throwaway database, through Prisma, by a script that refused any other database. Everything else was entered through the screens.

### What each part demonstrates

| Screen | What Maya's data shows |
|---|---|
| Dashboard | Today's scheduled workout marked complete; this week's sets, volume and time; "Trend 68 kg, about 4 kg above your goal weight of 64 kg"; recent PRs |
| Progress list | 13 exercises with Improved, Matched, Down and Baseline. Leg Press shows the "0 sessions" defect, WT-03 |
| Barbell Bench Press | 10 sessions from 47.5 to 62.5 kg; records (heaviest 62.5 kg, est. 1RM 79.2 kg); a chart with 4 views |
| Leg Press on its machine | 6 sessions on "Life Fitness leg press", with records of its own |
| History | 20 workouts in three months, filterable by gym |
| Weight | A smoothed trend (68 kg, −1.2 kg since Oct 12) and 41 entries |
| Nutrition, 9 Nov | Four meals, over target: totals, the over-target message, and fiber "not reported by all foods" |
| Nutrition history | Weekly averages, protein consistency, the 8-week trend |

## The other synthetic accounts

| Account | Used for | State now |
|---|---|---|
| `delete.me@example.test` | Sign-up, password reset by emailed link, password change, account deletion | **Deleted** through the UI (0 rows) |
| `young.tester@example.test` (born 2012) | The adults-only rule | Refused at onboarding; the account exists without a profile |

## Synthetic files used for scanning and import

All generated for this walkthrough, and not committed:

| File | Made with | Used for |
|---|---|---|
| A plan as PNG screenshot, text PDF, scanned PDF, CSV, TXT, DOCX, XLSX ("Coach Dana – Week 7 block", 6 exercises) | the repository's `scripts/lib/plan-fixtures.cjs` | plan import, all 7 formats |
| A US-style nutrition label "Maya's Granola (synthetic)" as PNG, text PDF and scanned PDF | `scripts/lib/pdf-fixtures.cjs` and an SVG render | label scanning |
| A package front, "Greek Yogurt · Plain · Nonfat" | an SVG render | package photo without a barcode |
| EAN-13 barcodes 5449000000996 (Coca-Cola, real on Open Food Facts) and 4006381333931, as images and as a camera video | zxing-wasm, as in `scripts/e2e-barcode.cjs` | camera, photo and typed barcode |
| **A meal photo: "Eq it-na pizza-margherita sep2005 sml.jpg"** by Valerio Capello, Wikimedia Commons, **CC BY-SA 3.0** | downloaded from Wikimedia Commons | meal identification. It appears in `07-scanning/20…25` screenshots |
