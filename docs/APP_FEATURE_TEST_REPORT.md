# Application feature test report

**A hands-on walkthrough of the running application, 2026-11-09.** Every result below comes from driving the real application in a browser, unless its classification says otherwise. Nothing here is owner acceptance: automated checks and this walkthrough are evidence, not approval.

Related: [APP_USER_GUIDE.md](APP_USER_GUIDE.md) (how to use each feature), [APP_SCREEN_INDEX.md](APP_SCREEN_INDEX.md) (every screen and its screenshot), [APP_DEMO_DATA.md](APP_DEMO_DATA.md) (the synthetic account). The canonical feature list is [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md); this report doesn't change any status there.

## 1. What was tested

| Item | Value |
|---|---|
| Branch | `feature/multi-gym-exercise-alternatives` (the release candidate) |
| Application commit | **`d7d278d`**. Nothing outside `docs/`, `CLAUDE.md` and `README.md` has changed since (checked with `git diff d7d278d..1daff57`), so the docs head `1daff57` runs identical code. No newer application code exists on any branch |
| Build | A fresh production build (`npm run build`) of that commit, served by `next start` |
| Runtime | Node 24.21.0, Next.js 15.5.28, React 19.1.10, Prisma 6.19.3 |
| Database | PostgreSQL 18.6, database `fitdb_test_isolated` on the **throwaway cluster** from `scripts/disposable-db.cjs` (127.0.0.1:55434, its own temporary folder, never the machine's PostgreSQL service). It carries the test-database marker and all 10 migrations, and already held about 1,630 synthetic accounts from earlier automated runs |
| Server | Bound to 127.0.0.1:3310 only, as a designated local test server (`FIT_LOCAL_TEST_SERVER=1`) |
| Browser | Playwright 1.63.0 Chromium, headless. Phone layout 390×844 (Pixel 7 emulation), desktop 1280×860, and a 320 px width check |

**Not touched:** production (none exists), `fitdb`, `fitdb_review`, `fitdb_test`, the permanent demo account, any real person's data, Windows settings. No dependency was installed, and no application code, schema or migration was changed.

### Environment settings for this run

| Setting | Value in this run | On a real deployment |
|---|---|---|
| Registration | **Open**, because a local test server allows it (`FIT_TEST_OPEN_REGISTRATION=1`) | Closed while the privacy notice is a draft, then limited by an allowlist |
| Email | Written to a local folder (the stand-in mailbox). **No real email was sent** | Resend, not yet set up (C1/C2) |
| USDA FoodData Central | **Live**, at `api.nal.usda.gov`, with the key from the local `.env.test` (never printed or committed) | the same, with the production key |
| Open Food Facts | **Live**, at `world.openfoodfacts.org` | the same |
| Label reading | **On this machine** (`LABEL_OCR=local`, tesseract.js 6.0.1 with bundled English data) | the same, planned |
| Meal photos | **On this machine** (`MEAL_RECOGNITION=local`, the pinned CLIP model in `.cache/models`) | the same, planned |
| Paid AI (Anthropic) | **Off.** Every `ANTHROPIC_*`, `LABEL_EXTRACTION_MODEL` and `MEAL_IDENTIFICATION_MODEL` setting was empty | refused by the production preflight |
| Admin | One run only, for the admin page, with the synthetic user temporarily listed in `ADMIN_USER_IDS` | the owner's account |
| Camera | Chromium's fake camera, playing a generated video of a real EAN-13 barcode | a real phone camera (not tested: E1) |

## 2. Startup

**The application started successfully on the first attempt.** The production build compiled (34 pages, 56 API routes). The server answered `/login` and passed the test-target guard's identity check, which confirms it was connected to the throwaway `fitdb_test_isolated` and nothing else. `/api/health` answered `200 {"status":"ok"}`. The server was restarted three times, each time on purpose: to switch from the food stand-in to the live providers, to add the admin setting, and to drop it again. It never failed to start.

## 3. The synthetic accounts

| Account | Purpose | Outcome |
|---|---|---|
| **Maya Torres** (`maya.torres@example.test`, fictional, born 1991) | The main demo user: everything in this report | Created through the real sign-up page. Kept on the throwaway database |
| A disposable account (`delete.me@example.test`) | Password reset, password change, account deletion | Created through the UI, then **deleted through the UI**. 0 rows remain |
| An under-18 account (`young.tester@example.test`, born 2012) | The adults-only rule | Refused at onboarding, as designed |

Passwords were random, kept only in a session scratch file, and never printed or committed. The `example.test` domain can't receive mail. What Maya's account contains is in [APP_DEMO_DATA.md](APP_DEMO_DATA.md).

**Seeded data:** the UI can only log a workout "now", so six weeks of past workouts (17 sessions, 233 sets) and 38 past weigh-ins were added directly to the throwaway database, to make history, charts and comparisons meaningful. Everything else, including 3 live workouts, 3 weigh-ins, the plans, schedule, gyms, every food entry and every scan, was entered through the UI.

## 4. Classifications

| Classification | Meaning here |
|---|---|
| **VERIFIED IN RUNNING UI** | Done by hand in the browser against the running app, with the result checked on screen (and screenshotted) |
| **VERIFIED BY API ONLY** | Checked with a direct HTTP request to the running app, not through a screen |
| **VERIFIED BY AUTOMATED TEST ONLY** | Not exercised in this walkthrough. The existing automated tests or CI cover it (see FEATURE_INVENTORY) |
| **PARTIALLY WORKING** | Part of the capability works, and the row says which part (most are partial by design) |
| **FAILED** | Tried, and it didn't work |
| **BLOCKED / NOT TESTED** | Couldn't or mustn't be tested here; the row says why |
| **NOT IMPLEMENTED** | No code exists, and the UI confirms its absence. Not counted as a failure |

## 5. Feature-by-feature results

One row per feature in [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md), so nothing is counted twice. "WT-" numbers are the defects in section 7.

### Workouts (18)

| Feature | Result | Evidence | Notes |
|---|---|---|---|
| Built-in exercise library (47) | VERIFIED IN RUNNING UI | `03-workouts/01-exercise-picker.png` | 47 exercises, grouped by muscle, with equipment |
| Custom exercises | VERIFIED IN RUNNING UI | `03-workouts/19-create-custom-exercise.png` | "Goblet Squat" created from the plan editor. **Can't be created during a workout (WT-01)**. Unlabeled selects (WT-09) |
| Workout plans | VERIFIED IN RUNNING UI | `03-workouts/02-…`, `05-plan-edit-page.png` | Create, edit (a weight and note persisted after reload), reorder controls, delete (asks first). The empty name is refused. **There is no duplicate-plan function** |
| Weekly schedule | VERIFIED IN RUNNING UI | `03-workouts/09-schedule-saved.png` | Mon/Wed/Fri set and saved; shown on Workouts and the dashboard |
| Sessions, sets, reps, weight | VERIFIED IN RUNNING UI | `03-workouts/12-…`, `14-workout-summary.png` | 3 live workouts, 22 sets. Starting from a plan, an empty workout, finishing and discarding |
| Notes (session, exercise, plan) | VERIFIED IN RUNNING UI | `03-workouts/14-workout-summary.png` | All three kinds saved and shown in history |
| Effort rating (RPE) | PARTIALLY WORKING | `03-workouts/12-session-sets-logged.png` | **Confirmed: the logger has no RPE input**, as the inventory says |
| Rest timer | VERIFIED IN RUNNING UI | `03-workouts/11-set-logged-rest-timer.png` | Starts after each set with the plan's rest, counts down ("Rest 1:31"), shows −15, +15 and Skip. The buttons weren't pressed |
| Workout history | VERIFIED IN RUNNING UI | `03-workouts/15-history-list.png` | 18 then 20 workouts by month, filter by gym, detail pages, "Repeat this workout" |
| Progressive overload | PARTIALLY WORKING (by design) | `06-progress/03-progress-overview.png` | Each session compared with the previous one (Improved, Matched, Down, Baseline). **No next-weight suggestion exists anywhere in the UI** |
| Personal records | VERIFIED IN RUNNING UI | `06-progress/04-exercise-bench-press.png`, `02-dashboard/03-…` | Heaviest, best e1RM, most reps, best volume; PR badges in summaries. Recent PRs repeats an exercise (WT-08) |
| Exercise progress charts | VERIFIED IN RUNNING UI | `06-progress/04-…` | Top weight, e1RM, volume, total reps tabs over 10 sessions |
| Gyms | VERIFIED IN RUNNING UI | `04-gyms/05-both-gyms-configured.png` | Two gyms, rename, history per gym; chosen when starting and changeable mid-workout |
| Gym equipment and named machines | VERIFIED IN RUNNING UI | `04-gyms/03-…`, `05-…` | Kinds and 3 named machines persisted after reload; a machine removed and re-added |
| Machine-specific history | VERIFIED IN RUNNING UI, with a defect | `06-progress/06-…`, `03-workouts/17-machine-sets.png` | "Compared with this machine only" and its own records work. **The Progress list says "0 sessions" (WT-03)** |
| Exercise alternatives and swaps | VERIFIED IN RUNNING UI, with a defect | `04-gyms/06-…` to `11-…` | Alternatives marked by what the chosen gym has; swap for this workout, or also update the plan (verified). The swapped exercise inherits the old target (WT-04) |
| Plan import from documents | VERIFIED IN RUNNING UI | `08-import/03-…` to `08-…` | PDF, CSV, TXT, DOCX and XLSX all read in the browser (no upload seen), every exercise matched. PDF import saved |
| Plan import from screenshots | VERIFIED IN RUNNING UI | `08-import/02-…`, `04-…` | Screenshot (0.3 s) and scanned PDF (0.7 s) read by on-machine OCR; saved with Tuesday and Saturday scheduled |

### Nutrition (16)

| Feature | Result | Evidence | Notes |
|---|---|---|---|
| USDA FoodData Central | VERIFIED IN RUNNING UI (live), with a defect | `05-nutrition/04-…`, `05-…` | Live results matched the USDA API directly (see section 6). **Some large records can't be opened (WT-02)** |
| Open Food Facts | VERIFIED IN RUNNING UI (live) | `05-nutrition/12-…`, `07-scanning/02-…` | Live text search and barcode lookups |
| Food search, ranking, budgets | VERIFIED IN RUNNING UI | `05-nutrition/04-…` | Search by source, result counts. Ranking is noisy (U-03). Budgets and the circuit breaker weren't triggered |
| Custom foods | VERIFIED IN RUNNING UI | `05-nutrition/10-…`, `11-…` | "Overnight oats (Maya's recipe)" created and logged; appears under My foods |
| Serving sizes | VERIFIED IN RUNNING UI, with a defect | `05-nutrition/07-…`, `05-nutrition/15-entry-edit.png` | Real USDA and OFF portions; servings edited later. A raw portion code shows as "90000 (296 g)" (WT-05) |
| Barcode by entry | VERIFIED IN RUNNING UI (live) | `07-scanning/03-…`, `04-…` | Unknown product, invalid check digit (refused before any lookup), letters refused. The timing case is WT-06 |
| Barcode by camera | VERIFIED IN RUNNING UI (simulated camera) | `07-scanning/02-camera-barcode-cola.png` | Decoded on the device from Chromium's fake camera, then a live OFF lookup. **Not on a real phone (E1)** |
| Meal types | VERIFIED IN RUNNING UI | `05-nutrition/14-day-full.png` | Breakfast, lunch, dinner, snacks |
| Calories and macros, daily totals | VERIFIED IN RUNNING UI | `05-nutrition/14-…`, `16-…` | Checked by hand: 118 g banana × 89 kcal/100 g = 105 kcal; 1.5 × 100 g chicken = 248 kcal; totals and "over target" correct after an edit and a delete |
| Daily targets | VERIFIED IN RUNNING UI | `05-nutrition/01-…` to `03-…` | 1,900 kcal, P 130, F 60; carbs calculated as 210 g with the check shown. Out-of-range refused. Effective from today (U-05) |
| Nutrition history | VERIFIED IN RUNNING UI | `05-nutrition/18-history-week.png` | Weekly averages, protein consistency, per-day list, 8-week trend |
| Nutrition label photo | VERIFIED IN RUNNING UI (on-machine OCR) | `07-scanning/11-…` to `19-…` | Read in 0.5 s. "2.5g" misread as "2.59" was **flagged and blocked**, not saved. The paid-AI path wasn't tested (off by design) |
| Label PDFs | VERIFIED IN RUNNING UI | `07-scanning/15-…`, `16-…` | Text PDF: every value right, read in the browser with no server call. Scanned PDF: OCR, with two values flagged for checking |
| Meal photo identification | VERIFIED IN RUNNING UI (on-machine model) | `07-scanning/20-…` to `25-…` | "Possibly pizza" (alternatives ravioli, carbonara) in 0.76 s; names only; the person picks the food and amount |
| Package photo, no barcode | VERIFIED IN RUNNING UI (live) | `07-scanning/21-…` | Words read in 0.37 s, then live candidates. One candidate listed twice (WT-08) |
| Missing nutrients stay null | VERIFIED IN RUNNING UI (live data) | `07-scanning/03-typed-barcode-not-found.png` | A real OFF record with no values shows "— … Not counted as 0" and can't be logged; fiber says "not reported by all foods" |

### Progress (8)

| Feature | Result | Evidence | Notes |
|---|---|---|---|
| Body-weight log | VERIFIED IN RUNNING UI | `06-progress/01-…`, `02-…` | Three days logged, including past dates; an existing date offers "Replace entry"; 700 kg refused (30–300) |
| Weight trend | VERIFIED IN RUNNING UI | `06-progress/01-weight-log-trend.png` | Smoothed trend 68 kg, −1.2 kg since Oct 12, with a plain explanation of its limits |
| Dashboard | VERIFIED IN RUNNING UI | `02-dashboard/01-…` to `03-…` | Empty, scheduled and populated states. The weekly ring is confusing (U-06) |
| Goals | PARTIALLY WORKING (by design) | `02-dashboard/03-…` | "Fat loss: trend 68 kg, about 4 kg above your goal of 64 kg". No date or percentage, as designed |
| Weekly summaries | PARTIALLY WORKING (by design) | `02-dashboard/03-…` | Only the dashboard's week card (sets, volume, time). No summary page |
| Body measurements | NOT IMPLEMENTED | — | No screen or field exists |
| Recovery and sleep | NOT IMPLEMENTED | — | No screen or field exists |
| Progress photos | NOT IMPLEMENTED | — | No screen or field exists |

### Accounts (11)

| Feature | Result | Evidence | Notes |
|---|---|---|---|
| Registration, link-first | VERIFIED IN RUNNING UI (test-server setting) | `01-account/02-…` to `06-…` | Email, emailed link, password (a short one refused), consent box. Open only because this was a local test server |
| Email proof | VERIFIED IN RUNNING UI (stand-in mailbox) | `01-account/03-check-your-email.png` | The link came from the local stand-in mailbox. No real email exists yet (C1/C2) |
| Login and logout | VERIFIED IN RUNNING UI | `01-account/06-…`, `11-…` | A wrong password gives "Incorrect email or password"; after logout, protected pages go to login |
| Password reset | VERIFIED IN RUNNING UI (stand-in mailbox) | `01-account/12-…` to `14-…` | The emailed link set a new password, then login worked. A second request minutes later sent no new email, with the same on-screen message (see section 8) |
| Password change | VERIFIED IN RUNNING UI | `01-account/15-password-changed.png` | "Your other devices have been signed out" |
| Profile and onboarding | VERIFIED IN RUNNING UI | `01-account/07-…` to `10-…` | One step; date of birth confirmed in words; units, goal and goal weight saved |
| Adults only (18+) | VERIFIED IN RUNNING UI | `09-account-privacy/08-under-18-restricted.png` | Refused, and the date isn't saved. Two "Log out" buttons (WT-08) |
| Data export | VERIFIED IN RUNNING UI | `09-account-privacy/01-…`, `02-…` | Password required (a wrong one refused). A 192 KB JSON with 20 workouts, 41 weigh-ins, 17 food entries, 2 gyms, 6 plans, 2 custom foods; **no password hash or token in it** |
| Account deletion | VERIFIED IN RUNNING UI | `09-account-privacy/06-…`, `07-…` | Needs the password and "DELETE" (lowercase refused). Login fails afterwards, and the database has 0 rows for the account |
| Privacy notice and consent | PARTIALLY WORKING (by design) | `09-account-privacy/03-…`, `04-…` | Shows "Draft… isn't for real users" with `[TO CONFIRM]` gaps; acceptance required at sign-up |
| Feedback and admin review | VERIFIED IN RUNNING UI | `09-account-privacy/05-…`, `09-…` | Sent from the Nutrition page; the admin page lists it with status, severity and priority controls and a redacted export |

### Platform (14)

| Feature | Result | Evidence | Notes |
|---|---|---|---|
| Responsive layout and design | VERIFIED IN RUNNING UI | `10-desktop-pwa/*` | Phone, desktop (sidebar), light and dark; no sideways scrolling at 320 px on the dashboard, logger or add-food |
| Installable PWA | VERIFIED IN RUNNING UI (browser checks) | `10-desktop-pwa/offline-page.png` | Manifest (standalone, start `/dashboard`, 192 and 512 icons, maskable) and an active service worker. **Installing wasn't performed, and no real phone was used** |
| Offline data use | NOT IMPLEMENTED (confirmed) | `10-desktop-pwa/offline-page.png` | Offline, a page shows "You're offline… Nothing can be saved", as designed |
| Accessibility | PARTIALLY WORKING | — | **No audit was run.** Observed: labelled controls on most forms, but unlabeled selects (WT-09) and native browser dialogs (U-01) |
| Authentication and sessions | VERIFIED IN RUNNING UI | `01-account/*` | Login, logout and redirects. Cookie flags weren't inspected (the staging rehearsal checks them) |
| Authorization and per-user isolation | VERIFIED BY AUTOMATED TEST ONLY | — | Not attempted across accounts here |
| Rate limits | VERIFIED BY AUTOMATED TEST ONLY | — | Not triggered |
| CSP and security headers | VERIFIED BY API ONLY | — | `/login`: a nonce CSP, `X-Frame-Options: DENY`, `nosniff`, `strict-origin-when-cross-origin`, `camera=(self)`. HSTS absent, as expected on plain-HTTP localhost |
| Email transport (Resend) | VERIFIED BY AUTOMATED TEST ONLY | — | The stand-in mailbox was used; nothing was sent |
| AI providers (Anthropic) | BLOCKED / NOT TESTED | — | Deliberately: a paid service, and refused in production |
| Image validation and on-server reading | VERIFIED IN RUNNING UI | `07-scanning/*`, `08-import/*` | On-machine OCR read label photos, a scanned label PDF, a plan screenshot, a scanned plan PDF and a package photo; the meal model also ran |
| Deployment | VERIFIED BY AUTOMATED TEST ONLY | — | CI (G1 17/17, staging rehearsal 108/108); nothing deployed |
| Encrypted backups and restore | VERIFIED BY AUTOMATED TEST ONLY | — | CI rehearsal |
| Monitoring | PARTIALLY WORKING (by design) | — | `/api/health` answered 200 by API. No external monitoring exists |

### Counts

| Result | Workouts | Nutrition | Progress | Accounts | Platform | **Total** |
|---|---|---|---|---|---|---|
| VERIFIED IN RUNNING UI | 16 | 16 | 3 | 10 | 4 | **49** |
| VERIFIED BY API ONLY | 0 | 0 | 0 | 0 | 1 | **1** |
| VERIFIED BY AUTOMATED TEST ONLY | 0 | 0 | 0 | 0 | 5 | **5** |
| PARTIALLY WORKING | 2 | 0 | 2 | 1 | 2 | **7** |
| FAILED | 0 | 0 | 0 | 0 | 0 | **0** |
| BLOCKED / NOT TESTED | 0 | 0 | 0 | 0 | 1 | **1** |
| NOT IMPLEMENTED | 0 | 0 | 3 | 0 | 1 | **4** |
| **Rows** | 18 | 16 | 8 | 11 | 14 | **67** |

All 7 partial rows are partial by design, and match the inventory. Four of the 49 rows verified in the UI carry a defect from section 7 (machine history WT-03, swaps WT-04, USDA WT-02, serving sizes WT-05), and custom exercises carry WT-01. **No feature failed outright.**

## 6. Live food providers (USDA and Open Food Facts)

The food stand-in was switched off for the whole nutrition walkthrough. Both providers were first checked directly, outside the app, then through the app.

| Check | USDA FoodData Central | Open Food Facts |
|---|---|---|
| **Credentials** | A 40-character key in the local `.env.test`; passed to the app's environment only, never printed or committed (the server log masks it) | None needed. The app's User-Agent names the GitHub repository, not a person |
| **Connectivity** | Up. Search 0.8 s; a food record 0.28 s; a bad key answers 403 in 0.1 s | Up. Product 0.1–1.0 s; search 0.5 s |
| **Response validity** | `Bananas, raw` (fdcId 173944, SR Legacy): 89 kcal/100 g directly, and **89 in the app**. Its 8 portions (medium 118 g, NLEA 126 g…) appeared in the app's serving list | Coca-Cola Original (5449000000996): 42.4 kcal/100 ml directly, **42 in the app**, with OFF's 330 ml serving. 25 real hummus products for "hummus" |
| **Proof it was live, not a stand-in** | The stand-in has 6 foods; the app showed 25 USDA results for "banana raw", and real FDC IDs and data types (Foundation, SR Legacy, Survey) | The stand-in has 8 products; the app found real products (Sabra, Lidl, Hope…) and a real but empty test record |
| **Search** | Works; 25 results a source | Works; 25 results |
| **Nutrition values** | Correct against the API (above) | Correct against the API (above) |
| **Serving sizes** | Real portions | Real serving from the record |
| **Barcode** | — | By camera, photo and typing: found, not found, and a real empty record |
| **Meal logging** | 14 USDA entries logged over two days (one later deleted) | 2 OFF entries logged |
| **Error handling** | **Defect WT-02:** one record (fdcId 330137, "Yogurt, Greek, plain, nonfat", Foundation) failed every time with HTTP 504 and "The food database took too long to respond". The USDA API itself took **8.2 s** to send its 725 KB, and the app stops waiting at 8 s. The message was clear, and other records worked | An unknown barcode showed its record; a real record with no nutrients was refused, never counted as 0. Nutella's code (3017624010966) is "product not found" on OFF today (a data fact; the app's check-digit rule also refuses it) |
| **Integration status** | **Working, with WT-02** | **Working** |

