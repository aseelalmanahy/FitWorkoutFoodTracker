# Bug tracker

**User-facing defects found by the owner or by hands-on testing, and where each stands.** The full defect history, including engineering defects, stays in [DECISION_REGISTER.md](DECISION_REGISTER.md) §7; release evidence stays in [RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md). "Fixed" means fixed and verified by tests; **only the owner's own confirmation is acceptance**.

**States** (from 2026-11-09): OPEN → IN PROGRESS → FIXED / PENDING OWNER REVIEW → VERIFIED / CLOSED. Only the owner moves an item to VERIFIED / CLOSED.

| ID | Found by | Defect | Severity | Status | Evidence |
|---|---|---|---|---|---|
| **UI-03** | Owner, 2026-11-09 | Weekly schedule controls were unclear: Add workout filled in the first plan by itself; Move and Remove weren't self-explanatory; plans from different programs were mixed | High | **FIXED / PENDING OWNER REVIEW**. Live on http://localhost:3400 (`73ea754`) | See "UI-03 to UI-08" below |
| **UI-04** | Owner, 2026-11-09 | Weekly schedule layout was broken: workout selectors shrank to tiny empty boxes, the Move control took most of the row, names couldn't be read | High | **FIXED / PENDING OWNER REVIEW**. Live on 3400 | See below |
| **UI-05** | Owner, 2026-11-09 | Program and plan management actions (edit, delete) were hard to find | Medium | **FIXED / PENDING OWNER REVIEW**. Live on 3400 | See below |
| **UI-06** | Owner, 2026-11-09 | No single active training program: the weekly schedule could mix plans from any program, and nothing said which program it followed | High | **FIXED / PENDING OWNER REVIEW**. Live on 3400; MIG-ACTIVE applied to `fitdb_test` with the owner's approval, 2026-11-09 | See below |
| **UI-07** | Owner, 2026-11-09 | Nutrition: no way to jump to a date other than one day at a time | Medium | **FIXED / PENDING OWNER REVIEW**. Live on 3400 | See below |
| **UI-08** | Owner, 2026-11-09 | Nutrition history: only whole weeks, one at a time; no custom date range | Medium | **FIXED / PENDING OWNER REVIEW**. Live on 3400 | See below |
| **UI-01** | Owner, 2026-11-09 | Imported plans were mixed with unrelated plans: each imported day became its own plan named "Program – Day", listed among the person's own plans, and was put on the weekly schedule whenever the file named a weekday | High | **Fixed** in `bd86e47`; owner review pending | See below |
| **IM-02** | Owner, 2026-11-09 | A text import ("workout 1.txt") saved exercises that weren't in the file | High | **Fixed** in `bd86e47` (cause found and closed); owner review pending | See below |
| **UI-02** | Owner, 2026-11-09 | Progress had no view by program: workouts couldn't be followed program by program and month by month; then (2026-11-09) no expandable exercise history | Medium: a missing view, nothing wrong | **FIXED / PENDING OWNER REVIEW**: the view in `418fdc7` (on 3400 now); the expandable history live on 3400 | See below |
| **IMG-01** | Owner, 2026-11-09 | A real plan image gave "No exercises with sets and repetitions were found" | High | **Fixed** in `2411496`, `7fec302`. The owner confirmed the reading works; **full acceptance is still separate** | [DECISION_REGISTER.md](DECISION_REGISTER.md) §7 |
| CON-01 | Owner, 2026-11-09 (Chrome console) | "Banner not shown: beforeinstallpromptevent.preventDefault() called" | None: an information message, by design | **Not a defect, no change.** The install flow was verified | See below |
| CON-02 | Owner, 2026-11-09 (Chrome console) | Repeated "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received" | None for the app: it comes from a browser extension | **Not an app defect, no change.** Reproduced only with an extension | See below |
| WT-01 … WT-09 | Walkthrough, 2026-11-09 | Nine defects from the hands-on walkthrough | Medium to cosmetic | Fixed in `cb346ff`, except WT-07 (not reproduced, monitored) | [RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md) Part 12 |

## UI-01: programs

**Cause.** The import saved one plan per day, named `${program} – ${day}`, with no record that the days belonged together, so the Workouts page could only list them one by one among individual plans. It also scheduled every day the file gave a weekday, with no choice offered.

**Fix.**
- **Data.** A program groups plans as ordered days. It's a new `WorkoutProgram` table plus two nullable columns on `WorkoutTemplate`, from migration `20261110120000_workout_programs` (MIG-PROG).
  - The migration only adds; existing plans stay individual plans.
  - Deleting or ungrouping a program keeps its plans, schedule and workout history.
