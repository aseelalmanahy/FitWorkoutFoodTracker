# Phase 4.1: weight log and goal card

**Built on `feature/phase-4.1-progress`, unmerged. Status is in the tracker, section 2f.** It follows `PRODUCT_STRATEGY.md` Phase 4.1 and the two records in `FEATURE_DECISIONS.md`: a body-weight log with a smoothed trend, and one card on the existing dashboard. **Excluded:** other measures, photos, adaptive targets, predicted dates, a new dashboard.

**MIG-04 is a file, applied nowhere.** **It must be applied to a database before this code runs there.** Without the table, the dashboard fails for every signed-in person, and **account deletion and export fail for every account,** so someone couldn't delete or download their data. So nothing on a database or in a browser has run, and that needs the owner's authorization. This also orders any future deployment: migration first. `npm run db:deploy` exists, and nothing runs it as part of a deployment.

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
| Latest date | The person's local day plus one, as food entries | A profile's time zone can be behind where they are, for instance when travelling |
| Replacing | The form says so, and names the stored value, before a save replaces an entry | A tab left open overnight, or a date picked by mistake, shouldn't overwrite anything silently |
| Age of the number | The card says "as of" the last entry, and one entry reads "Logged", not "Trend" | Someone who stops logging, perhaps deliberately, shouldn't see an old number as current |
| Restricted accounts | Not offered goals on the restricted page. The routes refuse them | The page says the app isn't available to them |

## Limits

- **No safeguard on goals or weights,** beyond that data-entry range. Underweight-goal safeguards stay with R-03 and Decision 23, and **no threshold is invented here.**
- **Merging after 4.0.5 needs two small additions:** `BodyMetric` has to be classified in the data inventory, and the draft notice has to mention the weight log. 4.0.5's tests will fail until that's done, as they're meant to.
- **Maintenance's starting point is the first logged weight,** which may not be when maintenance began.
- **The trend is one number for one person's noisy data.** It says nothing about body composition.
- **The trend lags, and the page says so.** A steady 0.1 kg a day over the first 28 days reads as about 1.9 kg, against a real 2.8 kg. **Change can rest on two weigh-ins a week apart,** as the minimum is a span, not a count.
- **An old trend stays on the card,** with its date. Whether the comparison should step back after a long gap needs a decision, and no threshold is invented here.
- **The weight page sends the whole log to the chart.** About 365 points a year, and at most about 9,800. Ten years may be slow on a phone, and it isn't windowed yet.
