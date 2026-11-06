# Phase 4.0.1 Implementation Plan: Adult Eligibility and Removal of Automatic Calorie Targets

**Authorization status: NOT AUTHORIZED. Implementation can't start until section 17's conditions are met.**

**Boundaries of this document:**

- **Planning only.** Publishing it for review approves nothing.
- **No implementation scope is approved.**
- **No medical threshold is approved.**
- **No database migration is approved.**
- **No production deployment is approved.**
- **No external service is approved.**
- **Phase 4.0 remains unfinished.**

It also takes no legal position. Application code is the same on `main` (`3f0fddc`) and this plan's branch (`1960eec`), and all references were checked against it on 2026-11-05.

**Decision numbers** are those in `docs/PHASE_4_0_DESIGN.md`, section 15, written "Decision 9". `docs/PRODUCT_STRATEGY.md` has its own list, always written "Strategy decision 8".

**For the independent reviewer:**

| Asked for | Where |
|---|---|
| Exact proposed scope | Sections 1, 3 and 4 |
| Source files likely to change | Section 11 |
| Architecture and data-flow effects | Annex B |
| Security and safety requirements | Section 8, Annexes A and C |
| Test cases | Section 12 |
| Negative controls | Section 13 |
| Regression risks | Annex D |
| Open owner decisions | Section 16 |
| Contradictions between documents | Annex E |
| Product Strategy Agent's review of this revision | Annex G |

**How to read this plan:**

| Marking | Meaning |
|---|---|
| **TECHNICAL DESIGN** | Fully specified. It can be built once the milestone is authorized |
| **BLOCKED (Decision N)** | Depends on an open decision. **Don't build any branch until it's decided.** No default applies |

**Evidence labels,** as defined in the design:

| Label | Means |
|---|---|
| **CONFIRMED DEFECT** | Follows directly from source read at this commit. The running app wasn't exercised |
| **REPRODUCED AT MODULE LEVEL** | Produced by calling the real pure function, or a stated copy of a formula. No app, route or database. It doesn't show what a user reaches through the UI |
| **INFERRED RISK** | Reasoned, not observed. This includes every prediction about which tests break |
| **UNTESTED ASSUMPTION** | Believed, not checked |
| **DESIGN RECOMMENDATION** | A proposal for approval |

## 1. Objective

Stop the app from giving people calorie or macro targets they didn't choose, and from offering them to people the formulas weren't meant for.

**Out of scope:** account deletion, export, email, registration changes beyond one line of text, deployment, Phase 4.1, and any threshold.

## 2. Verified current defects

**Numeric results were rerun on 2026-11-05 against the real functions in `energy.ts`, with no database.**

| # | Defect | Where | Evidence |
|---|---|---|---|
| 1 | Age minimum is 13 | `validation.ts:26-29` | CONFIRMED DEFECT |
| 2 | 365.25-day arithmetic is wrong at birthdays. With 18 as the limit: born 2008-02-28 passes at 2026-02-27 12:00 UTC while aged 17, and born 2008-11-05 is refused on the birthday | `validation.ts:27` | REPRODUCED AT MODULE LEVEL, using a copy of the formula, as no 18 rule exists to run |
| 3 | A second age rule in the form, whose estimate appearing or not reveals the limit | `profile-form.tsx:98-99` | CONFIRMED DEFECT |
| 4 | A target is written on first read, by any `GET` or page that calls `getTargets` | `targets.ts:49-61`. Callers: `targets/route.ts:16`, `targets/page.tsx:11`, `entries.ts:166,202` | CONFIRMED DEFECT |
| 5 | Saving a first manual target also seeds a `SUGGESTED` row dated to the earliest entry, so someone typing their own number still gets a suggestion on past days | `targets.ts:96`, then `:49-61` | CONFIRMED DEFECT |
| 6 | Backdated entries move the first target's date, during a read | `targets.ts:66-73` | CONFIRMED DEFECT |
| 7 | A suggested target follows profile edits with no notice | `targets.ts:111-120`, `api/profile/route.ts:19` | CONFIRMED DEFECT |
| 8 | Saving the editor unchanged relabels a seeded suggestion as "Set by you". The editor opens with the seeded row, as `current` | `targets-editor.tsx:13-16,66`, `targets.ts:97` | CONFIRMED DEFECT |
| 9 | "Use suggestion" is hidden when no target exists. **Narrow today:** seeding means `current` is rarely null, roughly only after a person moves to an earlier time zone (INFERRED RISK). It matters once seeding goes | `targets-editor.tsx:25,85` | CONFIRMED DEFECT, limited reach |
| 10 | Deficit suggested at any weight: female, 40 kg, 170 cm, 30 y, active gets 1,690 against a TDEE of 1,986, at BMI 13.8 by arithmetic | `energy.ts:86-90` | REPRODUCED AT MODULE LEVEL |
| 11 | Non-deficit suggestions skip the floors: 1,110, 1,480 and 260 kcal | `energy.ts:102` | REPRODUCED AT MODULE LEVEL |
| 12 | High estimates exceed the manual maximum of 8,000: male, 300 kg, 250 cm, 18 y, very active gets 8,510 at maintenance and 8,860 on muscle gain. The upsert skips that validation | `energy.ts`, `validation.ts:183`, `targets.ts:56` | REPRODUCED AT MODULE LEVEL |
| 13 | A floor raises a "deficit" above TDEE: 1,200 against 1,112, with text still saying "Moderate deficit" | `energy.ts:89,102-106` | REPRODUCED AT MODULE LEVEL |
| 14 | "Raised to a minimum safe floor", and an uncited comment on the floors | `energy.ts:36,105` | CONFIRMED DEFECT |
| 15 | Macros collapse silently: protein 200, carbs 0, fat 0 at 800 kcal and 100 kg on fat loss. The existing test only checks the total fits (`nutrition.test.ts:76-79`) | `energy.ts:154-158` | REPRODUCED AT MODULE LEVEL |
| 16 | `calorieTargetOverride` accepted down to 800, and read when seeding | `validation.ts:40`, `targets.ts:54-55` | CONFIRMED DEFECT |
| 17 | Sex, goal, activity and units default silently, as do experience and workout days. A metric user's "70" under the imperial default becomes 31.8 kg, which passes validation | `profile-form.tsx:54-57,60-61` | CONFIRMED DEFECT. The 31.8 kg figure is arithmetic |
| 18 | Onboarding has no exit. The only logout is on the profile page | `onboarding/page.tsx`, `profile/account-actions.tsx:34-38,54` | CONFIRMED DEFECT |
| 19 | Raw field names and limits reach users, such as "birthDate: Age must be..." | `client/api.ts:42` | CONFIRMED DEFECT |
| 20 | With no target, `MacroBar` exposes an empty progress bar with no maximum | `macro-bar.tsx:21` | CONFIRMED DEFECT |
| 21 | Activity hint contradicts labels, and ±10 % wording sits on TDEE when its evidence concerns resting rate | `profile-form.tsx:183,218`, `energy.ts:7-9,29-33` | CONFIRMED DEFECT |
| 22 | Onboarding says the data is "Used to personalise calorie estimates and training plans". No code reads it for a training plan, by searching property access | `onboarding/page.tsx:16` | CONFIRMED DEFECT |
| 23 | A typed macro target of 0 counts as over target as soon as anything is eaten, in red | `macro-bar.tsx:10,16,22,24`, `entries.ts:184-186` | CONFIRMED DEFECT |
| 24 | A protein target of 0 shows "Protein on target" on every logged day, though the weekly summary already excludes such days | `history/page.tsx:65,74`, compare `nutrition.ts:164` | CONFIRMED DEFECT |
| 25 | Protein 0 and fat 0 store a derived carb target of `kcal/4`, such as 500 g at 2,000 kcal, which the person never asked for | `nutrition.ts:133-137`, `targets.ts:94` | CONFIRMED DEFECT |

**Maintenance estimates aren't safe just because they aren't deficits.** 1,990 kcal at BMI 13.8 reads as "stay here". A fixture at BMI 20 gets the same 1,110 kcal as a person at 35 kg. So calories alone can't separate a plausible result from an alarming one, and any cutoff would be an invented threshold. **This plan sets none.**

## 3. Exact implementation boundaries

