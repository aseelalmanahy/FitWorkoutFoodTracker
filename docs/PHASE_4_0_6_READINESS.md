# Phase 4.0.6: local readiness

**This is what was verified on one Windows machine, against `fitdb_test`, with a local production build. It is not production readiness, and it is not a go/no-go.** Nothing here ran on a deployed server, a real phone, a real email provider or a production database, and no real person has used it.

It was built on `feature/phase-4.0.6-readiness`, from `main` at `5434f90`. **So it doesn't contain 4.0.5 (privacy and consent) or 4.1 (weight and goals),** which are unmerged on their own branches, awaiting review. **Each area below says where it was verified.** Once those merge, the full regression has to run again on the merged code.

**Since then, this branch is integrated with 4.0.5 and 4.1 on `integration/phase-4`, for development only, and privacy, consent, weight and goals were verified there. Results are in tracker section 2h. It's still not production readiness.**

## Results by area

| Area | Result on this branch | Evidence |
|---|---|---|
| Auth and sessions | Verified locally | `account-tokens` 32, `production-security` 14, `production-security-e2e` |
| Profile eligibility | Verified locally | `eligibility` in three browsers, `profile-minimization` 7, `profile-nulls` 16, `profile-minimization-e2e` |
| Privacy and consent | **Not on this branch.** Verified on `feature/phase-4.0.5-privacy`, on a draft notice | `privacy-consent` 9, `privacy-e2e`, there |
| Deletion and export | Verified locally | `account-data` 26, `account-data-e2e`. A file save on iOS is unverified (T-15) |
| Workouts | Verified locally, **with one unexplained failure** | `workout-sets` 7, `readiness-e2e`, `e2e-smoke`, below |
| Nutrition | Verified locally | `nutrition-api` 78, `nutrition-targets` 8, `e2e-nutrition`, `nutrition-targets-e2e`, `usda-missing-nutrients` 4, `meal`, `label-scan`, `label-pdf`, `readiness-e2e` |
| Weight and goals | **Not on this branch, and never run on a database.** Unit tests only, on `feature/phase-4.1-progress` | Needs MIG-04 applied to `fitdb_test`, which needs its own authorization |
| Error handling | Verified locally | `hardening`, `provider-malformed` 4, `provider-protection` 7. T-18, a real page-render failure, is still unobserved |
| Security headers | Verified locally | `production-security`, `production-security-e2e`, in three browsers. Over HTTP on loopback, so HTTPS behaviour is only what `production-https` 3 shows |
| Production startup | Verified locally | `production-startup` 17, `release-workflow` 8. It says nothing about a real host |
| Database isolation | Verified locally, **except T-14** | `guard` 51, `guard-browser` 21, `live-identity` 9. Every run checked the database's name and marker. **`safety-no-marker` and `db-guard-scoped` weren't run,** as they connect to `fitdb_test_other`, which is off limits |
| Performance | Measured, for one person on one machine | Below |

**The regression at `d363e4c`: 35 of 35 suites passed, one step at a time, with memory never below 15.5 GB.** Unit tests 1,620 of 1,620, with type check and build clean. An earlier run at `ad015f0` had one failure, below. **`safety-no-marker` and `db-guard-scoped` weren't run (T-14).** Four migration suites weren't run either, as they apply to earlier migrations.

**Deliberate defects:** 25 of 25 at unit level, and 16 of 16 in a real browser against a rebuilt server, each by a failed assertion. Several first failed for the wrong reasons, a wait running out, a build error or an out-of-date pattern, and none of those was counted. They were corrected and rerun. One older control no longer applied once the code it broke was replaced, and another now covers that defect.

**Security:** a read-only agent reviewed `5763413`. **Its findings are addressed in `d363e4c`.** A second reviewed the locking at `846c8c7`, and found no way to put a new set on a finished workout. Its findings are addressed in `09f0aa4`, or recorded as K-04. **No agent has re-read `d363e4c` as a whole, or `09f0aa4`.** The most serious was in a test: `readiness-performance`'s cleanup could have removed every person's rows on `fitdb_test` if its setup had failed. It hadn't, and the 10 QA accounts are intact. Independent source review is still to come.

## Defects corrected here

