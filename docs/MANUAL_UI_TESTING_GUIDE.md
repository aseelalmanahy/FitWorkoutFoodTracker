# Manual UI testing guide

**How to try FitWorkoutFoodTracker yourself, through its real screens, with the permanent demo account.** The sign-in details are in `demo-account.local.md`, on this machine only. This guide holds no passwords.

The app is built for phones first, so a narrow browser window shows it as intended.

## Starting the application

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

Wait for `Running at http://localhost:3000, verified on fitdb_test`, and use the address it prints. If port 3000 is taken, it refuses: stop what's using it, or add `--port=3001`.

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
| 2.3 | Nutrition → add food → search "banana" | Look at the results | Your demo food, and a USDA-labelled result. **That result comes from a local stand-in, and not from USDA** |
| 2.4 | Add food → pick a food | Save it | It appears in that meal, and the totals rise |
| 2.5 | Nutrition → Targets | Look at it | The current target, with carbs worked out from the rest |
| 2.6 | Nutrition → History | Look at this week | Daily calories against the target, and weekly averages |
| 2.7 | Nutrition, at `/nutrition?date=2026-10-28` | Look at that day | Only an unmeasured food: **a dash, not 0,** for calories and macros |
| 2.8 | Nutrition → History | Find a day marked "incomplete" | Its totals include only what its foods report. It isn't called below target because of that alone |

**Try this error:** enter a target with very few calories for the protein and fat, and see what it says.

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

## Known limitations

- **Local only.** One Windows machine, with a local production build, on `fitdb_test`. Nothing is deployed.
- **Not verified on a real iPhone or Android phone.** Browser testing at phone size isn't the same.
- **The privacy notice and terms are drafts,** with no legal review. There's been no clinical review either.
- **Two unexplained one-off test failures are open.** Tracker T-25 (the emailed sign-up link's page) and T-27 (after Finish, the finished page didn't appear). If you see either, please report it.
- **Finished workouts can still be changed by their owner** from a page left open (K-04), and a malformed address can give a bare error on some pages (J-07).
- **Open product decisions** are in `PHASE_4_MERGE_READINESS.md`, including how much evidence a numerical weight change needs (J-05).

## Reporting a defect

Say which step from this guide, what you did, what you expected, what happened, and the browser. A screenshot helps. **Leave out the password.**

## For each new phase

New features add a section here, and demo data to `scripts/lib/demo-account-data.cjs`. A phase isn't accepted until the owner has tried it and said so. See `DEVELOPMENT_WORKFLOW.md`.
