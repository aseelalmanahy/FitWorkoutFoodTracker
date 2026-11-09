# Application screen index

**Every screen captured in the 2026-11-09 walkthrough, with how to reach it.** All 148 images are real browser screenshots of the release candidate (application code `d7d278d`), taken with the fictional demo user Maya Torres on a throwaway database. Phone-width images are 540 px wide; desktop images are 1280 px. Full-page phone captures can show the bottom navigation bar partway down a tall page; that's how the capture is stitched, not the app's layout.

How to use each screen: [APP_USER_GUIDE.md](APP_USER_GUIDE.md). Results and defects: [APP_FEATURE_TEST_REPORT.md](APP_FEATURE_TEST_REPORT.md).

## Navigation map

```
Login ─┬─ Create an account → Check your email → (emailed link) Choose a password → Login → About you (first time only)
       └─ Forgot your password? → Check your email → (emailed link) Set a new password

Bottom bar (phone) / sidebar (desktop)
├─ Today ............ dashboard: today's workout, this week, goal, recent PRs
├─ Workouts ......... gym chooser, this week (Edit → Weekly schedule), My plans (Import, New, a plan → Edit plan),
│                     Start / Start an empty workout → Workout logger → Finish → Workout summary
│                     History (filter by gym) → a workout;  Gyms
├─ Nutrition ........ day view (‹ ›), Targets, History; + beside a meal → Add food
│                     Add food → search · Scan a package (barcode / photo) · + Custom food
│                              · Scan a nutrition label · Identify foods in a photo
├─ Progress ......... exercise list → an exercise (→ a machine);  Weight log
└─ Profile .......... units, goal, appearance, install help, Send feedback,
                      Download or delete my data → Your account and data (password, export, delete), Log out
Footer links: Privacy notice · Terms.   Owner only: /admin/feedback
```

## Empty states (a brand-new account)

| Screen | What the user sees and can do | How to get there | Screenshot |
|---|---|---|---|
| Your account and data | Change password, download, delete, log out | Profile → Download or delete my data | [account.png](screenshots/walkthrough/00-empty-states/account.png) |
| Feedback | Category, message, Send feedback, what you have sent | Profile → Send feedback | [feedback.png](screenshots/walkthrough/00-empty-states/feedback.png) |
| Add food, before searching | Search, source chips, Scan a package, + Custom food, label and meal-photo links | Nutrition → + | [nutrition-add.png](screenshots/walkthrough/00-empty-states/nutrition-add.png) |
| Nutrition history, empty | Week arrows, empty averages | Nutrition → History | [nutrition-history.png](screenshots/walkthrough/00-empty-states/nutrition-history.png) |
| Identify a meal | Take or choose a photo | Add food → Identify foods in a photo | [nutrition-meal.png](screenshots/walkthrough/00-empty-states/nutrition-meal.png) |
| Scan a label | Choose a photo or PDF | Add food → Scan a nutrition label | [nutrition-scan.png](screenshots/walkthrough/00-empty-states/nutrition-scan.png) |
| Targets, none set | Calories, protein, fat; carbs calculated | Nutrition → Targets | [nutrition-targets.png](screenshots/walkthrough/00-empty-states/nutrition-targets.png) |
| Nutrition day, empty | Add a target, + for each meal, day arrows | Nutrition tab | [nutrition.png](screenshots/walkthrough/00-empty-states/nutrition.png) |
| Profile | Units, name, date of birth, goal weight, goal, install help, appearance, data link, log out | Profile tab | [profile.png](screenshots/walkthrough/00-empty-states/profile.png) |
| Weight, no entries | Date, weight, Save weight | Progress → Weight log | [progress-weight.png](screenshots/walkthrough/00-empty-states/progress-weight.png) |
| Progress, no data | Weight log link, Go to workouts | Progress tab | [progress.png](screenshots/walkthrough/00-empty-states/progress.png) |
| Gyms, empty | Add a gym | Workouts → Gyms | [workouts-gyms.png](screenshots/walkthrough/00-empty-states/workouts-gyms.png) |
| History, empty | "No workouts yet", Go to workouts | Workouts → History | [workouts-history.png](screenshots/walkthrough/00-empty-states/workouts-history.png) |
| Import a plan | Choose a file; what is read where | Workouts → My plans → Import | [workouts-import.png](screenshots/walkthrough/00-empty-states/workouts-import.png) |
| New plan, empty | Plan name, notes, Add exercise, Save plan | Workouts → New | [workouts-plans-new.png](screenshots/walkthrough/00-empty-states/workouts-plans-new.png) |
| Weekly schedule, no plans | Prompt to create a plan first | Workouts → This week → Edit | [workouts-schedule.png](screenshots/walkthrough/00-empty-states/workouts-schedule.png) |
| Workouts, new user | No plans; Create a plan, Import, Start an empty workout, Add your gyms | Workouts tab | [workouts.png](screenshots/walkthrough/00-empty-states/workouts.png) |