- **Import.**
  - Saves one program, with its days named by day.
  - Changes the schedule only when "Also add these days to my weekly schedule" is ticked. The proposed weekdays, and what each day already holds, are shown first, and existing slots are never removed.
  - A retried save doesn't duplicate anything.
- **Workouts page.** The sections are This week, My programs, Individual plans, then Recent workouts.
  - Each program shows its name once, its numbered days, Edit and Start for each day, View and rename, Schedule, and its imported and scheduled status.
  - A program page renames, reorders, takes a day out or ungroups.
  - Plans saved before this change are left as they are. "Group into a program" lets the person group them by hand; nothing is grouped by guessing from names.

**Verified.**
- The import API and program tests: one program per import, in order, with no schedule change by default; opt-in scheduling; no duplicate on retry; rename, reorder, take out, ungroup keeping history; manual grouping; another person's plans refused.
- The import browser test in Chromium, Firefox and WebKit.
- Account export and deletion include programs.
- The full guarded regression, 56/56.
- Screenshots: [docs/screenshots/ui01](screenshots/ui01).

**On the owner's demo account since 2026-11-09.** MIG-PROG was applied to `fitdb_test` with the owner's approval; every existing row was unchanged. The new version runs at http://localhost:3400 ([PROJECT_STATUS.md](PROJECT_STATUS.md)).

## IM-02: wrong exercises from a text import

**What was found, not assumed.** The same file was opened on both running builds (3400 and 3401) without saving. In the preview:
- **Parsing:** 3 days, all 18 exercises, in order, with their sets and reps.
- **Matching:** only 4 exercises were chosen automatically, all correctly (Romanian Deadlift, Dumbbell Lateral Raise, Hanging Leg Raise, Chest-Supported Row).
- **Suggestions:** for the other 14, the right exercise was offered first, and both exercises of an "A or B" row were offered.
- **Requests:** nothing was sent before Save.

So the wrong exercises in the saved plans (for example Barbell Curl for "Romanian Deadlift or Trap Bar Deadlift", or Cable Crunch for "Lat Pulldown or Pull-ups") were entered at the manual choice step. There, 14 rows had to be picked from the whole library, there was no way to skip a row, and nothing set the plan's words beside each choice before saving.

**One parsing defect** was also found: "3 sets x 30–60 seconds" (a plank) was read as 30–60 repetitions.

**Fix.**
- Each exercise shows **Matched**, **Needs confirmation**, **Chosen by you** or **Skipped by you**.
- "Skip: don't save this exercise" leaves an exercise out.
- An "A or B" row says the plan gives a choice.
- Before Save, every choice is listed beside the plan's own words, with counts.
- Timed sets are kept as written, and never read as repetitions.

**Verified.**
- A unit test on the owner's file checks the 3 days, all 18 exercises in order with their sets and reps, the timed set, and that every automatic match names the same exercise.
- The browser test checks the statuses, the choices summary and skip.

**Not changed.** The demo account's three plans saved from that import on 2026-11-09 still hold the wrong exercises. They are the owner's records: delete them, or correct them in the plan editor.

**Remaining limits.**
- A row naming two exercises at once ("Bicep Curls & Tricep Pushdowns (Superset)") is one row: one exercise is chosen, and the other can be added in the plan editor.
- A timed set needs its repetitions typed in, or the exercise skipped, as plans store sets and repetitions only.

## CON-01 and CON-02: Chrome console messages

Checked on 2026-11-09 against http://localhost:3400 (`fd6f67b`), as the demo account, over 5 pages (dashboard, workouts, nutrition, progress, profile), in the Chromium bundled with Playwright 1.63, with a fresh browser profile. Nothing was saved.

**CON-01 is intended.** `src/components/pwa/install-help.tsx`, on the Profile page, catches Chrome's `beforeinstallprompt` and calls `preventDefault()`. It keeps the event so that the page's own **Install now** button can open Chrome's install dialog when the person asks, rather than Chrome showing its banner unprompted. Chrome then logs this information-level message; it isn't an error or a warning. The install flow was checked:
- Chrome reported no installability errors (`Page.getInstallabilityErrors`), and the service worker was registered.
- Chrome fired the real event on the Profile page, and **Install now** appeared.
- Choosing it called `prompt()` once, and the button went away.
- Chrome's own install icon in the address bar is unaffected.

**CON-02 comes from a browser extension, not the app.**
- **Without extensions:** 0 occurrences over the 5 pages.
- **With a minimal test extension** that does what many extensions do (a content script sends a message on each page, and the background listener returns `true` but never answers): 12 occurrences over the same pages, with exactly the owner's text, as `Uncaught (in promise) Error: …`.
- **The app can't produce it.** The message belongs to Chrome's extension messaging (`chrome.runtime`). Neither the source nor the built bundles (`.next/static`, `public/`) use `chrome.runtime`, and the app's service worker (`public/sw.js`) has no message listener.
- **To confirm in your own Chrome:** open http://localhost:3400 in an Incognito window with extensions off. The message doesn't appear. Turning extensions back on one at a time shows which one sends it; password managers, translators and ad blockers commonly do.

