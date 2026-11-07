# Feature Decisions

The register of product decisions. The `product-strategy-agent` reads this before evaluating anything, and new records are added here.

**Approval status: nothing below is approved for implementation.** Every entry is a recommendation until the owner approves a specific scope, and then the record will say so.

**About the evidence:** this product has no user research or usage data yet. Unless a claim says it was verified in the code, statements about what users want are assumptions. The thing that would settle each one is listed in its record.

**Priority:** P0 blocks real users or production. P1 is core to the purpose. P2 is a clear improvement. P3 is nice to have.
**Complexity:** S small, M medium, L large, XL large and cross-cutting. These are relative, not time estimates.
**Format:** rows with nothing to add are left out of shorter records. "Verified" means checked in the code at commit `64114bc`.

## Requested features

### Progressive overload graphs

**Recommendation: MODIFY** · Priority: P2 · Tier: POST-MVP

**Rationale:** This already exists. It doesn't need building, only a date range, which is the custom reporting periods feature below.

| | |
|---|---|
| User problem | Seeing whether a lift is progressing over time |
| Target user | Anyone doing resistance training |
| Existing functionality | **Built.** `progress/[exerciseId]/page.tsx` and `exercise-chart.tsx` chart top weight, est. 1RM, volume and reps. `overload.ts` gives live status per exercise, and personal records |
| Proposed solution | Keep it, and add the shared date range |
| Simpler alternative | Change nothing. Reasonable until an exercise has enough history to crowd the chart |
| Actual user value | Readable long histories (Assumption) |
| Risks | Rebuilding what works. Est. 1RM must stay labelled as an estimate |
| Dependencies | Custom reporting periods |
| Implementation complexity | S: filtering existing data |
| Maintenance cost | Low |
| What would change this decision | Requests for per-muscle weekly volume, which is a different chart and needs its own review |

### Nutrition intake graphs

**Recommendation: MODIFY** · Priority: P2 · Tier: POST-MVP

**Rationale:** Also built. It's limited to a week view and an 8-week trend, so the only gap is the range.

| | |
|---|---|
| User problem | Seeing intake against targets over time |
| Target user | Anyone tracking food |
| Existing functionality | **Built.** `nutrition/history/page.tsx` and `history-charts.tsx`: daily calories against each day's own target, and an 8-week calorie and protein trend |
| Proposed solution | Keep it, and add the shared date range |
| Simpler alternative | Change nothing |
| Actual user value | Longer views for people on a long diet phase (Assumption) |
| Risks | Averages over partly logged days mislead. The existing rule, averaging only over logged days and showing how many, must carry over |
| Dependencies | Custom reporting periods |
| Implementation complexity | S |
| Maintenance cost | Low |
| What would change this decision | Nothing expected |

### Custom reporting periods

**Recommendation: BUILD** · Priority: P2 · Tier: POST-MVP

**Rationale:** A small change that improves two existing screens and the planned weight trend, using one shared control. Build it once, not per chart.

| | |
|---|---|
| User problem | Answering "how did this period go?" for periods other than a week |
| Target user | People with more than a couple of months of data |
| Existing functionality | `history()` in `nutrition/entries.ts` already takes an end date and number of days |
| Proposed solution | One shared control: 4, 12 and 26 weeks, 1 year, and a custom range. Used by nutrition, exercise and body-weight views |
| Simpler alternative | Presets only, with no custom range. **Start here,** and add custom dates if they're asked for |
| Actual user value | One control across the app (Assumption) |
| Risks | Unbounded ranges cost query time, so the range needs a limit. Time-zone day boundaries must match the existing rules |
| Dependencies | None. More useful once there's a weight log |
| Implementation complexity | S to M |
| Maintenance cost | Low |
| What would change this decision | Nothing expected |

### Activity calorie expenditure estimates

**Recommendation: POSTPONE** · Priority: P3 · Tier: FUTURE EXPANSION

**Rationale:** It conflicts with "no misleading fitness calculations" unless it's carefully limited. The app's energy target **already includes activity,** through the activity multiplier in `energy.ts`, so adding exercise calories on top double-counts them and invites eating them back.

| | |
|---|---|
| User problem | Knowing roughly what an activity burned |
| Target user | People balancing food and activity |
| Existing functionality | `energy.ts` already estimates daily expenditure, and its own comments warn the estimate is uncertain |
| Proposed solution | If built later: a rounded range from a published activity table, labelled as an estimate, shown beside the activity and **never added to the food budget** |
| Simpler alternative | Log activity with no calorie figure. Correct targets from the weight trend, which measures the real outcome |
| Actual user value | Satisfies curiosity (Assumption). Doesn't obviously improve decisions |
| Risks | False precision, and double-counting that undermines a deficit. Activity tables give population averages, not one person's burn |
| Privacy and security | None new. Safety: "earning" food through exercise can be harmful for people with disordered eating |
| Dependencies | Activity logging |
| Implementation complexity | S to build, but it needs careful product design |
| Maintenance cost | Low |
| What would change this decision | Real users asking for it after using activity logging, with the display rules above accepted |

### Walking, running and other sports

**Recommendation: MODIFY** · Priority: P2 · Tier: POST-MVP

**Rationale:** The problem is real, as not all training is sets and reps. Build a plain manual log. Leave out GPS, wearables and per-sport features, each of which is a product of its own.

| | |
|---|---|
| User problem | Recording training that isn't sets and reps |
| Target user | People who mix lifting with cardio or sport |
| Existing functionality | `WorkoutSession` and `SetEntry` are built around sets and reps. **Don't force activity into them,** as it would distort volume, PRs and overload |
| Proposed solution | A separate activity entry: type, date, duration, optional distance, optional notes. Shown in history and on the dashboard. No calories |
| Simpler alternative | A session note. Usable today, but can't be charted |
| Actual user value | A fuller training record (Assumption) |
| Risks | Scope growth into pace, routes and devices. Hold the line at manual entry |
| Privacy and security | Stay away from location data. A route shows where someone lives |
| Dependencies | None |
| Architecture impact | One new table, so a migration |
| Implementation complexity | M |
| Maintenance cost | Low |
| What would change this decision | Demand for device import, which needs its own review |