## Account

| Screen | What the user sees and can do | How to get there | Screenshot |
|---|---|---|---|
| Login | Email, password, forgot password, create an account | Opening the app logged out | [01-landing-or-login.png](screenshots/walkthrough/01-account/01-landing-or-login.png) |
| Create your account | Email, Send sign-up link | Login → Create an account | [02-register-email.png](screenshots/walkthrough/01-account/02-register-email.png) |
| Check your email | Confirmation that a link was sent | After Send sign-up link | [03-check-your-email.png](screenshots/walkthrough/01-account/03-check-your-email.png) |
| Choose a password | Password, consent box, Create account | The emailed link | [04-register-complete.png](screenshots/walkthrough/01-account/04-register-complete.png) |
| Password too short | Validation message | Create account with under 8 characters | [05-register-weak-password.png](screenshots/walkthrough/01-account/05-register-weak-password.png) |
| Account ready | "Your account is ready. Log in to continue." | After Create account | [06-login-after-signup.png](screenshots/walkthrough/01-account/06-login-after-signup.png) |
| About you | Units, name, date of birth, Continue | First login | [07-onboarding.png](screenshots/walkthrough/01-account/07-onboarding.png) |
| About you, filled in | — | First login | [08-onboarding-filled.png](screenshots/walkthrough/01-account/08-onboarding-filled.png) |
| Date confirmation | "You entered 12 April 1991. Is this right?" | About you → Continue | [09-onboarding-confirm-dob.png](screenshots/walkthrough/01-account/09-onboarding-confirm-dob.png) |
| Profile with a goal | Fat loss, 64 kg | Profile | [10-profile-goal-saved.png](screenshots/walkthrough/01-account/10-profile-goal-saved.png) |
| Wrong password | "Incorrect email or password" | Login | [11-login-wrong-password.png](screenshots/walkthrough/01-account/11-login-wrong-password.png) |
| Reset your password | Email | Login → Forgot your password? | [12-forgot-password.png](screenshots/walkthrough/01-account/12-forgot-password.png) |
| Reset link sent | Neutral message | After submitting | [13-forgot-password-sent.png](screenshots/walkthrough/01-account/13-forgot-password-sent.png) |
| Set a new password | New password | The emailed reset link | [14-reset-password.png](screenshots/walkthrough/01-account/14-reset-password.png) |
| Password changed | "Your other devices have been signed out" | Account → Password | [15-password-changed.png](screenshots/walkthrough/01-account/15-password-changed.png) |

## Dashboard

| Screen | What the user sees and can do | How to get there | Screenshot |
|---|---|---|---|
| Today, new user | Rest day, Plan my week, Choose a goal | Today tab | [01-dashboard-new-user-empty.png](screenshots/walkthrough/02-dashboard/01-dashboard-new-user-empty.png) |
| Today with a scheduled workout | Today's workout, Start workout, goal card | Today tab | [02-dashboard-with-schedule.png](screenshots/walkthrough/02-dashboard/02-dashboard-with-schedule.png) |
| Today, populated | Completed today, week stats, goal trend, recent PRs | Today tab | [03-dashboard-populated.png](screenshots/walkthrough/02-dashboard/03-dashboard-populated.png) |

## Workouts

