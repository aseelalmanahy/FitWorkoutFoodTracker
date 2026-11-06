# Phase 4.0 Design: Account Safety and Pre-Beta Safeguards

**Status: proposal for independent review. Nothing here is approved for implementation.**

**Boundaries of this document:**

- **Planning only.** Publishing it for review approves nothing.
- **No implementation scope is approved.**
- **No medical threshold is approved.**
- **No database migration is approved.**
- **No production deployment is approved.**
- **No external service is approved.**
- **Phase 4.0 remains unfinished.** Corrections for later milestones are still outstanding.

No paid service, dependency or infrastructure is authorized either. A recommendation from the Product Strategy Agent or any reviewer isn't authorization. Base commit: `3f0fddc`.

**Corrected on 2026-11-05 for milestone 4.0.1 only:** sections 11 to 16 and the appendices, where they conflicted with `docs/PHASE_4_0_1_IMPLEMENTATION_PLAN.md`. That plan is the detailed source for 4.0.1. **Corrections for later milestones are listed at the end of section 12's table and aren't applied yet.** Specialist summaries in section 3 and the agent's table in section 4 are unchanged, as records of what they said.

**How much of this has been verified:** see the evidence classification below. No application, route, test suite or database was run for this review. **The expected deletion failure is inferred, and no one has observed it.**

## Evidence classification

Every significant claim belongs to one of these five levels. **Nothing inferred is presented as a reproduced failure.**

| Label | Means |
|---|---|
| **CONFIRMED DEFECT** | Visible in the source at `3f0fddc` by reading it. The defect follows directly from the code, but the running app wasn't exercised |
| **REPRODUCED AT MODULE LEVEL** | The behaviour was produced by calling the project's real pure function with stated inputs, without the app, routes or a database. It doesn't show what a user would reach through the UI |
| **INFERRED RISK** | Reasoned from the code or from how a technology behaves, and not observed |
| **UNTESTED ASSUMPTION** | Believed, and not checked. This includes everything about user behaviour, vendors and prices |
| **DESIGN RECOMMENDATION** | A proposal, for approval. It isn't a fact about the system |

### Reproduced at module level

Run with `npx tsx` against `src/lib/energy.ts`.

| Inputs | Result | Why it matters |
|---|---|---|
| Female, 35 kg, 150 cm, 40 y, sedentary, maintenance | Target 1,110 kcal, `floorApplied` false | Below the 1,200 floor, as floors apply only to deficits |
| Male, 40 kg, 155 cm, 50 y, sedentary, muscle gain | Target 1,480 kcal, `floorApplied` false | Below the 1,500 floor |
| Female, 30 kg, 100 cm, 110 y, sedentary, maintenance (schema limits) | Target 260 kcal | No lower limit on non-deficit suggestions |
| Female, 35 kg, 150 cm, 40 y, sedentary, fat loss | Target 1,200, TDEE 1,112, text says "Moderate deficit" | The floor raises intake above expenditure, and the text is wrong |
| Female, 40 kg, 170 cm, 30 y, active, fat loss | Target 1,690, TDEE 1,986 | A deficit at a BMI of 13.8, calculated by hand from those inputs |
| `suggestMacros` at 800 kcal, 100 kg, fat loss | Protein 200 g, carbs 0, fat 0 | Contradicts the documented fat floor |
| `ageFromBirthDate`, born 2008-02-28, at 2026-02-27 12:00 UTC | 17 | The real function is correct here |

**Age arithmetic, with a limit on this evidence:** `validation.ts` currently uses 13, so the 18 rule doesn't exist to run. The script copied that file's 365.25-day formula with 18 as the threshold.

| Born | At | 365.25 formula at 18 | True calendar age |
|---|---|---|---|
| 2008-02-28 | 2026-02-27 12:00 UTC | **Passes** | 17 |
| 2010-06-15 | 2028-06-14 12:00 UTC | **Passes** | 17 |
| 2008-11-05 | 2026-11-05 00:00 UTC | **Refused** | 18 |
| 2008-11-06 | 2026-11-06 11:59 UTC | **Refused** | 18 |

These results show what a threshold-only change would do, not an observed production failure. The same formula is in use at 13 today, so its 13 boundary should be imprecise in the same way (INFERRED RISK, not run at 13).

### Confirmed defects (read in source, not exercised)

- **Eligibility:** age limit of 13 (`validation.ts:26-29`), checked only at profile save, after the account and session exist (`register/route.ts:23-24`). A second limit in `profile-form.tsx:99`.
- **Targets:** `getTargets` writes a target from the suggestion on first read (`targets.ts:49-61`). A suggested target follows profile changes (`targets.ts:111-120`). `suggestCalories` receives no goal weight. `calorieTargetOverride` accepts 800 (`validation.ts:40`). Manual targets accept 800 with no warning (`validation.ts:183`).
- **Wording and defaults:** "minimum safe floor" (`energy.ts:105`). Sex and activity default silently (`profile-form.tsx:55,57`).
- **Accounts:** no reset, change-password, verification, deletion, export or email change. Register returns 409 for an existing email (`register/route.ts:14`). Logout ends one session only (`auth.ts:81-86`).
- **Access:** registration is public, and no invite control exists. The onboarding page offers no logout, and `(app)/layout.tsx` sends profile-less accounts there.
- **Configuration:** `APP_ORIGIN` is optional, with fallback to Host (`api.ts:27-35,46`). No deployment files, Node pin or general health route exist. HSTS and CSP are absent (`next.config.ts`).
- **Tests and UX:** the test guard checks `DATABASE_URL` only, and `e2e-smoke.cjs` doesn't call it. Validation field names reach users (`client/api.ts:42`). Auth requests have no client deadline.

### Inferred risks (not observed)

- **Deletion failing for a user with a logged custom exercise.** The `RESTRICT` constraints and their creation order are confirmed in `init/migration.sql:200,209,218,227`, and `user.delete` isn't called anywhere in `src/`. **The failure itself comes from reasoning about PostgreSQL's trigger order, and nobody has run it.** It might not fail. Five reviews and the agent inferred this separately from the same constraints, which isn't independent evidence of the outcome.
- **Reset-link poisoning.** No reset exists yet. The Host fallback is confirmed, and the attack would only arise if links were built from it.
- **Pre-registration hijack and session survival,** which would apply to features not yet built.
- **Sensitive data in mail-provider errors.** Non-Prisma errors are logged whole (`safe-log.ts:13`), which is confirmed. The contents of a provider's errors aren't known.
- **Light-theme contrast below AA.** Calculated by Review E from tokens, not measured in a browser, and not rechecked.
- **Existing test breakage counts,** including the 14 script files. These are predictions from reading code.
- **Hosting behaviour:** serverless breaking in-memory limits, memory on Linux, and production install omitting dev tools.

### Untested assumptions

- Everything about what users want, how many would try a false birth date, or sign-up friction.
- Vendor capabilities and all prices, which are from memory.
- That production starts empty. This is a proposed rule, and several recommendations depend on it.
- The WHO 18.5 figure, and the original study's age range, which are recalled and unverified.
- Mobile behaviour: the mail-app browser, iOS download and date entry. No real phone has been used.
- That no under-18 account exists in any personal database. None was inspected.

### Design recommendations

Everything in sections 7 to 12 and 16, the proposed schema, and the resolutions in Appendix A.

### Not approved by this document

**This review approves none of the following.** Each remains open, and needs your explicit decision:

| Item | Status |
|---|---|
| Email provider | Candidates named only. Not selected or configured |
| Hosting provider and managed database | Recommendation only. Not selected or configured |
| Database migrations | Proposed schema only. None authorized or written |
| One-page registration redesign | Proposed in this reconciliation, by no specialist. Needs separate scrutiny |
| Medical thresholds | None set. Floors in the code are uncited, and any underweight threshold goes to a qualified reviewer |
| Manual calorie-target policy | Warn or block is undecided, pending professional review |
| Age verification claims | Declared age only. **Nothing here verifies age, and it mustn't be described that way** |
| Legal compliance | **Not concluded for anything.** Legal questions remain open |
| Paid services | None approved, including legal and clinical review |
| Deployment | Not authorized. Production blockers still stand |

## 1. Executive summary

**Phase 4.0 is the right goal, but too big as one phase, and the current roadmap has it in the wrong order and misses some of the biggest risks.**

The findings that most change the plan:

1. **Suggested calorie targets are less protected than the docs say.** They're applied automatically (CONFIRMED DEFECT). A fat-loss deficit is suggested regardless of current weight, even at a BMI of 13.8, and floors apply only to deficits, so other goals can go below them, down to 260 kcal at the schema limits (REPRODUCED AT MODULE LEVEL).
2. **Account deletion may fail for anyone who logged a custom exercise** (INFERRED RISK). Reviews A, B, C, F and G and the agent each reasoned this from the constraints, contradicting "straightforward to add" in the readiness report. **It hasn't been run, and it needs a test.**
3. **Nothing limits the beta to invited people.** Registration is public (CONFIRMED DEFECT).
4. **The current age arithmetic is wrong at the boundary.** Changing the number to 18 would admit a 17-year-old and refuse some 18-year-olds (REPRODUCED AT MODULE LEVEL, using a copy of the formula).
5. **Reset links could be poisoned** (INFERRED RISK), as `APP_ORIGIN` is optional and falls back to the Host header (CONFIRMED DEFECT). This must be fixed before any reset email exists.
6. **No deployment configuration exists at all,** and the test guard wouldn't stop write-capable test scripts hitting a production `BASE_URL` (CONFIRMED DEFECT).

**Recommendation:** seven milestones plus a small test-safety guard, in a changed order. Start with a decisions step and the guard, then build the safety rules, which need no service or migration. Infrastructure moves before email and notices, because they depend on it. **Recommended first implementation milestone: 4.0.1, adults-only eligibility and calorie safeguards, once approved.**

## 2. Existing architecture

Verified at `3f0fddc`.

| Area | What exists | Where |
|---|---|---|
| Passwords | Argon2id, m=19 MiB, t=2, p=1 | `auth.ts:13` |
| Sessions | 32 random bytes, stored as SHA-256, fixed 30 days, expired rows removed only when presented | `auth.ts:67-79,103-106` |
| Device cookie | HMAC keyed on the password hash, so a new password invalidates it | `auth.ts:33-41` |
| Registration | Public. Creates the user and a session at once. Returns 409 for an existing email | `register/route.ts:14,23-24` |
| Logout | Deletes the current session only | `auth.ts:81-86` |
| Origin check | Required on mutations. `APP_ORIGIN` optional, with fallback to Host | `api.ts:27-35,41-53` |
| Age | Profile only, from 13, using 365.25-day division | `validation.ts:26-29` |
| Calendar age | `ageFromBirthDate`, correct calendar logic on the UTC date | `energy.ts:39-44` |
| Target seeding | `getTargets` writes a target from the suggestion on first read | `targets.ts:49-61` |
| Throttles | In memory, per process | `login-throttle.ts`, `auth.ts` |
| Cascades | Most from `User`, with `ON DELETE RESTRICT` on `TemplateExercise` and `SessionExercise` to `Exercise` | `init/migration.sql:209,227` |

**Missing, confirmed by search:** password reset or change, email verification, email change, account deletion, export, privacy or terms pages, an invite control, any deployment file, a general health route, and pinned Node.

## 3. Seven specialist assessments

**All seven ran as independent read-only subagents,** using the `Plan` agent type with separate briefs. None saw another's report. They were interrupted by a usage limit and resumed from their own transcripts, which didn't affect content. None created files, and no permanent specialist agents were created. Each is summarized here, not quoted in full.

### Review A: Product strategy

Phase 4.0 is too large for 5 to 10 invited people, and omits the control that makes the beta invited.

- **Essential:** invite allowlist, age rule, medical limits copy, target warnings, tested deletion, privacy notice, HTTPS, a restored backup, real-phone flows.
- **Would defer:** emailed recovery, verification, self-service export and a monitoring vendor, relying on an audited reset script and operator export. This removes the only migration.
- **Would cut:** an under-18 remediation flow, as a new production database has no such accounts.
- **Found missing:** support contact, breach note, end-of-beta data plan, and the owner's access to data.
- **Order:** infrastructure last is backwards.

### Review B: Software architecture

- **Deletion:** constraints verified as immediate `RESTRICT`, with the `Exercise` foreign key created first, so the cascade should hit `RESTRICT` before its child rows go. The fix needs no migration: one transaction deleting sessions, then templates, then the user. Changing those keys to cascade is rejected, as deleting an exercise would then erase history.
- **Tokens:** one `AccountToken` table, keyed by SHA-256, single-use by `deleteMany` and `count === 1`.
- **Reset:** in one transaction, consume the token, set the password and delete all sessions. No auto-login. The device cookie needs no extra work.
- **Verification:** wouldn't block login; a banner and a nullable `emailVerifiedAt`.
- **Other:** coded failures for mail, in-memory throttle keys hold plaintext email, and export as buffered versioned JSON with a row cap.

### Review C: Security and privacy

Blockers, most serious first: links only from a mandatory `APP_ORIGIN`; atomic reset with all sessions revoked; no pre-verification session or surviving attacker password; durable per-recipient and global email caps; deletion proven against the `RESTRICT` keys; re-authentication for deletion and export, and sign-out everywhere; verification by a page plus POST that never signs anyone in; replacing the registration 409; the adults-only gate; a privacy notice, retention schedule and backup policy.

Also: the register email check returns before Argon2, a timing signal. A missing proxy configuration puts everyone in one `register:untrusted` bucket, which anyone can exhaust. Reviewed routes scope by owner, but two-user tests exist mainly for Phase 3 routes.

### Review D: Fitness and nutrition safety

See section 6. Separates defects fixable now, requirements with stated evidence, and what needs a professional. Found the age boundary errors, target paths below the floors, a deficit at any weight, and misleading wording.

### Review E: UI/UX and accessibility

From reading code only. Blockers:

- No recovery path.
- Raw validation text reaches users, such as "birthDate: Age must be...".
- The onboarding estimate reveals the age limit.
- Auth requests have no client deadline.
- `confirm()` can't carry a password or explanation.

Also serious:

- Light-theme error text at 4.13:1 and 4.48:1, below AA (calculated from tokens).
- Success messages are silent to screen readers.
- Weak input boundaries.
- Logout looks like a destructive action.

`Sheet`, `Field`, `ErrorText` and `isUncertainFailure` are reusable. Refusal text shouldn't reveal the threshold or suggest retrying. Warnings should show no floor number or BMI value.

### Review F: QA and regression

Predicted breakage, from reading code:

- An 18+ rule on birth date only breaks **0** existing tests, as fixtures use 1990 or 1994. No test uses a teenage age, so a wrong rule would pass everything today.
- A gate that removes the session at register breaks **all 14 script files that register users.** No script calls login.
- A hard calorie floor breaks 2 sites that save 800 kcal.

Mechanisms: a schema-walking coverage check for deletion and export, a local mail stub, expiry tested by backdating rows, never a clock override in production code. Negative controls in section 13.

### Review G: DevOps and production

No deployment configuration exists, and several misconfigurations would fail silently. Findings beyond the brief:

- The test guard checks `DATABASE_URL` only, so `nutrition-api.test.cjs` could write to a production `BASE_URL`, and some scripts have no guard.
- `NODE_ENV=staging` disables Secure cookies and exposes db-identity.
- A production install omits `prisma` and `tsx`, which migrations and the seed need.
- Serverless and scale-to-zero hosting breaks the in-memory limits.

