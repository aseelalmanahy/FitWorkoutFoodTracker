# Decision and risk register

**Canonical: one place to see every decision, open question, rejection, deferral, risk, defect, debt item, blocker and external dependency.**
- Consolidated on 2026-11-09 from the sources named in each row.
- It doesn't replace them: they keep the reasoning and the full history.
- **An entry is an owner decision only where its source records the owner's own statement.** Everything else is a recommendation.

**Abbreviations used as sources:**

| Short | File |
|---|---|
| FD | [FEATURE_DECISIONS.md](FEATURE_DECISIONS.md) |
| PS | [PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md) |
| PD | [PHASE_4_0_DESIGN.md](PHASE_4_0_DESIGN.md) |
| TR | [PROJECT_COMPLETION_TRACKER.md](PROJECT_COMPLETION_TRACKER.md) |
| RA | [RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md) |
| EP | [PHASE_4_EXECUTION_PLAN.md](PHASE_4_EXECUTION_PLAN.md) |
| BP | [BETA_PLAN.md](BETA_PLAN.md) |

Each is followed by a line number, as in `TR:487`.

**Two "Decision N" numbering schemes exist, and they collide.** This register always prefixes them:
- **PS-Qn** are PRODUCT_STRATEGY's twelve open product questions (PS:496–512).
- **PD-Dn** are PHASE_4_0_DESIGN's thirty design decisions (PD:665–694).

So "Decision 8" in FD:416 and EP means PD-D8 (link-first registration), not PS-Q8 (weight log versus current weight).

## 1. Approved owner decisions

| ID | Decision | Date | Source | Note |
|---|---|---|---|---|
| OD-01 | PD-D8: link-first registration with an invitation allowlist | 2026-11-06 | PD:672, FD:416 | Built in 4.0.4 |
| OD-02 | PD-D10: emailed recovery is required | 2026-11-06 | PD:674 | Built in 4.0.4; real email is still C1/C2 |
| OD-03 | PD-D11: onboarding separate from registration | 2026-11-06 | PD:675 | Built |
| OD-04 | Merges to `main` of 4.0.1b (`38c4a37`), 4.0.1c (`899e54c`), 4.0.2 (`b79331d`), 4.0.3 (`de4607f`) and 4.0.4 (`eaeff34`) | 2026-11-06 | TR:44, 57, 102, 130, 145 | `eaeff34` after an independent ChatGPT review |
| OD-05 | Migrations on `fitdb_test` only: MIG-01/02, MIG-03, MIG-04 | 2026-11-06/07 | TR:56, 152, 214 | |
| OD-06 | Phase 4.0.5 local development, with O1–O6 | 2026-11-06 | PHASE_4_0_5_PLAN.md:13–20 | |
| OD-07 | `integration/phase-4` as a written exception (4.0.5, 4.1 and 4.0.6 together) | 2026-11-07 | TR:243 | **Not** a merge to `main` (PHASE_4_MERGE_READINESS.md:19) |
| OD-08 | **UX-01** approved for implementation: food-search reliability, responsive layouts, the redesign, login and welcome, notes; no schema change. Slate & Mist chosen | 2026-11-07 | FD:389, TR:288 | Built; acceptance pending (UX-01U) |
| OD-09 | The owner's vision backlog is kept, "not approved". GPS and followers stay open future decisions, against the recommendation to reject them | 2026-11-07 | FD:391, TR:299–307 | See §2 and §4 |
| OD-10 | **Beta capabilities, phases 1–5** approved: PWA, camera barcode, plan import, package photo, in-app feedback (plus docs phases 6 and 8) | 2026-11-08 | BP:3, TR:438 | Built ahead of Phase 4.2. **Not recorded in FD or PS** (DOC-01) |
| OD-11 | **Multi-gym, machine contexts and exercise alternatives** approved | 2026-11-08 | TR:487 | Built. FD:208–210 still says POSTPONE (DOC-01) |
| OD-12 | A1 "Proceed with A1 only"; A2 and A3 run by the owner | 2026-11-08 | RA:112, 149, 185 | Complete |
| OD-13 | No further Windows changes. The unencrypted C: drive is an accepted local limitation, **not** approval for new unencrypted copies of real data. Starting Docker Desktop counted as the G1 approval | 2026-11-08 | RA:692–697 | |
| OD-14 | "B2, B1b and MIG-FB + MIG-GYM on fitdb_test approved; B2's transient copy accepted." | 2026-11-09 | RA:982 | Done (RA Part 10) |
| OD-15 | Production and staging are built in the cloud. Local A4 and `fitdb_review`'s migrations are **not** prerequisites for them | 2026-11-09 | RA:1124–1127 | |
| OD-16 | Tooling (agents, router, orchestrator) frozen unless application work needs a change | 2026-11-06 | TR:1032, EP:30 | |
| OD-17 | K-04: the provisional direction is that finished workouts can't be changed | 2026-11-07 | TR:236 | Provisional, and **not built** |

