# Project status

**Canonical: the current state.** Last verified on 2026-11-09, by a documentation audit, against the code and git. Overview: [PROJECT_MASTER.md](PROJECT_MASTER.md). Every record: [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md).

## Where the code is

| | Commit | Notes |
|---|---|---|
| `main` | `5434f90` (2026-11-06) | Ends at Phase 4.0.4. One pull request ever: #1 (Phase 1), merged. No issues are open. |
| **Release candidate** `feature/multi-gym-exercise-alternatives` | Application code at **`939800f`**: the walkthrough defect fixes ([RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md) Part 12), IMG-01 (the plan-image import), then UI-01 and IM-02 (workout programs, the import review), UI-02 (Progress views), UI-03 to UI-08 (the active program, weekly schedule, management, nutrition dates), then the owner acceptance fixes UI-03, UI-05 and UI-09 (`25ef753`, `a842cc9`), and round 3: UI-06B, UI-05B, UI-05C, UI-10, GYM-01, UI-11, UI-12 (`939800f`, no migration): see [BUG_TRACKER.md](BUG_TRACKER.md). `bd86e47` adds migration MIG-PROG, `73ea754` adds MIG-ACTIVE | 150+ commits ahead of `main`. It contains every phase branch from 3.x to the cloud stack (verified with `git merge-base --is-ancestor`). The exceptions are `feature/ten-user-qa-fixtures` (3 unique commits: 10 QA accounts and a browser test) and `phase-2.5-review` (a review diff only) |
| Not merged to `main` | Phase 4.0.5, 4.1, 4.0.6, UX-01, release completion, beta capabilities, multi-gym, the deployment stack | Merging is a separate owner approval ([RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md) Part 11.5 B6) |
| Deployed | **Nothing** | No server, domain, email account or cloud database exists |
| Owner accepted | **Nothing** | Many owner approvals are recorded ([DECISION_REGISTER.md](DECISION_REGISTER.md) §1); no owner acceptance of any delivered work is recorded |

## Release verdict

**READY FOR STAGING DEPLOYMENT, NOT READY for an invited beta** (the verdict at the top of [RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md); Parts 11 and 12 have the evidence).

**What supports it:**
- The staging rehearsal: 108 of 108 checks passed in CI on a disposable Linux machine, from an empty database through HTTPS, the user journey, backup and restore, and an automatic rollback ([run 42648848569](https://github.com/aseelalmanahy/FitWorkoutFoodTracker/actions/runs/42648848569), `cb346ff`).
- At `cb346ff`: G1 17 of 17 on Linux; 56 of 56 guarded suites in three browsers; 2,325 unit tests; type check clean; `npm audit` 0.
- A hands-on walkthrough of the running app on 2026-11-09 (`d7d278d`, a throwaway database, live USDA and Open Food Facts, no paid AI): 11 of 11 user journeys passed; 49 of 67 features verified in the running UI, none failed; 9 new defects, two of them Medium (WT-01, WT-02). [APP_FEATURE_TEST_REPORT.md](APP_FEATURE_TEST_REPORT.md). All but WT-07 (not reproduced, monitored) are fixed at `cb346ff`.

## Blockers

**Staging** (all the owner's purchases or approvals; [RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md) 11.5 A):
1. A domain (a free temporary address can't reliably get a certificate).
2. A Hetzner account and a CX23 server in Nuremberg (nbg1). Hetzner's pages showed every plan as "currently unavailable" on 2026-11-09; if CX23 can't be created, CPX22 (€19.99/month) is the x86 fallback (RELEASE_ACCEPTANCE 12.3).
3. DNS records.
4. Approval of MIG-FB, MIG-GYM, MIG-PROG (workout programs) and MIG-ACTIVE (the active program), all additive, for the cloud databases.
5. A backup key pair: the owner keeps the private key and gives the public key.

**Invited beta** (11.5 B and Part 4):
- production (CX33, Object Storage);
- real email (Resend, plus a verified domain);
- the final privacy notice after legal review (NOTICE-B, R-01). Real registration stays closed until then, by design;
- real iPhone and Android testing (E1, R-13);
- owner acceptance of UX-01, GYM-ACCEPT and Phase 4 (U-04);
- the security sign-off;
- the merge to `main`;
- the clinical and legal items R-02, R-03, R-06 and R-12 ([DECISION_REGISTER.md](DECISION_REGISTER.md) §5).

## Environments (ENV-01, owner directive 2026-11-09)

Two permanent environments only. Temporary databases are for automated tests, never a third environment.

| Environment | Database | State |
|---|---|---|
| **LOWER**: development, testing, demonstrations | `fitdb_test`, on the owner's PC | **12 migrations** (MIG-PROG and MIG-ACTIVE applied 2026-11-09, each with the owner's approval, a fresh backup and every existing row unchanged against a fingerprint; latest backup `fitdb_test-pre-mig-active-apply-20261109T205108Z.dump`). Synthetic accounts plus the one demo account, `fitworkoutfoodtracker-demo@test.dev` |
| **PRODUCTION**: real users only | A separate cloud PostgreSQL, with its own credentials, backups and security | **Doesn't exist yet** (blockers above) |

- **One local application: http://localhost:3400**, started with `npm run local` from `FitWorkoutFoodTracker-programs` ([MANUAL_UI_TESTING_GUIDE.md](MANUAL_UI_TESTING_GUIDE.md)). It refuses a stale build, a migration mismatch or a missing demo account, and never migrates or seeds. Live USDA and Open Food Facts; paid AI off. Bound to 127.0.0.1 only (A1).
- **Retired, not deleted:** the servers on 3000–3003, 3401 and 3402 were stopped on 2026-11-09. Their folders stay, and so do these databases, which are no longer environments: `fitdb` (development, 4 migrations), `fitdb_review` (**real**: the owner's 3 review accounts, 8 migrations; MIG-FB, MIG-GYM, MIG-PROG and MIG-ACTIVE not applied). The throwaway test cluster (port 55434) holds the automated-test databases.
- **Network:** the firewall rules are closed (A2), and PostgreSQL listens on loopback only (A3).
- **Not set up:** private phone access. **Tailscale isn't installed** on the PC (checked 2026-11-09).

## Immediate next steps (in order)

1. **Owner:** buy the domain and the staging server, and approve the migrations for the cloud ([RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md) 11.5 A1–A6).
2. **Claude, after step 1:** record the approval, re-run the staging rehearsal, publish the images, and give the exact server commands (A7–A8).
3. **Owner:** test on real phones against staging, then run the UX-01 and GYM-ACCEPT checklists (A9; [MANUAL_UI_TESTING_GUIDE.md](MANUAL_UI_TESTING_GUIDE.md)).
4. **Owner:** start the legal review of the draft notice (NOTICE-B), with the open decisions it needs ([DECISION_REGISTER.md](DECISION_REGISTER.md) §2).
5. **Claude, recommended:** add the unit tests and the type check to CI. Today **no workflow runs them**; they run only on the owner's PC ([DECISION_REGISTER.md](DECISION_REGISTER.md) TD-CI).