Recommends one x64 Linux VPS with Caddy, one app container and Postgres, off-site backups and a startup preflight.

## 4. Product Strategy Agent recommendation

**The actual `product-strategy-agent` ran.** Evidence: in a separate fresh `claude -p` session, the startup list included it, the call shows `subagent_type: product-strategy-agent`, it made 82 tool calls, and its hook returned 81 allows and 1 block. That session also confirmed `CLAUDE.md` is loaded.

**Invocation record:** calling it from the planning session failed with "not found", the documented limitation for a session that predates the file. A first fresh run was cut off by a usage limit with no result, and isn't counted. The second completed.

**Overall: MODIFY.** Right goal, too large as one phase.

| Item | Decision | Priority | The agent's reason |
|---|---|---|---|
| Adults-only eligibility | **MODIFY** | P0 | 18 is right, but the criterion overpromises, and remediation is more than a beta needs |
| Calorie and weight-goal safeguards | **MODIFY** | P0 | The roadmap misses the riskier path: a deficit applied automatically to someone already underweight |
| Password recovery | **BUILD** | P0 | A forgotten password means losing everything. Add change-password |
| Email verification | **MERGE** | P0 | With recovery and closed sign-up, as link-first "email-proven sign-up" |
| Account deletion | **BUILD** | P0 | Must leave with data removed. Plain version probably fails, and profile-less accounts can't reach it |
| Personal-data export | **MODIFY** | P1 | One JSON download. Doesn't test trainer demand as the docs claim |
| Privacy notices and terms | **MODIFY** | P0 | Needs real facts first, and a stored record of acceptance, which adds a migration |
| Basic production infrastructure | **MODIFY** | P0 | Underspecified. Node pin and OS test move earlier. No monitoring vendor |
| Real-device testing | **MODIFY** | P1 | "Core flows" undefined, and it can't run until the deployed HTTPS build exists |

**Where it disagreed with earlier project records:** deletion isn't known to be straightforward; targets aren't "accepted" but applied; an under-18 person "can't complete sign-up" can't be promised with self-declared age; decisions 4, 5 and 11 also block this phase; a working name and domain are needed now.

**If only one thing could be built first:** the calorie and age safeguards. The first test to write is the deletion test.

## 5. Security threat model

E = existing weakness. N = risk the new features introduce.

| Threat | Type | Current state | Required control |
|---|---|---|---|
| Reset-link poisoning | N | `APP_ORIGIN` optional, Host fallback | Links only from a mandatory `APP_ORIGIN`. Refuse to start or send otherwise |
| Pre-registration hijack | E+N | Account and session before proof of the address | No account until the email link is used |
| Sessions surviving reset | N | Nothing revokes them | One transaction: token, password, all sessions. Notify by email |
| Token theft | N | No tokens yet | 256-bit, stored hashed, short expiry, `no-referrer`, `no-store`, click tracking off, no query strings in logs, no auto-login |
| Token replay | N | None | Atomic single use, bound to purpose, older tokens revoked |
| Mail scanners and CSRF | N | Origin check covers mutations only | GET renders a page, and a POST acts. Verification never signs anyone in |
| Enumeration | E | Register 409, timing gap | Same response and work. Login is already uniform |
| Email bombing | E+N | Limits in memory, and a shared bucket with no proxy | Allowlist, cooldown from the token row (durable), global cap, provider cap |
| Incomplete deletion | N | Inferred `RESTRICT` failure, not observed | Ordered transaction, plus a test seeding every model |
| Deleting or exporting another's data | N | Owner-scoping pattern is sound | Identity from the session only, with no id parameter. Two-user tests |
| Over-export | N | `findUnique` without `select` returns `passwordHash` | Explicit field allowlist |
| Stolen session | E | 30-day fixed session | Password re-entry for deletion and export, and revoke other sessions on password change |
| Password oracle | N | None | Re-entry goes through the existing throttle and Argon2 slots |
| Sensitive logs | E+N | Non-Prisma errors logged whole | Coded failures for mail and tokens, plus a redaction test |
| Cross-user exposure | E, low | Reviewed routes scope by owner. A sample of routes was read | Add two-user tests for workout routes |
| Test scripts hitting production | E | Guard checks `DATABASE_URL` only | Refuse a non-loopback `BASE_URL` |
| Restore undoing deletion | N | No backups yet | Revoke sessions after a restore, and replay a deletion list |

## 6. Fitness and nutrition safety review

**No medical threshold is set by this document.** Numbers already in the code are named as such. Anything recalled from general knowledge is marked and goes to a qualified reviewer.

### Defects, on the code's own logic

The evidence column uses the labels defined above.

| Defect | Evidence |
|---|---|
| **Age arithmetic.** With the threshold at 18, born 2008-02-28 passes at 2026-02-27 12:00 UTC while aged 17, and born 2008-11-05 is refused on the birthday | REPRODUCED AT MODULE LEVEL |
| **Two age rules disagree.** `validation.ts` and `ageFromBirthDate` give different answers near a birthday | REPRODUCED AT MODULE LEVEL |
| **Form repeats its own age limit** | `profile-form.tsx:99` (CONFIRMED DEFECT) |
| **Floors apply only to deficits.** Female, 35 kg, maintenance gives 1,110 kcal. At the schema limits, 260 kcal | REPRODUCED AT MODULE LEVEL |
| **A deficit at any weight.** Female, 40 kg, 170 cm, active, fat loss gives 1,690 against 1,986 TDEE, at BMI 13.8 by arithmetic | REPRODUCED AT MODULE LEVEL |
| **A floor can raise intake above TDEE** while still saying "Moderate deficit": 1,200 against 1,112 | REPRODUCED AT MODULE LEVEL |
| **Macros can collapse.** 800 kcal at 100 kg on fat loss gives protein 200 g, carbs 0, fat 0, contradicting a documented fat floor | REPRODUCED AT MODULE LEVEL |
| **Targets apply without a choice,** and move silently on profile edits | `targets.ts:49-61,111-120` (CONFIRMED DEFECT) |
| **A second low path.** `calorieTargetOverride` accepts 800 through the API, with no UI field | `validation.ts:40`, `targets.ts:54` (CONFIRMED DEFECT) |
| **Manual targets save down to 800 with no warning** | `validation.ts:183` (CONFIRMED DEFECT) |
| **"Minimum safe floor"** claims safety, and the floors are uncited in the code | `energy.ts:36,105` (CONFIRMED DEFECT) |
| **Sex and activity silently default** to MALE and MODERATE, and sex shifts BMR by 166 kcal | `profile-form.tsx:55,57` (CONFIRMED DEFECT) |
| **±10 % wording** sits on TDEE, while its evidence concerns resting metabolic rate. Figures show to 1 kcal, and activity's coarseness isn't shown despite the docs | `profile-form.tsx:218`, `energy.ts:7-9` (CONFIRMED DEFECT) |
| **Activity hint contradicts labels:** the hint excludes training, and the labels include it | `profile-form.tsx:183`, `energy.ts:29-33` (CONFIRMED DEFECT) |

### Requirements with stated evidence

- **Adults only.** The docs describe the formula as an adult estimate, and the code uses it for ages 13 to 17. Recalled and unverified: the original cohort was about 19 to 78, so caveat older adults too.
- **Who it isn't for.** Pregnancy and breastfeeding are recorded as unhandled. A **static notice,** with no checkbox and nothing stored, avoids collecting medical data.
- **An opt-out with no reason given.** "Track without suggested targets" covers pregnancy, illness and eating concerns without disclosure. Partly supported: `nutrition/page.tsx` already handles no target for a date.
- **No streaks,** and neutral colour for going over a target. It's red today.