**TECHNICAL DESIGN, in scope:**

- One shared age rule, enforced on `PUT /api/profile`.
- No target is ever written except by an explicit `PUT /api/nutrition/targets`. Backfill's fate is Decision 19, and this line assumes it isn't kept as a write on read.
- Removal of "safe floor" wording, and of automatic deficits and surpluses.
- Explicit units for new profiles.
- A working no-target state on every nutrition screen.
- A logout on onboarding, and readable errors on the profile form.

**BLOCKED, specified in sections 6 and 8:**

- The age limit (Decision 1) and date rule (Decision 15).
- Showing any estimate, and the calorie default (Decision 9). **Removing `suggestCalories` and `suggestMacros` assumes option A or B. Option C returns this plan to design.**
- Removing date backfill (Decision 19).
- A way to stop using a target (Decision 20).
- Requiring a chosen goal (Decision 21).
- The sign-up line (Decision 22).
- Whether sex and activity stay required if nothing uses them (Decision 25).
- How a calories-only target works (Decision 26).
- Who removes a refused person's account (Decision 27).
- What an under-18 date on a profile edit does (Decision 28).
- How an adult who mistyped a date recovers (Decision 29).
- How legacy `SUGGESTED` rows behave in the editor and on the Nutrition page (Decision 30).
- What the editor says below 800 kcal (Decision 31).

**Excluded:**

- Warnings, blocks or confirmation on manual targets, and underweight goal warnings (Decision 23). **Still required before the beta by the register,** see Annex E.
- Any weight, BMI or calorie threshold.
- Help resource and final wording (Decision 7).
- Over-target colour (Decision 24).
- Removing a refused person's account. **No milestone owns this yet** (Decision 27).
- Replacing raw errors in other forms.
- Converting the Goal buttons to radios. It's not needed for this objective.

## 4. User-visible changes

| Screen | Change |
|---|---|
| Sign-up | One line: "For adults 18 and over." **BLOCKED (Decisions 1, 22)** |
| Onboarding and profile | Estimate card removed, including `:203-226`. Sex, activity and units start unselected for new profiles, and goal too under Decision 21. New text: "Targets are optional. You can set your own in Nutrition → Targets." The profile keeps a link to targets |
| Units on a new profile | **Height and weight fields appear only after units are chosen,** as their labels and conversions depend on it |
| Onboarding | Intro at `:16` becomes "You can change this any time." Gains a "Log out" button |
| Sex and activity hints | Under Decision 25 and Decision 9's option A: "Stored with your profile. Not used for any calculation at the moment." **Interim wording** |
| Refusal, onboarding | Heading "We can't set up an account for you." Body: "Based on the date of birth you entered ([date]), this app isn't available to you. We didn't save that date." One action: Log out. Focus moves to the heading. **Don't add "try again" or a date-of-birth `max` attribute** |
| Refusal, profile edit | Field error: "This date of birth can't be used." Saved profile unchanged, and access continues. **BLOCKED (Decision 28)** |
| Editor, kcal below 800 | **BLOCKED (Decision 31).** Today this likely shows a raw limit through `client/api.ts:42` (INFERRED RISK) |
| Nutrition | With no target: "Consumed X kcal" in the top card, replacing `page.tsx:62`. On today only, a quiet "Add a target" link. On past dates, no link |
| `MacroBar` | With no target: text only, with no progress bar |
| History | With no target: hide the caption at `:56`, the sub-text at `:53` and the chart's target line and tooltip. Keep intake and days logged |
| Targets | "No target yet" plus blank fields. No suggestion card, no "Use suggestion", no 1.6 g/kg text |
| Save message | First target: "Saved. New targets apply from today." The current "Earlier days keep their previous targets" stays only when an earlier target exists |
| Dashboard | No change. Verified: it reads no targets |
| Legacy `SUGGESTED` rows | Label on Targets: "Set automatically earlier". **Whether the editor starts blank for them, and whether the Nutrition page labels them (`page.tsx:56`), is Decision 30** |

**Interim copy on the Targets page,** pending Decision 7's review:

> Targets are optional, and you can track food without one. This app can't account for health conditions, pregnancy or medication, and it isn't medical advice.

## 5. Server-side behaviour

**TECHNICAL DESIGN:**

```ts
// src/lib/eligibility.ts (new), pure
export const MIN_ADULT_AGE = 18;   // BLOCKED (Decision 1) until confirmed
export const MAX_ENTRY_AGE = 110;  // a data-entry bound. Not a medical limit
export type Eligibility = "eligible" | "under_minimum" | "out_of_range";
export function eligibilityOf(birthIso: string, now = new Date()): Eligibility;
```

- **Order of checks:** a date after the UTC date is `out_of_range`, then age above `MAX_ENTRY_AGE` is `out_of_range`, then age below `MIN_ADULT_AGE` is `under_minimum`.
- It calls the existing `ageFromBirthDate` from `energy.ts`, and no second calculation exists.
- **`profile-form.tsx:95-102` and the 365.25 formula are removed.** Only the server route calls `eligibilityOf`.

| Function or route | New behaviour |
|---|---|
| `getTargets` | `findMany`, then `toDated`. No seeding. The `profile` parameter goes. **The backfill branch at `:66-73` follows Decision 19:** this plan's tests assume removal |
| `getTargetFor` | **Removed.** Its only caller is `syncSuggestedTarget` |
| `setManualTarget` | Drops its `getTargets` call. Writes `source: "MANUAL"` from today. A legacy row for today is replaced by it |
| `applySuggestion`, `POST /api/nutrition/targets/suggestion` | **Removed.** Returns 404 |
| `syncSuggestedTarget`, and its call in `api/profile/route.ts` | **Removed.** Rows never change on a profile edit |
| `suggestionFromProfile` | **Removed** |
| `GET /api/nutrition/targets` | Returns `today`, `current` (may be null) and `history`. No `suggestion` |
| `daySummary`, `history` in `entries.ts` | Already handle a null target (`:169,181-182,212`). Only the `getTargets` call changes |
| `PUT /api/profile` | Parses, checks eligibility, then writes. On refusal, **nothing is written** |

**Removed from `energy.ts`, under Decision 9's option A or B:** `suggestCalories`, `suggestMacros`, `MIN_INTAKE_KCAL`, `PROTEIN_G_PER_KG`, `FAT_ENERGY_FRACTION`, `FAT_MIN_G_PER_KG`, `CalorieSuggestion`, `MacroTargets` and `round10`. **This eliminates the deficit, surplus, macro collapse and floor text defects,** as no code can produce them. Kept: `ageFromBirthDate`, the activity labels, and, only if Decision 9 picks option B, `mifflinStJeorBmr`, `estimateTdee` and the multipliers. Under option A these three have no production caller. **Recommended under option A: remove them with their tests,** as the agent advised and Git keeps them. This withdraws the earlier recommendation to keep them.

**`carbsFromRemainder` stays,** as pure arithmetic on what the person typed.

## 6. Data validation

| Field | Rule |
|---|---|
| `birthDate` | `z.iso.date()` only in the schema. Eligibility is checked in the route, so its text can't leak through Zod. Verified: the schema already rejects 2000-02-30, 2001-02-29 and 1990-1-1 |
| `calorieTargetOverride` | Removed from `profileSchema`, `ProfileValues`, `serialize.ts:18` and the form (`:23,110,131`). The column stays, unused, as no migration is authorized. A sent value is ignored. Test fixtures that still send `null` keep working (Zod strips unknown keys, INFERRED RISK until the test runs). The comment at `schema.prisma:97` goes stale, and `prisma/` isn't touched |
| `sex`, `activityLevel`, `goal`, `unitSystem` | Already required by the schema, and the columns are non-null. The change is in the form: no preselected value. Units are in scope, with sex and activity under Decision 25, and goal under Decision 21 |
| `nutritionTargetSchema` | **Unchanged: 800 to 8,000 kcal, described as a data range and never as safe** |
| `currentWeightKg`, `goalWeightKg` | Unchanged. Underweight goal warning is excluded (Decision 23) |

**Date rule:** `ageFromBirthDate` compares calendar parts on UTC dates. **BLOCKED (Decision 15)** until UTC is confirmed. Client-supplied `timezone` must never affect the result.

The calendar column below was run on the real function. **Eligibility itself doesn't exist yet.**