| Screen | What the user sees and can do | How to get there | Screenshot |
|---|---|---|---|
| Add exercise | Search, muscle filters, 47 exercises | Plan editor → Add exercise | [01-exercise-picker.png](screenshots/walkthrough/03-workouts/01-exercise-picker.png) |
| Plan editor, Lower A | As above | Workouts → New | [02-plan-editor-lower-a.png](screenshots/walkthrough/03-workouts/02-plan-editor-lower-a.png) |
| Plan editor, Upper A | Sets, reps, weight, rest, notes, reorder | Workouts → New | [02-plan-editor-upper-a.png](screenshots/walkthrough/03-workouts/02-plan-editor-upper-a.png) |
| Plan without a name | "Give the plan a name." | Save plan with no name | [03-plan-validation-empty.png](screenshots/walkthrough/03-workouts/03-plan-validation-empty.png) |
| Workouts with plans | My plans with Start, gym chooser | Workouts tab | [04-workouts-with-plans.png](screenshots/walkthrough/03-workouts/04-workouts-with-plans.png) |
| Edit plan | Edit, Delete, Save plan | Workouts → tap a plan | [05-plan-edit-page.png](screenshots/walkthrough/03-workouts/05-plan-edit-page.png) |
| After deleting a plan | The plan is gone (the confirmation is a browser dialog) | Edit plan → Delete | [06-plan-delete-confirm.png](screenshots/walkthrough/03-workouts/06-plan-delete-confirm.png) |
| Weekly schedule | + Add workout for each day | Workouts → This week → Edit | [07-schedule-empty.png](screenshots/walkthrough/03-workouts/07-schedule-empty.png) |
| Choosing a plan for a day | Plan list, Move to day | + Add workout | [08-schedule-add-picker.png](screenshots/walkthrough/03-workouts/08-schedule-add-picker.png) |
| Schedule saved | Mon, Wed, Fri plans in This week | Save schedule | [09-schedule-saved.png](screenshots/walkthrough/03-workouts/09-schedule-saved.png) |
| Workout logger | Gym, Finish, Swap, machine, set rows, notes, rest | Start on a plan | [10-session-start.png](screenshots/walkthrough/03-workouts/10-session-start.png) |
| Rest timer | Countdown, −15, +15, Skip | After Log set | [11-set-logged-rest-timer.png](screenshots/walkthrough/03-workouts/11-set-logged-rest-timer.png) |
| Sets logged | Logged sets, notes | Workout logger | [12-session-sets-logged.png](screenshots/walkthrough/03-workouts/12-session-sets-logged.png) |
| Workout complete | Summary after Finish | Finish | [13-finish-confirm.png](screenshots/walkthrough/03-workouts/13-finish-confirm.png) |
| Workout summary | Sets, comparisons, notes, Repeat, Delete | History → a workout | [14-workout-summary.png](screenshots/walkthrough/03-workouts/14-workout-summary.png) |
| Workout history | By month, gym filter | Workouts → History | [15-history-list.png](screenshots/walkthrough/03-workouts/15-history-list.png) |
| Empty workout | Add exercise | Start an empty workout | [16-empty-workout.png](screenshots/walkthrough/03-workouts/16-empty-workout.png) |
| Exercise on a named machine | "Compared with this machine only", previous sets | Logger → machine list | [17-machine-sets.png](screenshots/walkthrough/03-workouts/17-machine-sets.png) |
| Create an exercise | Name, muscle, equipment, Create and add | Plan editor → Add exercise → a new name | [19-create-custom-exercise.png](screenshots/walkthrough/03-workouts/19-create-custom-exercise.png) |
| Picker during a workout (defect WT-01) | Search text about to clear itself | Logger → Add exercise | [20-picker-search-cleared-evidence.png](screenshots/walkthrough/03-workouts/20-picker-search-cleared-evidence.png) |

## Gyms and alternatives

