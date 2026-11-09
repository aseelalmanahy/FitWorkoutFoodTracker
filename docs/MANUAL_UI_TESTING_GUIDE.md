# Manual UI testing guide

**How to try FitWorkoutFoodTracker yourself, through its real screens, with the permanent demo account.** The sign-in details are in `demo-account.local.md`, on this machine only. This guide holds no passwords.

Phones get a bottom bar. From 768 px a wider column, and from 1024 px a side bar with content up to 1200 px. Try it at more than one width.

## Starting the application

**There is one local application: http://localhost:3400** (ENV-01, 2026-11-09). It runs the newest verified build from `FitWorkoutFoodTracker-programs`, on `fitdb_test`, with the demo account and the live USDA and Open Food Facts services. Paid AI is off. Earlier ports (3000–3003, 3401, 3402) are retired; their folders and databases are kept.

To start it, in PowerShell. Leave the window open; Ctrl+C stops it:

```powershell
cd $HOME\Desktop\FitWorkoutFoodTracker-programs
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
npm run local
```

Before starting, it checks, only reading: the build is newer than the code; `fitdb_test` has exactly this code's migrations; the demo account exists; the USDA key is in `.env.test`; and USDA and Open Food Facts answer. It never migrates, creates an account or adds data: if a migration is missing, it refuses and says which. It prints no password or key. **If the window was closed without stopping it,** this stops whatever is on port 3400:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3400 | ForEach-Object { Stop-Process -Id $_.OwningProcess }
```

**After new code arrives in that folder,** stop it, run the build in step 1 below, and start it again. The steps below are the same thing written out (`npm run local` runs step 2).

In PowerShell, from the repository root. **Don't run `npm run dev` at the same time:** it overwrites the production build these steps need. It also reads `.env` rather than `fitdb_test`, so the demo account doesn't exist there.

**1. Once, and again after changing branches or code. Stop the app first with Ctrl+C,** as Windows won't let Prisma replace a file the running app is using:

```powershell
$env:DATABASE_URL = "postgresql://none:none@127.0.0.1:1/fitdb_test"
node node_modules/prisma/build/index.js generate
if ($LASTEXITCODE -eq 0) { node node_modules/next/dist/bin/next build }
if ($LASTEXITCODE -ne 0) { "This stopped with an error. Is the app still running?" }
Remove-Item Env:DATABASE_URL
```

That address is deliberately a closed port, so building reaches no database.

**2. To run it. Leave this window open, and press Ctrl+C to stop:**

```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
node --env-file=.env.test scripts/demo-server.cjs --confirm=fitdb_test
```

Wait for `Running at http://localhost:3400, verified on fitdb_test`, and use the address it prints. If port 3400 is taken, it refuses: stop what's using it.

**3. Open that address in Chrome, Edge or Firefox.** Safari and other WebKit browsers can't stay signed in over plain `http://localhost`, as the session cookie is `Secure`.

## Signing in

Enter the email and password from `demo-account.local.md`, and choose **Log in**. You go straight to the dashboard, as onboarding is already complete.

To add days since the demo data was last filled in, run this. It only adds what's missing, keeps your password, and brings back any demo row you deleted:

```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
node --env-file=.env.test scripts/demo-account.cjs --populate --confirm=fitdb_test
```

## What's in the demo account

| Area | Demo data |
|---|---|
| Profile | FitWorkoutFoodTracker Demo, born 1992, 5 ft 10 in, pounds and feet, goal of fat loss, target of 172 lb |
| Plans | Upper Body A, Lower Body A, Upper Body B, Lower Body B |
| Schedule | Monday, Tuesday, Thursday and Saturday. Wednesday, Friday and Sunday are rest days |
| Workouts | Finished workouts from September 12, 2026, with weights rising. Now and then a workout is missed |
| Nutrition | Most days from October 24, 2026, with two targets. Today has breakfast and lunch only |
| Weight | Most days from September 12, 2026, trending from about 190 lb to 183 lb |
| Gyms (only with the multi-gym migration) | City Gym (barbells, dumbbells, machines, cables, bodyweight; named machines "Lat pulldown station" and "Plate-loaded leg press") and Home gym (dumbbells, cables, bodyweight, bands). Workouts from October 19, 2026 are at a gym: Upper Body B at home, the rest at City Gym. The first Upper Body A from then has a swap: two bench sets, then dumbbell bench press. Earlier workouts have no gym |