### Activity guidance

This was one rejected item. It's really three different things, with three different answers. The earlier record rejected all of them together, which was too broad.

| Part | Decision | Priority | Tier |
|---|---|---|---|
| **Factual progress observations** from a person's own data | **BUILD,** by extending what exists | P2 | POST-MVP |
| **General exercise education** | **POSTPONE:** see exercise demonstration references | P3 | FUTURE EXPANSION |
| **Personalized health or training advice** | **REJECT** | None | None |

**Rationale:** An observation reports what the data shows, and the app can be right about that. Advice tells someone what to do about their body, based on things the app can't know, such as injuries, medication, pregnancy or history. The dividing line is whether the statement is a checkable fact about logged data.

| | |
|---|---|
| User problem | Understanding what their data means |
| Target user | Anyone with some logged history |
| Existing functionality | **Verified, built:** `overload.ts` already reports status with reasons, such as more reps at the same weight. `nutrition/history` reports days logged and protein consistency |
| Proposed solution | More of the same, under these rules. Each observation names its data and period, and says so when there isn't enough data. No "you should". No predictions of when a goal will be reached |
| Examples allowed | "Protein reached your target on 5 of 6 logged days." "Bench press top weight is up 5 kg in 8 weeks." "Your 4-week weight trend is down 0.3 kg a week" |
| Examples not allowed | "You should eat more protein." "You're overtraining." "You can safely lose faster." "Take a rest day" |
| Simpler alternative | The existing screens, which already show most of this |
| Actual user value | Saves working it out by hand (Assumption) |
| Risks | Technically true statements can still pressure people, so wording needs care. **A boundary to keep honest:** the app already suggests calorie and macro targets. These stay labelled estimates, from a cited method, that the person accepts or changes |
| Privacy and security | Uses only the person's own data, computed on the server. No new sharing |
| Dependencies | Body-weight log, for weight observations |
| Implementation complexity | S per observation, using pure functions with tests |
| Maintenance cost | Low |
| What would change this decision | Advice would need a qualified person who writes and answers for it, and legal review |

### Personal trainer platform

Covers trainer accounts, trainer-client relationships, trainer-created programs, trainer dashboards, trainer feedback and permission management, evaluated together because none works without the others.

**Recommendation: POSTPONE,** preserved as **Initiative T,** a separate potential major capability outside the current roadmap · Priority: P3 for now · Tier: FUTURE EXPANSION

**Rationale:** It may be a real differentiator, so it stays on the record, with its own plan. It isn't being rejected. But it turns a single-user app into a multi-party one that hands health-adjacent data to another person, so it can't begin until the app has real users, working recovery and deletion, and evidence that trainers want it.

| Item | Decision | Note |
|---|---|---|
| Trainer accounts | **MERGE** into Initiative T | A capability on a normal account, not a second account system |
| Trainer-client relationships | **MERGE** | The core of the risk: consent and revocation |
| Trainer-created workout programs | **MERGE** | Reuse `WorkoutTemplate`, copied to the client. Never a second plan system |
| Trainer progress dashboards | **MERGE** | Read-only existing Progress views, scoped by consent. Not a separate analytics product |
| Trainer feedback | **MERGE** | Notes on a session. Real messaging would be a much larger feature |
| Trainer-client permission management | **MERGE,** designed first | See its own record |

| | |
|---|---|
| User problem | Trainers can't see a client's logs, and clients re-enter programs by hand (Assumption) |
| Target user | Adults with a personal trainer, and those trainers |
| Existing functionality | **Verified:** no trainer, coach or role concept in `src/` or the schema. Plans, logging, Progress and session notes exist for one user at a time |
| Proposed solution | The stages in `PRODUCT_STRATEGY.md`, section 8. Each has its own product review |
| Simpler alternative | **Do this first:** the client exports a report and sends it to the trainer. It needs no roles, and shows whether the demand is real |
| Actual user value | A possible differentiator, and maybe revenue (Assumption, untested) |
| Risks | Every query today filters on `userId`, and getting one wrong exposes someone's health data. Trainer credentials can't easily be verified. Liability if a program injures someone |
| Privacy and security | See the prerequisites in `PRODUCT_STRATEGY.md`, section 8. Legal review is required before any sharing |
| Dependencies | Account recovery, verified email, deletion, export, production deployment, real users, notifications |
| Architecture impact | Roles, a relationship table, and an authorization change touching **every** nutrition and workout query. The largest change on this list |
| Implementation complexity | XL |
| Maintenance cost | High, permanently |
| What would change this decision | **Specific evidence:** real trainers committing to a pilot, or clients repeatedly exporting reports for trainers. If it's central to the owner's plans, it can be prioritized sooner, but the prerequisites stay |

### Trainer profiles

The earlier record rejected these on the grounds that they imply a marketplace. **That was too broad:** a basic private profile doesn't need one. These are separate decisions.

| Part | Decision | Priority | Tier |
|---|---|---|---|
| **Private text profile:** name, short biography, self-reported qualifications, visible only to that trainer's connected clients | **MERGE** into Initiative T | P3 | FUTURE EXPANSION |
| **Private profile photograph** | **POSTPONE,** until storage exists for another reason | P3 | FUTURE EXPANSION |
| **Public discovery or directory** | **POSTPONE:** a separate business decision, outside Initiative T | None | None |
| **Marketplace and payments** | **REJECT** for now | None | None |

**Rationale:** A client invited by their own trainer gains a little from seeing a biography, and it costs little as text. A photograph is the expensive part, as it's the only reason for this feature to need image storage. Public discovery changes the risk, as it needs moderation, impersonation checks and credential checks. Payments add financial regulation, refunds and disputes.