**Tests:** the PWA unit tests passed (`src/lib/pwa.test.ts` and related, 127 passed). The browser PWA suite wasn't run, as it starts its own app server.

## UI-02: Progress views

**Owner design decision (2026-11-09), recorded as given.**
- **The existing exercise cards and their badges stay.** The owner explicitly approved them: **Improved** (green), **Down** (orange), **Matched** (blue) and **Baseline** (neutral).
- **Unchanged:** their colours, appearance, comparison calculations, and the link to each exercise's detail page.
- **The new organization is an added view, not a replacement.**

**The Progress page has three views, as tabs:**
1. **Training programs** (the default, `/progress`): by program, then month, then workout date, then exercises.
2. **Exercise progress** (`/progress?view=exercises`): the existing cards and badges, from the same code, unchanged.
3. **Body weight**: opens the existing weight log, `/progress/weight`.

**How the Training programs view works.** There's no database change. A workout's program comes from its plan: workout → plan → program.
- **Grouped by each plan's current program,** and the page says so. Grouping or ungrouping a plan moves its past workouts with it. Storing the program on each workout would need a schema change, which the owner asked to avoid.
- **Workouts with no program** (from individual plans, empty workouts or deleted plans) are in one group, **Not in a program**. Nothing is grouped by guessing from names or dates.
- **Each exercise on a date** gets the same badge calculation as Exercise progress. It compares that workout with the previous workout of the same exercise, on the same machine or none (WT-03), across every program, so switching programs never gives a false Baseline. The latest workout's badge equals the exercise card's (unit-tested).
- Each workout links to its history page. Each exercise links to its progress detail, on its machine if it had one.

**Product review** (`product-strategy-agent`, MODIFY).
- **Adopted:** its points on the "Not in a program" label, the current-program note, the per-date comparison and the Body weight link.
- **Not adopted:** its suggestion to open on Exercise progress while there are no programs. The owner explicitly chose Training programs as the default.

**Verified.**
- **Unit tests** (`src/lib/progress-programs.test.ts`, 7), covering:
  - grouping and order;
  - months by local date;
  - comparison across programs, but never across machines;
  - the latest badge equal to the card's;
  - an exercise done twice in a workout counted as one;
  - no badge without working sets.
- **Browser tests:**
  - `gyms-e2e` passed. It now also checks the default view, the Not in a program group, and a machine exercise's link. Its card checks run on `?view=exercises`.
  - `csp-e2e` passed.