| Case | At | Calendar age | Result |
|---|---|---|---|
| Born 2008-11-05 | 2026-11-04 23:59 UTC | 17 | `under_minimum` |
| Born 2008-11-05 | 2026-11-05 00:00 UTC | 18 | `eligible` |
| Born 2008-11-05 | 2026-11-06 00:00 UTC | 18 | `eligible` |
| Born 2008-02-28 | 2026-02-27 12:00 UTC | 17 | `under_minimum` |
| Born 2008-02-29 | 2026-02-28 12:00 UTC | 17 | `under_minimum` |
| Born 2008-02-29 | 2026-03-01 00:00 UTC | 18 | `eligible`. **Legal to confirm** |
| Born 2026-11-05 | 2026-11-05 12:00 UTC | 0 | `under_minimum` |
| Born 2026-11-06 | 2026-11-05 12:00 UTC | -1 | `out_of_range` |
| Born 1916-11-05 | 2026-11-05 00:00 UTC | 110 | `eligible` |
| Born 1915-11-05 | 2026-11-05 00:00 UTC | 111 | `out_of_range` |

## 7. Error handling

| Case | Status | Body | Client |
|---|---|---|---|
| Under minimum, no profile yet | 422 | `{ error, details: { reason: "age_ineligible" } }` | Refusal view |
| Under minimum, profile exists | 422 | Same | Field error |
| Out of range | 400 | `{ error: "Check the date of birth." }` | Field error |
| Profile fields invalid | 400 | Zod details | Mapped per field to fixed copy, with no limits or field names |
| Network | | `saveFailureMessage` pattern | Keep what was typed |
| Removed suggestion route | 404 | | None calls it |
| Target with protein and fat over kcal | 400 | Existing message | Existing |

**No change to `client/api.ts` is needed.** `ApiError.details` already carries `fieldErrors` and would carry `reason` (`:3,43`), and `HttpError` and `jsonError` already pass details (`server/api.ts:10,18`). The form reads `details` instead of showing `message`. Other forms are unaffected. The form focuses the first invalid field, and sets `aria-invalid` and `aria-describedby`. `Field` already has an `error` prop.

**The refusal never shows the threshold's number.** This doesn't keep it secret: under Decision 22 the sign-up page states it, and repeated attempts would find it (INFERRED RISK). The purpose is not to invite a retry. The date goes in component state only, never the URL, and refused dates aren't logged.

## 8. Fitness safety rules

**TECHNICAL DESIGN:**

1. No automatically persisted target, on any path.
2. No deficit, surplus or macro suggestion exists in the code.
3. No floor described as safe, anywhere.
4. Food tracking works with no target.
5. No medical condition is asked for or inferred, and nothing about it is stored.
6. Age is always described as declared, never verified.
7. **No threshold is added.** That includes reusing `MIN_INTAKE_KCAL` or 800 as a warning trigger.

The review behind these rules is in Annex A.

### BLOCKED: calorie default and estimate display (Decision 9)

**Don't build any option until Decision 9 is decided.** None involves a threshold.

| | **Option A: no estimate** (recommended until reviewed) | **Option B: on request** | **Option C: explicit acceptance** |
|---|---|---|---|
| Shown | Nothing numeric | One coarse range on the Targets page, behind "Show a rough estimate" | A suggested target, with an accept step |
| Calculation | None | `mifflinStJeorBmr` × the multipliers of the adjacent activity levels, rounded. Goal doesn't change it | Needs a formula and rules for goals |
| Echo | n/a | Age, sex, height, weight and activity used | Same, at minimum |
| Withheld when | n/a | Sex or activity not chosen, or stored birth date not eligible. **Withholding by calorie or body size goes to the reviewer, as 800 to 8,000 is a data range and not a safety limit** | Would need a reviewed rule |
| Wording | n/a | "Rough estimate of current energy use. Not a goal or recommendation." Explicitly not a confidence interval. Sex hint: "The equation has only these two versions. Used only for this estimate." | Needs review |
| Writes a target | Never | **Never.** People type their own number | Only on that accept step |
| Needs | Owner | Owner, plus professional review: a number can work as a recommendation | Owner, professional review, and a new plan |

**How the recommendations moved:** design section 15 originally recommended a form of C, and Review E proposed a one-tap "Use this as my target". The agent and Review D recommend against one-tap, as it makes a formula's output the person's target. The agent's earlier final review allowed an estimate on request, **but its review of this revision withdrew that and recommends A:** B has no honest withholding rule without a threshold, and its range has no validated width (Annex G).