### Needs a qualified reviewer, or legal review

| Question | Who |
|---|---|
| Whether 1,200 and 1,500 kcal are appropriate floors, and warn or block | Dietitian |
| An underweight threshold, whether to show it, and its limits. Recalled and unverified: WHO 18.5 for adults | Dietitian or clinician |
| Warning wording, help resource, and history and over-target displays | Clinician with eating-disorder experience |
| Evidence for intersex, transgender and non-binary users | Professional |
| Minimum age by market, 29 February, whose "today" counts, and a medical-device question | Legal |

### Disagreement to settle: warn or block

Warnings inform and the person stays in control, as the register already says. **But a warning can read as approval of anything not warned about, and published limits can become goals.** So: show no floor number and no BMI figure.

## 7. Account recovery architecture

Design only.

```
Request → same response always → if an account exists and the cooldown has passed: token, email
Link (GET) → renders a page, consumes nothing
Submit (POST) → hash the new password in an Argon2 slot, then in one transaction:
  delete the token where id, purpose and expiry match, and require count = 1
  update passwordHash
  delete every Session and token for that user
→ no automatic sign-in → notify by email
```

- **Token:** 32 random bytes, stored as SHA-256, reusing the session pattern.
- **Expiry:** 30 to 60 minutes is a suggestion to confirm.
- **Change-password:** requires the current password, keeps a rotated current session and deletes others. It shares this code.
- **Links only from `APP_ORIGIN`,** enforced at startup.
- **Sending** happens outside the request, so timing doesn't reveal accounts. This assumes a long-lived process, like everything else here.
- **Email change:** deferred, handled manually during the beta. Architecture Review B wanted it included, as a typo would otherwise be permanent. The allowlist and link-first sign-up make typos unlikely.

## 8. Email verification architecture

**Recommended: link-first sign-up, with no verified flag.** Enter an email, always see "check your email", follow the link, and only then does an account exist.

**This one design closes several findings:** pre-registration hijack, the registration 409 and timing signal, mistyped addresses, and a refused minor never having an account. Allowlist checks sit at the same point.

**Proposed extension, from this reconciliation and not from any one review:** complete sign-up on one page, with password and the existing `ProfileForm`, and create `User` and `Profile` in one transaction. **There'd then be no profile-less account,** which removes the stuck-at-onboarding gap and the routes reachable without a profile. It needs scrutiny, as it's the largest change to an existing flow.

**The cost is real:** Review F predicts all 14 registering script files break. Mitigation is one shared helper, which signs up through the mail stub. **No test-only bypass in production code.**

**Fallback, if email is delayed:** personal invite links and a scripted reset, as Review A and the agent both allow.

### Proposed schema (not authorized)

```prisma
enum AccountTokenPurpose { SIGNUP  PASSWORD_RESET }

/// `id` is the SHA-256 hash of the emailed token, like Session.
model AccountToken {
  id        String   @id
  purpose   AccountTokenPurpose
  email     String   // normalized
  userId    String?  // null for SIGNUP: no account exists yet
  expiresAt DateTime
  createdAt DateTime @default(now())
  user      User?    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([email, purpose]) // one live token, and createdAt gives a durable cooldown
  @@index([expiresAt])
}

model User {
  // existing fields stay
  termsVersion    String?
  termsAcceptedAt DateTime?
  accountTokens   AccountToken[]
}
```

This adapts Review B's design, which assumed a user always exists. Tokens are purged when issued, as no background job exists.

**If the owner prefers immediate sign-up instead:** add `emailVerifiedAt DateTime?`, fix the 409 separately, and delete refused accounts. Review B's banner design applies then.

## 9. Account deletion and export

### Deletion

- **Route:** session identity only, no id parameter. Password re-entry through the existing throttle.
- **Order, in one transaction with a raised timeout:** lock the user row, delete workout sessions, delete templates, delete the user. Clear both cookies, including `fit_device` on its own path.
- **No grace period.** No migration.
- **Unaffected:** shared food and exercise catalogues.
- **Left behind:** expiring throttle state, which should be cleared for that email. Logs and backups need a written policy.
- **Coverage:** see section 13.
- **UI:** `Sheet`, listing what's lost, linking to export (never required), password field, "Cancel" and "Permanently delete my account". Afterward, a public page says what was removed.

### Export