| Screen | What the user sees and can do | How to get there | Screenshot |
|---|---|---|---|
| Gym equipment | Kinds of equipment | Workouts → Gyms | [02-downtown-equipment.png](screenshots/walkthrough/04-gyms/02-downtown-equipment.png) |
| Gym machines | Named machines, Remove | Workouts → Gyms | [03-downtown-machines.png](screenshots/walkthrough/04-gyms/03-downtown-machines.png) |
| Second gym added | Two gym cards | Workouts → Gyms → Add | [04-home-added.png](screenshots/walkthrough/04-gyms/04-home-added.png) |
| Both gyms configured | Equipment and machines saved | Workouts → Gyms | [05-both-gyms-configured.png](screenshots/walkthrough/04-gyms/05-both-gyms-configured.png) |
| Swap sheet at Downtown | Chin-Up, Pull-Up, choose myself, update plan | Logger → Swap exercise | [06-swap-sheet-downtown.png](screenshots/walkthrough/04-gyms/06-swap-sheet-downtown.png) |
| Alternative selected | Swap to Pull-Up | Swap sheet | [06b-swap-selected.png](screenshots/walkthrough/04-gyms/06b-swap-selected.png) |
| After a swap | "Swapped out" and "Swapped in" | Swap to … | [07-after-swap-pull-up.png](screenshots/walkthrough/04-gyms/07-after-swap-pull-up.png) |
| Swap sheet at Home garage | Alternatives "not listed at this gym" | Logger at Home garage → Swap | [08-swap-sheet-home-back-squat.png](screenshots/walkthrough/04-gyms/08-swap-sheet-home-back-squat.png) |
| Own choice, plan updated | Bulgarian Split Squat, plan box ticked | Choose another exercise myself | [09-swap-own-choice-with-plan-update.png](screenshots/walkthrough/04-gyms/09-swap-own-choice-with-plan-update.png) |
| Home workout | Swapped exercise logged | Logger | [10-home-session.png](screenshots/walkthrough/04-gyms/10-home-session.png) |
| Home workout summary | "At Home garage", 1 PR | Finish | [11-home-session-summary.png](screenshots/walkthrough/04-gyms/11-home-session-summary.png) |

## Nutrition

| Screen | What the user sees and can do | How to get there | Screenshot |
|---|---|---|---|
| Targets being entered | Carbs calculated, energy check | Nutrition → Targets | [01-targets-entered.png](screenshots/walkthrough/05-nutrition/01-targets-entered.png) |
| Targets saved | Current target, Stop using a target | Save targets | [02-targets-saved.png](screenshots/walkthrough/05-nutrition/02-targets-saved.png) |
| Target out of range | "Enter a number from 800 to 8,000" | Save targets | [03-targets-validation.png](screenshots/walkthrough/05-nutrition/03-targets-validation.png) |
| Food search, all sources | Live USDA and packaged results with counts | Add food → type | [04-search-all-sources-banana.png](screenshots/walkthrough/05-nutrition/04-search-all-sources-banana.png) |
| Food search, USDA only | 25 USDA results | USDA foods chip | [05-search-usda-only.png](screenshots/walkthrough/05-nutrition/05-search-usda-only.png) |
| Portion sheet | Servings, serving size, meal | Tap a result | [06-portion-editor-banana.png](screenshots/walkthrough/05-nutrition/06-portion-editor-banana.png) |
| Portion: 1 medium banana | Add to Breakfast | Portion sheet | [07-portion-banana-medium.png](screenshots/walkthrough/05-nutrition/07-portion-banana-medium.png) |
| Day after breakfast and lunch | Consumed against target, macros | Nutrition | [08-day-totals-partial.png](screenshots/walkthrough/05-nutrition/08-day-totals-partial.png) |
| Custom food form | Name, brand, barcode, serving, nutrients | + Custom food | [09-custom-food-form.png](screenshots/walkthrough/05-nutrition/09-custom-food-form.png) |
| Custom food filled in | Save and continue | + Custom food | [10-custom-food-filled.png](screenshots/walkthrough/05-nutrition/10-custom-food-filled.png) |
| Custom food: amount | Serving, meal, add | Save and continue | [11-custom-food-saved.png](screenshots/walkthrough/05-nutrition/11-custom-food-saved.png) |
| Packaged foods (Open Food Facts) | 25 live products | Packaged foods chip | [12-search-packaged-off-hummus.png](screenshots/walkthrough/05-nutrition/12-search-packaged-off-hummus.png) |
| Portion for an OFF product | The product's own serving | Tap a product | [13-portion-off-product.png](screenshots/walkthrough/05-nutrition/13-portion-off-product.png) |
| Full day | Four meals, over target | Nutrition | [14-day-full.png](screenshots/walkthrough/05-nutrition/14-day-full.png) |
| Edit an entry | Servings, serving size, meal, Delete, Save changes | Tap an entry | [15-entry-edit.png](screenshots/walkthrough/05-nutrition/15-entry-edit.png) |
| Day after an edit and a delete | Updated totals | Nutrition | [16-day-after-edit-delete.png](screenshots/walkthrough/05-nutrition/16-day-after-edit-delete.png) |
| Yesterday | Targets "Not set" (a target applies from its date) | Nutrition → ‹ | [17-yesterday.png](screenshots/walkthrough/05-nutrition/17-yesterday.png) |
| Nutrition history | Weekly averages, chart, 8-week trend | Nutrition → History | [18-history-week.png](screenshots/walkthrough/05-nutrition/18-history-week.png) |