| | |
|---|---|
| User problem | A client confirming who they're sharing data with |
| Target user | Clients and trainers already in a relationship |
| Existing functionality | **Verified:** none. `Profile` holds private personal data, which a trainer profile must not reuse or expose |
| Proposed solution | A separate small profile, shown only inside a consented relationship. Qualifications labelled **self-reported, not verified** by the app |
| Simpler alternative | Show the trainer's name and email from the invitation, which may be enough for a pilot |
| Actual user value | Reassurance (Assumption). Low unless Initiative T proceeds |
| Risks | Implied endorsement of unverified credentials. For photos: storage, moderation and takedown |
| Privacy and security | The trainer's own personal data, which needs deletion and export too. Photos get the same metadata removal as other uploads |
| Dependencies | Initiative T. Photos also need object storage |
| Implementation complexity | S for text; M to L with photos |
| Maintenance cost | Low for text; Medium with photos |
| What would change this decision | A deliberate decision to become a marketplace, which is a business decision first |

### Multiple gym locations

**Recommendation: POSTPONE** · Priority: P3 · Tier: FUTURE EXPANSION

**Rationale:** A location field does nothing by itself. The real problem is that weights aren't comparable across different machines, and the app can already express that.

| | |
|---|---|
| User problem | A leg press at one gym isn't the same as at another, which muddles progress |
| Target user | People who train at more than one place |
| Existing functionality | Custom exercises work today: "Leg Press (Home)" tracks separately, including its own charts and PRs. Session notes can also record it |
| Proposed solution | Nothing yet. Mention the custom-exercise approach in help text |
| Simpler alternative | That is the simpler alternative |
| Actual user value | Fewer steps than a separate custom exercise (Assumption) |
| Risks | Every session and exercise history gains a dimension. Location is personal data |
| Dependencies | None |
| Architecture impact | A location table, plus changes to overload and PR logic |
| Implementation complexity | M to L |
| Maintenance cost | Medium |
| What would change this decision | Users finding custom exercises too awkward in practice |

### Equipment identification and photographs

The earlier record rejected these together. **Private reference photographs don't need AI,** so they're separate decisions.

| Part | Decision | Priority | Tier |
|---|---|---|---|
| **AI equipment identification** | **REJECT** | None | None |
| **Private equipment reference photographs** | **POSTPONE,** as an optional future feature | P3 | FUTURE EXPANSION |

**Rationale:** Remembering which machine or setting someone used is a real, modest need. But a text note on an exercise covers most of it today, and photographs would be the app's **first stored images,** ending a deliberate rule. That's a lot of permanent cost for this benefit, so storage should arrive for a stronger reason first, if at all. AI identification stays rejected: the person knows the machine, and paid wrong answers would pollute their history.

| | |
|---|---|
| User problem | "Which machine was that, and what were the seat settings?" |
| Target user | People using several gyms, or unfamiliar machines |
| Existing functionality | **Verified:** exercise notes exist on plans and in the logger, whose placeholder already suggests "seat height, cues". Custom exercises exist. `Equipment` is a field on `Exercise`. `exercise-picker.tsx` displays it but doesn't filter by it. No images are stored anywhere, by design |
| Proposed solution | Now: nothing new. Later, if it's reopened: an optional private photo on a custom exercise, visible only to its owner, never sent to AI |
| Simpler alternative | **The existing exercise notes,** such as "seat 4, pin 7", which work today. A photo in the phone's own gallery also works |
| Actual user value | Modest convenience (Assumption) |
| Risks | Gym photos can include other people, and some gyms forbid photography. Storage is permanent cost |
| Privacy and security | Private bucket with short-lived signed URLs, strict per-user access, metadata removal through the existing image pipeline, deletion on removal and account deletion including backups, included in export, and a per-user storage limit |
| Storage cost | An ongoing bill that grows with users, plus backup. Unmeasured. Limit: about 7 MiB per image under current upload rules, which should be reduced for this use |
| Dependencies | Object storage, account deletion and export |
| Architecture impact | Object storage is a new service. New table. The current "images aren't stored" statements in the docs must change |
| Implementation complexity | L, mostly storage and deletion |
| Maintenance cost | Medium |
| What would change this decision | Beta users repeatedly asking for it, or another feature justifying storage first |

### Cross-platform Android and iPhone applications

**Recommendation: MODIFY** · Priority: P1 for real-phone testing, P2 for the installable web app, P3 for store apps · Tier: Real-phone testing MVP ESSENTIAL; install POST-MVP; store apps FUTURE EXPANSION

**Rationale:** A mobile-first web app already runs on both platforms, but it has **never been tested on a real phone,** and that's the first step. Make it installable before considering a second codebase. Two native apps would be the most expensive decision available, and would solve little that's known.

| | |
|---|---|
| User problem | Having the app on a phone, quick to open |
| Target user | Everyone. Logging happens at the gym and at meals |
| Existing functionality | The whole app is mobile-first. No manifest or service worker exists yet |
| Proposed solution | 1. Test on real phones. 2. Add a manifest and icons so it installs. 3. Only if a real limit is found, wrap the same code for the stores. **No native rewrite** |
| Simpler alternative | A bookmark to the home screen, which works today without any icon or manifest |
| Actual user value | An app-like launch (Assumption). Enables web push, on iPhone reported only once installed, which needs confirming on a device |
| Risks | Store review and fees come with store apps. Offline behaviour needs care, as caching must never show stale data as current or hold one person's data on a shared phone |
| Privacy and security | Don't cache personal API responses in a service worker without a design for it |
| Dependencies | Deployment over HTTPS, real-device testing, an app icon, and so the name and brand |
| Implementation complexity | S for install; L for store wrappers; XL for native |
| Maintenance cost | Low for install; High for store apps |
| What would change this decision | Real-device testing showing a web limitation that matters |

### Shared account synchronization

**Recommendation: MERGE** · Priority: None for sync itself · Tier: Already present

**Rationale:** Multi-device sync already happens, because the server holds all data and any signed-in device sees it. What's missing is offline logging. If "shared" meant several people using one account, the answer is no: it mixes their data and breaks every calculation.