All of it is made up for demonstration. **The foods aren't a nutrition reference.** Their names end in "(demo)".

## Phase 1: accounts, plans and workouts

| # | Where | Do this | What should happen |
|---|---|---|---|
| 1.1 | Login page | Enter a wrong password | "Incorrect email or password", and you stay on the page |
| 1.2 | Login page | Enter the right password | The dashboard opens |
| 1.3 | Workouts → This week | Look at it | Today's plan, or Rest, with finished days marked Done |
| 1.4 | Workouts → My plans | Open **Upper Body A** | Its exercises, with sets, reps and target weights |
| 1.5 | Workouts → This week → Edit | Look at it, or change a day | Plans by day, and "Rest day" for Wednesday, Friday and Sunday |
| 1.6 | Workouts → My plans → **Start** on a plan | Enter a weight and reps, and tap the tick | The set is saved, and a rest timer starts. "Previous" shows the last workout's sets |
| 1.7 | While logging | Tap **Finish** | It asks you to confirm, then opens the finished workout, with **Repeat this workout** |
| 1.8 | Finished workout | Tap **Repeat this workout** | A new workout opens, with the same exercises and no sets yet |
| 1.9 | While logging | Tap **Discard workout** | It asks you to confirm, and removes that workout |
| 1.10 | Workouts → History | Open a workout | Its sets, volume and time |

**Try these errors:** tap **Finish** with no sets logged, and you're told to log at least one. Starting a workout and logging a set on a very slow connection, then tapping **Finish** straight away, says a set is still saving.

## Phase 2: nutrition