## Progress

| Screen | What the user sees and can do | How to get there | Screenshot |
|---|---|---|---|
| Weight log and trend | Chart, trend, entries, Replace entry | Progress → Weight log | [01-weight-log-trend.png](screenshots/walkthrough/06-progress/01-weight-log-trend.png) |
| Weight out of range | "Enter a weight between 30 and 300 kg" | Save weight | [02-weight-validation.png](screenshots/walkthrough/06-progress/02-weight-validation.png) |
| Progress list | Exercises with status; Leg Press shows "0 sessions" (WT-03) | Progress tab | [03-progress-overview.png](screenshots/walkthrough/06-progress/03-progress-overview.png) |
| Exercise progress | Chart tabs, records, sessions | Progress → an exercise | [04-exercise-bench-press.png](screenshots/walkthrough/06-progress/04-exercise-bench-press.png) |
| Exercise, no-machine view | Machine chooser, empty (WT-03) | Progress → Leg Press | [05-exercise-leg-press-machine.png](screenshots/walkthrough/06-progress/05-exercise-leg-press-machine.png) |
| Exercise on one machine | Its own chart and records | Leg Press → the machine | [06-exercise-leg-press-by-machine.png](screenshots/walkthrough/06-progress/06-exercise-leg-press-by-machine.png) |

## Barcodes, labels, packages and meal photos

