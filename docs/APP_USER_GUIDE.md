# FitWorkoutFoodTracker user guide

**How to use every feature of the app, for a first-time user.** Written from a hands-on walkthrough of the release candidate (application code `d7d278d`) on 2026-11-09, using a fictional demo user, **Maya Torres**. Every screenshot is a real capture of the running app. What was tested, and what didn't work, is in [APP_FEATURE_TEST_REPORT.md](APP_FEATURE_TEST_REPORT.md). Maya's data is described in [APP_DEMO_DATA.md](APP_DEMO_DATA.md).

The app has five tabs: **Today, Workouts, Nutrition, Progress, Profile**. On a phone they sit along the bottom; on a computer, down the left side.

> Screenshot paths below are relative to `docs/screenshots/walkthrough/`.

## Contents

- **Getting started:** [1 Create an account](#1-create-an-account) · [2 Log in and out](#2-log-in-and-out) · [3 Forgotten password](#3-forgotten-password) · [4 Profile and goal](#4-profile-and-goal)
- **Today:** [5 The dashboard](#5-the-dashboard)
- **Workouts:** [6 Workout plans](#6-workout-plans) · [7 Weekly schedule](#7-weekly-schedule) · [8 Logging a workout](#8-logging-a-workout) · [9 Rest timer](#9-rest-timer) · [10 Notes](#10-notes) · [11 Workout history](#11-workout-history) · [12 Gyms and equipment](#12-gyms-and-equipment) · [13 Swapping an exercise](#13-swapping-an-exercise) · [14 Custom exercises](#14-custom-exercises) · [15 Importing a plan](#15-importing-a-plan)
- **Progress:** [16 Exercise progress and records](#16-exercise-progress-and-records) · [17 Body weight](#17-body-weight)
- **Nutrition:** [18 Daily targets](#18-daily-targets) · [19 Searching and logging food](#19-searching-and-logging-food) · [20 Changing or deleting an entry](#20-changing-or-deleting-an-entry) · [21 Custom foods](#21-custom-foods) · [22 Barcodes](#22-barcodes) · [23 Package photo without a barcode](#23-package-photo-without-a-barcode) · [24 Nutrition label scan](#24-nutrition-label-scan) · [25 Meal photo](#25-meal-photo) · [26 Nutrition history](#26-nutrition-history)
- **Your account:** [27 Download your data](#27-download-your-data) · [28 Change your password](#28-change-your-password) · [29 Delete your account](#29-delete-your-account) · [30 Privacy notice and terms](#30-privacy-notice-and-terms) · [31 Feedback](#31-feedback) · [32 Appearance](#32-appearance) · [33 Install on a phone, and offline](#33-install-on-a-phone-and-offline)
- **For the app's owner:** [34 Feedback review](#34-feedback-review)
- [What the app doesn't do yet](#what-the-app-doesnt-do-yet)

---

## 1. Create an account

**Purpose:** get your own private account.
**Where:** the login page → **Create an account**.

1. Type your email and press **Send sign-up link**.
2. Open the email and follow its link (it works for 24 hours).
3. Choose a password of at least 8 characters, tick **I've read the Privacy notice and Terms**, and press **Create account**.
4. Log in. You'll see one short **About you** step: choose kg/cm or lb/ft, enter your name and date of birth, press **Continue**, and confirm the date written out in words.

**Example:** Maya entered `maya.torres@example.test`, then "Maya", 12 April 1991 and kg/cm. The app asked "You entered 12 April 1991. Is this right?" before saving.
**Expected result:** your dashboard, greeting you by name.
**Limitations:** the app is for adults only. A date of birth under 18 is refused and not saved. Sign-up is closed on a real deployment until the privacy notice is final. In this walkthrough it was open because the app ran as a local test server, and the emails went to a local folder.
**Screenshots:** `01-account/02-register-email.png`, `03-check-your-email.png`, `04-register-complete.png`, `05-register-weak-password.png`, `07-onboarding.png`, `09-onboarding-confirm-dob.png`, `09-account-privacy/08-under-18-restricted.png`

## 2. Log in and out

**Purpose:** keep your data private on shared devices.
**Where:** the login page; **Profile → Log out**.

1. Enter your email and password, and press **Log in**.
2. To log out, open **Profile** and press **Log out** at the bottom.

**Expected result:** a wrong password shows "Incorrect email or password". After logging out, every page sends you back to the login page.
**Screenshots:** `01-account/01-landing-or-login.png`, `11-login-wrong-password.png`

## 3. Forgotten password

**Purpose:** get back in without your password.
**Where:** the login page → **Forgot your password?**

1. Enter your email and press the button. The page always says a link was sent, so it never reveals whether an account exists.
2. Open the email's link within 60 minutes, choose a new password, and log in with it.

**Limitations:** asking again a few minutes later may not send a second email; use the first one.
**Screenshots:** `01-account/12-forgot-password.png`, `13-forgot-password-sent.png`, `14-reset-password.png`

## 4. Profile and goal

**Purpose:** set your units, an optional goal, and a goal weight.
**Where:** **Profile**.

1. Choose **kg / cm** or **lb / ft**.
2. Optionally enter a **Goal weight**, and choose a goal: Fat loss, Muscle gain, Maintenance or Strength. Tap the chosen goal again to clear it.
3. Press **Save changes**.

**Example:** Maya chose **Fat loss** with a goal weight of **64 kg**.
**Expected result:** the dashboard's Goal card uses them, for example "Trend 68 kg · about 4 kg above your goal weight of 64 kg".
**Limitations:** the goal card gives no date or percentage. Goals are optional.
**Screenshot:** `01-account/10-profile-goal-saved.png`

## 5. The dashboard

**Purpose:** see today at a glance.
**Where:** the **Today** tab.

It shows:
- **Today's workout** from your schedule, with **Start workout** (or "Completed today", or a rest day with **Log a workout anyway**).
- **This week:** completed against planned workouts, and the week's sets, volume and time.
- **Goal:** your weight trend against your goal weight.
- **Recent PRs:** personal records from the last 30 days.

**Example:** on Monday, Maya's card showed "Upper A · 4 exercises". After her workout it read "Completed today", and Recent PRs listed her Overhead Press records.
**Limitations:** the week ring counts every finished workout against the planned ones, so extra unscheduled workouts can make it read oddly. There's no separate weekly report.
**Screenshots:** `02-dashboard/01-dashboard-new-user-empty.png`, `02-dashboard-with-schedule.png`, `03-dashboard-populated.png`, `10-desktop-pwa/desktop-dashboard.png`

## 6. Workout plans

**Purpose:** save a workout you repeat, with target sets, reps, weight and rest.
**Where:** **Workouts → My plans → New** (or **Create a plan**).

1. Enter a **Plan name** and, if you like, notes.
2. Press **Add exercise**, search or browse by muscle, and tap an exercise.
3. For each exercise, fill in **Sets**, **Reps min**, **Reps max**, **Wt**, **Rest (sec)** and optional notes. Use ↑ and ↓ to reorder, and the bin to remove.
4. Press **Save plan**.

To **edit** a plan, tap it under My plans, change anything, and save. To **delete** it, press **Delete** and confirm; workouts you've already logged are kept.

**Example:** Maya's **Upper A**: Barbell Bench Press 4 × 6–8 @ 55 kg (rest 150 s), Barbell Row 4 × 8–10 @ 45 kg, Overhead Press 3 × 6–8 @ 35 kg ("Strict, no leg drive"), Lat Pulldown 3 × 10–12 @ 45 kg. Her **Lower A** has squats, Romanian deadlifts, leg press and calf raises.
**Expected result:** the plan appears under My plans with its exercises listed, and a **Start** button.
**Limitations:** there's no "duplicate plan" button. A plan needs a name.
**Screenshots:** `03-workouts/01-exercise-picker.png`, `02-plan-editor-upper-a.png`, `03-plan-validation-empty.png`, `04-workouts-with-plans.png`, `05-plan-edit-page.png`

## 7. Weekly schedule

**Purpose:** say which plan you do on which day.
**Where:** **Workouts → This week → Edit**.

1. On a day, press **+ Add workout** and choose a plan.
2. Repeat for other days (a day can hold more than one plan), then press **Save schedule**.

**Example:** Monday Upper A, Wednesday Lower A, Friday Upper A.
**Expected result:** the week strip on Workouts and the dashboard's Today card show your plan for each day. Days without a plan are rest days.
**Screenshots:** `03-workouts/07-schedule-empty.png`, `08-schedule-add-picker.png`, `09-schedule-saved.png`

## 8. Logging a workout

**Purpose:** record what you actually lifted.
**Where:** **Today → Start workout**, or **Workouts → Start** beside a plan, or **Start an empty workout**.

1. If you use gyms, choose **Training at** first (you can change it in the workout too).
2. For each exercise, type the **weight** and **reps** for a set and press the tick (**Log set**). The next set row appears, with your last numbers shown in grey as a suggestion.
3. To remove a logged set, press its ✕.
4. Press **Add exercise** to add one that isn't in the plan.
5. When you're done, press **Finish**. Exercises with no sets are removed (the app tells you first).
6. **Discard workout** at the bottom throws the whole workout away.

**Example:** Maya logged bench press 55 kg × 8, 8, 7, 6; barbell row 45 kg × 10, 10, 9, 9; overhead press 35 × 7, 35 × 6, 32.5 × 8, at Downtown Fitness.
**Expected result:** a summary: "Workout complete", time, sets (14), volume (4,020 kg), PRs, and each exercise compared with last time.
**Limitations:**
- There's no input for effort (RPE).
- **Known issue (WT-01):** during a workout, the **Add exercise** search box clears itself after a moment. Scroll the list or filter by muscle instead, or add the exercise to the plan beforehand.

**Screenshots:** `03-workouts/10-session-start.png`, `12-session-sets-logged.png`, `13-finish-confirm.png`, `14-workout-summary.png`, `16-empty-workout.png`

## 9. Rest timer

**Purpose:** time your rest between sets.
**Where:** it appears by itself after you log a set.

It counts down from the exercise's rest time (for example 150 s for bench press). Press **−15** or **+15** to adjust it, or **Skip** to end it. Change the rest time in the plan.
**Screenshot:** `03-workouts/11-set-logged-rest-timer.png`

## 10. Notes

**Purpose:** remember how something felt.
- **An exercise note:** in a workout, press **Add a note on how it felt** under the exercise. A note saved in the plan shows here as **Exercise note**.
- **A workout note:** the **Workout notes** box at the bottom of a workout.
- **A plan note:** the **Notes** box in the plan editor.

**Example:** "Felt strong; last set was a grind." on bench press; "Good energy. Slept well." for the workout.
**Expected result:** notes appear in the workout's history page.
**Screenshot:** `03-workouts/14-workout-summary.png`

## 11. Workout history

**Purpose:** look back at past workouts.
**Where:** **Workouts → History**, or **All** beside Recent.

The list is grouped by month, with sets, volume, time and gym for each workout. Use **All / Downtown Fitness / Home garage** to filter by gym. Tap a workout to see every set, notes, comparisons and records. **Repeat this workout** starts a new one with the same exercises. **Delete workout** removes it.

**Example:** Maya's history lists 20 workouts from 28 September.
**Screenshots:** `03-workouts/15-history-list.png`, `10-desktop-pwa/desktop-workouts-history.png`

## 12. Gyms and equipment

**Purpose:** if you train in more than one place, keep each gym's machines apart and see which alternatives each gym can do.
**Where:** **Workouts → Gyms** (or **Add your gyms**).

1. Type a gym name (only you see it; no location is used) and press **Add**.
2. Under **What it has**, tick the kinds of equipment it has: barbells, dumbbells, machines, cables, bodyweight, kettlebells, bands, other.
3. Under **Machines**, name a specific machine, choose its type, optionally tie it to one exercise, and press **Add machine**.
4. When logging an exercise, choose the machine in the exercise's machine list.

**Example:** **Downtown Fitness** has barbells, dumbbells, machines, cables and bodyweight, plus a Hammer Strength chest press, a Life Fitness leg press and a lat pulldown station. **Home garage** has dumbbells, bodyweight, kettlebells and bands.
**Expected result:** sets on a named machine are compared only with that machine ("On Life Fitness leg press: compared with this machine only"), and it gets its own records.
**Limitations:** **Known issue (WT-03):** the Progress list shows "0 sessions" for an exercise done only on a named machine. Open the exercise and choose the machine to see its history. Each exercise's machine list shows every machine at that gym, not only matching ones.
**Screenshots:** `04-gyms/02-downtown-equipment.png`, `03-downtown-machines.png`, `05-both-gyms-configured.png`, `03-workouts/17-machine-sets.png`, `06-progress/06-exercise-leg-press-by-machine.png`

## 13. Swapping an exercise

**Purpose:** replace an exercise when the equipment is taken or missing.
**Where:** in a workout, **Swap exercise** under the exercise.

1. The sheet lists alternatives that train **the same movement** (a hand-reviewed list, never just the same muscle). Each one is marked by whether your current gym has the equipment.
2. Tap one, or press **Choose another exercise myself**.
3. Optionally tick **Also change my plan to use it from now on**.
4. Press **Swap to …**.

**Example 1:** at Downtown Fitness, Maya swapped Lat Pulldown for **Pull-Up** for that workout only.
**Example 2:** at Home garage, squat alternatives (front squat, hack squat, leg press) were all marked "not listed at this gym", so she chose **Bulgarian Split Squat** herself and ticked "Also change my plan". Lower A now starts with it.
**Expected result:** the new exercise appears marked "Swapped in for …". Sets already logged stay with the original exercise.
**Limitations:** **known issue (WT-04):** the swapped-in exercise shows the original's target weight (Pull-Up showed "@ 45 kg"). Alternatives come only from the reviewed list, so a home gym may have none.
**Screenshots:** `04-gyms/06-swap-sheet-downtown.png`, `07-after-swap-pull-up.png`, `08-swap-sheet-home-back-squat.png`, `09-swap-own-choice-with-plan-update.png`, `11-home-session-summary.png`

## 14. Custom exercises

**Purpose:** add an exercise that isn't among the 47 built-in ones.
**Where:** the **Add exercise** picker, in the plan editor.

1. Type the exercise's full name. When nothing matches exactly, **Create "…"** appears.
2. Press it, choose the muscle and equipment, and press **Create and add**.

**Example:** "Goblet Squat".
**Expected result:** it's added and appears in the picker afterwards, marked "Custom".
**Limitations:** choose the muscle yourself: it defaults to Chest. Because of WT-01, create it from the plan editor, not during a workout.
**Screenshot:** `03-workouts/19-create-custom-exercise.png`

## 15. Importing a plan

**Purpose:** turn a coach's plan or a note into workout plans without retyping it.
**Where:** **Workouts → My plans → Import**.

1. Choose a file (up to 10 MB): **PDF, a photo or screenshot, CSV, TXT, Word (DOCX) or Excel (XLSX)**.
2. Check what was found: the program name, each day and its **On the schedule** day, and each exercise with sets, reps, weight, unit, rest and notes. Each line shows what the plan said ("From the plan: …") and what it matched ("Matched: …"). Fix anything that's wrong, or remove it.
3. Press **Save N plans**.

**Example:** Maya imported "Coach Dana – Week 7 block" (Tuesday push, Saturday pull) from a screenshot. All six exercises matched, and Tuesday and Saturday were filled in from the day names.
**Expected result:** one plan for each day, scheduled on the days you chose.
**Limitations:** documents are read in your browser and not uploaded. Photos, screenshots and scanned pages are read on the app's server and not kept. Importing the same plan twice creates duplicates, and schedules them again.
**Screenshots:** `08-import/02-review-plan-screenshot-png.png`, `03-review-plan-pdf.png`, `05-review-plan-csv.png`, `07-review-plan-docx.png`, `08-review-plan-xlsx.png`, `09-workouts-after-import.png`

## 16. Exercise progress and records

**Purpose:** see whether you're getting stronger.
**Where:** the **Progress** tab.

The list shows every exercise you've done: sessions, top set, the last date, and a status against the previous session: **▲ Improved, = Matched, ▼ Down**, or **Baseline** for the first one. Tap an exercise to see:
- a chart of **Top weight, Est. 1RM, Volume** or **Total reps**;
- **Personal records:** heaviest weight, best estimated 1RM, most reps in a set, best session volume;
- every session, with PR badges.

**Example:** Maya's bench press: 10 sessions, from 47.5 kg to a heaviest of 62.5 kg, and a best estimated 1RM of 79.2 kg.
**Limitations:** the app compares; it **doesn't suggest your next weight**. The status compares load first, then reps at that load, then total volume.
**Screenshots:** `06-progress/03-progress-overview.png`, `04-exercise-bench-press.png`

## 17. Body weight

**Purpose:** log your weight and see a smoothed trend.
**Where:** **Progress → Weight log**, or **Weight log** on the Goal card.

1. Choose the **Date** (today or an earlier day), type the **Weight**, and press **Save weight**. If that date already has an entry, the button says **Replace entry**.
2. Delete an entry from the list with **Delete**.

**Example:** Maya logged 67.9, 67.6 and 67.4 kg on 7–9 November, on top of six weeks of history.
**Expected result:** a chart of your entries with a smoothed trend (68 kg, −1.2 kg since 12 October), and a list of entries, each with its trend value.
**Limitations:** one entry a day, 30–300 kg. The trend is an average that lags behind recent changes; it doesn't show body composition or predict anything.
**Screenshots:** `06-progress/01-weight-log-trend.png`, `02-weight-validation.png`

## 18. Daily targets

**Purpose:** set your own calorie and macro targets. They're optional.
**Where:** **Nutrition → Targets**.

1. Enter **Calories**, and optionally **Protein** and **Fat**.
2. When you enter both, carbohydrate is calculated from what's left, and the arithmetic is shown.
3. Press **Save targets**. **Stop using a target** removes it.

**Example:** 1,900 kcal, protein 130 g, fat 60 g. Carbs came out at 210 g ("4×130 + 4×210 + 9×60 = 1900 kcal").
**Expected result:** the Nutrition page shows consumed against target, remaining, and each macro's bar.
**Limitations:** the app doesn't calculate targets for you, and it isn't medical advice. Calories must be 800–8,000. **A target applies from the day you save it**, so earlier days show "Not set".
**Screenshots:** `05-nutrition/01-targets-entered.png`, `02-targets-saved.png`, `03-targets-validation.png`

## 19. Searching and logging food

**Purpose:** record what you eat.
**Where:** **Nutrition → +** beside a meal (Breakfast, Lunch, Dinner, Snacks).

1. Type at least 2 letters. Choose the source: **All sources**, **USDA foods** (generic foods), **Packaged foods** (Open Food Facts) or **My foods**.
2. Tap a result. Each shows its calories and macros per 100 g, and where it came from.
3. Choose the **Serving size** (for example "1 medium (118 g)"), the number of **Servings**, and the **Meal**, then press **Add to …**.
4. **Recent** lists foods you've logged before, for quick re-logging.

**Example:** Maya's breakfast: a medium banana (USDA "Bananas, raw", 105 kcal), half a cup of oats and a Greek yogurt.
**Expected result:** the meal and the day's totals update. Use ‹ and › to move between days.
**Limitations:**
- Results come live from USDA and Open Food Facts, and similar names can have different values.
- Searches can include loosely related foods.
- **Known issue (WT-02):** a few large USDA records take too long and show "The food database took too long to respond". Choose another record.
- A few USDA serving names are raw codes, such as "90000 (296 g)" (WT-05).

**Screenshots:** `05-nutrition/04-search-all-sources-banana.png`, `05-search-usda-only.png`, `07-portion-banana-medium.png`, `08-day-totals-partial.png`, `14-day-full.png`

## 20. Changing or deleting an entry

**Where:** **Nutrition**, tap the entry.

Change the servings, serving size or meal and press **Save changes**, or press **Delete** and confirm.
**Example:** Maya changed her banana to 2; breakfast went from 345 to 450 kcal.
**Screenshots:** `05-nutrition/15-entry-edit.png`, `16-day-after-edit-delete.png`

## 21. Custom foods

**Purpose:** log your own recipes or foods that aren't in the databases.
**Where:** **Add food → + Custom food**.

1. Enter the name, an optional brand and barcode, a serving (name and size in g or ml), and calories, protein, carbs and fat (fiber optional).
2. Press **Save and continue**, then choose the amount and add it.

**Example:** "Overnight oats (Maya's recipe)", 1 jar (250 g): 310 kcal, P 18, C 42, F 8.
**Expected result:** it's logged, and appears under **My foods**.
**Screenshots:** `05-nutrition/09-custom-food-form.png`, `10-custom-food-filled.png`, `11-custom-food-saved.png`

## 22. Barcodes

**Purpose:** log a packaged food by its barcode.
**Where:** **Add food → Scan a package**.

1. Point the camera at the barcode. It's read on your phone; only the digits are sent.
2. If the camera can't start, **type the barcode** and press **Look up**, or **Choose a photo of the package**.
3. Check "Is this your product?", then press **Yes, choose an amount**.

**Example:** Coca-Cola Original (5449000000996) was found on Open Food Facts at 42 kcal/100 ml, with its 330 ml serving.
**Expected result:** the product, then the amount screen.
**Limitations:**
- A code with a wrong check digit is refused as "That isn't a valid product barcode".
- A product with no nutrition values can't be logged: values are never assumed to be 0. Use **Create my own food** instead.
- Camera scanning hasn't been tried on a real phone yet.

**Screenshots:** `07-scanning/01-scan-a-package.png`, `02-camera-barcode-cola.png`, `03-typed-barcode-not-found.png`, `04-typed-barcode-bad-check-digit.png`, `05-barcode-from-photo.png`, `06-barcode-amount.png`

## 23. Package photo without a barcode

**Purpose:** find a packaged food when there's no barcode to scan.
**Where:** **Scan a package → Choose a photo of the package**, using a photo of the front.

The app reads the words on the package (for example "Greek Yogurt · Plain - Nonfat") and searches for them. Tap the words to change the search, then choose a matching product.
**Limitations:** the photo only finds candidates; **it never supplies nutrition values**. The photo isn't kept.
**Screenshot:** `07-scanning/21-package-photo-no-barcode.png`

## 24. Nutrition label scan

**Purpose:** save a food from its nutrition label.
**Where:** **Nutrition → Add food → Scan a nutrition label**.

1. Choose a **photo** or a **PDF** of the label.
   - For a photo, optionally drag to crop, press **Continue**, then **Use this**.
   - For a PDF, choose the page, then **Read values from the text**, or for a scanned page, **Crop and scan this page image**.
2. **Check every value against the label.** Each shows what was read ("Label says: …"). Values the app couldn't trust are marked **Couldn't read**.
3. Enter the product name and the serving (name, size and unit), fix anything that's wrong, and tick **I compared these values with the label, and they're correct**.
4. Press **Save to My foods**, then **Add to diary**, or log it later from My foods.

**Example:** "Maya's Granola (synthetic)". The photo's "2.5g" fat was read as "2.59", marked **Couldn't read**, and corrected by hand to 2.5. Per serving (1/2 cup, 30 g): 120 kcal, P 4, C 20, F 2.5, fiber 3.
**Expected result:** "Saved to My foods", with a table per serving and per 100 g.
**Limitations:** reading happens on the app's own server (or in your browser for a text PDF), with no paid AI service. The product name and serving size are always typed by you. Saving doesn't add the food to your diary until you choose to.
**Screenshots:** `07-scanning/11-label-photo-review.png`, `14-label-photo-values.png`, `15-label-pdf-values.png`, `16-label-scanned-pdf-values.png`, `17b-label-confirmed.png`, `18-label-saved.png`

## 25. Meal photo

**Purpose:** a quick start for logging a plated meal.
**Where:** **Nutrition → Add food → Identify foods in a photo**.

1. **Take a photo** or **Choose a photo**, then press **Identify foods**.
2. The app suggests the main dish (for example "Possibly pizza", with close alternatives). Press **Accept this name**, correct it, or **Mark as unknown**. **Add a food the AI missed** adds others.
3. Press **Find this food**, choose the meal, pick the matching record, and enter the amount.

**Example:** a photo of a pizza margherita → "Possibly pizza" → USDA "Pizza, cheese, stuffed crust" → 2 medium pieces → Dinner.
**Limitations:** it names **only the main dish**, and **never estimates amounts or nutrition**. Finding a record doesn't confirm the suggestion was right.
**Screenshots:** `07-scanning/20-meal-photo-suggestions.png`, `22-meal-accepted.png`, `24-meal-food-results.png`, `25-meal-portion.png`

## 26. Nutrition history

**Purpose:** see how you've eaten over weeks.
**Where:** **Nutrition → History**.

It shows the week's **average calories** against the average target, days logged, **average protein**, **protein consistency** (days at 90% or more of target), a daily bar chart with the target line, a list of days, and an **8-week trend**. Use ‹ and › to change weeks.
**Screenshot:** `05-nutrition/18-history-week.png`

## 27. Download your data

**Where:** **Profile → Download or delete my data → Download my data**.

Enter your password and press **Download**. You get one JSON file with your profile, plans, schedule, workouts, weight log, food diary, custom foods, targets, gyms and feedback. It never contains your password.
**Example:** Maya's file was 192 KB, with 20 workouts and 41 weigh-ins.
**Limitations:** up to 50,000 rows; one export at a time.
**Screenshots:** `09-account-privacy/01-export-password-prompt.png`, `02-export-done.png`

## 28. Change your password

**Where:** **Profile → Download or delete my data → Password**.

Enter your current and new passwords and press **Change password**. Your other devices are signed out.
**Screenshot:** `01-account/15-password-changed.png`

## 29. Delete your account

**Where:** **Profile → Download or delete my data → Delete my account**.

Enter your password, type **DELETE** in capitals, and press **Permanently delete my account**.
**Expected result:** "Your account has been deleted". Everything is removed straight away, and you're signed out everywhere.
**Limitations:** this can't be undone. Backups may keep a copy until they expire. Shared food and exercise information stays.
**Screenshots:** `09-account-privacy/06-delete-account-prompt.png`, `07-account-deleted.png`

## 30. Privacy notice and terms

**Where:** links at the bottom of the login and profile pages.
**Limitations:** **both are drafts**, not yet legally reviewed, with gaps marked `[TO CONFIRM]`. They aren't for real users yet.
**Screenshots:** `09-account-privacy/03-privacy-notice.png`, `04-terms.png`

## 31. Feedback

**Where:** **Profile → Send feedback**, or `/feedback`.

Choose what it's about, write up to 2,000 characters, and press **Send feedback**. Don't include health details or other people's names. What you've sent, and its status, are listed below the form.
**Screenshot:** `09-account-privacy/05-feedback-sent.png`

## 32. Appearance

**Where:** **Profile → Appearance**: **System, Light** or **Dark**.
**Screenshots:** `10-desktop-pwa/dark-dashboard.png`, `dark-nutrition.png`, `dark-progress-weight.png`

## 33. Install on a phone, and offline

**Where:** **Profile → Install the app**. In Chrome, open the ⋮ menu and choose **Install app** (or **Add to Home screen**).

It opens full screen like an app.
**Limitations:** **it still needs a connection.** Offline, you'll see "You're offline… Nothing can be saved", and nothing is kept on the phone except the app's own files. Installing hasn't been tried on a real phone yet.
**Screenshot:** `10-desktop-pwa/offline-page.png`

## 34. Feedback review

**For the app's owner only** (accounts listed by the server's `ADMIN_USER_IDS`).
**Where:** `/admin/feedback`.

Filter by status and category, set each item's status, severity and priority, and download a redacted review export. Reporters appear only as a short reference.
**Screenshot:** `09-account-privacy/09-admin-feedback-review.png`

---

## What the app doesn't do yet

- Body measurements (other than weight), sleep and recovery, and progress photos.
- Effort (RPE) input when logging sets.
- Suggesting your next weight. Progress shows comparisons only.
- A weekly summary page or report.
- Working offline.
- Duplicating a plan.