- **Route:** `POST`, not `GET`, as it carries a password and no state-changing or sensitive GET is wanted (Review C, over Review B's `GET`). `no-store`, rate-limited.
- **Format:** one versioned JSON document with units stated, built with explicit field selection. Buffered, not streamed, as a truncated stream looks like a valid file.
- **Includes:** user email and dates, profile, custom exercises, plans, schedule, sessions and sets, custom foods, food entries and targets, plus exercise names for built-in references.
- **Excludes:** password hash, sessions, tokens and shared catalogues.
- **Size cap:** count first. About 250,000 rows is Review B's judgement, not a measurement.
- **Mobile:** fetch then download, so failure can be reported. Test on an iPhone.

## 10. Privacy requirements

**This document doesn't conclude that anything is legally compliant.** Questions below come from general knowledge, and haven't been checked against current law.

**Facts needed before any notice can be accurate:** operator, country, host, database, email provider, retention periods, who can read production data, and backup window.

| Decision | Recommendation |
|---|---|
| Beta notice | One plain combined notice and terms, if the legal reviewer accepts it |
| Consent | Record version and time of acceptance. Whether explicit consent is needed is a legal question |
| Retention | Tokens, sessions, logs and backups each get a stated period. Review G suggests about 14 days of backups, for legal confirmation |
| Backups | The notice states how long deleted data persists. A manual list re-applies deletions after a restore |
| Third parties | Name each: host, database, email provider (addresses and links), USDA and Open Food Facts (search text and barcodes). Anthropic only if Track A proceeds |
| Production access | A written rule for when the owner may read data, and whether it's recorded |
| Incidents | Who's told, when and how |
| End of beta | What happens to participants' accounts and data |

**Questions for legal review:** whether the age is set by law; duties on learning a user is a minor; whether food, weight and birth date are health data in the chosen country and need explicit consent; breach duties; whether suggestions and warnings raise a medical-device question; timing and format of access and deletion rights; processor agreements and transfers; whether an invite-only beta by an individual changes any of this; and ODbL attribution.

## 11. Pre-beta infrastructure

**Recommended:** one x64 Linux VPS running Caddy and a single app container with a 1.5 GB limit, **plus managed PostgreSQL** in the beta's region. A free uptime monitor, and a transactional email provider.

**A disagreement resolved here:** Review G's main recommendation self-hosts Postgres, and the agent prefers managed. **Managed is recommended,** because this is the owner's first production system and the data is the part that can't be replaced. **A timed restore is still required.** The PaaS option (always-on container plus managed Postgres) is a reasonable alternative, subject to checks on hop count, body limits and overlap during deploys.

**Rough cost, from memory and unverified:** $10 to $60 a month, depending on the option. Check before approving. Owner time for patching is the larger cost.

| Requirement | Detail |
|---|---|
| Startup preflight | Refuses to start unless `NODE_ENV=production` and `APP_ORIGIN` is HTTPS, or if `EXPOSE_DB_IDENTITY`, any AI key or model, a stub URL, or a database name containing "test" is set |
| Node | Pin the tested version in `engines`, `.nvmrc` and the image. Run the tests on Linux |
| Proxy | `TRUST_PROXY_HOPS=1`, HSTS with a short max-age first, an 8 MB body limit, no `/api/` caching, app bound to loopback. Run the forged-header test |
| Health | New `/api/health`, status only. db-identity stays off |
| Backups | Automatic and off-site, plus one before each migration. **One timed restore before the first invite** |
| Release | Migrate as a separate step, then swap the image. Expand-and-contract, as Prisma has no down migrations. A written runbook, including a failed migration |
| Install | Handle dev-only `prisma` and `tsx`. Prove a clean `npm ci` on Linux. Seed the exercise library |
| Environments | `NODE_ENV=production` on any deployed environment. Separate credentials. A disposable rehearsal server, no permanent staging |
| Test guard | All write-capable scripts refuse a non-loopback `BASE_URL`, with no allowlist. Moved to 4.0.0a, as the hazard already exists against the development database |
| Logs | Retention period set, and checked after each deploy for the proxy warning, which appears only once per process |
| AI | Stays off with no key. Disable `/api/images/validate` while AI is off |
| Data | Production starts empty, with no test accounts. `noindex` |
| Patching | Audit before deployment, and someone assigned to apply updates |

**Not needed yet:** Redis, multiple instances, Kubernetes, CDN, connection pooler, bounce webhooks, an APM stack, a monitoring vendor, on-call rotation, or an email queue.

## 12. Milestone breakdown

**The proposed five-part division is changed.** Infrastructure last doesn't work, as notices must name the host and processors, email needs a domain, and device tests need a deployed HTTPS build. Each milestone needs its own approval, and passes through the full workflow. Migrations, paid services and new infrastructure are flagged.

| Order | Milestone | Migration | Paid or new service | New dependency |
|---|---|---|---|---|
| 1 | 4.0.0 Decisions and inputs | No | Legal and clinical review, possibly paid | No |
| 1a | 4.0.0a Test-target guard | No | No | No |
| 2 | 4.0.1 Eligibility and calorie safeguards (Stage A) | No | No | No |
| 2a | 4.0.1b Target stop and calories-only, **proposed** | **Yes, own approval** | No | No |
| 2b | 4.0.1c Profile data reduction, **proposed, can slip alone** | **Yes, own approval** | No | No |
| 3 | 4.0.2 Deletion and export. **Proposed: export ships after 4.0.1b** | No | No | No |
| 4 | 4.0.3 Production foundation | No | **Host, database, domain, monitor** | No |
| 5 | 4.0.4 Email-proven access | **Yes** | **Email provider** | **Possibly an email SDK** |
| 6 | 4.0.5 Notice and acceptance | **Shares 4.0.4's** | Legal review | No |
| 7 | 4.0.6 Device test and go/no-go | No | No | No |

4.0.1 and 4.0.2 can run alongside 4.0.3. Then come Phase 4.1, a repeat of device testing for new screens, and the beta.

**Final-round findings for later milestones, reviewed but not yet applied here.** They come from the agent's final review and the specialist re-reviews, and these sections still need correcting:

| Milestone | Finding |
|---|---|
| Order | Registration must close before any deployment, with an allowlist on the existing route in 4.0.3. Final go/no-go moves after Phase 4.1's device retest |
| 4.0.2 | The opening test observes plain `user.delete`. A profile-less account needs a route outside `(app)/layout.tsx`. Help resource, and a home for underweight warnings, are unassigned |
| 4.0.3 | Preflight design and added environment rules, health route, restore pass criteria, baseline security headers |
| 4.0.4 | Decision 11's one-page sign-up: **the agent recommends rejecting it for the beta, against section 8.** Token rules change: drop `@@unique([email, purpose])`, several live tokens, and a purge for sign-up tokens, which user cascades miss |
| Monitoring | "Basic error monitoring" in the roadmap isn't defined here |

### 4.0.0 Decisions and inputs

- **Objective:** settle what later milestones depend on.
- **Scope:** decisions in section 15, a one-page data-flow inventory, a legal question list, and named reviewers. **No code.**
- **Acceptance:** each blocking decision recorded, with its owner and date. Reviewers named or the gap explicitly accepted.
- **Rollback:** none needed.
- **Approvals:** owner.

### 4.0.0a Test-target guard

- **Objective:** no write-capable test script can reach a non-loopback server or an unmarked database.
- **Scope:** one shared guard and a meta-test. Hardening, so product review can be skipped under the workflow. It needs its own detailed plan.
- **Why first:** the hazard already exists, and 4.0.1 rewrites these tests.
- **Rollback:** code only.

### 4.0.1 Adults-only eligibility and calorie safeguards

**The detailed plan is `docs/PHASE_4_0_1_IMPLEMENTATION_PLAN.md`. If this summary and that plan differ, the plan is correct.**

**Proposed by the plan's Annex H, not approved:** this milestone becomes Stage A with no migration, and adds a fail-closed access gate for no-profile and stored under-minimum accounts, plus neutral over-target colour. 4.0.1b adds one `NutritionTarget` migration (Decisions 20, 26). 4.0.1c adds one separate `Profile` migration (Decisions 21, 25). **Stage A alone must not admit real users.**

- **Objective:** no misleading targets for minors, and no automatic low intake for anyone.
- **Scope:**
  - One shared calendar-age rule, enforced on the server for onboarding and profile edits. Neutral refusal.
  - No target written except by an explicit `PUT`. Seeding, syncing, the override and the suggestion route are removed.
  - `suggestCalories` and `suggestMacros` are removed, which removes deficits, surpluses, macro collapse and floor wording. Whether any estimate is shown is decision 9.
  - Require units to be chosen. Sex and activity follow decision 25, and goal follows decision 21.
  - A working no-target state, a logout on onboarding, and readable errors on the profile form.
  - Static "not medical advice" text. Final wording: decision 7.
- **Not in this milestone:** warnings on manual targets or goal weights (decision 23), as each needs an unreviewed number. **So 800 kcal stays accepted with no warning, which is a known gap and not a safe state.**
- **Reuse:** `ageFromBirthDate`, existing no-target handling in `entries.ts` and the nutrition page, `Field`, `ErrorText`.
- **Code changes:** see the plan's section 11.
- **Database and dependencies:** none. **No automatic path changes target rows.** The person's own removal, under decision 20, is the only exception.
- **Acceptance criteria:** see the plan's section 14.
- **Rollback:** code only, by reverting the commit.
- **Agent, on the revised plan:** MODIFY, see the plan's Annex G. A recommendation, not approval.
- **Approvals:** owner on decisions 1, 9, 15, 19, 20, 21, 22 and 25 to 31. Qualified reviewer on wording before the beta, and on any threshold.

### 4.0.2 Account deletion and data export

- **Objective:** people can leave, and take their data.
- **Proposed by the plan's Annex H, not approved:** deletion is also offered from the refusal and restricted screens, reachable without a complete profile. Export follows 4.0.1b, and includes stopped target rows and nulls as null.
- **Scope:** first, a test proving or disproving the expected failure. Then ordered deletion, export, password re-entry, `/profile/account` page, and the coverage check.
- **Reuse:** `Sheet`, throttle and Argon2 slots, `isUncertainFailure`, `SAVE_TIMEOUT_MS`.
- **Database and dependencies:** none.
- **Security:** session identity only, field allowlist, rate limits.
- **Acceptance criteria:**
  - Deleting a user removes every row they own, in each case: custom exercise unused, in a plan, in a session, in both, and in an in-progress session.
  - A control user, built-in exercises and shared foods are unchanged.
  - A wrong password deletes nothing. Failure mid-way leaves everything intact. The old session gets 401. The email can register again.
  - Export contains a sentinel from every exported field, and nothing from the control user. No hash or token anywhere.
  - Adding a model or field to the schema without classifying it fails the test suite.
- **Rollback:** code only, though a deletion can't be undone.
- **Approvals:** owner on export fallback. Legal on timing.

### 4.0.3 Production foundation

- **Objective:** a restorable private service, with no real data yet.
- **Scope:** section 11.
- **Code changes:** preflight, `/api/health`, mandatory `APP_ORIGIN` in production, disabling image validation while AI is off, Node pin and HSTS.
- **Database and dependencies:** none in code. **New infrastructure flagged.**
- **Acceptance criteria:**
  - Each preflight condition refuses startup, tested individually.
  - A forged `X-Forwarded-For` and `X-Forwarded-Host` have no effect through the deployed proxy.
  - The database has no public port.
  - **A timed restore has been completed and written down.**
  - A release and a rollback have each been rehearsed once.
  - **Production starts empty,** checked, as 4.0.1's handling of legacy targets and under-18 profiles depends on it.
- **Rollback:** previous image. Migrations follow the runbook.
- **Approvals:** owner on host, database, domain, cost ceiling and data access rule.

### 4.0.4 Email-proven access

- **Objective:** only invited people can join, and anyone locked out can recover.
- **Scope:** sections 7 and 8, the allowlist (environment-based, with no table), change-password, an auth request deadline, and a local mail stub.
- **Reuse:** `hashToken`, throttles, `route()`, `Field`.
- **Database: migration flagged.** `AccountToken` and acceptance fields. Additive, with no effect on existing rows. Rollback is a new forward migration, and old code ignores the additions.
- **New dependency:** possibly an email SDK, or plain HTTP to the provider. Needs approval.
- **Security:** section 5.
- **Acceptance criteria:**
  - An address not on the allowlist gets the same response, and no email.
  - No account exists until the link is used.
  - GET consumes nothing. Parallel use gives exactly one success, with no 429.
  - Expired, used and wrong-purpose tokens are refused, tested at T-1ms and T+1ms by backdating rows.
  - After reset, every old session gets 401 and the old password fails.
  - Known and unknown addresses get identical responses. Only hashes are stored.
  - No token or address appears in logs on provider failure.
  - The cooldown survives a restart.
  - All 14 registering scripts pass through the real flow.
- **Approvals:** owner on sign-up model, provider, migration and dependency.

### 4.0.5 Notice and acceptance

- **Objective:** people know what happens to their data before entering it.
- **Scope:** final notice and terms describing what's really built, public pages, and acceptance recorded at sign-up.
- **Reuse:** auth page layout. Fields from 4.0.4's migration.
- **Acceptance criteria:**
  - Every processor, data category and retention period in the notice matches the inventory, checked against the deployment.
  - Sign-up can't complete without acceptance, and version and time are stored and exported.
  - Pages are public and keyboard accessible, and linked from sign-up and profile.
- **Rollback:** text, with a new version if it changes.
- **Approvals:** owner, plus legal review.

### 4.0.6 Device test and go/no-go

- **Objective:** evidence that it works on real phones, and a defined meaning of "safeguards complete".
- **Scope:** the scripted flows on one iPhone and one Android phone against the deployed build, the owner using it for a real week of training, and a written checklist.
- **Decide here:** whether lost responses when logging a set need a fix first, as `POST .../sets` has no idempotency key.
- **Proposed go/no-go items, from the agent's review of 4.0.1, not approved:** decision 23 has a reviewed number, or a recorded accepted gap with the register amended. Decision 26 has nullable macro columns, or that choice recorded.
- **Also proposed by the plan's Annex H2, not approved:** decisions 6, 7 and 24 meet their acceptance conditions there. 4.0.1b is merged, and 4.0.1c is merged or its gap is accepted by the owner. A retention rule for abandoned profile-less accounts exists, from 4.0.5.
- **Acceptance criteria:** every flow recorded pass or fail per device, including a link opened from a mail app, date entry, a screen lock between sets, a network drop while saving, session persistence, reset, export and deletion. No open blocker. Checklist signed by the owner. Database reset before the first participant.
- **Rollback:** none needed.
- **Approvals:** owner signs go or no-go.

## 13. Test strategy

**Existing test impact,** predicted from reading code: see Review F in section 3.

| Area | Unit | API integration on a guarded test database | Browser |
|---|---|---|---|
| Age | All boundary cases with a fixed clock, across host time zones | Direct `PUT /api/profile` refused | Refusal screen |
| Calorie goals | Removed functions stay removed | No target written on read, first save or profile edit | Blank editor, no progress bar with no target |
| Tokens | Expiry, hash only | Reuse, wrong purpose, parallel use | Through the mail stub |
| Resets | Older token policy | Racing passwords, all sessions revoked | |
| Cross-user | | A's token with B's session, `?userId=` ignored, B's password can't delete A | Two contexts |
| Deletion | Coverage check | Seed every model, scan all tables, the five custom-exercise cases | Confirm flow |
| Export | Field manifest | Sentinels, control user's data absent | Download |
| Email failure | Fake sender | Stub 500, 429, timeout; same reply; no token in logs | Error message |
| Database failure | Rejecting fakes | Test-only trigger mid-delete, full rollback | |
| Mobile | | | 390x844 on 3 engines; real phones in 4.0.6 |
| Regression | Full `vitest` | All API suites | All E2E through the real sign-up flow |

**Coverage check:** classify every model and field for deletion and export, and fail on anything unclassified. It must also match the model count in `schema.prisma`, as a stale generated client would otherwise pass. Whether runtime `Prisma.dmmf` carries enough detail wasn't checked. If not, parse the schema.

**Time:** fake `Date` in unit tests, and backdate rows through the guarded client for server runs. **Never add a clock override to production code.**

**Mail:** a local stub modelled on the existing provider stub. Fail if the mail URL isn't loopback.

### Negative controls

Each must fail on its named assertion. A crash, 429 or 500 doesn't count, and each is rebuilt before running and restored byte for byte.

| Protection | Change | Must fail on |
|---|---|---|
| Token expiry | Skip the check | T+1ms accepted |
| Single use | Don't consume | Second use succeeds |
| Atomic use | Read then update | Two successes under a held lock |
| Token type | Drop the purpose check | Signup token resets a password |
| Hashed token | Store raw | Column equals inbox token |
| Session revocation | Skip it | Old session still works |
| Enumeration | 404 for unknown address | Replies differ |
| Link origin | Build from Host | Forged host in the emailed link |
| Export scope | Read `?userId=` | Control user's sentinel present |
| Coverage | Synthetic model and field | Gaps non-empty |
| Deletion order | Plain `user.delete` | Custom-exercise case errors, rows remain |
| Over-deletion | Also delete built-in exercises | Survivor count |
| Atomic deletion | Remove the transaction | Partial rows found |
| 18+ | Threshold back to 13 | 17-year-old accepted |
| Calendar age | Restore 365.25 | 2008-11-05 at 2026-11-05 00:00 UTC |
| No automatic target | Restore seeding | Target row after a page load |
| Preflight | Remove each condition | Server starts |
| Mail isolation | Non-loopback mail URL | Startup refusal |

The full list for 4.0.1 is in the plan's section 13. A "799 shows no warning" control was removed: the schema rejects 799, so it could never reach a warning, and 4.0.1 has no warning.

**Past mistakes to avoid here:** harnesses reporting success on failure, tests that couldn't fail, controls caught for the wrong reason, stale builds, and suites with no guard. WebKit sign-up currently bypasses the UI, so it wouldn't prove a UI gate.

## 14. Risk register

| Risk | Likelihood | Impact | Response |
|---|---|---|---|
| Automatic deficit for an underweight person | Medium | **High, health** | 4.0.1 |
| Deletion fails for real users | Inferred, unobserved | High | Test first in 4.0.2 |
| Reset-link poisoning | Low once deployed correctly | High | Preflight, `APP_ORIGIN` |
| Data loss with no working restore | Medium | High | Timed restore before first invite |
| Beta opens publicly by accident | Medium | High | Allowlist |
| Notice doesn't match behaviour | Medium | High | Written last, from the inventory |
| No qualified reviewer found | Medium | High | No suggested numbers and no threshold warnings. **Whether the beta may proceed with that gap recorded is decision 7** |
| Legal review delayed or costly | Medium | Medium to High | One country, invited beta, stated in the go/no-go |
| Email provider delay | Medium | Medium | Invite links and scripted reset fallback |
| Test rewrite larger than predicted | Medium | Medium | One shared helper |
| Sign-up redesign breaks onboarding | Medium | Medium | One-page proposal gets separate scrutiny |
| Owner's first production system | High | Medium | Managed database, written runbooks |
| Lost set on a poor connection | Medium | Medium, accuracy | Decide in 4.0.6 |
| Test script hits production | Low | High | Guard change |
| Self-declared age is false | Medium | Medium | Accepted, and stated openly |
| Warnings read as approval | Medium | Medium | No numbers, professional wording |
| 800 kcal manual target accepted with no warning after 4.0.1 | Unknown | **High, health** | Stated gap, decision 23 |

## 15. Open decisions

**For the owner. None is decided by this document.** These numbers are permanent, and `PRODUCT_STRATEGY.md` section 12 has its own separate list. Decisions 19 to 31 were added during 4.0.1 planning, and earlier numbers are unchanged.

**The final engineering recommendations are in the plan's Annex H1 and H2, with legal and clinical dependencies in H7. They replace this table's recommendations for decisions 6, 7, 20, 21, 23, 24, 25, 26, 27, 29 and 31. The table below is kept as the earlier position. All remain recommendations.**

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| 1 | Minimum age | 18, subject to legal review | 4.0.1 |
| 2 | Beta country and participants | One country, adults known to the owner | 4.0.0 |
| 3 | Operator: who's legally responsible, business or personal | Decide now, not after 4.0 | 4.0.5 |
| 4 | Working name and domain | One name. "Forge" is in the app, FitWorkoutFoodTracker elsewhere | 4.0.3, 4.0.4 |
| 5 | Host, database, email provider, monthly ceiling | Section 11 | 4.0.3, 4.0.4 |
| 6 | Legal reviewer and budget | Needed for 4.0.5 | 4.0.5 |
| 7 | Qualified safety reviewer | Needed for floors, wording and help resource | Beta |
| 8 | Sign-up model | Link-first with allowlist. Fallback: invite links. **Approved by the owner, 2026-11-06:** no account until a valid link is used | 4.0.4 |
| 9 | Calorie default: A, no estimate. B, estimate on request, never applied. C, suggestion with explicit acceptance | **A, changed from C,** reopened only once a named reviewer has seen it. The agent's review of the revised plan also recommends A, withdrawing its earlier on-request position. See the plan's section 8 | 4.0.1 |
| 10 | Whether emailed recovery is required for the beta | Yes, as you've said. Review A disagrees. **Approved by the owner, 2026-11-06:** required | 4.0.4 |
| 11 | One-page sign-up with profile | Yes, subject to review. **Decided otherwise by the owner, 2026-11-06:** onboarding stays separate from registration for the beta, as the product agent recommended | 4.0.4 |
| 12 | Backup retention | About 14 days, to confirm | 4.0.5 |
| 13 | Export fallback if time runs short | Keep self-service. It's small | 4.0.2 |
| 14 | Production data access rule | Written, and restricted | 4.0.3 |
| 15 | Calendar date for age: UTC or local | UTC, as `timezone` is client-supplied | 4.0.1 |
| 16 | End-of-beta data, and support contact | Decide before invites | 4.0.6 |
| 17 | Which phones | One iPhone and one Android | 4.0.6 |
| 18 | Project-wide secret deny rules (earlier decision 12) | Separate small change | None |
| 19 | Remove date backfill, where a first target moves back over earlier entries | Remove | 4.0.1 |
| 20 | How to stop using a target, as `kcal` can't be null | Person deletes their target rows, with confirmation. Earlier days lose their comparison | 4.0.1 |
| 21 | Require a chosen goal | Yes, if Phase 4.1 keeps its goal card | 4.0.1 |
| 22 | State 18+ openly at sign-up and in terms | Yes. The refusal stays neutral | 4.0.1 |
| 23 | Warnings on manual targets and underweight goals, which the register requires before the beta | Needs a reviewed number, or an accepted gap. No milestone yet | Beta |
| 24 | Over-target colour | Neutral. No milestone yet | Beta |
| 25 | Whether sex, activity, height, current weight, experience and workout days stay required if nothing reads them | Keep for 4.0.1 as a stopgap, with honest text, as the columns are non-null. By the beta, each needs a named reader or stops being required. Legal to advise | 4.0.1 |
| 26 | Calories-only targets, as the schema can't separate zero from unspecified macros | Nullable columns as their own migration before any real user, which needs approval, with required numbers until then. See the plan's section 8 | 4.0.1 |
| 27 | Who removes a refused person's account. The register requires it, and no milestone does it | Assign to 4.0.2, or amend the register | 4.0.1 authorization |
| 28 | What an under-18 date on a profile edit does | Refuse and keep access, for development data only | 4.0.1 |
| 29 | How an adult who mistyped a date recovers | Support contact once decision 16 names one, with no "try again" wording | 4.0.1 |
| 30 | Legacy `SUGGESTED` rows: blank editor, and a label on the Nutrition page | Yes to both | 4.0.1 |
| 31 | What the target editor says below 800 kcal | Fixed text calling it a data range, never safe. Wording to the reviewer | 4.0.1 |

**Proposed corrections to existing documents, not made here,** since the register and strategy mustn't be changed without approval:

- "Straightforward" deletion in the readiness report.
- "Someone under 18 can't complete sign-up" in the roadmap.
- "Accepts or changes" for targets in the register.
- Export as a test of trainer demand.
- Roadmap prerequisites and naming timing.
- The README, `ARCHITECTURE.md` and the 3.6 status line, as before.

## 16. Recommended first implementation milestone

**After 4.0.0's blocking decisions and the 4.0.0a guard, and only once approved: 4.0.1.**

**Why first:**

- It's the only area where a failure can harm someone's health rather than their data.
- Its calculation defects are REPRODUCED AT MODULE LEVEL, and its target-path defects are confirmed in the source.
- It needs no service, dependency or migration, **as Stage A under the plan's Annex H. 4.0.1b and 4.0.1c each propose one migration, with their own approval.** **It does change existing tests,** contrary to an earlier version of this section: seeding is asserted in `nutrition-api.test.cjs` and `release-workflow.test.cjs`, and six browser flows need updating. See the plan's section 12.
- It's useful even if every other decision takes time.

**Decisions it needs:** 1, 9, 15, 19, 20, 21, 22 and 25 to 31.

**Also recommended, as the first test written:** the deletion test that opens 4.0.2, on a designated test database. It's small, and settles whether the readiness report is wrong.

## Appendix A: Decision matrix

"Agent" is the Product Strategy Agent. All are recommendations.

| Requirement | Product | Architecture | Security | Fitness safety | UX | Testing | Infrastructure | Depends on | Size | Final |
|---|---|---|---|---|---|---|---|---|---|---|
| Adults-only | Agent MODIFY, P0 | Shared calendar rule. No migration | Self-declared, never "verified" | Formula is for adults | Neutral refusal, no threshold shown | Boundaries, fixed clock | None | Decisions 1, 15 | S | **Build in 4.0.1** |
| Calorie and goal safeguards | Agent MODIFY, P0 | `getTargets`, `energy.ts`. No migration | Refused date not logged | **Main health risk** | No suggestions, no-target states. Warnings wait for decision 23 | Every target write path | None | Decisions 9, 19, 20, 26 | M | **Build in 4.0.1, without warnings** |
| Closed registration | Missing from roadmap; A and agent essential | Env allowlist | Prevents public exposure | Keeps participants known | Same response | Non-listed address | None | Sign-up model | S | **Build in 4.0.4** |
| Password recovery | Agent BUILD; A defer | Token table | Blockers 1, 2, 4 | None | Expired link recovery | Tokens, races, controls | Email, `APP_ORIGIN` | 4.0.3 | M | **Build in 4.0.4** |
| Change password | Agent, A add | Shares reset code | Revokes other sessions | None | In settings | Revocation | None | 4.0.4 | S | **Build in 4.0.4** |
| Email verification | Agent MERGE; A defer | Link-first, no flag | Closes hijack, enumeration | Refused minor has no account | "Check your email", resend | All 14 scripts through it | Email | Decision 8 | S to M, large test impact | **Build in 4.0.4** |
| Deletion | Agent BUILD, P0 | Ordered transaction. No migration | Re-auth, session identity | None | Sheet with password | Seed all, five cases | Backup replay | Retention | S to M | **Build in 4.0.2** |
| Exit without a profile | Agent found the gap | Removed by one-page sign-up | Covers stuck accounts | None | Avoids dead end | Reachability | None | Decision 11 | S | **Resolved by 4.0.4, or add a logout to onboarding** |
| Export | Agent MODIFY, P1; A defer | Versioned JSON. No migration | POST, re-auth, allowlist | None | Progress and failure | Sentinels, control user | None | None | S | **Build in 4.0.2** |
| Notice and terms | Agent MODIFY, P0 | Acceptance fields, shared migration | Names processors | "Not medical advice", who it isn't for | Public, short | Text matches inventory | None | Legal, inventory | S in code, L outside | **Build in 4.0.5** |
| Production foundation | Agent MODIFY, P0 | Preflight, health route | Mandatory `APP_ORIGIN`, no public database | None | None | Each preflight condition | **VPS, managed database, domain** | Decisions 4, 5 | M to L | **Build in 4.0.3** |
| Real-device testing | Agent MODIFY, P1 | None unless defects | Test accounts, reset after | None | Date entry, mail links | Written script | Deployed build | 4.0.3 to 4.0.5 | S to M | **Run in 4.0.6, repeat after 4.1** |
| Sign out everywhere | Review C blocker | Delete user's sessions | Stolen session | None | Settings | Revocation | None | 4.0.4 | S | **Via change-password. Separate control later** |
| Email change | B include; agent later | `EMAIL_CHANGE` token purpose | Notify old address | None | Settings | Token tests | Email | 4.0.4 | M | **Defer, manual during beta** |
| Under-18 remediation flow | A cut; D documents the state | Route-level block | Stored minors | Stops formulas | Blocked page | Boundary | None | Empty production database | M | **Don't build. Manual procedure.** Superseded in part, as proposed by the plan's Annex H: a derived, fail-closed restriction with no stored flag |

### Disagreements, and how each was resolved

These are stated rather than averaged. **Resolutions are recommendations for the owner.**

| # | Disagreement | Positions | Recommendation, and why |
|---|---|---|---|
| 1 | **Emailed recovery and verification before the beta?** | **A:** defer, with a scripted reset and allowlist, which removes the only migration. **Agent:** build, keeping A's approach as a fallback. **C:** treats its controls as blockers | **Build.** You named these as prerequisites, and a beta should test the real flow. A's argument is sound for 5 to 10 known people, so it stays as the fallback if email is delayed |
| 2 | **How verification works** | **B:** nullable flag, login not blocked. **C:** no pre-verification session or surviving attacker password. **Agent:** link-first, no flag | **Link-first.** B's design leaves C's hijack open unless a reset evicts the attacker. Production starts empty, so B's concern about existing accounts doesn't apply. **Cost:** Review F's 14 script files |
| 3 | **Self-service export before the beta?** | **A:** defer, as operator export covers it. **Agent:** keep, P1. **C:** protect it if built | **Keep.** Small, and operator export means routine owner access to personal data, which is worse |
| 4 | **Order** | **Your draft:** infrastructure last. **A and agent:** earlier | **Earlier.** Notices, email links and device tests all depend on it |
| 5 | **Export method** | **B:** `GET`. **C:** `POST`, no sensitive `GET` | **POST,** as it needs password re-entry |
| 6 | **Age date** | **D:** local "today". **F:** client-supplied time zone mustn't move the result. **Agent:** `ageFromBirthDate`, on UTC | **UTC.** One rule that the client can't influence. Someone may pass hours early or late by local time, which is acceptable given that age is self-declared. Legal to confirm. Decision 15 |
| 7 | **Under-18 handling** | **D:** a stored minor keeps access unless blocked at route level. **A and agent:** cut it | **Cut, on one condition: production starts empty.** D's finding stands if any data carries over |
| 8 | **Email abuse limits** | **C:** durable caps are a blocker. **Agent:** tolerable for invited users | **Middle, on evidence:** the allowlist stops third-party bombing for sign-up, and the token row gives a durable cooldown at no extra cost. Add a provider cap |
| 9 | **Hard floor or warning** | **F:** a hard floor breaks tests. **D:** a professional decision. **Register:** person stays in control | **Neither in 4.0.1, changed from "warn".** The agent's final review found that reusing the uncited floors as a warning trigger is an unreviewed threshold in disguise. Decision 23. Test impact isn't a reason either way |
| 10 | **Database hosting** | **G:** self-hosted in Compose. **Agent:** managed | **Managed,** see section 11 |
| 11 | **Email change** | **B:** include. **Agent:** after beta | **After beta,** manually until then |
| 12 | **Does deletion actually fail?** | No disagreement, but **nobody has run it.** Reviews differ only on detail, such as the error code | **Test first.** It's an inferred risk, not a known failure |

## Appendix B: Implementation readiness

**Nothing here is authorized. A recommendation isn't approval.**

| Status | Items |
|---|---|
| **Already implemented** | Argon2id hashing, hashed sessions, device cookie invalidated by a password change, login throttling and uniform login errors, Origin checks, owner-scoped routes (reviewed sample), estimate labels, deficit caps and floors for deficits, no-target handling on the nutrition page, `Sheet` focus and locking, body limits, secret-safe Prisma logging, 3-browser E2E harness, database guard, AI off without a key |
| **Missing** | Reset, change-password, verification, allowlist, deletion, export, re-authentication, privacy and terms pages, acceptance record, target warnings, "who this isn't for" text, help resource, preflight, health route, HSTS, Node pin, deployment files, backups, runbooks, mail stub, coverage check, two-user workout tests, real-phone tests |
| **Needs correction** (confirmed or reproduced, per the evidence classification, except the inferred items named there) | Age rule and arithmetic, two age rules, `profile-form.tsx` age gate, floors only on deficits, automatic targets, deficit at any weight, floor above TDEE text, macro collapse, `calorieTargetOverride` API path, "minimum safe floor" and other wording, default sex and activity, register 409 and timing, raw validation text, light-theme contrast, `APP_ORIGIN` fallback, test guard, safe logging for mail, stale documents |
| **Requires design approval** | Link-first sign-up, one-page sign-up with profile, token schema, deletion order, export format, target default and no-target state, allowlist storage, preflight rules, release runbook |
| **Requires owner approval** | Section 15. **Every migration, paid service, new dependency and piece of infrastructure.** Each milestone's start and merge |
| **Requires legal or professional review** | Age, health-data status, consent, retention, breach duties, medical-device question, notice wording, ODbL. Floors, underweight threshold, warning wording, help resource, sex field |
| **Blocked by another milestone** | 4.0.1 by the 4.0.0a guard, and decisions 1, 9, 15, 19, 20, 21, 22 and 25 to 31. 4.0.3 by decisions 4, 5. 4.0.4 by 4.0.3 and decisions 8, 11. 4.0.5 by 4.0.3, 4.0.4 and legal review. 4.0.6 by all earlier. Phase 4.1 by 4.0.2's coverage check. The beta by everything, and by 4.1 |