| Screen | What the user sees and can do | How to get there | Screenshot |
|---|---|---|---|
| Scan a package, no camera | Type the barcode, choose a photo | Add food → Scan a package | [01-scan-a-package.png](screenshots/walkthrough/07-scanning/01-scan-a-package.png) |
| Barcode found | Is this your product? | Camera scan | [02-camera-barcode-cola.png](screenshots/walkthrough/07-scanning/02-camera-barcode-cola.png) |
| Product with no values | "Not counted as 0", can't be logged | Typed barcode | [03-typed-barcode-not-found.png](screenshots/walkthrough/07-scanning/03-typed-barcode-not-found.png) |
| Invalid barcode | "That isn't a valid product barcode" | Typed barcode | [04-typed-barcode-bad-check-digit.png](screenshots/walkthrough/07-scanning/04-typed-barcode-bad-check-digit.png) |
| Barcode from a photo | Product found | Choose a photo of the package | [05-barcode-from-photo.png](screenshots/walkthrough/07-scanning/05-barcode-from-photo.png) |
| Barcode amount | The product's serving, meal | Yes, choose an amount | [06-barcode-amount.png](screenshots/walkthrough/07-scanning/06-barcode-amount.png) |
| Label photo: crop | Optional crop, Continue | Scan a label → photo | [08-label-label-png.png](screenshots/walkthrough/07-scanning/08-label-label-png.png) |
| Label PDF: pages | Choose the page | Scan a label → PDF | [09-label-label-pdf.png](screenshots/walkthrough/07-scanning/09-label-label-pdf.png) |
| Scanned PDF: pages | "No selectable text" | Scan a label → scanned PDF | [10-label-label-scanned-pdf.png](screenshots/walkthrough/07-scanning/10-label-label-scanned-pdf.png) |
| Photo check | Use this, Crop closer, Retake | After Continue | [11-label-photo-review.png](screenshots/walkthrough/07-scanning/11-label-photo-review.png) |
| PDF page choice | Read values from the text, or scan the image | Choose a page | [12-label-pdf-review.png](screenshots/walkthrough/07-scanning/12-label-pdf-review.png) |
| Scanned PDF page | Crop and scan this page image | Choose a page | [13-label-scanned-pdf-review.png](screenshots/walkthrough/07-scanning/13-label-scanned-pdf-review.png) |
| Label values from a photo | Each value with "Label says"; a flagged value | Use this | [14-label-photo-values.png](screenshots/walkthrough/07-scanning/14-label-photo-values.png) |
| Label values from a PDF | All values read | Read values from the text | [15-label-pdf-values.png](screenshots/walkthrough/07-scanning/15-label-pdf-values.png) |
| Label values from a scanned PDF | Two values flagged | Crop and scan | [16-label-scanned-pdf-values.png](screenshots/walkthrough/07-scanning/16-label-scanned-pdf-values.png) |
| Values corrected | "This is what will be saved" | Label review | [17-label-corrected-ready.png](screenshots/walkthrough/07-scanning/17-label-corrected-ready.png) |
| Values confirmed | Confirmation box ticked | Label review | [17b-label-confirmed.png](screenshots/walkthrough/07-scanning/17b-label-confirmed.png) |
| Label food saved | Saved to My foods, Add to diary | Save to My foods | [18-label-saved.png](screenshots/walkthrough/07-scanning/18-label-saved.png) |
| Logging the label food | Portion sheet from My foods | Add food → My foods | [19-label-food-logging.png](screenshots/walkthrough/07-scanning/19-label-food-logging.png) |
| Meal suggestion | "Possibly pizza"; accept, unknown, remove | Identify foods | [20-meal-photo-suggestions.png](screenshots/walkthrough/07-scanning/20-meal-photo-suggestions.png) |
| Package photo matches | Words read, live candidates | Scan a package → photo | [21-package-photo-no-barcode.png](screenshots/walkthrough/07-scanning/21-package-photo-no-barcode.png) |
| Suggestion accepted | Find this food | Accept this name | [22-meal-accepted.png](screenshots/walkthrough/07-scanning/22-meal-accepted.png) |
| Choose the food | Meal chooser | Find this food | [23-meal-choose-food.png](screenshots/walkthrough/07-scanning/23-meal-choose-food.png) |
| Food results for the dish | USDA and packaged results | Choose a meal | [24-meal-food-results.png](screenshots/walkthrough/07-scanning/24-meal-food-results.png) |
| Meal portion | Serving, servings | Tap a result | [25-meal-portion.png](screenshots/walkthrough/07-scanning/25-meal-portion.png) |

## Plan import

| Screen | What the user sees and can do | How to get there | Screenshot |
|---|---|---|---|
| Import review (first look) | Days, exercises, matches | Import → screenshot | [01-screenshot-review.png](screenshots/walkthrough/08-import/01-screenshot-review.png) |
| Import review: screenshot | Program, days, weekdays, exercises | Import → screenshot | [02-review-plan-screenshot-png.png](screenshots/walkthrough/08-import/02-review-plan-screenshot-png.png) |
| Import saved | Go to your workouts | Save 2 plans | [02b-saved-plan-screenshot-png.png](screenshots/walkthrough/08-import/02b-saved-plan-screenshot-png.png) |
| Import review: PDF | As above | Import → PDF | [03-review-plan-pdf.png](screenshots/walkthrough/08-import/03-review-plan-pdf.png) |
| Import saved (PDF) | — | Save 2 plans | [03b-saved-plan-pdf.png](screenshots/walkthrough/08-import/03b-saved-plan-pdf.png) |
| Import review: scanned PDF | As above | Import → scanned PDF | [04-review-plan-scanned-pdf.png](screenshots/walkthrough/08-import/04-review-plan-scanned-pdf.png) |
| Import review: CSV | As above | Import → CSV | [05-review-plan-csv.png](screenshots/walkthrough/08-import/05-review-plan-csv.png) |
| Import review: TXT | As above | Import → TXT | [06-review-plan-txt.png](screenshots/walkthrough/08-import/06-review-plan-txt.png) |
| Import review: Word | As above | Import → DOCX | [07-review-plan-docx.png](screenshots/walkthrough/08-import/07-review-plan-docx.png) |
| Import review: Excel | As above | Import → XLSX | [08-review-plan-xlsx.png](screenshots/walkthrough/08-import/08-review-plan-xlsx.png) |
| Workouts after imports | Imported plans, Tuesday and Saturday scheduled | Workouts tab | [09-workouts-after-import.png](screenshots/walkthrough/08-import/09-workouts-after-import.png) |