| | |
|---|---|
| User problem | Seeing the same data on every device |
| Target user | Anyone with more than one device |
| Existing functionality | **Works today:** data is server-side, and sessions are per device |
| Proposed solution | Nothing to build. Offline logging, the adjacent real gap, is recorded under recommended additions |
| Simpler alternative | n/a |
| Risks | Two people sharing one account: mixed history, wrong targets, no privacy |
| Dependencies | n/a |
| Implementation complexity | None |
| Maintenance cost | None |
| What would change this decision | **Open decision 6:** whether "shared" meant something else, such as a family plan |

### Front-and-back food packaging scanning

**Recommendation: MODIFY** · Priority: P2 for barcode · Tier: Camera barcode POST-MVP; front scan POSTPONED

**Rationale:** Back-of-pack scanning exists. A front photo adds only the name and brand, which the label extraction already asks for, at the cost of another paid request. It also brings in marketing claims like "high protein" that must not be mistaken for nutrition data. A **camera barcode scanner** is what's actually missing, and it's free and on-device.

| | |
|---|---|
| User problem | Adding a packaged food without typing |
| Target user | People eating packaged foods |
| Existing functionality | **Built:** label scanning with review (`label-scanner.tsx`, `label-review.tsx`), PDF labels, and typed barcode lookup (`/api/foods/barcode/[code]`). Label extraction already has `productName` and `brand` |
| Proposed solution | Add camera barcode scanning that feeds the existing lookup, with label scan as the fallback when a product isn't found. Keep typing a name as it is |
| Simpler alternative | Typed barcodes, which work today |
| Actual user value | Much faster logging of packaged foods (Assumption) |
| Risks | `BarcodeDetector` isn't in every browser, so it may need a decoding library, which is a new dependency. Open Food Facts data is community-entered, and is already labelled that way |
| Privacy and security | Camera frames stay on the device. Nothing new is sent, apart from the barcode number |
| Dependencies | Real-device testing. Front-pack scanning would also need the AI accuracy test |
| Implementation complexity | M |
| Maintenance cost | Low |
| What would change this decision | The AI accuracy test showing that name extraction from a back label often fails |

### Reminders

Covers workout reminders, food logging reminders and progress check-in reminders.

**Recommendation: MERGE** into one reminder system, then BUILD · Priority: P2 · Tier: POST-MVP

**Rationale:** Three features would mean three sets of settings over one delivery mechanism. Build one system with reminder types. It's blocked until the app is installable or has email, because there's currently no way to reach anyone outside the app.

| Item | Decision | Note |
|---|---|---|
| Workout reminders | **MERGE** | Uses the existing weekly schedule. The most clearly useful of the three |
| Food logging reminders | **MERGE** | Off by default, and only ever neutral wording |
| Progress check-in reminders | **MERGE** | Depends on the body-weight log. Otherwise there's nothing to check in on |
| Notification preferences | **MERGE** | Built with this system, not before it. See its own record |

| | |
|---|---|
| User problem | Forgetting to train or log (Assumption) |
| Target user | Anyone who has lapsed |
| Existing functionality | `ScheduleSlot` holds the schedule, and `Profile.timezone` the time zone. No notification code exists |
| Proposed solution | Opt-in only, per type, with a set time and a one-tap off. Never guilt, streak pressure or calorie language |
| Simpler alternative | **Try first:** export the workout schedule as a calendar file (`.ics`). Reminders then come from the phone's own calendar, with no infrastructure |
| Actual user value | Possibly better consistency (Assumption) |
| Risks | Notification fatigue leads to uninstalling. Food reminders can feed unhealthy preoccupation. Delivery differs by platform, and is unreliable on iPhone web apps until tested |
| Privacy and security | Notification text can appear on a locked screen, so it must never include weights or calories. Push subscriptions are personal data and must go with account deletion |
| Dependencies | Installable app, or an email provider. A scheduled job |
| Architecture impact | Reminder settings and push subscription tables, plus the app's first background job |
| Implementation complexity | L, of which background delivery is most |
| Maintenance cost | Medium: delivery failures need monitoring |
| What would change this decision | The calendar file proving enough |

### Daily motivational quotes

**Recommendation: REJECT** · Priority: None · Tier: None

**Rationale:** It takes up screen space on the page people open to get something done, and it doesn't help them do it. If motivation is the goal, a person's own progress is more honest and already available: recent PRs are on the dashboard today.

| | |
|---|---|
| User problem | Motivation, though nothing suggests a quote solves it (Assumption) |
| Target user | Unclear |
| Existing functionality | Dashboard PRs and the weekly completion ring |
| Proposed solution | None. If wanted, one line from the person's own data, such as "3 PRs this month" |
| Simpler alternative | That line |
| Risks | Clutter, misattributed or copyrighted quotes, and repetitive content. Weight-related motivational content can land badly |
| Implementation complexity | S |
| Maintenance cost | Low |
| What would change this decision | Cheap enough that this is a matter of taste: the owner may reasonably overrule it |

### Female scientist and dumbbell branding concept

**Recommendation: MODIFY** · Priority: P2 · Tier: POST-MVP, timed with the installable app

**Rationale:** It's a design decision and not a feature, and it fits the accuracy-first positioning. Three things to settle first: the product has two names, a detailed character won't read at icon size, and "scientist" must not imply that results are scientifically verified.

| | |
|---|---|
| User problem | No recognizable identity. The app is called **"Forge"** in `layout.tsx`, and FitWorkoutFoodTracker everywhere else |
| Target user | Everyone |
| Existing functionality | Light and dark design tokens exist. There's no logo or app icon |
| Proposed solution | 1. Settle the name. 2. Make a simple mark that works at small icon size. 3. Use the full character only for larger moments, like onboarding |
| Simpler alternative | A wordmark and simple icon now, with the character later |
| Actual user value | Distinctive, and signals evidence and care. Possibly a broader audience than typical gym branding (Assumption) |
| Risks | Implied scientific endorsement, in a product whose whole position is not overclaiming. Trademark search needed for any name. Rights to the artwork need to be clear. It can narrow appeal if it's the only face of the product |
| Dependencies | Needed before the installable app, which requires an icon |
| Implementation complexity | S in code; design work is separate |
| Maintenance cost | Low |
| What would change this decision | User reactions to mock-ups |