| # | Where | Do this | What should happen |
|---|---|---|---|
| 2.1 | Nutrition | Look at today | Breakfast and lunch, with calories and macros against the 2,150 kcal target |
| 2.2 | Nutrition → the arrows at the top | Go back a day | That day's meals |
| 2.3 | Nutrition → add food → search "banana" | Look at the results | Your demo food, and live USDA results (on http://localhost:3400; an older stand-in setup showed a "Test data" note instead) |
| 2.4 | Add food → pick a food | Save it | It appears in that meal, and the totals rise |
| 2.5 | Nutrition → Targets | Look at it | The current target, with carbs worked out from the rest |
| 2.6 | Nutrition → History | Look at this week | Daily calories against the target, and weekly averages |
| 2.7 | Nutrition, at `/nutrition?date=2026-10-28` | Look at that day | Only an unmeasured food: **a dash, not 0,** for calories and macros |
| 2.8 | Nutrition → History | Find a day marked "incomplete" | Its totals include only what its foods report. It isn't called below target because of that alone |

**Try this error:** enter a target with very few calories for the protein and fat, and see what it says.

## The review environment: real data, real food databases

**Retired (ENV-01, 2026-11-09).** Use http://localhost:3400 instead. `fitdb_review` and its folder are kept, not deleted, and not started. This section is kept for history. It ran the redesigned app on its own database, `fitdb_review`, with the real USDA FoodData Central and Open Food Facts services. What you enter is kept, including across restarts. It's in its own folder, `FitWorkoutFoodTracker-review`, beside this one, and doesn't affect the demo on port 3000 or 3001.

| | |
|---|---|
| Address | http://localhost:3002 (only this computer can reach it) |
| Your account | Email and password in `FitWorkoutFoodTracker-review\review-account.local.md`, which Git ignores |
| Database | `fitdb_review`, on this computer. Never `fitdb` or `fitdb_test` |

**To start it,** in PowerShell. Leave the window open; Ctrl+C stops it:

```powershell
cd $HOME\Desktop\FitWorkoutFoodTracker-review
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
node --env-file=.env.review scripts/review-server.cjs --confirm=fitdb_review
```

Wait for `Running at http://localhost:3002`. **If the window was closed without stopping it,** this stops whatever is on port 3002:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3002 | ForEach-Object { Stop-Process -Id $_.OwningProcess }
```

**First time:** sign in, then fill in your profile, as a new user would. Your account starts empty: no workouts, food or measurements.

**What's real here, and what isn't:**

| | |
|---|---|
| Real | Workouts, notes, food logging, targets, weight, history, charts, export, deletion, all stored in `fitdb_review`. USDA and Open Food Facts searches, product details and barcode lookups, live |
| Limits | Open Food Facts allows each person **4 searches a minute** (10 for the whole app). Typing a long word can use several, and the app then says so. USDA allows 20 a minute. Results are the providers' own, with their order and gaps |
| Not available | Photo label scanning and meal photos (paid AI, off). Sign-up, and password reset by email (no email service). Ask for a new account if a password is lost |

**One real password-reset email (journey G), once C1 and C2 are approved.** With the three mail settings from C1 in `.env.review`, restart the review server, then create the one test account at an inbox you control. It has no known password, so only the emailed link opens it:

```powershell
cd $HOME\Desktop\FitWorkoutFoodTracker-release
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
node --env-file=.env.review scripts/review-account.cjs --mail-tester --email=<your address> --confirm=fitdb_review
```

| # | Do this | Passes when |
|---|---|---|
| G.1 | On the review server, **Forgot password**, with that address | The page says the same as for any address. The email arrives within a few minutes (if in spam, note it), from your `MAIL_FROM` |
| G.2 | In the email, **Show original** | SPF and DKIM both say pass |
| G.3 | Open the link | The reset page of the review server's own address (`http://localhost:3003`, or the tailnet name if started with `--origin`) |
| G.4 | Set a new password, then sign in with it | Sign-in works with the new password only. A second "password changed" email arrives |
| G.5 | Open the same link again | It's refused: a link works once, for 60 minutes |
| G.6 | **Forgot password** with an address that has no account | The same answer on screen, and no email |

## UX-01: food search, layout, design and notes

UX-01 is part of the build on http://localhost:3400; the separate preview below is retired (ENV-01). On `feature/ux-reliability-redesign`. To try it without disturbing the demo on port 3000, build and run it from its own folder, `FitWorkoutFoodTracker-ux`, beside this one, with the same two steps above and `--port=3001`, and with `--env-file=..\FitWorkoutFoodTracker\.env.test`, as `.env.test` stays in this folder only.

**After A1 (this computer only).** The UX-01 preview keeps its own build, but is served by the release folder's launcher, which listens on this computer only. Stop the old preview on 3001 first, then:

```powershell
cd $HOME\Desktop\FitWorkoutFoodTracker-release
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
node --env-file=..\FitWorkoutFoodTracker\.env.test scripts/demo-server.cjs --confirm=fitdb_test --port=3001 --app-dir=..\FitWorkoutFoodTracker-ux
```

It says `Running at http://localhost:3001 (127.0.0.1 only) from …FitWorkoutFoodTracker-ux`. The demo on 3000 is the same, with `--port=3000` and `--app-dir=` the folder it's served from now.

| # | Where | Do this | What should happen |
|---|---|---|---|
| X.1 | Login page, on a wide window | Look at it | A slate brand panel on the left, the same form on the right. On a phone, a small header above the form |
| X.2 | Add food, before typing | Look under the search box | "Type at least 2 characters to search", and what the chosen source means. Recent foods are listed |
| X.3 | Add food | Search **large egg** | "Whole egg (demo)" under My foods, as its serving is "1 large" |
| X.4 | Add food | Search **egg**, then choose **USDA foods** | "No USDA results for "egg"", "Found in My foods (1)", and **Show all sources**, which brings it back |
| X.5 | Add food | Search **banana**, then try each source | Each source shows only its own results, with its count on the chip. The test-data note is shown |
| X.6 | Add food | Search **eggs** or **oatmeal** | Nothing found, and it says so plainly: the demo has no such records |
| X.7 | Add food → Whole egg (demo) | Choose 2 servings, and add it | The sheet shows 1 large, and logging adds it to the meal |
| X.8 | Every page, at 1440, 820 and 390 px | Look at it | Side bar on desktop, bottom bar below that. No sideways scrolling |
| X.9 | Progress → an exercise, and Progress → Weight log | Look at the charts | Muted slate charts with a legend. Improved, Matched and Down keep their icons and words |
| X.10 | Nutrition → History | Look at the charts | Calorie bars with a dashed target, and the trend with protein dashed |
| X.11 | While logging a workout | Tap **Add a note on how it felt** on an exercise, type, then **Done** | The note shows on that exercise. "Saved" confirms it |
| X.12 | While logging | Type in **Workout notes**, then Finish | The finished workout shows "Exercise note" on that exercise and "Workout notes" for the session, read-only |
| X.13 | Profile → Units, and a dark-mode system setting | Switch | Everything stays readable in light and dark |

**Logging food or finishing a workout adds rows to the demo account,** as using it always has. Nothing else changes in the demo data.

## Release completion: the candidate build on port 3003

On `feature/release-completion`, in the folder `FitWorkoutFoodTracker-release`. **It runs beside the stable review server, on the same database and with your same account,** so what you enter in either appears in both. Port 3002 keeps running the earlier, stable build. Nothing here changes the database's structure.

```powershell
cd $HOME\Desktop\FitWorkoutFoodTracker-release
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$env:LABEL_OCR = "local"
$env:MEAL_RECOGNITION = "local"
node --env-file=.env.review scripts/review-server.cjs --confirm=fitdb_review --port=3003
```

Wait for `Running at http://localhost:3003`. **Meal photos need their model once:** if the start is refused with "the model file … is missing", run `node scripts/meal-model-fetch.cjs` in the same folder first (about 150 MB, checked against recorded hashes).

**If it says port 3003 is already held,** it names the process and whether it's this folder's own server left running. Stop only that one with `node scripts/review-server.cjs --stop --port=3003`: it refuses anything else, including the stable server on 3002, which belongs to another folder. **Sign in once on each port:** both are `localhost`, so they share a sign-in cookie; signing out on one signs you out on the other.

| # | Where | Do this | What should happen |
|---|---|---|---|
| R.1 | Add food | Type **eg**, then **egg** | With 2 letters, only My foods is searched, and it says "Type 3 or more characters to search USDA and packaged foods too". With 3, USDA and packaged foods are searched too, once you stop typing |
| R.2 | Add food | Search **egg**, **banana**, **beef**, **greek yogurt** | Plain, raw foods near the top: "Egg, whole, raw", "Banana, raw", "Beef, ground, raw". Results are the providers' own records |
| R.3 | Add food | Search the same word twice within a minute | The second answer is immediate, from the app's short-lived cache, and doesn't use your Open Food Facts allowance |
| R.4 | Add food | Search a barcode, for example **3017620422003** | One packaged product (Nutella), with its own per-100 g values. A code that doesn't exist finds nothing, and says so |
| R.5 | Nutrition → Add → **Scan a nutrition label** | Photograph or upload a clear, straight nutrition label, Continue, then **Use this** | In a second or two, the review screen. It says the values were read **by text recognition on this server**. Nothing leaves this computer |
| R.6 | The review screen | Compare every number with the label | Each is either exactly what's printed or empty with a reason. **A number that's different from the label is a defect: please report it with the photo.** The product name is empty for you to type |
| R.7 | The review screen | Correct a value, type the name, check the confirmation, save, then **Add to diary** | The food is saved once, then logged like any of your foods |
| R.8 | Nutrition → Add → **Identify foods in a photo** | Upload a photo of one dish (a pizza, a salad, a bowl of rice), then **Identify foods** | In about a second: "Possibly …", the two closest alternatives, and a notice that a model on this server names only the main dish. No amount or calorie appears anywhere |
| R.9 | The suggestion | Accept it or correct the name, then **Find this food**, choose a meal and a food, type how much you had, and add it | The food's values come from the record you chose, for the amount you typed. Anything else on the plate: **Add a food the AI missed** |
| R.10 | Identify a meal | Upload a photo with no food (a document, a room) | It says it found no food, rather than naming a dish |

**What to expect from label reading:** it's ordinary text recognition, not AI. Every label is read twice, two different ways, and only the numbers both readings agree on are filled in; the rest are left empty with both readings shown in the reason. It reads clean, flat, well-lit, printed labels well. **On real packets it leaves most values for you:** measured on 21 real photos from Open Food Facts, it recognized 9 as labels and filled in only 5 values, none wrong. Curved or glossy packets, light text on dark panels, and labels in several languages side by side are the hardest. It never fills in a value it couldn't read.

**What to expect from meal photos:** the model compares the whole photo with a list of 116 dishes and foods. On 35 real photos it named the right food first in 23 and among its three in 30. It can't count, weigh or see more than the main dish: you choose the foods and amounts.

**On your phones (not yet possible):** once Tailscale is approved and installed (tracker section 2j, group E), start the server with `--origin=https://<your-pc>.<your-tailnet>.ts.net` and open that address on the phone. The server stays on this computer only; Tailscale carries it to your own signed-in devices. While `--origin` is set, use that address on this computer too.

**Before E1, know this:** Tailscale's HTTPS certificate is public. Every certificate is published in Certificate Transparency logs, so the names `<your-pc>` and `<your-tailnet>` become publicly searchable, though the address stays reachable only from your own signed-in devices. Choose a machine name you don't mind being public. Device setup: Tailscale on this PC, the iPhone and the Android phone, all signed in to the same personal tailnet; MagicDNS and HTTPS certificates turned on in the Tailscale admin page; `tailscale serve --bg 3003` on this PC. Use review tester 2's account on the phones, not your own.

| # | iPhone, Safari | Android, Chrome | Passes when |
|---|---|---|---|
| H.1 | Open the address | Same | It loads with a padlock and no certificate warning |
| H.2 | Sign in | Same | The dashboard appears |
| H.3 | Close Safari completely, reopen the address | Close Chrome completely, reopen | Still signed in |
| H.4 | Nutrition → Scan a label → **Take photo** | Same | The phone asks for camera permission once, and the camera opens. Refusing it leaves the photo library choice working |
| H.5 | Choose a photo from the library (iPhone photos are HEIC) | Take a photo with the camera (JPEG) | It's accepted, and the label review appears (read on the server, as the screen says) |
| H.6 | Log a food from search, with a serving | Same | It appears in today's meal, with totals that add up |
| H.7 | Start a workout, log two sets, add a note, Finish | Same | It appears in history with its sets and note |
| H.8 | Every page, upright and sideways | Same | Nothing is wider than the screen; the bottom bar is reachable |
| H.9 | Sign out, then press Back | Same | You stay signed out |
| H.10 | From a phone not on your tailnet (Wi-Fi off, mobile data, Tailscale off) | Same | The address doesn't open |

Browser emulation on this computer (WebKit at phone size through a local HTTPS stand-in) passed the app's side of this, but **H.1 to H.10 only count when done on the real phones.**

## Phase 3: photo features, unavailable here

**Scan a label and Identify a meal need a paid AI service, which is off here,** so don't expect results from them. The add-food screen hides the link to scanning for that reason. They were tested against a local stand-in.

## Phase 4: account, privacy, weight and goals

| # | Where | Do this | What should happen |
|---|---|---|---|
| 4.1 | Today | Look at the goal card | "Trend" in pounds, and how far it is above your goal of 172 lb, with no prediction or praise |
| 4.2 | Progress → Weight log | Look at it | The trend, the change since about four weeks ago, a chart with a dot for each weigh-in, and the entries |
| 4.3 | Weight log | Enter a new weight for today | It says you've already logged today, and that saving replaces it. Saving does |
| 4.4 | Weight log | Enter 20 lb, or 700 lb | It's refused, with the allowed range, and nothing changes |
| 4.5 | Weight log | Delete an entry | It asks you to confirm, and removes that entry |
| 4.6 | Progress | Look at the list | Exercises marked Improved, Matched or Down |
| 4.7 | Progress → an exercise | Look at it | A chart, personal records, and every session |
| 4.8 | Profile | Tap the chosen goal, and save | The goal clears. It's optional, so the dashboard asks instead of comparing |
| 4.9 | Profile | Change units to kg / cm, and back | Weights across the app change units |
| 4.10 | Profile → your account and data | Download my data, with the password | A JSON file with your profile, workouts, food log, targets and weight log |
| 4.11 | `/privacy` and `/terms` | Open them | Each is public, and marked as a draft with its version |
| 4.12 | Profile → Log out | Do it | You're signed out. Going to `/dashboard` returns you to the login page |

**Please don't use Delete my account on the demo account.** It works, and removes everything. Populating again would rebuild the demo data from the same password, but your own additions would be gone.

**Not available here:** signing up a new account (registration stays closed while the notice is a draft, and no real email is sent), and password-reset emails.

## Multi-gym, exercise swaps and package photos

**On `feature/multi-gym-exercise-alternatives`. This build needs two migrations the owner hasn't approved yet:** `20261108120000_feedback` (MIG-FB) and `20261109120000_multi_gym` (MIG-GYM). `fitdb_test` has neither. Without them, the workout pages of this build fail there. Until you approve applying them to `fitdb_test`, use the preview on the disposable test database described in the session report, which has both. After they're applied, `demo-account.cjs --populate` adds the gyms. It says `Multi-gym rows skipped` when the migration isn't there.

| # | Where | Do this | What should happen |
|---|---|---|---|
| MG.1 | Workouts → Gyms (under "Training at") | Add "Hotel gym". Then add "hotel GYM" | The first is added. The second is refused: you already have a gym with that name |
| MG.2 | Gyms | Rename Hotel gym, and tick Dumbbells and Bodyweight | The name changes. Each box changes as you tap it, and stays after a reload |
| MG.3 | Gyms → Hotel gym | Add a machine "Smith machine", type Machines | It's listed under Machines. Remove it: it goes. A machine that workouts used can't be removed |
| MG.4 | Workouts | Choose "Training at: City Gym", then Start Upper Body A | The workout's header shows City Gym. You can change it there during the workout |
| MG.5 | The workout | Log two sets of Barbell Bench Press, then Swap exercise | A list of the same movement (Dumbbell Bench Press, Machine Chest Press, Push-Up), each marked by what City Gym has. Never Cable Fly, a different movement for the same muscle |
| MG.6 | Swap sheet | Choose Dumbbell Bench Press, leave "Also change my plan" off, and swap | The bench press says "Swapped out; its sets are kept", with your two sets. Dumbbell Bench Press follows it, "Swapped in for Barbell Bench Press" |
| MG.7 | The workout | On Lat Pulldown, before logging, choose the machine "Lat pulldown station" | It says it's compared with this machine only, and "Previous" shows only that machine's sets |
| MG.8 | Finish the workout | Look at the summary | "At City Gym", the swap on both exercises, and the machine. Comparisons and PRs are per machine |
| MG.9 | Workouts → Plans → Upper Body A | Look at it | Still Barbell Bench Press: the plan didn't change. Swapping with "Also change my plan" ticked changes that entry only |
| MG.10 | History | Tap City Gym, then Home gym | Only the workouts at that gym. Workouts from before gyms are under All only |
| MG.11 | Progress → Lat Pulldown | Look, then tap "Lat pulldown station" | First the history with no specific machine, then the machine's own sessions and records, each labelled |
| MG.12 | Today → Add food → Scan a barcode → Use a photo | Choose a photo of a package front with no barcode | Its words are read, searched once, and up to five possible products shown with their source. Here, they're marked as test data |
| MG.13 | Package matches | Tap one, then "No, show the other matches", then tap one and "Yes, choose an amount" | Nothing is logged until you choose an amount. The logged values are the product record's, not the photo's |
| MG.14 | Package matches | Change the words and Search, or "Open in food search" | It searches again in the sheet, or opens the usual search with those words. Scan the label and Create my own food stay there |
| MG.15 | Side bar (wide window), welcome page, emails | Look at the name | FitWorkoutFoodTracker everywhere. No "Forge" |

**Not here:** GPS or locations (by design), a shared gym list, and AI suggestions for swaps (alternatives are reviewed movement patterns and your own earlier swaps only).

## UI-02: Progress views

On http://localhost:3400. The Exercise progress cards and badges are meant to look and work exactly as before ([BUG_TRACKER.md](BUG_TRACKER.md) UI-02).

| # | Where | Do this | What should happen |
|---|---|---|---|
| P.1 | Progress | Open it | Three tabs: **Training programs** (selected), **Exercise progress**, **Body weight** |
| P.2 | Training programs | Look at it | Each program with its workout count and last date, then months (the latest open), then each workout's date and exercises, each with a badge. Workouts not from a program are under **Not in a program** |
| P.3 | Training programs | Tap a workout's name, then go back and tap an exercise | The finished workout opens; the exercise opens its progress detail |
| P.4 | Workouts → a program → take a day out, then Progress | Look at it | That day's past workouts move to Not in a program, as the note under the list says. Put it back afterwards |
| P.5 | Exercise progress | Look at it | The same cards and badges as before: Improved green, Down orange, Matched blue, Baseline neutral. A card opens its exercise |
| P.6 | Body weight | Tap it | The weight log opens |
| P.7 | Progress, on a phone width | Look at it | All three tabs visible, and no sideways scrolling |
| P.8 | Training programs → a month → a workout date → an exercise | Tap each in turn | The exercise opens in place: its sets, the machine if any, the previous comparable workout with the change in numbers, recent history with each badge as it was then, and **View full exercise chart** |

## UI-03 to UI-08: schedule, active program, management and nutrition dates

On http://localhost:3400, once MIG-ACTIVE is applied. Your existing schedule is **left exactly as it is** until you confirm an active program, and that preview lists every change first. Choose **Cancel** in the preview if you only want to look.

| # | Where | Do this | What should happen |
|---|---|---|---|
| A.1 | Workouts | Look at it | "Choose your active program", and "No active program chosen" under This week. Nothing was chosen for you |
| A.2 | A program → **Set as active** | Look, change a day's weekday chips, then **Cancel** | Each workout with its suggested days; the exact entries that would be removed and added. Cancel changes nothing |
| A.3 | The same, then **Make “…” active** | Confirm | Workouts shows it as **Active program**; This week says "From your active program …" and matches its days |
| A.4 | Weekly schedule (Edit schedule) | Look at it | Each day: the workout's full name, its program and exercise count, and **Change**, **Move**, **Remove**; empty days say Rest day |
| A.5 | Weekly schedule → **Add workout** on a rest day | Look at the chooser | Nothing is selected; **Choose** is disabled until you pick one. Only your active program's workouts are offered, and the page says why |
| A.6 | Weekly schedule | Change one, move one, remove one; then **Discard changes** | "Unsaved changes" while editing; Discard returns to the saved week. Nothing is saved until **Save schedule** |
| A.7 | Weekly schedule, on a phone | Look at it | Names wrap; the three buttons are full-size; no sideways scrolling |
| A.8 | Workouts → an individual plan or a program day → **Delete** | Read it, then **Cancel** | It says which schedule days lose it and that logged workouts stay. Cancel deletes nothing. (Try deleting only a plan you don't need.) |
| A.9 | Workouts → a program → **Delete** | Read it, then Cancel | Its plans stay as individual plans, with their schedule and history; if active, no program will be active |
| N.1 | Nutrition → the date in the middle | Pick another day, then **Jump to today** | That day's meals and totals load; Jump to today returns |
| N.2 | Nutrition → History → the period in the middle | Choose a start after the end | It says the start is after the end, and Apply is disabled |
| N.3 | The same, with a valid range of a few weeks | Apply | "Averages for this period", that period's days and chart (labelled by date); the trend still says 8 weeks, with its dates. **Back to this week** returns |

## Known limitations

- **Local only.** One Windows machine, with a local production build, on `fitdb_test`. Nothing is deployed.
- **Not verified on a real iPhone or Android phone.** Browser testing at phone size isn't the same.
- **The privacy notice and terms are drafts,** with no legal review. There's been no clinical review either.
- **Two unexplained one-off test failures are open.** Tracker T-25 (the emailed sign-up link's page) and T-27 (after Finish, the finished page didn't appear). If you see either, please report it.
- **Finished workouts can still be changed by their owner** from a page left open (K-04), and a malformed address can give a bare error on some pages (J-07).
- **Open product decisions** are in `PHASE_4_MERGE_READINESS.md`, including how much evidence a numerical weight change needs (J-05).
- **UX-01's browser suites now run on the release branch,** which contains UX-01's code, against the separate `fitdb_test_isolated`, in Chromium, Firefox and WebKit (including `responsive`: 13 views, 4 widths, 2 themes). The preview on 3001 is UX-01's own build, which those suites don't drive. **Only you can accept UX-01.**
- **The local food stand-in is small.** It has no egg, plain milk or oats, so "eggs" and "oatmeal" find nothing here. That's the demo data, not the real catalogs, which weren't called.

## Reporting a defect

Say which step from this guide, what you did, what you expected, what happened, and the browser. A screenshot helps. **Leave out the password.**

## For each new phase

New features add a section here, and demo data to `scripts/lib/demo-account-data.cjs`. A phase isn't accepted until the owner has tried it and said so. See `DEVELOPMENT_WORKFLOW.md`.
