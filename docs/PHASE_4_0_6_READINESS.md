# Phase 4.0.6: local readiness

**This is what was verified on one Windows machine, against `fitdb_test`, with a local production build. It is not production readiness, and it is not a go/no-go.** Nothing here ran on a deployed server, a real phone, a real email provider or a production database, and no real person has used it.

It was built on `feature/phase-4.0.6-readiness`, from `main` at `5434f90`. **So it doesn't contain 4.0.5 (privacy and consent) or 4.1 (weight and goals),** which are unmerged on their own branches, awaiting review. **Each area below says where it was verified.** Once those merge, the full regression has to run again on the merged code.

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
| Database isolation | Verified locally | `guard` 51, `guard-browser` 21, `live-identity` 9. Every run checked the database's name and marker |
| Performance | Measured, for one person on one machine | Below |

**The regression at `ad015f0`: 34 of 35 suites passed, with `e2e-smoke` failing once, below.** Unit tests 1,618 of 1,618, and type check and build clean. Since then, only `e2e-readiness.cjs` and the sign-up helper's error path changed, and `readiness-e2e` and `e2e-smoke` were rerun on them. Lowest available memory in the regression was 15.6 GB, with one step at a time.

**Deliberate defects:** 18 of 18 at unit level, and 9 of 9 in a real browser against a rebuilt server, each by a failed assertion. Two of the browser ones first failed for the wrong reasons, a wait running out and a build error, and neither was counted. They were corrected and rerun.

## Defects corrected here

| Defect | Fix | Tests |
|---|---|---|
| **A day or meal whose foods report no value for a nutrient showed 0.** This broke "missing nutrition stays null, never 0" | Totals are null when entries exist and none reports the nutrient. An empty day is still 0, as nothing was eaten. Pages show a dash. Remaining calories aren't worked out from an unknown amount. Averages leave such days out, and they aren't called below target | `nutrition.test.ts`, `nutrition-api`, `readiness-e2e` |
| **A lost response could log a set twice (S-07).** Someone in a gym with a bad connection sees an error, taps again, and has two sets | Logging a set takes an idempotency key, with the method already used for food. It needs no migration. Trying again returns the saved set, and the same key with different values is refused | `workout-sets.test.ts`, `workout-sets`, `readiness-e2e`, which saves a set, loses the response, and retries |
| **`GET /api/exercises/{id}/previous` answered 200 null for another person's exercise,** where `/history` answers 404. No data leaked | Both answer 404 | `workout-sets` |

**Limits of the S-07 fix:** if someone changes the values after a lost response, and the first attempt did save, the app says so, and they have to reload to see that set. A deliberate second set gets a new key. A screen lock between sets, and a network drop on a real phone, are still R-13.

## Unexplained failure

**`e2e-smoke` failed once in the full regression at `ad015f0`, with no change to application code since, and that run is not counted as a pass.** It waited 30 seconds for the password field on the emailed link's page, during its second sign-up.

- **It didn't recur.** It then passed 25 of 25 reruns, 10 of them directly after the suite that ran before it, and the page showed its form on 420 of 420 loads with a fake token, with up to 16 at once.
- **The cause is unknown.** Memory wasn't low (lowest 17.5 GB in that step), and the server log shows no error. Nothing shows what the page displayed, so it can't be ruled out that a real person could see this.
- **What it could mean for a person:** if that page were to lose its token, they'd see "This link isn't complete", and need a new link. Nothing suggests that's what happened, and nothing rules it out.
- **The sign-up helper now reports what the page showed,** so another occurrence says more. Tracked as T-25.

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

**`fitdb_test` holds about 5,150 leftover test users from earlier suite runs,** besides the 10 QA accounts, which are intact. They don't affect these results, and they weren't removed, as nothing here authorizes that.

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