## Owner decisions, 2026-11-07

**Approved by the owner for implementation: UX-01.** Food-search reliability, responsive layouts, the Slate & Mist redesign, the login and welcome screen, and better exercise and workout notes, with no schema change. The owner chose Slate & Mist from three proposed directions. Status is in the tracker, section 2i.

**Kept in the backlog, not approved:** recovery tracking, workout effort, more activity types, progress photographs, GPS routes, followers and photo sharing. The `product-strategy-agent`'s recommendations for each are summarized in the tracker, section 2i. Where it recommended rejecting GPS and followers, the owner chose to keep them as future decisions, so that disagreement stays open.

## Recommended additions

These came from gaps found while inspecting the code. None was requested.

### Account recovery and verified email

**Recommendation: BUILD** · Priority: P0 · Tier: MVP ESSENTIAL

**Rationale:** Today, someone who forgets their password **loses their history permanently.** That alone rules out real users. `ARCHITECTURE.md` already lists it as a follow-up.

| | |
|---|---|
| User problem | Being locked out, and accounts registered with mistyped addresses |
| Existing functionality | Login, registration and sessions exist. No reset or verification (searched in `src/`) |
| Proposed solution | Password reset by emailed one-time link, email verification, and revoking other sessions on reset |
| Simpler alternative | None acceptable for real users |
| Risks | Reset is a classic account-takeover path: tokens must be hashed, single-use, short-lived, and must not reveal which emails exist |
| Dependencies | Transactional email provider, a new recurring service needing approval |
| Architecture impact | A token table, so a migration |
| Implementation complexity | M |
| Maintenance cost | Low to Medium |
| What would change this decision | Nothing |

**Owner decisions, 2026-11-06, for Phase 4.0.4.** Decision 8 approved: link-first registration with an invitation allowlist, and no account until a valid link is used. Decision 10 approved: emailed password recovery is required. Decision 11: onboarding stays separate from registration for the beta, following this agent's recommendation over the design's earlier proposal. **Approved for development only:** the migration file may be written, and applying it, an email provider or SDK, a Prisma major upgrade, deployment and merging each still need separate approval.

### Account deletion and data export

**Recommendation: BUILD** · Priority: P0 · Tier: MVP ESSENTIAL

**Rationale:** A production blocker, and a basic promise of user control over food and body data. Export is also the cheap test of trainer demand.

| | |
|---|---|
| User problem | Leaving and taking their data with them |
| Existing functionality | None in the app. `User` relations already cascade in the schema |
| Proposed solution | Delete with confirmation and password. Export as CSV or JSON |
| Simpler alternative | Delete first, export next, as they're separable |
| Risks | Deletion must also cover backups and logs per the retention policy. Export must be rate-limited, and must only ever cover the signed-in user |
| Dependencies | Privacy notice |
| Implementation complexity | S to M |
| Maintenance cost | Low, though each new table must be added to the export |
| What would change this decision | Nothing |

### Body-weight log and trend

**Recommendation: BUILD** · Priority: P1 · Tier: MVP ESSENTIAL

**Rationale:** The product promises progress toward goals, and it **can't show it.** `Profile.currentWeightKg` is one value that's overwritten, so there's no history. Goals are often weight-based, and `energy.ts` itself says its estimates should be corrected against observed weight trends. This is the largest gap in the core product.

| | |
|---|---|
| User problem | "Is my weight moving toward my goal?" |
| Target user | Anyone with a fat-loss or muscle-gain goal |
| Existing functionality | `goalWeightKg` and `currentWeightKg` exist. `ARCHITECTURE.md` plans a `BodyMetric` table and a smoothed trend |
| Proposed solution | Log weight by date. Chart a smoothed trend and report change from the trend, not single weigh-ins, since daily weight swings with water. Show progress against the goal |
| Simpler alternative | Weight only for now, leaving waist and other measures for later |
| Actual user value | Enables goal progress, check-ins and any later target adjustment (verified dependency) |
| Risks | Weighing can be distressing: use neutral language, and keep it optional. **Decide how it relates to `currentWeightKg`,** which currently feeds calorie suggestions |
| Privacy and security | Sensitive personal data, to be included in export and deletion |
| Dependencies | None to start |
| Architecture impact | One table, so a migration |
| Implementation complexity | M |
| Maintenance cost | Low |
| What would change this decision | Nothing expected |

### Adults-only eligibility and goal safeguards

**Recommendation: MODIFY** · Priority: P0 · Tier: MVP ESSENTIAL, before any real user

**Rationale:** Validation accepts ages **from 13,** and the app then gives calorie targets, including fat-loss deficits, using a formula meant for adults. That's a misleading calculation for a growing teenager, and a safety concern. Initial eligibility should be adults aged 18 and older.