## 2. Open owner decisions

| ID | Question | Recommendation (not a decision) | Priority | Source | Blocks |
|---|---|---|---|---|---|
| PS-Q1 / PD-D1 | Minimum age | 18 (built), subject to legal review | P0 | PS:500, PD:665 | NOTICE-B |
| PS-Q2 | Countries for the beta and launch | — | P0 | PS:501 | legal review, residency |
| PS-Q3 / PD-D5 | Host, database, monthly ceiling | Hetzner, option A: CX23 for staging, CX33 for production | P0 | PS:502, RA 11.5 | staging |
| PS-Q4 / PD-D4 | Product name and domain | Working name FitWorkoutFoodTracker; FitBunny deferred | P0 for the domain | PS:503, TR:498 | domain, branding |
| PS-Q5 | Is this a business: free, paid or personal? | — | P2 | PS:504 | monetization |
| PS-Q6 | What "shared account" meant | Sharing one account rejected; multi-device works | P3 | PS:505, FD:278 | — |
| PS-Q7 | Is the trainer platform central? | Postpone (Initiative T) | P2 | PS:506 | Initiative T |
| PS-Q8 / J-06 | Weight log versus the profile's `currentWeightKg` | — | P1 | PS:507, TR:219 | — |
| PS-Q9 | AI acceptance thresholds | Agree them before Track A | P2 | PS:508 | Track A |
| PS-Q10 | Is paid AI wanted at all? | "Don't activate" is acceptable | P2 | PS:509 | Track A |
| PS-Q11 | Who owns exercise and safety content? | A qualified reviewer | P2 | PS:510 | exercise demonstrations |
| PS-Q12 | Project-wide secret deny rules | — | P3 | PS:511 | — |
| PD-D2, D3, D12–D14, D16–D18 | The remaining design decisions, among them PD-D12 (backup retention, 14 days proposed), PD-D14 (who may read production data) and PD-D16 (support contact) | see PD:665–694 | P0–P1 | TR:943 (D-03) | NOTICE-B, production |
| PD-D29 | Attempt limit | Deferred to legal advice | P1 | TR:944 (D-04) | — |
| J-04 | Is a goal required? | Built as optional | P2 | TR:217 | — |
| J-05 | Trend smoothing method and minimum evidence | Must not change silently | P2 | TR:218 | — |
| K-04 | Can a finished workout be changed? | Provisional: no (OD-17) | Low | TR:236, RA:87 | — |
| F1 | Accept the USDA "bread" ranking limit (RC-01) | Accept | P3 | TR:427 | — |
| G2 | Hosting, RPO 24 h, RTO 4 h, retention, encryption keys | as recommended in BETA_HOSTING.md | P0 | RA:604, 11.5 | staging and production |
| MIG-CLOUD | MIG-FB and MIG-GYM for the cloud databases. `approved-migrations.json` is shared, so this also allows `fitdb_review` if someone runs it | — | P0 | RA 11.5 A5 | staging |
| MIG-REVIEW | MIG-FB and MIG-GYM on `fitdb_review` | — | P2 (not a cloud prerequisite, OD-15) | RA Part 2 | review env |
| A4 | Local database role isolation | — | P3 (not a cloud prerequisite) | RA:234 | — |
| BUNNY | `BUNNY_AGENT_DESIGN.md`: untracked in the main worktree, **never read** by instruction | The owner says if it should be read | — | SESSION_HANDOFF.md:19, TR:1036 | — |
| BRAND | Final name, logo, icons. The icons are temporary | Settle the name first | P2 | FD:367–385, TR:570 | store listing, polish |
| ACCEPT | UX-01, GYM-ACCEPT, U-04 (Phase 4), E1 results, the security sign-off, NOTICE-B wording, the merge, deployment | — | P0 | RA Parts 2–4, 11.5 | invited beta |

## 3. Rejected proposals (recommendations to reject; not revived)