- **On the demo account** (`fitdb_test`, read-only):
  - Exercise progress: the 21 cards were **identical** to the previous page's, in markup, classes and links.
  - Training programs: 32 workouts under the program the owner made, across 3 months. Badges: Improved 73, Matched 30, Down 29, and Baseline 21 (one per exercise's first session).
  - No page errors, and no sideways scrolling at 390 px.
- **Screenshots:** [docs/screenshots/ui02](screenshots/ui02).

**Limits.**
- A workout from a plan that was later moved to another program shows under the plan's current program, not the one it had then.
- With years of workouts, the view lists them all, by month, with only the latest month open.

## UI-03 to UI-08, and the rest of UI-02 (consolidated owner fixes, 2026-11-09)

Built on `feature/ux-consolidated`, then integrated into `feature/multi-gym-exercise-alternatives`. Reviewed by `product-strategy-agent` for UI-06 (MODIFY). Its points are adopted:
- check the preview is still current;
- clear "active" on deletion, keeping the schedule;
- never remove a schedule entry without confirmation;
- an editable default spread;
- no automatic choice for the demo account;
- say why standalone plans aren't offered while a program is active.

**UI-06, one active program.**
- **Data:** `Profile.activeProgramId`, nullable and unique, cleared if that program is deleted. It comes from migration `20261111120000_active_program` (**MIG-ACTIVE**), which only adds; no program is made active by it.
- **Nothing is ever chosen for the person.** On Workouts, "Choose your active program" asks once.
- **Set as active** opens a preview:
  - each workout day gets weekdays, kept from the current schedule where it has some, otherwise spread (3 days: Mon, Wed, Fri); all of them can be changed;
  - every schedule entry that would be removed or added is listed;
  - nothing changes until it's confirmed.
- **Confirmation** sets the program and the schedule in one transaction. It's refused if the schedule changed since the preview, or if a day would hold more than 3 workouts.
- **On Workouts:**
  - the active program is shown first, then other programs, then individual plans;
  - This week names the active program, and flags any entry from outside it.
- **While a program is active,** only its workouts can be added to the schedule, enforced on the server as well. Entries already on the schedule may stay.
- **Deleting the active program** keeps its plans and the schedule, and leaves no program active.
- Completed workouts and progress are never changed.

**UI-03/UI-04, weekly schedule.**
- Each day shows its workouts by name (wrapping), program and exercise count, with labelled **Change**, **Move** and **Remove** buttons, or "Rest day".
- **Add workout** opens a chooser with nothing preselected: program, then workout.
- A day holds one workout by default. **Add another workout to this day** (up to 3) is a separate, deliberate link.
- **Move** offers the other weekdays, with full days disabled.
- **Remove** takes a workout off the schedule only.
- Everything is a draft until **Save schedule**. **Discard changes** returns to the saved week, and leaving with unsaved changes warns.
- The dialogs are native `<dialog>` elements: Escape closes them and focus returns to the opener. Changes are announced to screen readers.

**UI-05, management.**
- Every individual plan and program day has **Start**, **Edit** and **Delete**. Every program has **Set as active**, **Manage** and **Delete**.
- Every deletion opens a dialog that says:
  - which schedule days lose the plan;
  - how many logged workouts stay;
  - that a workout in progress carries on.
- Deleting a program keeps its plans, as individual plans.
- The program page has the same Set as active and Delete.

**UI-02, completed.** Program, then month, then **workout date**, each collapsible; then the exercises actually performed. An exercise expands to show:
- its logged sets, with warm-ups marked, and the machine;
- the previous comparable workout (same exercise and machine context, strictly before that date) and the numerical comparison;
- its recent history, with each badge **as it stood on its own date**;
- a link to the full chart.

The Improved/Down/Matched/Baseline badges and the Exercise progress cards are unchanged; that view's code is byte-for-byte identical. Workouts are still grouped by each plan's *current* program, as the page says.

**UI-07, Nutrition day.**
- Previous day | the date (opens a calendar) | next day.
- **Jump to today** whenever another day is shown.
- Days after today can't be chosen, and an empty day loads like any other.

**UI-08, Nutrition history.**
- Previous week | the period (opens a calendar with Start and End) | next week. **Back to this week** whenever another period is shown.
- A custom range of up to 92 days drives the averages (the existing logged-day rules), the day list and the daily chart, which is labelled by date when longer than a week.
- A reversed, invalid, future or over-long range is refused with the reason, and this week is shown instead.
- The trend stays an **8-week** chart, labelled with the exact weeks it covers (ending with the period's last day).
- Error messages use neutral colours, keeping the rule that nutrition never shows "down" colours.

**Verified (disposable data only; nothing on the demo account was changed by tests).**
- **Unit tests** passed for the activation rules, the period rules and the Progress history (as of each date, separate per machine).
- **API tests** (`workout-import-api`, 13 of 13) cover:
  - a preview that changes nothing;
  - a stale preview refused, with nothing removed;
  - too many workouts on a day, and plans outside the program, refused;
  - a confirmation that sets both the schedule and the active program;
  - the schedule limited to the active program's workouts;
  - another person's program refused;
  - deleting the active program, and deleting a plan with history and a workout in progress.
- **New browser suite `ux-e2e`:**
  - in Chromium, Firefox and WebKit: activation with its preview, and the schedule editor (add with nothing preselected, Escape, discard, change, move, remove, save);
  - in Chromium: UI-02 expansion, UI-05 dialogs, the UI-07 calendar and UI-08 ranges;
  - at 375 px: a long name wraps, and nothing scrolls sideways.
- Results of the wider regression are in [PROJECT_STATUS.md](PROJECT_STATUS.md) and the delivery report.

**Database.** MIG-ACTIVE was rehearsed on a restored copy of the backup `fitdb_test-pre-mig-active-20261109T203220Z.dump`, in the throwaway cluster. Results:
- every existing row in 20 tables was unchanged;
- 0 of 4,801 profiles active;
- no drift from the schema.

**Applied to `fitdb_test` on 2026-11-09 with the owner's approval**, after a fresh backup (`fitdb_test-pre-mig-active-apply-20261109T205108Z.dump`): every existing row unchanged against the fingerprint taken just before, 0 profiles active, no drift; the demo account's counts identical before and after. Not applied to any other database.

**Limits.**
- A workout's program in Progress is its plan's *current* program.
- A day taken out of the active program stays on the schedule, flagged, until removed.
- A program with more than 7 days gets no suggested weekday for its 8th day onwards; the person can add one.