| Area | What the code does (verified) | What must be addressed before real users |
|---|---|---|
| **Registration** | `register` creates an account and session from email and password only. Age is first checked at onboarding, in `profileSchema` | State 18+ before sign-up, and confirm age at onboarding. Someone under 18 gets a clear refusal, with no profile saved and the just-created account removed |
| **Editing birth date** | The same schema applies to profile edits | Apply the 18+ rule there too, and decide what happens if an edit shows someone is under 18 |
| **Enforcement limits** | Date of birth is self-declared | It can't be verified without an identity check, which is out of proportion here. Terms must say 18+. Don't describe this as age verification |
| **Existing underage accounts** | Automated tests use adult birth dates. **No personal or production database was inspected for this review** | Before the first real user, the owner checks any database that will be used. Policy: block use, notify, offer export, and delete |
| **Calorie formulas** | `energy.ts` uses Mifflin-St Jeor with adult activity multipliers. It has no handling for pregnancy, breastfeeding or medical conditions | Say who the estimates aren't for. Add a plain "not medical advice" statement. Sex is a required input to the formula, so the wording should say so without implying more |
| **Goal safeguards** | Suggested targets are capped and floored: deficit at most 500 kcal, not below BMR or 1,200/1,500 kcal. **Manual targets go as low as 800 kcal,** and goal weight only needs to be from 30 to 300 kg, with no height check | Warn on manual targets below the floors. Warn when a goal weight implies an underweight BMI, for adults. Don't suggest targets for such a goal. Warnings inform, and a person stays in control of their own record |
| **Eating concerns** | Nothing in the app addresses this | A place to find help, chosen with expert input. No streaks or guilt language |
| **Legal and privacy** | No privacy notice or terms exist | **Legal review needed, not concluded here:** minimum age rules and children's data by market, whether food and weight data counts as health data under the laws that apply, consent, and retention. Depends on the launch countries |

| | |
|---|---|
| User problem | Protecting people who could be harmed by this app's calculations |
| Existing functionality | `validation.ts` sets the age limits. `energy.ts` has `MIN_INTAKE_KCAL` and the suggestion floors |
| Simpler alternative | The age check alone is small, and shouldn't wait for the rest |
| Risks | A warning can be read as approval of whatever isn't warned about. Over-blocking takes control from adults |
| Dependencies | Owner decision. Legal review of the markets served |
| Implementation complexity | S to M |
| Maintenance cost | Low |
| What would change this decision | Expert or legal advice supporting a different age or different safeguards |

### Saved meals and copying a previous day

**Recommendation: BUILD** · Priority: P2 · Tier: POST-MVP

**Rationale:** Many people eat the same things repeatedly (Assumption), and logging effort is the likely reason people stop. Recent foods help one item at a time. `ARCHITECTURE.md` already plans `FavoriteMeal`.

| | |
|---|---|
| User problem | Re-entering the same breakfast every day |
| Existing functionality | `recentFoods` exists, and `Repeat` already does this for workouts |
| Proposed solution | Start with **copy a meal or day to today.** Add named saved meals if asked |
| Simpler alternative | Copy alone needs no schema change, as entries already hold nutrition snapshots |
| Risks | Copying must make new entries with their own idempotency keys, and must keep source and missing values intact |
| Dependencies | None |
| Implementation complexity | S for copy; M for saved meals |
| Maintenance cost | Low |
| What would change this decision | Logging frequency data, once there are users |

### Offline-tolerant workout logging

**Recommendation: POSTPONE** · Priority: P2 · Tier: POST-MVP

**Rationale:** Gyms often have poor signal (Assumption), and today a failed request means a set doesn't get logged. But full offline sync is expensive. Measure on real phones first, then do the smallest thing that helps.

| | |
|---|---|
| User problem | Logging sets in a basement gym with no signal |
| Existing functionality | Workout logger requires a connection. Phase 3.6's idempotency pattern doesn't yet cover sets |
| Proposed solution | First step: idempotent set logging, and a clear retry when a request fails. Then a local queue, if needed |
| Simpler alternative | Keep what's typed on screen, and retry |
| Risks | Conflict handling across devices. Anything stored locally must be cleared on logout |
| Dependencies | Real-device testing, installable app |
| Implementation complexity | M for retries; L for a full queue |
| Maintenance cost | Medium |
| What would change this decision | Real-gym testing showing it's common |

### Real-user beta and feedback

**Recommendation: BUILD** · Priority: P0 · Tier: MVP ESSENTIAL

**Rationale:** Every value claim in this document is untested. A small group of real users costs little, and would settle more of these decisions than any further analysis.

| | |
|---|---|
| User problem | The project doesn't know what users need |
| Existing functionality | None |
| Proposed solution | 5 to 10 people using it for a few weeks, with a short conversation afterward. No analytics needed yet |
| Simpler alternative | That is the simple version. Privacy-respecting analytics can wait |
| Risks | Real data means the privacy basics must be in place first |
| Dependencies | Pre-beta safeguards (Phase 4.0) and core progress (Phase 4.1) |
| Implementation complexity | S |
| Maintenance cost | Low |
| What would change this decision | Nothing |

## Existing plans re-evaluated

`ARCHITECTURE.md` plans further features. They're reviewed here so they don't get built by default.

### AI scanning activation

**Recommendation: POSTPONE,** as optional Track A · Priority: P2 · Tier: Separate from the release sequence

**Rationale:** Built, tested with stubs, and switched off. The product must be worth using without it. Neither feature should be switched on until a paid test on real labels and meals measures accuracy and cost. **Meal photo identification must earn its place:** it only suggests names that someone then searches for anyway, so it might not save enough to justify its cost. Retiring it is a legitimate outcome.

| | |
|---|---|
| Existing functionality | Phases 3.2 to 3.6 |
| Simpler alternative | Barcode lookup and text PDFs need no AI |
| Dependencies | Spending limit, privacy notice, paid test approval |
| What would change this decision | Measured accuracy and cost, against thresholds agreed before the test |

### AI fitness assistant

**Recommendation: POSTPONE** · Priority: P3 · Tier: FUTURE EXPANSION

**Rationale:** Recurring cost, with safety exposure from a chat interface that can sound authoritative on health. The deterministic insights already answer many likely questions.

| | |
|---|---|
| Dependencies | Provider cost data, a proven AI accuracy process, and enough data per user to be useful |
| What would change this decision | Repeated user requests that deterministic screens can't answer |

### Progress photos

**Recommendation: POSTPONE** · Priority: P3 · Tier: FUTURE EXPANSION

**Rationale:** Among the most sensitive data the app could hold, and it would end the current rule that no images are stored. Weight and measurements cover much of the need.