| Defect | Fix | Tests |
|---|---|---|
| **A day or meal whose foods report no value for a nutrient showed 0.** This broke "missing nutrition stays null, never 0" | Totals are null when entries exist and none reports the nutrient, and so is anything worked out from them. An empty day is still 0, as nothing was eaten. Pages show a dash. Averages leave such days out |
| **A day with some foods missing a nutrient was treated as complete.** It could be called "below target", and "kcal left" had no mark | A partial total is a lower bound, so it can show a target was reached, and can't show one was missed. Those days aren't counted in protein consistency. What's left is marked, and history says "incomplete" | `nutrition.test.ts`, `readiness-e2e` | `nutrition.test.ts`, `nutrition-api`, `readiness-e2e` |
| **A lost response could log a set twice (S-07).** Someone in a gym with a bad connection sees an error, taps again, and has two sets | Logging a set takes an idempotency key, with the method already used for food. It needs no migration. Trying again returns the saved set, and the same key with different values is refused. After a lost response, the page re-reads the workout, so it usually finds the saved set without anyone retrying. A second Enter is ignored | `workout-sets.test.ts`, `workout-sets`, `readiness-e2e`, which saves a set, loses the response, and retries |
| **A retry or a second tab could add a set to a finished workout,** changing its records. Nothing in the app offers that on purpose | New sets are refused once it's finished. An honest retry still gets the set it saved | `workout-sets` |
| **`GET /api/exercises/{id}/previous` answered 200 null for another person's exercise,** where `/history` answers 404. No data leaked | Both answer 404 | `workout-sets` |

**Limits of the S-07 fix:** a key lasts until its set is known to be saved. If the answer is lost and the re-read fails too, then someone who ignores the message, does a second set with the same values and taps once the connection is back gets the first set returned. So one row stands for two real sets. A screen lock between sets, and a network drop on a real phone, are still R-13.

**Also limits, not fixed here:** weekly averages count a partly reported day as a whole day. Sets racing with different keys can share a set number, as they could before, and a constraint would need a migration. If the page's client code fails to load, the emailed link's page shows only its heading, with no message.

## Logging a set against finishing a workout

**The gap:** the status check and the insert were separate statements, so a set already past its check could be saved after the workout's completion committed. Finishing could also drop an exercise whose first set was under way, and two finishes could both succeed with different end times.

**The fix, with no schema change:** `logSet` and `finishSession` each hold the workout's row with `FOR UPDATE`, from the status check to the commit. In PostgreSQL's default isolation, a request that was waiting re-reads the row once it gets it, so it sees a finish that committed ahead of it. A retry of a set saved earlier still gets that set, as that check comes before the status check.

**Waiting is bounded.** Each lock wait is limited to 4 seconds, and a request queued behind another can wait for two, then answers 503 with nothing saved. One person can have 8 requests waiting, per server process, as each one holds a shared connection. A transaction that times out, or finds no free connection, also answers 503 rather than a bare 500.

**How it's tested:** the orderings are forced, not hoped for. `workout-sets` holds a row lock of its own and reads `pg_stat_activity`, read-only and for this database, to see a request waiting before sending the next. It then lets go.

| Ordering | Result |
|---|---|
| A set's insert under way, then a finish | The finish waits, and the set is in the workout |
| A finish first, with a set waiting | The set gets 409, and nothing is saved |
| A set first, with a finish waiting | Saved, and the finish counts it |
| A retry of a saved set, waiting behind a finish | Gets the saved set, with one row |
| A retry of a set never saved, waiting behind a finish | 409, and nothing is added |
| Two finishes | One gets 200 and the other 409, with one end time |

**Results at the fix's final code:** `09f0aa4`. Unit tests 1,629 of 1,629, with type check and build clean. `workout-sets` 25 of 25, and `guard`, `readiness-e2e`, `readiness-performance`, `e2e-smoke`, `account-data`, `release-workflow`, `production-security` and `hardening` all pass. **This isn't a full regression,** which belongs to the combined code. Deliberate defects: 23 of 23 by a failed assertion, 12 at unit level and 11 against a rebuilt real server. Removing the locks is caught, as is checking status before a retry's lookup. An earlier version of the unit tests missed five defects, as their stand-in couldn't tell a call inside the transaction from one outside. That was corrected, and those five rerun. One real-server control first named the wrong tests, and was corrected and rerun rather than counted.

**What this doesn't cover:**

- **The limit of 8 is per server process,** so several processes would each allow 8. It's a judgement, and nothing measured it against a real connection pool.
- **It has only run against one local PostgreSQL.** The behaviour relied on is PostgreSQL's documented default, and a database set to another isolation level would need checking.
- **Other changes to a finished workout are still allowed,** K-04.

