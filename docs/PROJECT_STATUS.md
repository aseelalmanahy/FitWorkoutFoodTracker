# Project status

**Canonical: the current state.** Last verified on 2026-11-09, by a documentation audit, against the code and git. Overview: [PROJECT_MASTER.md](PROJECT_MASTER.md). Every record: [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md).

## Where the code is

| | Commit | Notes |
|---|---|---|
| `main` | `5434f90` (2026-11-06) | Ends at Phase 4.0.4. One pull request ever: #1 (Phase 1), merged. No issues are open. |
| **Release candidate** `feature/multi-gym-exercise-alternatives` | Application code at **`d7d278d`**; the documentation commits after it change no code | 150+ commits ahead of `main`. It contains every phase branch from 3.x to the cloud stack (verified with `git merge-base --is-ancestor`). The exceptions are `feature/ten-user-qa-fixtures` (3 unique commits: 10 QA accounts and a browser test) and `phase-2.5-review` (a review diff only) |
| Not merged to `main` | Phase 4.0.5, 4.1, 4.0.6, UX-01, release completion, beta capabilities, multi-gym, the deployment stack | Merging is a separate owner approval ([RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md) Part 11.5 B6) |
| Deployed | **Nothing** | No server, domain, email account or cloud database exists |
| Owner accepted | **Nothing** | Many owner approvals are recorded ([DECISION_REGISTER.md](DECISION_REGISTER.md) §1); no owner acceptance of any delivered work is recorded |

## Release verdict

**READY FOR STAGING DEPLOYMENT, NOT READY for an invited beta** (the verdict at the top of [RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md); its Part 11 has the evidence).

**What supports it:**
- The staging rehearsal: 108 of 108 checks passed in CI on a disposable Linux machine, from an empty database through HTTPS, the user journey, backup and restore, and an automatic rollback ([run 42569013328](https://github.com/aseelalmanahy/FitWorkoutFoodTracker/actions/runs/42569013328), `d7d278d`).
- G1, the production image check: 17 of 17 on Linux (`267a6ea`).
- The last full regression at `caca244`: 56/56 guarded suites, 2,309 unit tests, type check clean, `npm audit` 0. The application code hasn't changed since.
- A hands-on walkthrough of the running app on 2026-11-09 (`d7d278d`, a throwaway database, live USDA and Open Food Facts, no paid AI): 11 of 11 user journeys passed; 49 of 67 features verified in the running UI, none failed; 9 new defects, two of them Medium (WT-01, WT-02). [APP_FEATURE_TEST_REPORT.md](APP_FEATURE_TEST_REPORT.md).

## Blockers

**Staging** (all the owner's purchases or approvals; [RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md) 11.5 A):
1. A domain (a free temporary address can't reliably get a certificate).
2. A Hetzner account and a CX23 server.
3. DNS records.
4. Approval of MIG-FB and MIG-GYM for the cloud databases.
5. A backup key pair: the owner keeps the private key and gives the public key.

**Invited beta** (11.5 B and Part 4):
- production (CX33, Object Storage);
- real email (Resend, plus a verified domain);
- the final privacy notice after legal review (NOTICE-B, R-01). Real registration stays closed until then, by design;
- real iPhone and Android testing (E1, R-13);
- owner acceptance of UX-01, GYM-ACCEPT and Phase 4 (U-04);
- the security sign-off;
- the merge to `main`;
- the clinical and legal items R-02, R-03, R-06 and R-12 ([DECISION_REGISTER.md](DECISION_REGISTER.md) §5);
- recommended before real users, not yet a recorded blocker: fixing WT-01 (exercise search clears itself during a workout) and WT-02 (large USDA records time out) ([DECISION_REGISTER.md](DECISION_REGISTER.md) §7).

## Local environments (the owner's PC; for development and demonstrations only)

| Database | Data | State |
|---|---|---|
| `fitdb` | Development, 1 account on a real domain | 4 migrations (B-07: it lacks MIG-01..04) |
| `fitdb_review` | **Real**: the owner's, 3 accounts | 8 migrations. MIG-FB and MIG-GYM **not** applied (a separate approval). Backup restore verified (B2) |
| `fitdb_test` | Synthetic (5,698 accounts), plus the demo account | **10 migrations** (MIG-FB and MIG-GYM applied 2026-11-09). Demo account with 2 gyms and 11 machines and equipment items |
| `fitdb_test_isolated`, `…_other` | Synthetic | 8 migrations; the B1b safety suites pass |

- **Servers:** 3000 (demo, an older build), 3001 (UX-01 preview), 3002 and 3003 (review). All bound to 127.0.0.1 only (A1).
- **Network:** the firewall rules are closed (A2), and PostgreSQL listens on loopback only (A3).
- **Not set up:** private phone access. **Tailscale isn't installed** on the PC (checked 2026-11-09).

## Immediate next steps (in order)

1. **Owner:** buy the domain and the staging server, and approve the migrations for the cloud ([RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md) 11.5 A1–A6).
2. **Claude, after step 1:** record the approval, re-run the staging rehearsal, publish the images, and give the exact server commands (A7–A8).
3. **Owner:** test on real phones against staging, then run the UX-01 and GYM-ACCEPT checklists (A9; [MANUAL_UI_TESTING_GUIDE.md](MANUAL_UI_TESTING_GUIDE.md)).
4. **Owner:** start the legal review of the draft notice (NOTICE-B), with the open decisions it needs ([DECISION_REGISTER.md](DECISION_REGISTER.md) §2).
5. **Claude, recommended:** add the unit tests and the type check to CI. Today **no workflow runs them**; they run only on the owner's PC ([DECISION_REGISTER.md](DECISION_REGISTER.md) TD-CI).