| ID | Proposal | Source | Status |
|---|---|---|---|
| RJ-01 | Personalized health or training advice | FD:126 | Rejected |
| RJ-02 | Trainer marketplace and payments ("for now") | FD:189 | Rejected for now |
| RJ-03 | AI equipment identification | FD:235 | Rejected |
| RJ-04 | Daily motivational quotes | FD:349–351 | Rejected; the owner may overrule (FD:365) |
| RJ-05 | Sharing one account between people | FD:278–282 | Rejected; multi-device works |
| RJ-06 | Calories invented by AI from a photo | CLAUDE.md principles; PHASE_3_DESIGN.md | Rejected by principle; the code never does it |
| RJ-07 | GPS routes; followers and photo sharing | TR:305–306 | Recommended REJECT, but **the owner kept them open** (OD-09). So: open, not rejected |

## 4. Deferred features (POSTPONE)

| ID | Feature | Priority | Reopens when | Source |
|---|---|---|---|---|
| DF-01 | Initiative T, the personal-trainer platform (T0–T5) | P3 | trainers commit to a pilot, or clients keep exporting for trainers | FD:147–151, PS:331–382 |
| DF-02 | Public trainer discovery; trainer photo | — | after T | FD:187–188 |
| DF-03 | Activity calorie estimates | P3 | user demand | FD:75–94 |
| DF-04 | Offline logging | P2 | after beta; idempotent sets exist | FD:504–520 |
| DF-05 | Track A, paid AI activation | P2 | PS-Q9, PS-Q10, a spending limit, the notice | FD:544–546, PS:303–313 |
| DF-06 | AI fitness assistant | P3 | — | FD:557–566 |
| DF-07 | Progress photos | P3 | storage, encryption, deletion including backups | FD:568–576 |
| DF-08 | Adaptive calorie targets | P2 | weight-log data; a suggestion the person accepts | FD:590–599 |
| DF-09 | History comparison additions | — | — | FD:635–637 |
| DF-10 | Exercise demonstrations (outbound links only) | P3 | a qualified reviewer (PS-Q11) | FD:750–767 |
| DF-11 | Native or store apps (no native rewrite) | P3 | after real-phone testing | FD:259–276 |
| DF-12 | Front-of-pack scan | — | **Partly superseded**: package-photo identification was built (OD-10) | FD:297–299 |
| DF-13 | Private equipment photos | P3 | — | FD:236 |
| DF-14 | General exercise education | P3 | — | FD:125 |
| DF-15 | Streamed export (EXP-02), to lift the 50,000-row limit | before the beta grows | an account nears the limit | RA:757 |

## 5. Release blockers

| ID | Blocker | Priority | Status | Source | Resolved when |
|---|---|---|---|---|---|
| BL-STG | Staging purchases and approvals (domain, CX23, DNS, MIG-CLOUD, backup key) | P0 | Open, owner | RA 11.5 A | staging deployed and smoke passes there |
| R-01 | Legal review | P0 | Open, blocked | TR:951 | dated advice answers Annex H7 |
| NOTICE-B / H-02 | Final privacy notice; registration stays closed until then | P0 | Open | RA:369, TR:209 | `noticeIsFinal()` true, with a dated review |
| H-03, H-04 | Retention deletion; re-acceptance after a change | P0, P1 | Open | TR:210–212 | legal answers |
| R-02 | Clinical review | P0 | Open | TR:952 | a written review, or a signed gap |
| R-03 | Low-target safeguard (800 kcal accepted without a warning) | P0 | Open | TR:953 | a reviewed threshold and source; none invented |
| R-06 | Retention rule | P0 | Open | TR:956 | the rule in the notice, and applied |
| R-12 | Eating-concern help resource | P0 | Open | TR:962 | reviewed and reachable |
| R-13 / E1 | Real iPhone and Android | P0 | Open | TR:963, RA 7.6 | a pass or fail per flow, on both phones |
| C1/C2, G-03, R-10 | Real email | P0 | Open, external | TR:153, RA:397 | a domain, Resend, G.1–G.6 in a real inbox |
| S-14 | A restore could bring deleted accounts back | P0 | Design only | TR:983 | the deletion ledger built, and a real restore test |
| R-08 | Production starts empty: untested on a real server | P0 | Rehearsed in CI only | TR:958, RA 11.3 | counts recorded on production |
| R-09 | Closed registration on a deployed server | P0 | Built; seen in CI only | TR:959 | observed on staging |
| G3–G7 | Staging, HTTPS on the domain, backups, monitoring, invited rollout | P0 | Prepared and rehearsed, not run | RA Part 2, 11.5 | each gate's checks on the real servers |
| SIGNOFF | Security sign-off | P0 | Open, owner | RA Part 4 | a dated written sign-off |
| MERGE | Merge to `main` | P0 | Open, owner | PHASE_4_MERGE_READINESS.md:19 | the owner's approval |