## Unexplained failure

**`e2e-smoke` failed once in the full regression at `ad015f0`, with no change to application code since, and that run is not counted as a pass.** It waited 30 seconds for the password field on the emailed link's page, during its second sign-up.

- **It didn't recur.** It then passed 25 of 25 reruns, 10 of them directly after the suite that ran before it, and the regression at `d363e4c`, and the page showed its form on 420 of 420 loads with a fake token, with up to 16 at once. Those loads didn't follow the real sequence of a sign-up and an emailed link.
- **The cause is unknown.** Memory wasn't low (lowest 17.5 GB in that step). The server log shows no error, which rules out little, as a failed script or a guard-proxy error wouldn't reach it. Nothing shows what the page displayed. Three states fit: its client code never finished loading, the response wasn't the page, or the token was lost. A read-only review of the code found no mechanism for losing the token, and that doesn't prove it can't happen. So it can't be ruled out that a real person could see this.
- **What it could mean for a person:** if that page were to lose its token, they'd see "This link isn't complete", and need a new link. Nothing suggests that's what happened, and nothing rules it out.
- **The sign-up helper now reports the response status, what the page showed, and any script errors or failed requests,** so another occurrence can tell those apart. Tracked as T-25.

## Performance

Measured by `readiness-performance`, on a local production build, for one person with 365 days of food (2,190 entries) and 150 workouts (3,000 sets). Five requests each.

| Request | Median | Slowest | Size |
|---|---|---|---|
| `/dashboard` | 48 ms | 90 ms | 28 KB |
| `/progress` | 41 ms | 44 ms | 22 KB |
| `/workouts` | 10 ms | 29 ms | 28 KB |
| `/workouts/history` | 17 ms | 18 ms | 69 KB |
| `/nutrition` | 8 ms | 11 ms | 33 KB |
| `/nutrition/history` | 9 ms | 11 ms | 27 KB |
| `GET /api/nutrition/history`, 84 days | 5 ms | 6 ms | 19 KB |
| `POST /api/account/export` | 118 ms | 127 ms | 2.7 MB |

The 10 QA accounts were read in the fixture run at `7ee5498`, where the slowest page was under 100 ms (`QA_FIXTURES.md`, on that unmerged branch).

**These times include no real network, TLS, a phone's rendering, a remote database or a second person.** They show that nothing is unreasonably slow in the code with a year of data, and nothing about a deployed server. No limit is set, as none has been decided.

## What can't be verified here

| Needs | What's outstanding | Tracked |
|---|---|---|
| A real iPhone and Android phone | Core flows, including an emailed link from a mail app, date entry, a screen lock between sets, a network drop while saving, session persistence, a file save on iOS. **Browser emulation doesn't substitute** | R-13, T-15 |
| A deployed server | HTTPS, proxy, one instance, memory on Linux, monitoring, CSP in practice | R-15, S-18 |
| A real email provider | Delivery of sign-up and reset links, and what a provider's link scanning does to them | M-12's limits, Decision 3 |
| A production database | Migrations, backup and a tested restore, that it starts empty | R-07, R-08 |
| Reviewers | Legal review of the notice, clinical review of safeguards, including 800 kcal still being accepted | R-02, R-03, R-12, H-01 on the 4.0.5 branch |
| The owner's authorization | MIG-04 on `fitdb_test`, merging 4.0.5, 4.1 and this branch, a real week of use, the signed checklist, the database reset | J-02, K-01 |

**`fitdb_test` holds about 5,300 leftover test users from suite runs, and each regression adds about 90,** besides the 10 QA accounts, which are intact. They don't affect these results, and they weren't removed, as nothing here authorizes that.

## Phase 4.2 requirements

**Phase 4.2 has not started, and nothing here starts it. It isn't complete, and there are no real users.** It needs its own separate approval, after all of:

1. Legal review.
2. Clinical review.
3. Production deployment approval.
4. Email delivery verification.
5. Database migration approval.
6. Backup restoration verification.
7. Security blockers resolved.
8. Real-device acceptance testing.

**A "go" from 4.0.6 wouldn't begin it either.** Its scope stays as `PRODUCT_STRATEGY.md` has it: 5 to 10 adults, a few weeks, on real phones, then a conversation with each. Its go/no-go also needs the results above to be repeated on the merged code.