**"Until reviewed" needs a reopening condition,** as no reviewer exists yet (the agent's finding). **Proposed:** reopen only once Decision 7 names a qualified reviewer and that person has seen the wording and method. **A consequence of A:** manual entry becomes the only route to a target, and that path has no guard (Decision 23). Whether people would copy worse numbers from elsewhere is an UNTESTED ASSUMPTION.

### Consent rule for any future suggestion

**DESIGN RECOMMENDATION, binding on later phases if accepted.** No suggestion exists after this milestone. Any later one, including from the Phase 4.1 weight log or Strategy decision 8, must meet all of these:

1. It goes back through product review, professional review and the owner.
2. Showing a suggestion writes nothing, on `GET` or page load.
3. A target is written only by a deliberate action on a screen showing the values and how they were derived.
4. Fields aren't prefilled from it, so one Save can't accept it by accident.
5. The source is stored truthfully, so a suggestion is never labelled "Set by you".
6. **Accepted values never follow later changes** to profile or weight. A change can prompt, never apply.
7. Declining is free, permanent until the person asks, and needs no reason. No repeated prompting.
8. It's never shown when the stored birth date isn't eligible.

### BLOCKED: date backfill (Decision 19)

`targets.ts:66-73` extends a first target back over earlier entries. **Recommended: remove,** since it marks untargeted days against a target set later, and contradicts the editor's "Earlier days keep their previous targets" (`targets-editor.tsx:35`). It's a deliberate earlier feature (test "D4" at `nutrition-api.test.cjs:401`, where "D4" is an audit label unrelated to any decision number), so **it needs a decision.**

**Keeping it can't stay as it is,** as it writes during a read, which breaks acceptance criterion 3. Keeping it needs either a computed value at read time, with no write, or a write when the entry is saved. Both need added design.

### BLOCKED: stopping a target (Decision 20)

`kcal` is non-null (`schema.prisma:390`), so no row can say "no target from today". **Recommended: `DELETE /api/nutrition/targets` removes all the user's target rows,** after a `Sheet` confirmation: "Stop using a target? Your food log stays, but past days will no longer be compared with a target." **Consequence:** earlier days lose their target comparison, which departs from "changing a target never rewrites past days" (`schema.prisma:385`). The alternative is a nullable column, which needs a migration and isn't authorized. **The agent notes that Decisions 20 and 26 touch the same table:** if nullable macros are approved, decide nullable `kcal` at the same time, which could preserve history (INFERRED RISK, untested). **Doing nothing leaves no way back to tracking without a target,** which undermines the opt-out for pregnancy, illness or eating concerns.

### BLOCKED: calories-only targets (Decision 26)

**A new finding from removing suggested macros.** Protein and fat are required, and all macro columns are non-null (`schema.prisma:391-393`). Today's editor opens filled in. With blank fields, someone who wants only a calorie target must invent macro numbers or type 0.

**Zero and unspecified are different things, and the current schema can't tell them apart:**

| Meaning | Today | Problem |
|---|---|---|
| Unspecified, typed as blank | Refused: `parseNum("")` is NaN, so the editor shows an error (`targets-editor.tsx:30`) | Correct: blank never silently becomes 0. **This must stay,** by test T30 |
| Unspecified, typed as 0 | Stored as 0 | Reads as a real target of 0: red "over" (defect 23), "Protein on target" (defect 24) |
| A deliberate target of 0 | Stored as 0 | Identical to the row above |
| Carbs, when protein and fat are 0 | Stored as `kcal/4` | An unrequested 500 g target at 2,000 kcal (defect 25) |
| Carbs of 0 because protein and fat fill the energy | Stored as 0 | A real derived result, or a legacy collapse (defect 15). Identical to any other 0 |

**Options, for the owner:**

| | **A: zero means no comparison** | **B: nullable macro columns** | **C: no calories-only in 4.0.1** |
|---|---|---|---|
| How | Compare a macro only if its target is above 0. Compare carbs **only if protein and fat are both above 0,** since protein 150 and fat 0 at 2,000 kcal would otherwise compare a derived 350 g. Applies to `MacroBar`, `history/page.tsx:65,74`, the editor's carb preview (`targets-editor.tsx:96-98`), and target displays, which show "not set". The form must say to type 0 | Store null for unspecified. Blank stays blank, and carbs are derived only when both are given | Keep requiring numbers |
| Migration | No | **Yes, not approved.** Its own migration: see below | No |
| Truthful | **No.** Stored 0 and `kcal/4` still mean "not set", so a later export or migration can't tell them from real values | Yes | Yes, but pushes people to invent numbers, or to get defects 23 to 25 |
| A deliberate 0 | Can't be expressed. Harmless, as it only removes a comparison | Expressible | Remains, with the red display |
| Fits "missing stays null, never 0" | Poorly. The principle concerns nutrition facts, not targets, but the owner should judge | Yes | Poorly |

**Recommended, following the agent: B as its own migration before any real user, with C until it lands.** If the owner refuses a migration before the beta, use A. Either way, B or that choice becomes a named beta gate. **This is not decided, and B needs its own migration approval.**

**Two earlier recommendations here are withdrawn:**

- A hint plus `MacroBar` only, which missed defects 24 and 25.
- Sharing 4.0.4's migration, with A as the interim. The agent showed this isn't sound. 4.0.4's migration is described as additive, with old code ignoring it, and dropping NOT NULL isn't additive: reverted code would meet nulls, and restoring NOT NULL needs a value, probably 0 (INFERRED RISK, Prisma's behaviour unobserved). B would also wait on Decisions 4, 5, 8 and 11, and export ships earlier, in 4.0.2, so its target fields could change afterward. Development-only data justifies C just as well as A, without throwaway code.

**While C applies,** defects 23 to 25 remain for anyone who types 0. Only development data exists at that stage.

### Excluded, not decided: manual targets and goal weights (Decision 23)

Three options exist for manual targets: block, warn, or require added confirmation. **All need a number, and 1,200 and 1,500 are uncited.** Underweight goal warnings need a BMI threshold. This plan builds none of them. Manual targets keep the 800 to 8,000 range, plus the notice in section 4. **So 800 kcal stays accepted with no warning after this milestone, and existing low rows stay in force with no notice. That's a known remaining gap, not a safe state.** Existing fixtures save 800 (`nutrition-api.test.cjs:225`, `e2e-nutrition.cjs:139`), so a later block would change them, which isn't a reason for or against one.

**The agent's position, not yet approved:** shipping 4.0.1 this way is acceptable, but leaving this unowned isn't, as nothing specific would stop a beta with silent 800 kcal. It recommends adding a 4.0.6 go/no-go item before authorizing 4.0.1: a reviewed number, or a recorded accepted gap with the register amended. It also says its own earlier recommendation to warn below the floors relied on figures that `energy.ts:36` doesn't cite, and was wrong. **The go/no-go item is recorded in the design as proposed.**

## 9. Backward compatibility

- **No schema or migration change.** No new dependency or service.
- `NutritionTarget` rows are unchanged, and `SUGGESTED` stays a valid value.
- `calorieTargetOverride` becomes unused.
- **API changes, all internal:** `suggestion` is removed from `GET /api/nutrition/targets`. The suggestion route is removed. `calorieTargetOverride` is ignored. Under Decision 20, a `DELETE` is added.

## 10. Existing targets and accounts

| Situation | Behaviour |
|---|---|
| Existing target rows | Stay and keep working. **Not rewritten by any automatic path,** by test T29. The only deletion is the person's own, under Decision 20. **One existing behaviour stays:** a second save on the same day replaces that day's row (`targets.ts:84-88`), as one row exists per date. Dates moved by past backfill aren't moved back |
| Existing `SUGGESTED` rows | Frozen, as nothing updates them. Labelled "Set automatically earlier". **They remain in force, unchosen, and may hold the defective values above.** Acceptable only because they exist only in development databases (UNTESTED ASSUMPTION, none inspected), so 4.0.3 must check production starts empty. **Defect 8 survives unless Decision 30 changes it:** the editor prefills from `current`, so saving a legacy row unchanged would read "Set by you" (INFERRED RISK) |
| Rows seeded from the override | Marked `MANUAL`, though their macros came from the formula (`targets.ts:55-58`), so they can't be told from chosen rows. Development data only (UNTESTED ASSUMPTION) |
| A stored under-18 profile | No blocked state. It keeps access, and any profile save is refused, as the birth date revalidates. Under option A it sees no formula output. **Acceptable only if production starts empty.** The register's policy is block, notify, offer export and delete (Annex E) |
| Accounts with defaulted sex or activity | Can't be told from chosen ones without a migration. Deferred: they exist only in development databases (UNTESTED ASSUMPTION) |
| Accounts with no profile | Onboarding, now with Log out. API routes for workouts stay reachable, which is acceptable as they involve no calorie formula. **An earlier version said 4.0.2 removes refused accounts. Its scope doesn't,** so this is Decision 27 |

## 11. Exact files expected to change

**Application:**

| File | Change |
|---|---|
| `src/lib/eligibility.ts` | New |
| `src/lib/energy.ts` | Removals above, plus activity label alignment |
| `src/lib/validation.ts` | `birthDate`, remove override |
| `src/lib/server/nutrition/targets.ts` | Removals, read-only `getTargets` |
| `src/lib/server/nutrition/entries.ts` | `getTargets` calls at `:166,202` |
| `src/lib/server/serialize.ts` | Remove override |
| `src/app/api/profile/route.ts` | Eligibility, remove sync |
| `src/app/api/nutrition/targets/route.ts` | Remove `suggestion`. Add `DELETE` only under Decision 20 |
| `src/app/api/nutrition/targets/suggestion/route.ts` | Delete |
| `src/app/(app)/nutrition/targets/page.tsx` | No suggestion, notice |
| `src/app/(app)/nutrition/page.tsx`, `nutrition/history/page.tsx`, `src/components/nutrition/history-charts.tsx` | No-target states. The chart only if its target line needs it |
| `src/app/onboarding/page.tsx` | Log out, intro text |
| `src/components/logout-button.tsx` | New, a small client component, as the page is a server component. `account-actions.tsx` is left alone |
| `src/app/(auth)/auth-form.tsx` | One line, under Decisions 1 and 22 |
| `src/components/nutrition/targets-editor.tsx` | Blank fields, no suggestion, label, save message |
| `src/components/nutrition/macro-bar.tsx` | Text only with no target, and under Decision 26 |
| `src/lib/nutrition.ts`, `src/lib/server/nutrition/entries.ts` | Only if Decision 26 changes how derived carbs or zero targets are computed |
| `src/components/profile/profile-form.tsx` | No estimate, no defaults, conditional fields, field errors, refusal view, native radios for `Segmented` |

**Tests:**

| File | Change |
|---|---|
| `src/lib/eligibility.test.ts`, `src/lib/validation.test.ts` | New |
| `src/lib/energy.test.ts` | Remove `:15-36` and the import. Keep `ageFromBirthDate`, and `Mifflin-St Jeor` only under option B |
| `src/lib/nutrition.test.ts` | **Remove the `suggestMacros` import (`:6`) and its tests (`:58-79`).** Keep `carbsFromRemainder` |
| `scripts/lib/e2e-onboarding.cjs` | New shared helper for the 6 onboarding flows |
| `scripts/e2e-smoke.cjs`, `e2e-nutrition.cjs`, `e2e-hardening.cjs`, `e2e-label-pdf.cjs`, `e2e-label-scan.cjs`, `e2e-meal.cjs` | Use the helper |
| `scripts/nutrition-api.test.cjs`, `release-workflow.test.cjs`, `live-provider-check.cjs` | See section 12. New API tests go in `nutrition-api.test.cjs`, so `npm run test:api` runs them |
| `scripts/e2e-eligibility.cjs` | New browser tests, using the `BROWSERS` pattern and the guard |

**Not changed:** `prisma/`, `package.json`, the lockfile, auth routes, `src/lib/client/api.ts`, agents, and `docs/` except the updates in Annex E.

**Prerequisite:** the test-target guard (4.0.0a, section 17) must be merged first, as this milestone rewrites write-capable tests.

## 12. Test cases

### Existing tests that will change

**All predicted from reading code, not run (INFERRED RISK).**

| File | Direct | Depends on seeding until rewritten |
|---|---|---|
| `nutrition-api.test.cjs` | `:57` drop the suggestion route from the anonymous list. `:137-140` no seed. `:153-163` replace, including the `POST` at `:160-162`. `:251` `current` is now null, so this would throw. `:309-318` replace. `:401-422` rewrite: `:406` has no seed to read | `:150`, `:200-202`. `:257-275` creates its rows directly, and should pass |
| `release-workflow.test.cjs` | `:39,80-83` remove. `:161-176` test 11 inverts | `:101`, `:115`, `:146`, `:181` |
| Same, **under Decision 19's removal** | `:135-136,139` and `:147,151,153-154`: backdated days have no target, and `proteinDaysWithTarget` drops from 3 | |
| `nutrition-api.test.cjs`, **under Decision 19's removal** | `:410-413`, `:417`, `:419-421` | |
| `live-provider-check.cjs` | FLOW-1 `:491`, FLOW-2 `:509,511`. Live runs need separate approval, and its unit tests must pass | |
| 6 E2E onboarding flows | Time out at `waitForURL` without units, sex and activity chosen. **`e2e-smoke.cjs:27-29` also relies on the imperial default** | Fixed by the helper |
| `e2e-hardening.cjs:675-683` | **Would still pass, but for the wrong reason.** With blank protein and fat, the error no longer proves that "1,200" caused it. Fill both with valid values first | |
| `e2e-nutrition.cjs:36-46,138-144` | None predicted: it fills all three fields | |
| 18+ rule itself | 0 predicted, as fixtures use 1990 and 1994. So a wrong rule would pass everything today | |

**Rule: a changed test must state why. No assertion is weakened to pass.**

### New tests

| ID | Test | Level | Exact assertion |
|---|---|---|---|
| T1 | Calendar age | Unit, fixed clock | Every row in section 6's table |
| T2 | Host time zone | Unit | Same results with host `TZ` of Pacific/Kiritimati and Pacific/Pago_Pago |
| T3 | Client `timezone` ignored | API | **Chosen so a local-date rule would flip.** At UTC hour 10 or later, send Kiritimati with an 18th birthday falling tomorrow UTC: 422. Before that, send Pago Pago with a birthday today UTC: 200. Wait out the final minute of a UTC day |
| T4 | 17-year-old refused | API | `PUT /api/profile` gives 422 and `reason === "age_ineligible"`. `profile.count` 0 |
| T5 | Refused edit | API | 422. Stored `birthDate` and other fields unchanged |
| T6 | Threshold not revealed | API, browser | Body and view, **with the entered date removed first,** contain no "18" or "13" |
| T7 | Refused date not logged | API | Server log file doesn't contain the date used |
| T8 | Reads write nothing | API | After `GET` targets, day and history, and loading those pages, with and without entries: `nutritionTarget.count === 0` |
| T9 | Concurrent reads | API | 8 parallel reads all 200, count 0 |
| T10 | First manual save | API | With a backdated entry present, `PUT` gives exactly one `MANUAL` row, effective today, and **no `SUGGESTED` row** |
| T11 | Profile edit writes nothing | API | **Create a `SUGGESTED` row directly,** then edit weight: its values are unchanged. Repeat with a `MANUAL` row |
| T12 | Legacy override ignored | API | A profile with the column set directly gets count 0 |
| T13 | Sent override ignored | API | `PUT /api/profile` with `calorieTargetOverride: 800` gives 200, the column is unchanged, and count 0 |
| T14 | Legacy row replaced | API | A `SUGGESTED` row for today, then `PUT`: one row, `MANUAL` |
| T15 | Suggestion route gone | API | `POST` gives 404 |
| T16 | `suggestion` gone | API | Key absent from `GET /api/nutrition/targets` |
| T17 | No-target day | API | `target` null, `calories` null, totals correct, 200 |
| T18 | Editor starts blank | Browser | Calories, protein and fat inputs are empty with no target |
| T19 | No progress bar | Browser | `role="progressbar"` count 0 with no target |
| T20 | Required fields | Browser | Without sex or activity: visible error, focus on the first invalid field, **no `PUT` sent** |
| T21 | Units first | Browser | Height and weight fields absent until units are chosen |
| T22 | Refusal focus | Browser, 3 engines | Heading is `document.activeElement`. Log out present. URL doesn't contain the date |
| T23 | Onboarding logout | Browser | Log out, then `/login` shows and the session is gone |
| T24 | Wording | Unit | Source search finds no "minimum safe floor", "Moderate deficit" or "Small surplus" |
| T25 | Legacy label | Browser | A `SUGGESTED` row shows "Set automatically earlier", never "Set by you" |
| T26 | Under Decision 19's removal | API | A backdated entry leaves the first target's `effectiveFrom` at today, and that day's `target` null |
| T27 | Under Decision 20 | API | `DELETE` leaves count 0, entries unchanged, 401 anonymously, **and user B's rows untouched** |
| T28 | Under Decision 26's option A | Browser | With protein 0 and fat 0: no bar and no "over" for any macro after eating, **including carbs,** and history shows no "Protein on target" |
| T29 | Historical rows preserved | API | Seed rows on three dates, including a legacy `SUGGESTED` one. After reads, a profile edit and a `PUT` today: rows for earlier dates are unchanged in every column, and each past day still reports its own target |
| T30 | Blank is never 0 | Browser, API | Blank protein or fat: error shown, no `PUT` sent. A `PUT` omitting them: 400, no row |
| T31 | Under Decision 26's option A | Browser | Protein 150, fat 60: all three macros compare normally, so the rule doesn't hide real targets. **Protein 150, fat 0: protein compares, and carbs don't** |
| T32 | Under Decision 30 | Browser | With a legacy `SUGGESTED` row, calories, protein and fat inputs start blank, and the Nutrition page labels it |

## 13. Negative controls

**Each must fail on the named assertion. A crash, 429, 500 or TypeError doesn't count.** Rebuild before running, and restore byte for byte.

| ID | Change | Must fail on |
|---|---|---|
| NC1 | Threshold back to 13 | T4: `status === 422` |
| NC2 | Restore 365.25 | T1: 2008-11-05 at 2026-11-05 00:00 UTC is `eligible` |
| NC3 | Use local date from `timezone` | T3: the expected status |
| NC4 | Restore seeding in `getTargets` | T8: count 0 |
| NC5 | Restore the `getTargets` call in `setManualTarget`, with seeding | T10: no `SUGGESTED` row |
| NC6 | Restore override seeding | T12: count 0 |
| NC7 | Restore `syncSuggestedTarget` | T11 with the **`SUGGESTED`** row. A `MANUAL` row can't catch it, as `targets.ts:116` returns early |
| NC8 | Restore the suggestion route | T15: 404 |
| NC9 | Restore `suggestion` in `GET` | T16: key absent |
| NC10 | Editor prefills again | T18: calories input empty |
| NC11 | Restore a sex default | T20: error visible and no `PUT` sent |
| NC12 | Reveal the number in refusal copy | T6: body contains no "18" |
| NC13 | `MacroBar` always renders a bar | T19: `progressbar` count 0 |
| NC14 | Write the profile before checking | T4: `profile.count` 0 |
| NC15 | Keep override in `profileSchema` | T13: column unchanged |
| NC16 | Log the refused body | T7: date absent |
| NC17 | Label legacy rows "Set by you" | T25 |

**Under the decisions, add:**

| ID | Under | Change | Must fail on |
|---|---|---|---|
| NC18 | Decision 19 | Restore backfill | T26: `effectiveFrom` stays today |
| NC19 | Decision 20 | `DELETE` only today's row | T27: count 0, with an older row seeded first |
| NC20 | Decision 20 | Drop `userId` from the `DELETE` | T27: user B's rows untouched |
| NC21 | Decision 26, option A | Compare carbs when protein or fat is 0 | T28 and T31: no carbs bar |
| NC22 | Decision 26, option A | Hide every macro when any is 0 | T31: bars present |
| NC23 | Always | Treat blank as 0 in the editor | T30: no `PUT` sent |
| NC24 | Always | Have a profile edit touch older rows | T29: earlier rows unchanged |
| NC25 | Decision 30 | Prefill the editor from a legacy row | T32: inputs empty |

## 14. Acceptance criteria

All objectively testable:

1. Every row of section 6's date table passes.
2. `PUT /api/profile` with a declared under-minimum date returns 422 and writes nothing. Described as declared age, never verification.
3. No code path other than `PUT /api/nutrition/targets` writes `NutritionTarget`, and `DELETE` only under Decision 20, by test and by searching for `nutritionTarget.` writes.
4. `suggestCalories`, `suggestMacros` and `MIN_INTAKE_KCAL` no longer exist.
5. No screen shows a suggested target, deficit or "Suggested" label, and the search in T24 is empty. Under option B, the estimate meets section 8 and has its own tests and controls.
6. With no target, nutrition, history and targets screens return 200, with correct totals and no progress bar.
7. New profiles can't be submitted without chosen units, and without sex, activity and goal as Decisions 25 and 21 determine.
8. Onboarding offers Log out, and a refused person can use it.
9. Every new test passes, with new browser tests in 3 engines. Every section 13 control fails on its named assertion.
10. `npm run lint`, `npm test` and `npm run build` pass. **So does each API suite and all six E2E scripts run by name,** as `test:api` and `test:e2e` cover only some. On designated test databases, with stubs only.
11. `prisma/`, `package.json` and the lockfile are unchanged.
12. The criteria of Decisions 9, 19, 20, 26 and 30 pass according to the decisions taken: T26 to T28, T31 and T32, and their controls.
13. Each changed existing test states why it changed, and none is weakened, including `e2e-hardening.cjs:675-683`.
14. Docs named in Annex E that describe removed behaviour are updated, or the owner has deferred them in writing.

## 15. Rollback strategy

Code only: revert the merge. **No data migration occurs and no rows are rewritten,** so nothing needs restoring.

- After a revert, seeding returns, so accounts with no target would get one on the next read.
- Rows created by `PUT` during this milestone remain valid.
- **Under Decision 20:** deleted target rows can't be restored by a revert. No real users exist at this stage.

## 16. Open decisions

All are the owner's. **None is decided here.** The plan's earlier D-numbers are retired: Annex F maps them.

**Blocking this milestone:**

| Decision | Question | Recommendation | Blocks |
|---|---|---|---|
| 1 | Minimum age | 18, subject to legal review | Age rule and sign-up text |
| 15 | UTC or local date | UTC | Age rule |
| 9 | Calorie default: option A, B or C | A, reopened only once a named reviewer has seen it. The agent agrees on A | Estimate, and section 8 |
| 19 | Remove date backfill | Remove | Backfill and its tests |
| 20 | How to stop using a target | Delete rows, with confirmation | That action |
| 21 | Require a chosen goal | Yes, if Phase 4.1 keeps its goal card. Otherwise goal has no use after this milestone | Goal control |
| 22 | State 18+ openly | Yes, in sign-up and terms. The refusal stays neutral | Sign-up line |
| 25 | Under option A, nothing reads sex, activity, height, current weight, experience or workout days. Keep requiring them? | Keep for this milestone as a stopgap, with honest text, as the columns are non-null and a silent default is the defect. **The agent adds: by the beta, each required field needs a named reader or should stop being required, which may need a migration.** Legal to advise | Form requirements, hint text |
| 26 | Calories-only targets, and zero versus unspecified macros | Nullable columns as their own migration before any real user (needs approval), with option C until then. Option A if a migration is refused | Editor, `MacroBar`, history, tests T28 and T31 |
| 27 | Who removes a refused person's account. The register requires removal, and no milestone does it | Assign it to 4.0.2's scope, or amend the register | Authorization, per the agent |
| 28 | An under-18 date on a profile edit: refuse the edit and keep access, or more. The register says to decide this (`FEATURE_DECISIONS.md:459`) | Refuse and keep access, for development data only | Edit behaviour |
| 29 | How an adult who mistyped a date recovers, as refusal offers only Log out | Point to a support contact once Decision 16 names one, with no "try again" wording | Refusal copy |
| 30 | Legacy `SUGGESTED` rows: editor starts blank, and the Nutrition page labels them | Yes to both | Editor, Nutrition page, T32 |
| 31 | What the editor says below 800 kcal, which today likely shows a raw limit. Any message surfaces 800 as a limit | Fixed text calling it a data range and never safe. Wording to the reviewer | Editor error |

**Not blocking this milestone, but blocking the beta:**

| Decision | Question | Note |
|---|---|---|
| 7 | Qualified safety reviewer | Wording, help resource. **Design risk register accepts "a recorded gap", and the register requires review. Choose one.** The agent's position: no reviewer means no suggested numbers and no threshold warnings |
| 6 | Legal reviewer | 18+, 29 February, data categories |
| 23 | Manual target and underweight goal warnings | Needs a number from the reviewer, or an accepted gap with the register amended. **Has no milestone yet.** The agent recommends a named 4.0.6 go/no-go item, added before 4.0.1 is authorized |
| 24 | Over-target colour | Neutral recommended. Red today at `macro-bar.tsx:16,22,24`, `nutrition/page.tsx:18,50,58`, `history/page.tsx:73`. **Has no milestone yet.** It needs no threshold, so it could join this one |

## 17. Implementation authorization status

| Part | Status |
|---|---|
| Technical design | Ready for independent review |
| Age rule | BLOCKED: Decisions 1, 15 |
| No automatic targets, removals, no-target screens, logout, errors | Technically ready, **not authorized** |
| Required goal, sign-up text | BLOCKED: Decisions 21, 22 |
| Sex and activity requirements | BLOCKED: Decision 25 |
| Estimate | BLOCKED: Decision 9 |
| Backfill | BLOCKED: Decision 19 |
| Stop using a target | BLOCKED: Decision 20 |
| Calories-only targets | BLOCKED: Decision 26 |
| Refused accounts, edit behaviour, typo recovery | BLOCKED: Decisions 27, 28, 29 |
| Legacy rows, editor message below 800 | BLOCKED: Decisions 30, 31 |
| Manual target policy | Excluded. Not decided |
| Product Strategy Agent | **MODIFY** on this revision. Annex G. A recommendation, not approval |
| Clinical and legal positions | **None taken.** Interim copy isn't approved wording |

**Implementation may start only when all of these are true:**

1. The owner has decided the fourteen blocking decisions in section 16.
2. The owner has explicitly authorized 4.0.1.
3. The 4.0.0a test-target guard has been merged.
4. This plan has passed independent review.

**A Product Strategy Agent recommendation isn't authorization.**

### Prerequisite: 4.0.0a test-target guard

**A separate change, with its own approval.** It's hardening, so product review can be skipped under `DEVELOPMENT_WORKFLOW.md:58`. **Why first:** `requireTestDatabaseUrl` checks only `DATABASE_URL` (`test-db-guard.cjs:75-85`). The six E2E scripts and `provider-*.test.cjs` read `BASE_URL` and call no guard, by search.

**Scope, DESIGN RECOMMENDATION:** `scripts/lib/test-target-guard.cjs`, with `decideTarget` (loopback only, no allowlist, missing refused, exit 4), `assertServerIsMarkedTest` (checks the db-identity marker), the name rule `(^|_)test(_|$)`, and a meta-test that every write-capable script calls it. It gets its own detailed plan before being built.

## Annex A: Fitness safety review

**Done by the implementing engineer in this session, by reading code and running pure functions. It's not independent, and not a clinical review.** It builds on Review D and the agent's final review, which weren't repeated.

| Area | Finding | Evidence | Treatment | Status |
|---|---|---|---|---|
| **Declared-age eligibility** | Limit is 13, and checked only at profile save, after the account exists. It's declared, so someone can type another date | CONFIRMED DEFECT. How often people would do so is an UNTESTED ASSUMPTION | Shared rule on the server. Never called verification. Account stays, with no owner for removal yet | BLOCKED: Decisions 1, 27, 28 |
| **Birthday boundaries** | `ageFromBirthDate` is right on every row tested. The 365.25 formula is wrong on both sides. A person is 18 from UTC midnight, so they may pass hours early or late by local time | REPRODUCED AT MODULE LEVEL | T1 to T3, NC2, NC3 | BLOCKED: Decision 15. 29 February goes to legal |
| **Automatic targets** | Four write paths: first read, first manual save, profile edit, and backfill | CONFIRMED DEFECT | All removed, with backfill under Decision 19 | Ready, not authorized |
| **Unsafe suggestions** | Range from 260 to 8,860 kcal within schema limits. Deficit at BMI 13.8. A floor above TDEE | REPRODUCED AT MODULE LEVEL | Functions removed. **No floor is corrected, as any correction needs a number** | Decision 9 |
| **Macro calculations** | Collapse to carbs 0 and fat 0. 2.0 g/kg protein, whose rationale assumes a deficit, is applied at any weight. An override of 800 at 80 kg gives carbs 0 | REPRODUCED AT MODULE LEVEL | `suggestMacros` removed. Remaining macro arithmetic only derives carbs from what was typed | Ready, not authorized |
| **Calories-only targets** | Removing suggestions forces invented numbers or a 0. A 0 shows as over target or "on target", and derives an unrequested carb target. The schema can't separate zero from unspecified | CONFIRMED DEFECT for the displays and derived carbs. What people would do is an INFERRED RISK | Section 8 | BLOCKED: Decision 26 |
| **Existing historical targets** | Rows are never rewritten. Legacy suggested rows stay in force, unchosen, possibly with defective values | CONFIRMED DEFECT for the mechanism. Their existence is an UNTESTED ASSUMPTION, no database inspected | Frozen and labelled. Production-empty check in 4.0.3 | **Design accepts this only with an empty production database** |
| **Consent for future suggestions** | None needed in this milestone, as none exist. Without a rule, 4.1's weight log could bring the problem back (Strategy decision 8) | INFERRED RISK | Eight-part rule in section 8 | DESIGN RECOMMENDATION |
| **Manual targets** | 800 kcal accepted with no warning, indefinitely | CONFIRMED DEFECT | **Not fixed here.** A warning needs an unreviewed number | Decision 23, gap stated |
| **Goal weight** | 30 kg accepted at any height. 4.1's goal card would show progress toward it | CONFIRMED DEFECT for acceptance. The card is planned | **Not fixed here** | Decision 23 |
| **Unit mistakes** | Forcing a units choice removes the default error. Someone can still choose wrongly, and 31.8 kg passes | CONFIRMED DEFECT for the default. The rest is an INFERRED RISK | Partly reduced | Stated |
| **Over-target display** | Red, plus the 90 % protein threshold shown as success in `history/page.tsx:53,65,74`. Effect on people is an UNTESTED ASSUMPTION | CONFIRMED DEFECT for the display | Colour: Decision 24. Protein threshold: for the reviewer | Not in this milestone |
| **Test coverage** | No test uses a teenage age. `energy.test.ts` asserts "never suggests below the floor" on a fat-loss case only. A test asserting a behaviour isn't evidence it's safe | CONFIRMED DEFECT | Section 12 | Ready, not authorized |

**Principle check:**

| Principle | After this milestone |
|---|---|
| AI never invents calories or macros | Not affected. No AI in this path |
| Missing nutrition stays null | Food data unaffected. See Decision 26 for targets |
| No claim of more precision than the method supports | Improved: 1 kcal figures and "suggested" are gone under option A |
| No real users before safeguards | Unchanged. **This milestone alone doesn't make the app safe for real users** |

## Annex B: Architecture and data-flow effects

**Target writes, before:**

```
Any read (GET targets, GET day, GET history, 3 pages)
  → getTargets → no rows → suggestCalories + suggestMacros → WRITE SUGGESTED
               → earlier entry → WRITE moved effectiveFrom
PUT /api/profile → syncSuggestedTarget → WRITE SUGGESTED
POST .../suggestion → WRITE SUGGESTED
PUT /api/nutrition/targets → getTargets (may WRITE) → WRITE MANUAL
```

**After:**

```
Any read → getTargets → SELECT only
PUT /api/profile → eligibilityOf → refuse (no write) or write Profile only
PUT /api/nutrition/targets → WRITE MANUAL
DELETE /api/nutrition/targets → DELETE own rows (Decision 20 only)
```

**Effects:**

- `NutritionTarget` gets one writer, so `getTargets` needs no profile, and the race handling at `targets.ts:15-22` is needed only for `upsertToday`.
- The client form still imports `ACTIVITY_LABELS` from `energy.ts`, but no longer calls any formula.
- `profile-form.tsx` no longer shares logic with the server. **The server is the only age authority,** and the form only reports its answer.
- After option A, **nothing reads `sex`, `activityLevel`, `goal`, `heightCm` or `currentWeightKg`,** by searching property access. They're stored and displayed only (Decision 25).
- Nothing about data retention, sharing or external services changes. No new table, role or dependency.
- Phase 4.1 can update `currentWeightKg` with no effect on targets.

## Annex C: Security and privacy requirements

| Requirement | How it's checked |
|---|---|
| Identity comes only from the session, with no id parameter, on any changed route | Existing `route()` pattern, T27 for `DELETE` |
| Mutations keep the existing Origin check | `route()` unchanged |
| The refused date isn't stored, logged or put in a URL | T4, T7, T22 |
| No threshold in refusal text | T6 |
| No medical data asked for or stored | Review of the diff, section 8 rule 5 |
| Describes declared age only | Review of copy |
| Errors show no raw field names or limits on this form | T20 and a field-mapping unit test |
| Other routes unchanged | Diff review |
| Tests stay away from real databases and servers | 4.0.0a guard. **Never fitdb.** Provider stubs only, and no paid calls |
| The refused person still has an email and session | **Known gap, with no owner yet** (Decision 27). No real users until it's closed |

**Not claimed:** legal compliance, or that birth date, weight and food aren't health data. Those are legal questions.

## Annex D: Regression risks

| Risk | Likelihood | Response |
|---|---|---|
| Test rewrite bigger than predicted, as predictions weren't run | Medium | Run the suites first. Report differences |
| E2E flows break on unselected controls | High, expected | One helper. WebKit bypasses sign-up by API but still uses the onboarding form |
| Native radios change how Playwright must click them: visually hidden inputs may not take a plain `click()` | Medium | Click the label in the helper. Keyboard check in T20. **If it grows, split it out,** as it's not needed for the safety objective |
| `e2e-hardening.cjs:675-683` passes for the wrong reason | Certain unless fixed | Named in section 12 and acceptance criterion 13 |
| `MacroBar`'s no-target state breaks an existing layout | Low | Screenshots at 390×844 |
| History averages change after removing backfill | Medium, expected | Decision 19, stated tests |
| Existing user with a saved profile can't save if their stored date is now refused | Expected | Field error. Only development data is affected |
| Removing the estimate reduces perceived value | Unknown, UNTESTED ASSUMPTION | Option B exists. No usage data either way |
| Removing formula helpers under option A means restoring them from Git if a later reviewer approves an estimate | Low | Section 5 |
| Docs still describing suggestions mislead later work | High | Annex E |
| Revert brings seeding back | Certain on revert | Section 15 |
| A late UTC day makes T3 flaky | Low | T3 waits out the last minute. API fixtures use relative dates, so they mustn't fall on 29 February |

## Annex E: Contradictions between documents

**`docs/PHASE_4_0_DESIGN.md` was corrected in this round** for its 4.0.1 scope, decisions and tests. **`PRODUCT_STRATEGY.md`, `FEATURE_DECISIONS.md` and `DEVELOPMENT_WORKFLOW.md` weren't changed:** the design records that the register and strategy need approval first. These remain for the owner:

| # | Where | Says | This plan | Proposed resolution |
|---|---|---|---|---|
| 1 | `FEATURE_DECISIONS.md:458` | A refused person's new account is removed | Account stays, and 4.0.2's scope doesn't remove it | **Decision 27:** assign it, or amend the register |
| 2 | `FEATURE_DECISIONS.md:463`, `PRODUCT_STRATEGY.md:173` | Warn on low manual targets and underweight goals | Excluded, as both need an unreviewed number | **Owner chooses under Decision 23.** It stays a pre-beta requirement unless changed |
| 3 | `FEATURE_DECISIONS.md:463` | Suggested targets are capped and floored, and that's protective | Reproduced defects, and removed | Update the record |
| 4 | `FEATURE_DECISIONS.md:461`, `PRODUCT_STRATEGY.md:171` | Under-18 account: block, notify, offer export, delete | No blocked state, relies on an empty production database | Accept, with the check in 4.0.3 |
| 5 | `PRODUCT_STRATEGY.md:236` | "Someone under 18 can't complete sign-up" | Declared age only | Reword to a declared under-18 date |
| 6 | `PRODUCT_STRATEGY.md:81,99`, `README.md:12,26` | Energy estimates and suggested targets exist | Removed under option A | Update when implemented |
| 7 | Strategy decision 8 | Targets "stay manual unless accepted", and the weight log "feeds calorie suggestions" | Nothing feeds suggestions | Update once Decision 9 is decided |
| 8 | `DEVELOPMENT_WORKFLOW.md:37` | Each recommendation has a record in the register | **Phase 4.0's agent results aren't in `FEATURE_DECISIONS.md`** | Add them, with owner approval |
| 9 | `schema.prisma:97` | "Null = use suggestion" | Column unused | Leave, with `prisma/` frozen. Fix at the next migration |

## Annex F: Corrections made to this plan

**Retired decision numbers:**

| Old | Topic | Now |
|---|---|---|
| D1 | Minimum age | Decision 1 |
| D2 | UTC or local | Decision 15 |
| D3 | Estimate display | Decision 9, now with option C |
| D4 | Date backfill | Decision 19 (new) |
| D5 | Stopping a target | Decision 20 (new) |
| D6 | Require goal | Decision 21 (new) |
| D7 | State 18+ openly | Decision 22 (new) |
| D8 | Manual target policy | Decision 23 (new), adding goal weights |
| D9 | Wording and help | Decision 7 |
| D10 | Over-target colour | Decision 24 (new) |
| | Sex and activity with no use | Decision 25 (new) |
| | Calories-only targets | Decision 26 (new) |
| | Refused accounts, edits, typo recovery, legacy rows, editor message | Decisions 27 to 31 (new, from the agent's findings) |

**Wrong references fixed:**

| Was | Now | Topic |
|---|---|---|
| `targets.ts:61-73` | `:49-61` | Seeding |
| `targets.ts:74-85` | `:66-73` | Backfill |
| `targets.ts:123-132` | `:111-120` | Sync |
| `profile-form.tsx:97-99` | `:98-99`, removal `:95-102` | Second age rule |
| `release-workflow.test.cjs:135,147,153` only | Fuller list in section 12 | Backfill tests |
| `nutrition-api.test.cjs:412,417` only | Fuller list in section 12 | Backfill tests |
| `live-provider-check.cjs` FLOW-2 `:509` | `:509,511` | FLOW-2 |

**Unsupported or wrong claims fixed:**

| Was | Correction |
|---|---|
| Editor prefills the suggestion | The `:13` fallback is rarely reached, as seeding fills `current` first. The real defect is relabelling on save |
| `getTargetFor` unchanged | Its only caller goes, so it's removed |
| `client/api.ts` must change, with tests | `details` already carries this |
| `eligibility.ts` usable on client | No client caller is needed |
| Only `energy.test.ts` needs changes | `nutrition.test.ts` also uses `suggestMacros` |
| Goal radios excluded because helpers click buttons | Helpers are being rewritten anyway. The real reason is scope |
| Sex "used only for this estimate" | True only under option B |
| Over-range estimates "by Review D's run, not rechecked" | Rerun: 8,510 and 8,860 |
| Option B withholds outside 800 to 8,000 | That would be a threshold in disguise, so it goes to the reviewer |
| "Existing rows not deleted" | Conflicted with Decision 20, now stated |

**Tests and controls that couldn't have worked as written:**

| Was | Problem | Now |
|---|---|---|
| Restore `syncSuggestedTarget`, existing target | Sync returns early for `MANUAL`, so a manual fixture passes | T11 uses a `SUGGESTED` row |
| Use local date, host `TZ` test | Changing the host's zone doesn't exercise the client's `timezone` | T3 chooses values that flip |
| Refusal contains no "18" | A date like 2008-11-18 would fail it for the wrong reason | T6 removes the date first |
| Reads write nothing | Keeping backfill would contradict it | Section 8 |

**Gaps added:** units-first fields, the first-save seeding defect, the macro 0 display, unused data, the onboarding claim about training plans, a logged-date test, two-user `DELETE` tests, the consent rule, and the six-script run in acceptance criterion 10.

**Found in the final revalidation, before publishing:**

| Was | Correction |
|---|---|
| Sections 3 and 5 marked as ready the removal of suggestions, backfill and defaults | Those silently assumed Decisions 9, 19, 25 and 21. Now conditional |
| Calories-only described only as a display problem | Adds defects 24 and 25, and the zero versus unspecified table |
| No test that past rows survive, or that blank stays blank | T29, T30, NC23, NC24 |

## Annex G: Product Strategy Agent review of this revision

**The named `product-strategy-agent` ran once on 2026-11-05, on this plan before its findings were added.** It read the source and documents, and ran nothing. **This is a recommendation and authorizes nothing.** Its report is summarized here, not quoted in full. It discloses reading more of the design than it was asked to, to test milestone claims. **It was given the corrections from the final revalidation, but it hasn't reviewed the changes made after its report.**

**Overall: MODIFY.** "Removing automatic targets is right. Fix Decision 26 and the unowned gaps before authorization."

| Topic | Its recommendation | Reason, as it gave it | Treatment here |
|---|---|---|---|
| No automatic estimates (Decision 9) | **A,** withdrawing its earlier on-request position. Reject C | B has no honest withholding rule without a threshold, and its range has no validated width. "Until reviewed" needs a reopening condition | Recommendation updated. **Owner decides** |
| Calories-only (Decision 26) | **B as its own migration, C until it lands.** A only if a migration is refused. Make it a named beta gate | Sharing 4.0.4's migration isn't sound. A compares a derived carb target at protein 150, fat 0 | Recommendation updated, A's rule corrected, T31 extended. **Owner decides, and any migration needs separate approval** |
| Existing targets | Accept for development data only | Conditional on 4.0.3's empty-production check and 4.0.6's reset. Prefill and an unlabelled Nutrition page remain | Decision 30, T32 |
| Backfill (Decision 19) | Remove | It writes on read and contradicts the editor's copy | Same recommendation. **Owner decides** |
| Stopping a target (Decision 20) | Accept deletion as interim | The only no-migration route, and the person chooses it. The confirmation must state the loss | Confirmation reworded. **Owner decides** |
| Eligibility (Decisions 1, 15, 22) | 18 subject to legal review. UTC. State it openly | The client time zone is untrusted, the error is under a day, and age is only declared | Same recommendations. **Owner decides** |
| Refused account | Acceptable only with an owner | 4.0.2's scope doesn't remove it | Decision 27 |
| Low manual targets, underweight goals (Decision 23) | **Acceptable for 4.0.1, not acceptable unowned.** Add a 4.0.6 go/no-go item before authorizing | With no milestone, nothing specific stops a beta with silent 800 kcal. It calls its earlier warn-below-the-floors advice wrong | Proposed in the design. **Not approved** |
| Sex and activity (Decision 25) | Acceptable as a stopgap, wrong as framed | Fails data minimisation at beta, with no end date. Height, weight, experience and days are unread too | Question widened. **Owner decides,** legal to advise |
| Title | "Calorie Safety" overclaims | | Renamed |
| Silently resolved items | Edit behaviour, typo recovery, legacy prefill, the message below 800, unused helpers | | Decisions 28 to 31. Helpers: section 5 |
| Facts | Defect 17 incomplete. "4.0.2 removes refused accounts" unsupported. Design scope conflicted on sex and activity | | All corrected, after checking them against the code and design |

**What it couldn't verify, by its own account:** it ran nothing and re-derived 1,690, 8,510, 8,860 and the macro collapse by hand. Test-breakage predictions, test and script references, UI behaviour and Zod's message text are unchecked. Prisma's behaviour with nulls after a revert is unobserved. No database was inspected, and all claims about user value are assumptions.