## Account data, privacy and feedback

| Screen | What the user sees and can do | How to get there | Screenshot |
|---|---|---|---|
| Download your data | Password, Download | Account → Download my data | [01-export-password-prompt.png](screenshots/walkthrough/09-account-privacy/01-export-password-prompt.png) |
| Export done | File downloaded | Download | [02-export-done.png](screenshots/walkthrough/09-account-privacy/02-export-done.png) |
| Privacy notice (draft) | Draft banner, [TO CONFIRM] gaps | Footer → Privacy notice | [03-privacy-notice.png](screenshots/walkthrough/09-account-privacy/03-privacy-notice.png) |
| Terms (draft) | — | Footer → Terms | [04-terms.png](screenshots/walkthrough/09-account-privacy/04-terms.png) |
| Feedback sent | Thank-you, sent list | Send feedback | [05-feedback-sent.png](screenshots/walkthrough/09-account-privacy/05-feedback-sent.png) |
| Delete your account? | Password, type DELETE | Account → Delete my account | [06-delete-account-prompt.png](screenshots/walkthrough/09-account-privacy/06-delete-account-prompt.png) |
| Account deleted | What was removed | Permanently delete my account | [07-account-deleted.png](screenshots/walkthrough/09-account-privacy/07-account-deleted.png) |
| Under 18 refused | Check the date, delete, log out | Onboarding with a 2012 birth date | [08-under-18-restricted.png](screenshots/walkthrough/09-account-privacy/08-under-18-restricted.png) |
| Feedback review (admin) | Filters, status, severity, priority, redacted export | /admin/feedback | [09-admin-feedback-review.png](screenshots/walkthrough/09-account-privacy/09-admin-feedback-review.png) |

## Desktop, dark mode, PWA and narrow screens

| Screen | What the user sees and can do | How to get there | Screenshot |
|---|---|---|---|
| Dashboard, dark | — | Profile → Appearance → Dark | [dark-dashboard.png](screenshots/walkthrough/10-desktop-pwa/dark-dashboard.png) |
| Nutrition, dark | — | As above | [dark-nutrition.png](screenshots/walkthrough/10-desktop-pwa/dark-nutrition.png) |
| Weight, dark | — | As above | [dark-progress-weight.png](screenshots/walkthrough/10-desktop-pwa/dark-progress-weight.png) |
| Dashboard, desktop | Sidebar navigation | Today, on a wide screen | [desktop-dashboard.png](screenshots/walkthrough/10-desktop-pwa/desktop-dashboard.png) |
| Nutrition, desktop | — | Nutrition | [desktop-nutrition.png](screenshots/walkthrough/10-desktop-pwa/desktop-nutrition.png) |
| Weight, desktop | — | Progress → Weight log | [desktop-progress-weight.png](screenshots/walkthrough/10-desktop-pwa/desktop-progress-weight.png) |
| Progress, desktop | — | Progress | [desktop-progress.png](screenshots/walkthrough/10-desktop-pwa/desktop-progress.png) |
| History, desktop | — | Workouts → History | [desktop-workouts-history.png](screenshots/walkthrough/10-desktop-pwa/desktop-workouts-history.png) |
| Workouts, desktop | — | Workouts | [desktop-workouts.png](screenshots/walkthrough/10-desktop-pwa/desktop-workouts.png) |
| Offline page | "You're offline", Try again | Any page without a connection | [offline-page.png](screenshots/walkthrough/10-desktop-pwa/offline-page.png) |
| Dashboard at 320 px | No sideways scrolling | A narrow phone | [w320-dashboard.png](screenshots/walkthrough/10-desktop-pwa/w320-dashboard.png) |
| Add food at 320 px | No sideways scrolling | A narrow phone | [w320-nutrition-add.png](screenshots/walkthrough/10-desktop-pwa/w320-nutrition-add.png) |
| Logger at 320 px | No sideways scrolling | A narrow phone | [w320-workouts-session.png](screenshots/walkthrough/10-desktop-pwa/w320-workouts-session.png) |