## 6. Security risks and limitations (accepted or open)

| ID | Risk | Severity | Status | Source | Next action |
|---|---|---|---|---|---|
| S-02, S-17, S-23 | Rate limits and throttles are in memory, per process, and reset on restart | Medium | Accepted for one instance | TR:971–998 | one instance only; revisit before scaling |
| S-04 | Age is declared, not verified | Medium | Accepted | TR | legal review |
| S-22 | No purge job for expired sessions | Low | Open | TR | add with retention (R-06) |
| S-26, S-28 | The draft-notice gate could be opened by misconfiguring a test server | Low | Open (limit) | TR | never expose a test server |
| S-27 | One check enforced in the browser only | Low | Open | TR | per the tracker row |
| SR-LOW-1 | Database TLS isn't authenticated (snakeoil certificate, `sslmode=require`) | Low | Accepted (internal network only) | RA 11.2 | a per-server certificate and `verify-full` |
| SR-LOW-2 | The deploy user is root-equivalent (docker group) | Low | Accepted | RA 11.2 | key-only SSH, from the owner's IP |
| SR-LOW-3 | Role passwords in the database container's environment | Low | Accepted | RA 11.2 | — |
| SR-LOW-4 | A restored copy lets `fit_app` write the migration history until the migrate step runs | Low | Accepted, documented | RA 11.2 | run the migrate step after a restore |
| OPS-1 | Anyone who can run the migrate image with another command can call Prisma | Info | Open | RA:88 | G3 access controls |
| OPS-2 | The remembered next-gym ID is cleared only on sign-out | Info | Open | RA:89 | — |
| I-1, I-2 | Look-alike names and invisible tag characters in names (per person only) | Info | Open | RA:83–84 | fixes listed in RA |
| SEC-ACL | The local backup folder: access fixed; the drive is unencrypted | Medium | Fixed; encryption accepted locally (OD-13) | RA:96 | none locally |
| AI-OFF | Paid AI exists in the code, but the production preflight refuses it | — | By design | `production-config.ts` | Track A |

## 7. Known defects