| | |
|---|---|
| Dependencies | Object storage, encryption, deletion including backups, and a security review |
| What would change this decision | Strong user demand, after the weight log exists |

### PDF or image workout plan import

**Recommendation: POSTPONE** · Priority: P3 · Tier: FUTURE EXPANSION

**Rationale:** Listed as Phase 3 in `ARCHITECTURE.md`, but never built. It's useful only if people arrive with plans in documents. Could also serve trainers later.

| | |
|---|---|
| Dependencies | AI accuracy process |
| What would change this decision | Beta users or trainers actually asking for it |

### Adaptive calorie target adjustment

**Recommendation: POSTPONE** · Priority: P2 · Tier: POST-MVP

**Rationale:** The honest answer to "how much am I really burning?", as it uses a person's measured intake and weight trend rather than a formula. It needs weeks of good data, and has to be a suggestion that the person accepts, never an automatic change.

| | |
|---|---|
| Dependencies | Body-weight log, and enough logged days. The result must say how much data it used |
| What would change this decision | Weight-log data showing that it's reliable enough |

## Features from the independent product review

ChatGPT's review listed these as missing. **Each was checked in the code first, and they aren't all missing.** A recommendation from a reviewer gets no more weight than one from anyone else.

| Feature | Verified state | Decision | Priority | Tier |
|---|---|---|---|---|
| Bodyweight and measurement trends | Missing | MODIFY | P1 | MVP ESSENTIAL (weight only) |
| Workout history comparison | **Built** for consecutive sessions | POSTPONE any addition | P3 | FUTURE EXPANSION |
| Exercise substitutions | Partial | MODIFY | P2 | POST-MVP |
| Workout personal records | **Built** | MERGE into summaries | None | Exists |
| Scheduled progress check-ins | Missing | MERGE | P2 | POST-MVP |
| Trainer-client permission management | Missing | MERGE into Initiative T | P3 | FUTURE EXPANSION |
| Weekly progress summaries | Partial | MODIFY | P2 | POST-MVP |
| Goal progress dashboard | Partial | MODIFY | P1 | MVP ESSENTIAL |
| Exercise demonstration references | Missing | POSTPONE | P3 | FUTURE EXPANSION |
| Notification and reminder preferences | Missing | MERGE | P2 | POST-MVP |

### Bodyweight and measurement trends

**Recommendation: MODIFY** · Priority: P1 · Tier: MVP ESSENTIAL for weight; measurements POST-MVP

**Rationale:** Weight history is the largest gap in the core product, and is covered by the body-weight record above. Waist and other measurements are a reasonable later step, but don't need to be in the first version.

| | |
|---|---|
| Existing functionality | **Verified, missing:** `Profile.currentWeightKg` is one overwritten value. No measurement field exists anywhere. `ARCHITECTURE.md` plans a `BodyMetric` table |
| Actual user value | High for weight, as it's the outcome many goals are about (Assumption). Measurements help when weight stalls (Assumption) |
| Proposed solution | One table with a `kind` column, as already planned, so measurements later need no second table. The first release offers weight only |
| Simpler alternative | Weight only, which is what's recommended |
| Implementation complexity | M for weight. S to add measurements later |
| Dependencies | Decision on how it relates to `currentWeightKg` |
| Privacy and security | Sensitive body data: per-user isolation, included in export and deletion, kept out of notifications and logs |
| Risks | Frequent weighing can distress some people, so it stays optional, with neutral wording |

### Workout history comparison

**Recommendation: POSTPONE** · Priority: P3 · Tier: FUTURE EXPANSION

**Rationale:** Most of this exists. Choosing any two sessions side by side adds a screen for a need nobody has reported yet.

| | |
|---|---|
| Existing functionality | **Verified, built:** `workouts/history/[id]/page.tsx` compares each exercise with the previous session using `compareToPrevious`. `progress/[exerciseId]/page.tsx` lists every session with its status. The logger shows previous performance per set |
| Actual user value | Comparing consecutive sessions is high, and already delivered. Comparing arbitrary sessions is low (Assumption) |
| Proposed solution | Nothing now. Reporting periods cover longer views |
| Simpler alternative | The existing session list, opened one at a time |
| Implementation complexity | M for a two-session picker and view |
| Dependencies | None |
| Privacy and security | None new |
| What would change this decision | Beta users asking for it |

### Exercise substitutions

**Recommendation: MODIFY** · Priority: P2 · Tier: POST-MVP

**Rationale:** Machines being taken is an everyday gym problem. It already works in a clumsy way, so make it one action. Don't let the app claim that two exercises are equivalent.

| | |
|---|---|
| Existing functionality | **Verified, partial:** `workout-logger.tsx` can add and remove exercises during a session, and new ones load their own previous performance. There's no swap action, so a replacement goes to the end of the list. No substitution data exists. `Exercise` has `primaryMuscle` and `equipment` |
| Actual user value | Fewer steps at a busy gym (Assumption) |
| Proposed solution | A "Swap" action in the logger: it keeps the position, and opens the picker listing the same primary muscle first. It asks before discarding logged sets, and doesn't change the plan. Each exercise keeps its own history and PRs |
| Simpler alternative | Remove and add, which works today |
| Risks | Implying equivalence or safety. The wording is "same muscle group", not "alternative for you". Curated substitution lists would be expert content, and aren't proposed |
| Implementation complexity | S to M, with no schema change expected |
| Dependencies | None |
| Privacy and security | None new |

### Workout personal records

**Recommendation: MERGE** · Priority: None · Tier: Already exists

**Rationale:** Already built and well tested. **Nothing to build.** Show them in the weekly summary, using the same function.

| | |
|---|---|
| Existing functionality | **Verified, built:** `computeRecords` in `overload.ts` covers heaviest weight, best est. 1RM, most reps and best session volume, strictly beating earlier sessions. Shown on the exercise page, session page and dashboard |
| Actual user value | High, and already delivered |
| Proposed solution | Reuse `computeRecords` in the weekly summary, with no second PR calculation |
| Implementation complexity | None for the feature |
| Dependencies | Weekly progress summaries |
| Privacy and security | None new |