## 7. Defects found

Confirmed means reproduced in the running app. None of these was fixed: this task changed no application code.

| ID | Severity | Defect | How to reproduce | Evidence |
|---|---|---|---|---|
| **WT-01** | **Medium** | **During a workout, the exercise search box clears itself** within about 0.7 s, so you can't search for, or create, an exercise mid-workout; you have to scroll the whole list. The same picker in the plan editor keeps the text. Likely cause: `exercise-picker.tsx` resets the query in an effect that depends on `onClose`, and `workout-logger.tsx:343` passes a new inline `onClose` each time the logger re-renders | Start any workout → Add exercise → type "Goblet". Measured: the text is there at 100 and 400 ms, empty at 700 ms and after. In the plan editor it stays | `03-workouts/20-picker-search-cleared-evidence.png` |
| **WT-02** | **Medium** | **Some USDA records can't be opened**: large Foundation records take longer than the app's 8-second limit (`src/lib/server/foods/http.ts:95`) | Add food → search "greek yogurt plain nonfat" → USDA → choose "Yogurt, Greek, plain, nonfat" (Foundation) → "The food database took too long to respond" (HTTP 504), every time. USDA itself takes 8.2 s for that 725 KB record | server log; section 6 |
| **WT-03** | Low | **The Progress list shows "0 sessions" for an exercise done only on a named machine** (Leg Press: 6 sessions on "Life Fitness leg press"), and the exercise page opens on the empty "No specific machine" view | Log Leg Press with a named machine selected → Progress | `06-progress/03-…`, `05-…`, `06-…` |
| **WT-04** | Low | **A swapped-in exercise inherits the original's target**: Pull-Up (bodyweight) showed "Target 3 × 10–12 @ 45 kg" from Lat Pulldown | Swap Lat Pulldown for Pull-Up in a workout | `04-gyms/07-after-swap-pull-up.png` |
| **WT-05** | Low | **A raw USDA portion code appears as a serving name**: "90000 (296 g)" for "Pizza, cheese, stuffed crust" | Add that USDA food → Serving size list | the serving list, read in the run log; the entry was then set to 2 medium pieces |
| **WT-06** | Low | **A typed-barcode error can be replaced** by the camera-failure notice when the code is submitted before the camera attempt has failed; the code is still never looked up | Open Scan a package where no camera is available, immediately type `5449000000997` and look it up: no "isn't a valid product barcode" message. Waiting about 1.5 s first shows it correctly | `07-scanning/04-…` (the corrected run) |
| **WT-07** | Low | A React hydration error (#418) was logged once on the workout page, while sets were being logged. **Not reproduced** in 4 later fresh loads of an in-progress workout | — | console log of that run |
| **WT-08** | Cosmetic | Repeated controls and rows: two "Log out" buttons on the under-18 screen, two "Close" in Scan a package, Romanian Deadlift twice in Recent PRs, a package-photo candidate listed twice | as described | `09-account-privacy/08-…`, `10-desktop-pwa/desktop-dashboard.png`, `07-scanning/21-…` |
| **WT-09** | Low (accessibility) | The create-exercise form's muscle and equipment selects have **no accessible label**, and the muscle defaults to Chest (a new "Goblet Squat" was saved as Chest) | Plan editor → Add exercise → type a new name → Create | `03-workouts/19-create-custom-exercise.png` |

These are in addition to the known defects in [DECISION_REGISTER.md](DECISION_REGISTER.md) §7. Two known ones were seen again: RC-03 (on-server label reading flags some values) and RC-05 (the meal model names one dish).

## 8. Observations that aren't defects

- **The second password-reset request in a few minutes sent no email**, while the page showed the same "we've sent a link" message. This looks like a deliberate cooldown that hides whether the account exists; worth confirming in the design notes.
- **Overload is a comparison, not advice.** No screen suggests a next weight; the inventory says so too.
- **Squat alternatives at a gym without barbells or machines**: the reviewed table offers Front Squat, Hack Squat and Leg Press, all "not listed at this gym", and no dumbbell option, because split squats and lunges are classed as a different movement. The user has to choose one themselves.
- **"PR · Most reps in a set"** appeared on a Romanian Deadlift done at 24 kg, much lighter than usual, beside a "Down" status. Both are correct by their definitions, but the pair reads oddly.

## 9. Complete user journeys

| # | Journey | Result | Evidence |
|---|---|---|---|
| 1 | A new user registers, sets goals and creates a workout plan | **PASS** | `01-account/02…10`, `05-nutrition/01…02`, `03-workouts/02…04` |
| 2 | Schedules a workout, completes it and reviews history | **PASS** | `03-workouts/09`, `10…14`; WT-04 seen during it |
| 3 | Completes multiple sessions and views progress | **PASS**, with seeded history | 3 live workouts on top of 17 seeded. `06-progress/03…06`, `02-dashboard/03` |
| 4 | Creates two gyms and uses exercise alternatives | **PASS** | `04-gyms/*`. At Home garage no suggested alternative was available, so one was chosen by hand and the plan updated |
| 5 | Searches for food, logs meals and reviews daily totals | **PASS**, live providers | `05-nutrition/04…18`. WT-02 hit once; a different record worked |
| 6 | Scans a food label and confirms the values | **PASS**, on-machine OCR | `07-scanning/11…19`. A misread value was flagged; corrected; confirmed; saved; logged (+120 kcal) |
| 7 | Imports a workout screenshot and creates a schedule | **PASS** | `08-import/02`, `02b`, `09`. Tuesday and Saturday scheduled |
| 8 | Imports a PDF workout plan | **PASS** | `08-import/03`, `03b` |
| 9 | Records weight over several dates and reviews progress | **PASS** | `06-progress/01…02`, `02-dashboard/03` (goal card) |
| 10 | Exports account data | **PASS** | `09-account-privacy/01…02` |
| 11 | A separate disposable user deletes their account | **PASS** | `09-account-privacy/06…07`; 0 rows afterwards |

**11 PASS, 0 FAIL, 0 PARTIAL, 0 BLOCKED.**

## 10. Untested, and why

| Not tested | Why |
|---|---|
| A real iPhone or Android phone: camera, install, touch | No device was used. Everything was a desktop browser with phone emulation and a fake camera (E1 remains open) |
| Firefox and WebKit by hand | Chromium only in this walkthrough; the automated suites cover all three |
| Installing the PWA | Headless Chromium can't complete an install. The manifest and service worker were verified |
| Real email delivery | No mail provider is set up (C1/C2); the stand-in mailbox was used |
| Paid AI label and meal reading | Off by design, and refused in production |
| Registration as it will work on a real deployment | Closed there while the notice is a draft; open here only because this was a local test server |
| Cross-account isolation, rate limits, cookie flags | Covered by automated tests; not exercised by hand |
| An accessibility audit or a screen reader | None was run |
| The rest timer's −15, +15 and Skip buttons; reordering plan exercises; moving a scheduled workout to another day; "Stop using a target"; deleting a weight entry; switching to lb units | Seen on screen, not pressed |
| Performance under load | Out of scope |

## 11. Environment limitations, not app bugs

- The throwaway database already held synthetic accounts and feedback from earlier automated runs, so the admin page lists their feedback too.
- History is partly seeded (section 3); a real user would build it over weeks.
- Phone-width screenshots are full-page captures, so the fixed bottom navigation bar can appear partway down a tall page. That's how the screenshot tool stitches the page, not the app's layout.
- The camera was simulated with a generated video of a real barcode.
- The meal photo is a public photo from Wikimedia Commons (see [APP_DEMO_DATA.md](APP_DEMO_DATA.md)); every other image was generated.
- Several of my scripted steps first picked the wrong control (for example a machine type) and were corrected through the UI. None of these were app faults, and none are reported as such.

## 12. Readiness

**For a guided demonstration to the owner or a small audience: ready**, on a desktop browser or phone emulation, against a throwaway database, with the live food providers. Avoid two things in a demo, or show them as known issues: searching for an exercise mid-workout (WT-01; add it from the plan instead), and the large USDA Foundation records (WT-02).

**For real users (the invited beta): not ready, and this walkthrough doesn't change that.** The blockers in [PROJECT_STATUS.md](PROJECT_STATUS.md) still apply: staging, real phones (E1), the privacy notice and its legal review, real email, production, and the owner's acceptance. WT-01 and WT-02 should be fixed before real people use the logger and food search.

**Owner acceptance: none is recorded.** This report is evidence for it, not a substitute for it.
