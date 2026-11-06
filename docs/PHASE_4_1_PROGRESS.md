# Phase 4.1: weight log and goal card

**Built on `feature/phase-4.1-progress`, unmerged. Status is in the tracker, section 2f.** It follows `PRODUCT_STRATEGY.md` Phase 4.1 and the two records in `FEATURE_DECISIONS.md`: a body-weight log with a smoothed trend, and one card on the existing dashboard. **Excluded:** other measures, photos, adaptive targets, predicted dates, a new dashboard.

**MIG-04 is a file, applied nowhere.** This code needs it on any database it runs on, because the dashboard reads the new table. So **nothing on a database or in a browser has run,** and that needs the owner's authorization.

## Choices made

| Point | Choice | Why |
|---|---|---|
| Table | `BodyMetric`, with `kind` and one value, `WEIGHT` | The strategy and `ARCHITECTURE.md` plan one table with a `kind`. Only weight is built, as the record says |
| One entry a day | Unique on user, kind and date. Saving a date again replaces it | Daily is what the trend reads. A date is the person's own calendar day, as food entries are |
| `currentWeightKg` | **Separate. The log changes nothing on the profile** | **Open decision 8, built as `PHASE_4_EXECUTION_PLAN.md` recommends, and the owner's to confirm.** `PRODUCT_STRATEGY.md` recommends otherwise, as it was written when that field fed calorie suggestions. Now only the profile form and its serializer read it, so copying would only rewrite something the person stored |
| Smoothing | An exponentially weighted average by calendar days, with a 10-day time constant | Named, tested, and treating a gap as time. **The constant is a judgement** |
| Change | From the trend, over about 28 days, naming the date it starts from. Nothing until the log spans 7 days | Less than that is noise |
| Precision | Whole display units to one decimal, as weights are elsewhere | A trend isn't known more precisely. No percentage and no predicted date |
| Goal | **Selectable on the profile, optional.** Moved out of "details nothing reads", as the card now reads it | Decision 21 asks whether to require one, and that stays the owner's. It isn't required |
| Goal card | Fat loss or muscle gain: trend against goal weight. Strength: records in 30 days. Maintenance: distance from the first logged weight | As the record says. Muscle gain says plainly that weight doesn't show muscle |
| Wording | Plain, with no praise, warning or colour for being above or below a number | Weighing can be distressing, and logging is optional |
| Range | 30 to 300 kg, as the profile's weight | No new limit is invented |

## Limits

- **No safeguard on goals or weights,** beyond that data-entry range. Underweight-goal safeguards stay with R-03 and Decision 23, and **no threshold is invented here.**
- **Merging after 4.0.5 needs two small additions:** `BodyMetric` has to be classified in the data inventory, and the draft notice has to mention the weight log. 4.0.5's tests will fail until that's done, as they're meant to.
- **Maintenance's starting point is the first logged weight,** which may not be when maintenance began.
- **The trend is one number for one person's noisy data.** It says nothing about body composition.
