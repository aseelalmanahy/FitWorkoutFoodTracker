# Bug tracker

**User-facing defects found by the owner or by hands-on testing, and where each stands.** The full defect history, including engineering defects, stays in [DECISION_REGISTER.md](DECISION_REGISTER.md) §7; release evidence stays in [RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md). "Fixed" means fixed and verified by tests; **only the owner's own confirmation is acceptance**.

| ID | Found by | Defect | Severity | Status | Evidence |
|---|---|---|---|---|---|
| **UI-01** | Owner, 2026-11-09 | Imported plans were mixed with unrelated plans: each imported day became its own plan named "Program – Day", listed among the person's own plans, and was put on the weekly schedule whenever the file named a weekday | High | **Fixed** in `bd86e47`; owner review pending | See below |
| **IM-02** | Owner, 2026-11-09 | A text import ("workout 1.txt") saved exercises that weren't in the file | High | **Fixed** in `bd86e47` (cause found and closed); owner review pending | See below |
| **IMG-01** | Owner, 2026-11-09 | A real plan image gave "No exercises with sets and repetitions were found" | High | **Fixed** in `2411496`, `7fec302`. The owner confirmed the reading works; **full acceptance is still separate** | [DECISION_REGISTER.md](DECISION_REGISTER.md) §7 |
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