### Scheduled progress check-ins

**Recommendation: MERGE** into weekly summaries and the reminder system · Priority: P2 · Tier: POST-MVP

**Rationale:** A check-in is a review of progress at a regular time. The weekly summary is the review, and a reminder is the regular time. A separate feature would duplicate both.

| | |
|---|---|
| Existing functionality | **Verified, missing:** no check-in concept, and no notifications |
| Actual user value | Possibly better consistency (Assumption) |
| Proposed solution | A weekly summary, plus an optional reminder pointing to it. Questionnaires aren't included |
| Simpler alternative | A recurring calendar entry from the calendar file |
| Implementation complexity | S once both parts exist |
| Dependencies | Weekly summary, reminder system, body-weight log |
| Privacy and security | Reminder text stays generic on a locked screen |

### Trainer-client permission management

**Recommendation: MERGE** into Initiative T, as its first design task · Priority: P3 · Tier: FUTURE EXPANSION

**Rationale:** It's meaningless without trainers, but it's the part that makes trainers safe, so it comes first when the initiative starts. It shouldn't be built ahead of need, as guessing at a permission model now would add complexity that nothing uses.

| | |
|---|---|
| Existing functionality | **Verified, missing:** access is by `userId` only, and there's no sharing of any kind |
| Actual user value | Essential if trainers exist, none otherwise |
| Proposed solution | The client grants access by category (workouts, nutrition, body data), can revoke it at any time with immediate effect, and can see an access log. Read-only by default |
| Simpler alternative | Data export while demand is unproven |
| Implementation complexity | XL, due to authorization across every data route |
| Dependencies | Initiative T's demand gate. Verified email and notifications |
| Privacy and security | The main control for health-adjacent data sharing. Needs legal review, and a test for every route and permission combination |

### Weekly progress summaries

**Recommendation: MODIFY** · Priority: P2 · Tier: POST-MVP, early

**Rationale:** The numbers already exist on separate screens. The value is in one place that answers "how was my week?", and that needs little new logic.

| | |
|---|---|
| Existing functionality | **Verified, partial:** `getWeekStats` powers "This week" on the dashboard: workouts, sets, volume, time. `nutrition/history` gives weekly averages and days logged. PRs appear on the dashboard. Nothing combines them, and there's no email |
| Actual user value | One view of the week (Assumption) |
| Proposed solution | A view that reuses `getWeekStats`, `summarizePeriod`, `computeRecords` and the weight trend. Facts only, stating how many days were logged |
| Simpler alternative | Link the existing screens from the dashboard |
| Risks | Averages over few logged days mislead, so the count must be shown. No AI-written narrative. Email would need its own review, as it sends body data outside the app |
| Implementation complexity | S to M, with no schema change expected |
| Dependencies | Body-weight log for the weight line, which can be omitted until then |
| Privacy and security | None new while it stays in the app |

### Goal progress dashboard

**Recommendation: MODIFY** · Priority: P1 · Tier: MVP ESSENTIAL

**Rationale:** Monitoring progress toward a goal is the product's stated purpose, and it isn't shown today. **Add a card to the existing dashboard, not a new dashboard.**

| | |
|---|---|
| Existing functionality | **Verified, partial:** `Profile` stores `goal` and `goalWeightKg`, which are only used for target suggestions. The dashboard shows the week's workouts and PRs. `/nutrition` shows progress against daily targets. Nothing compares someone's state with their goal |
| Actual user value | High: it answers the question the product exists to answer (Assumption) |
| Proposed solution | One card that depends on the goal. Fat loss or muscle gain: trend weight against goal weight. Strength: recent PRs. Maintenance: distance from the starting weight. **No predicted completion dates,** as they'd claim more than the data supports |
| Simpler alternative | Start with the weight goals only |
| Risks | Goal language around weight must stay neutral. Muscle gain isn't the same as weight gain, and the card must not imply it |
| Implementation complexity | S to M after the weight log |
| Dependencies | Body-weight log |
| Privacy and security | None new |

### Exercise demonstration references

**Recommendation: POSTPONE** · Priority: P3 · Tier: FUTURE EXPANSION

**Rationale:** Useful to beginners, but it's a content product. Someone has to choose it, check that it's safe, and keep it working for 47 exercises and more. Custom exercises can't have it at all. People can also search for a video themselves.

| | |
|---|---|
| Existing functionality | **Verified, missing:** `Exercise` has only name, muscle and equipment |
| Actual user value | Moderate for beginners (Assumption). The current audience isn't known to be beginners |
| Proposed solution | When reopened: short reviewed text cues, or plain outbound links. **No embedded third-party video,** which would share viewing data with that third party |
| Simpler alternative | A "Search for this exercise" link, which needs no curated content |
| Risks | Wrong technique advice, and links that break or change. Self-hosted video is a storage and licensing cost |
| Implementation complexity | S to add a field. The content is the real cost |
| Maintenance cost | Medium: someone must own it |
| Dependencies | A qualified person to review content |
| Privacy and security | Outbound links only, with no tracking embeds |
| What would change this decision | Beta users being beginners who get stuck at technique |

### Notification and reminder preferences

**Recommendation: MERGE** into the reminder system · Priority: P2 · Tier: POST-MVP

**Rationale:** Preferences for notifications that don't exist have nothing to control. They ship together, and it's not a separate feature.

| | |
|---|---|
| Existing functionality | **Verified, missing:** no notifications, preferences or background jobs |
| Actual user value | High once reminders exist, since control is what makes them tolerable (Assumption) |
| Proposed solution | Per-type on or off, a time, off by default. Security emails, such as password reset, aren't optional and are separate |
| Simpler alternative | One global on or off for the first version |
| Implementation complexity | S alongside reminders |
| Dependencies | Reminder system |
| Privacy and security | Settings and push subscriptions are personal data, included in export and deletion. Notification text stays generic |