| ID | Defect | Severity | Status | Source | Next action |
|---|---|---|---|---|---|
| R1 | Saving and deleting the same plan at once can deadlock (ends as a 503, nothing changed) | Low | Open | RA:82 | lock the plan row before `deleteMany` |
| I-3 | A theoretical lock cycle (would end as a 503) | Info | Accepted | RA:85 | — |
| FM-1 | Food-photo de-duplication can hide a person's own identical food | Low | Open | RA:86 | optional follow-up |
| K-04 | A finished workout can be edited from a page left open | Low | Open; owner decision | RA:87 | decide (OD-17), then build |
| K-06, K-07, K-08 | Theoretical deadlocks; pool size | P3, P3, P2 | Open | TR:238, 258–259 | set the pool size at deployment (`connection_limit=10` is in the template) |
| J-07 | A null byte in an ID gives a 500 | P3 | Open | TR:218 | — |
| RC-01 | USDA "bread" ranking | P3 | Open (F1) | TR:360 | owner accepts (F1) |
| RC-03 | On-server label reading fills few values (5 of 174 read, 0 wrong) | P2 | Open | TR:336, 361 | D0–D2 evaluation |
| RC-05 | The meal model names one dish | P3 | Open | TR:362 | — |
| WK-RSC-1 | WebKit logs Next.js RSC fallbacks in `demo-account-e2e` | Low | Open, cause unknown | RA:1112–1115 | re-check if it recurs |
| T-25, T-27 | One-off `e2e-smoke` failures, cause unknown | P1 | Open; T-27 accepted for integration only | TR:911, 914 | resolve or accept before the beta |
| RC-08 | Proxy connection failures in tests | P2 | Test-only, monitored | TR:365, RA:504 | keep monitoring |
| WT-01 | During a workout, the Add exercise search cleared itself (the picker reset on every re-render) | Medium | **Fixed** in `cb346ff`; e2e in 3 engines | [RA Part 12](RELEASE_ACCEPTANCE.md) | — |
| WT-02 | Large USDA records timed out (USDA ~8 s on a cold record; the limit was 8 s) | Medium | **Fixed** in `cb346ff`: a bounded 15 s limit for one record (searches keep 8 s), and only the nutrients used are requested; verified live | [RA Part 12](RELEASE_ACCEPTANCE.md) | — |
| WT-03 | The Progress list showed "0 sessions" for machine-only exercises | Low | **Fixed** in `cb346ff` | [RA Part 12](RELEASE_ACCEPTANCE.md) | — |
| WT-04 | A swapped-in exercise inherited the replaced exercise's target weight | Low | **Fixed** in `cb346ff` | [RA Part 12](RELEASE_ACCEPTANCE.md) | — |
| WT-05 | A raw USDA portion code shown as a serving name | Low | **Fixed** in `cb346ff` for records fetched from then on; old cached records in local databases keep theirs | [RA Part 12](RELEASE_ACCEPTANCE.md) | — |
| WT-06 | A late camera failure replaced a typed-barcode message | Low | **Fixed** in `cb346ff` | [RA Part 12](RELEASE_ACCEPTANCE.md) | — |
| WT-07 | A React hydration error (#418) once on the workout page | Low | **Not reproduced; monitored**. The clock hypothesis was tested and ruled out | [RA Part 12](RELEASE_ACCEPTANCE.md) | re-check if it recurs |
| WT-08 | Repeated controls or rows | Cosmetic | **Fixed** in `cb346ff` (Log out, Close, Recent PRs); a possibly duplicate package candidate is left | [RA Part 12](RELEASE_ACCEPTANCE.md) | — |
| WT-09 | Unlabelled create-exercise selects; the muscle defaulted to Chest | Low | **Fixed** in `cb346ff` | [RA Part 12](RELEASE_ACCEPTANCE.md) | — |
| IMG-01 | A real plan image (399 px wide, three-day table) gave "No exercises with sets and repetitions were found": read at its own size (text ~7 px), and the parser couldn't split a table row's day, name and sets | **High** (found by the owner) | **Fixed** in `2411496` and `7fec302`: small images enlarged in one lossless pass; OCR rows split at column gaps; a row missing its reps re-read at 1600 px and filled only where both readings agree; a review step to add an unread line or split a day. Through the app: 3 days, 18 of 18 rows, all 3 x 8-12; 12 matched for certain, 6 offered with the right exercise first. Unit, real-recognizer, and browser tests in 3 engines; G1 and the rehearsal (108/108) passed | commits `2411496`, `7fec302` | owner to retest at the review URL |
| UI-01 | Imported days were saved as unrelated plans ("Program – Day"), mixed with individual plans, and scheduled whenever the file named a weekday | **High** (found by the owner) | **Fixed** in `bd86e47`: programs (MIG-PROG, additive), one program per import, scheduling only when ticked with the proposed days shown, a reorganized Workouts page, manual grouping for older plans. Not yet on `fitdb_test`: MIG-PROG needs the owner's approval there | [BUG_TRACKER.md](BUG_TRACKER.md) | owner review |
| IM-02 | A text import saved exercises not in the file | **High** (found by the owner) | **Fixed** in `bd86e47`: reproduced as the manual choice step (parsing and matching were right); added Skip, per-exercise status and a choices summary before Save; timed sets no longer read as reps. The demo account's three plans from that import are left as they are, for the owner | [BUG_TRACKER.md](BUG_TRACKER.md) | owner review |

**Closed defects, kept here for history:**
- EXP-01: a large export crashed the app (High). Fixed and verified on Linux.
- DEP-01: no built-in exercises on a fresh database (High).
- DEP-02: the CUDA download broke builds.
- DEP-03: a working rollback was reported as failed.
- SR-1..SR-4: the security review's four mediums.
- M-WK-1: a race in the meal suite (a test defect).
- QA-05: resolved by `d6f94f3`; B1b passed.
- A3-PS7, RC-06 (the image is now built), RC-07, RC-09, RC-10, RC-11, F-11 (`npm audit` 0).
- The seven review findings (RA Part 1).

All are in RA Parts 1, 8–11.

## 8. Technical debt

| ID | Debt | Priority | Source | Next action |
|---|---|---|---|---|
| TD-CI | **No CI workflow runs the unit tests, the type check or the guarded browser suites.** They run only on the owner's PC | P1 | `.github/workflows/` (g1, release-image, staging-rehearsal only) | add a test workflow with stubbed providers |
| TD-ESLINT | `npm run lint` is only `tsc --noEmit`; there's no ESLint | P3 | `package.json` | decide whether ESLint is wanted |
| TD-06 | README, ARCHITECTURE.md and PHASE_3_DESIGN.md were stale | P3 | TR | **Notes added 2026-11-09**, pointing to the canonical documents |
| TD-07 | PHASE_4_0_0A said "Not merged" | P3 | TR | **Corrected 2026-11-09** |
| TD-CALOR | `Profile.calorieTargetOverride` is unused | P3 | `schema.prisma` | drop it, with a separately approved migration |
| TD-EXPORT | The export is buffered, not streamed (EXP-02) | P2 | RA:757 | DF-15 |
| TD-RPE | `SetEntry.rpe` is stored but has no input | P3 | FEATURE_INVENTORY | product decision (effort ratings, roadmap) |
| B-07, C-08, J-08 | `fitdb` (development) lacks MIG-01..04 | P1 | TR:45, 58, 260 | apply with a backup, or keep development on `fitdb_test` |
| TD-01..TD-16, TOOL-01..04 | Further items as listed in the tracker | mostly P3 | TR:1004–1032 | per row |

## 9. External dependencies

| ID | Dependency | Used for | State |
|---|---|---|---|
| EXT-USDA | USDA FoodData Central (`FDC_API_KEY`, a free key) | generic food search | key not obtained for staging or production |
| EXT-OFF | Open Food Facts (`OFF_CONTACT`) | packaged foods, barcodes | contact address not set |
| EXT-RESEND | Resend (free tier) | sign-up and reset email | no account |
| EXT-HETZNER | Hetzner Cloud and Object Storage | staging and production | no account |
| EXT-DOMAIN | A registrar (~$12/year) | HTTPS, email | not bought |
| EXT-GHCR | GitHub container registry | release images | workflow ready, never run |
| EXT-LE | Let's Encrypt (through Caddy) | certificates | needs the domain |
| EXT-ANTHROPIC | Anthropic | optional label and meal reading (Track A) | refused in production |
| EXT-TAILSCALE | Tailscale | private phone access to local builds | **not installed** on the PC (2026-11-09) |
| EXT-HF / GITHUB-RELEASES | Hugging Face (meal model at build time); GitHub releases (onnxruntime, the CUDA download now skipped) | image build | the model is pinned and SHA-checked |

## 10. Documentation conflicts found (and how they were resolved)

| ID | Conflict | Resolution |
|---|---|---|
| DOC-01 | FD and PS say "nothing is approved", and FD lists multi-gym as POSTPONE, while the owner approved UX-01 (2026-11-07), the beta capabilities and multi-gym (2026-11-08) | This register records them (OD-08, OD-10, OD-11). A note at the top of FD and PS points here. The verdict text is kept as history |
| DOC-02 | Two "Decision N" schemes collide | Prefixes PS-Qn and PD-Dn (above) |
| DOC-03 | PS's roadmap (4.3 after the 4.2 beta) versus BP building PWA, barcode, plan import, package photos and swaps before the beta | ROADMAP.md records them as delivered ahead of plan; 4.3's remaining scope is re-listed |
| DOC-04 | Stale status lines: PHASE_4_0_0A "Not merged"; PHASE_3_DESIGN 3.6 "awaiting review"; PHASE_3_PRODUCTION_READINESS (`npm audit`, no deletion route); ARCHITECTURE.md (BMR/TDEE targets, phases planned, Postgres 16, no email); README (Phases 1–2 only); TR header; SESSION_HANDOFF (2026-11-07 snapshot) | A dated note at the top of each, pointing to the canonical document. The original text is kept |
| DOC-05 | RA header: "candidate at `8c520a0`" and "No migration has been applied to `fitdb_test`", against Part 10 | Header corrected to the current candidate; the migration line notes MIG-FB and MIG-GYM are applied to `fitdb_test` |
| DOC-06 | Memory figures in older documents (1.5 GB, two exports at once, 250,000 rows) | Current: a 2 GB container, the heap at 768 MB, 50,000 rows, one export at a time (RA Part 9). Older figures are kept as history |
| DOC-07 | QA-05, RC-08, T-14 statuses differ between TR and RA | RA Parts 10–11 are latest: QA-05 resolved, B1b passed, RC-08 test-only and monitored |
| DOC-08 | Branding: "Forge" mentioned in PS and FD | The app and emails say FitWorkoutFoodTracker (TR:498, verified in code); the final name is still PS-Q4 |
