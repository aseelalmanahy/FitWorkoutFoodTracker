# Documentation index

**Canonical: which document says what, and how far to trust it.** Updated 2026-11-09.

**Authority levels:**

| Level | Meaning |
|---|---|
| **Canonical** | The current source of truth. Kept up to date |
| **Evidence** | An append-only record of what was done and tested. Its latest section is current; earlier sections are history, not current status |
| **Design** | The reasoning behind a phase. Its status line may predate implementation; the canonical documents give the current status |
| **Draft** | Not approved |
| **Superseded** | Replaced; kept for history |

**When documents disagree:** the canonical documents win. Then the latest part of RELEASE_ACCEPTANCE.md wins over earlier parts and the tracker.

## Start here (canonical)

| Document | What it answers |
|---|---|
| [PROJECT_MASTER.md](PROJECT_MASTER.md) | What the project is, its vision (labelled by who said it), the actual architecture, the Phase 1–4 matrix |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | The current branch and commit, the release verdict, blockers, the next steps |
| [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md) | Every feature, with its status and evidence, verified against the code |
| [ROADMAP.md](ROADMAP.md) | What's next, in dependency order, with acceptance criteria. Nothing in it is approved unless marked |
| [DECISION_REGISTER.md](DECISION_REGISTER.md) | Owner decisions, open questions, rejected, deferred, risks, defects, debt, blockers, dependencies, and doc conflicts |

## Rules and process (canonical)

| Document | Authority |
|---|---|
| [../CLAUDE.md](../CLAUDE.md) | Project instructions for every session: product review first, a UI demonstration per phase, model routing, the non-negotiable principles |
| [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md) | The full feature cycle and the UI-demonstration requirements |
| [FEEDBACK_REVIEW_WORKFLOW.md](FEEDBACK_REVIEW_WORKFLOW.md) | How beta feedback is triaged |
| [MANUAL_UI_TESTING_GUIDE.md](MANUAL_UI_TESTING_GUIDE.md) | The owner's hands-on checklists: UX-01, MG.1–MG.15, H.1–H.10, G.1–G.6. Never commit `demo-account.local.md` |
| `../.claude/agents/*.md` | The specialist agents (product strategy, architecture, development, security review, quick task). **Frozen** (OD-16) |
| `../.claude/skills/` | The `intelligent-model-router` and `parallel-task-orchestrator` skills. **Frozen** |

## Evidence (append-only records)

| Document | What it records | Current part |
|---|---|---|
| [RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md) | Release gates, approvals and evidence, 2026-11-08 → 09 | **Its header verdict, and Parts 10 and 11** (11.5 is the current authorization package). Parts 2, 6, 7.7, 8.9 and 9.6 are superseded packages |
| [PROJECT_COMPLETION_TRACKER.md](PROJECT_COMPLETION_TRACKER.md) | Every requirement, test and defect by ID, phases 1–4.0.x and sections 2j–2n | its register rows (R-, S-, T-, TD-); RELEASE_ACCEPTANCE is later on gates |
| [PHASE_4_EXECUTION_PLAN.md](PHASE_4_EXECUTION_PLAN.md) | Phase 4 execution and the owner authorizations A1–A9 | history |
| [PHASE_4_INTEGRATION_PLAN.md](PHASE_4_INTEGRATION_PLAN.md), [PHASE_4_MERGE_READINESS.md](PHASE_4_MERGE_READINESS.md) | Building `integration/phase-4`; the merge decision package | the merge to `main` is still unapproved |
| [MIG_04_RUNBOOK.md](MIG_04_RUNBOOK.md) | How MIG-04 was applied to `fitdb_test` | history; the pattern for later migrations |
| [SESSION_HANDOFF.md](SESSION_HANDOFF.md) | A snapshot of 2026-11-07 | **superseded by PROJECT_STATUS.md**; keep for its rules (for example, BUNNY) |
| [../PHASE_2_PROGRESS.md](../PHASE_2_PROGRESS.md) | Phase 2 and 2.5 progress and the live check | the final section (15/15 PASSED) |

## Application walkthrough (evidence, 2026-11-09)

| Document | What it records |
|---|---|
| [APP_FEATURE_TEST_REPORT.md](APP_FEATURE_TEST_REPORT.md) | The hands-on test of the running app at `d7d278d`: environment, a result for every feature, the 11 journeys, defects WT-01..09, live USDA and Open Food Facts checks, readiness |
| [APP_USER_GUIDE.md](APP_USER_GUIDE.md) | How to use every feature, step by step, with the demo user and screenshots |
| [APP_SCREEN_INDEX.md](APP_SCREEN_INDEX.md) | Every screen, how to reach it, and its screenshot (148, in `screenshots/walkthrough/`) |
| [APP_DEMO_DATA.md](APP_DEMO_DATA.md) | The fictional account used, what was seeded and what each part shows |

## Product and decisions

| Document | Authority |
|---|---|
| [PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md) | **Design**: the recommended vision, roadmap and open questions (PS-Q1..12). "Proposed" throughout. Owner approvals since then are in DECISION_REGISTER §1. Its "confirmed missing" list (PS:103) is stale |
| [FEATURE_DECISIONS.md](FEATURE_DECISIONS.md) | **Design and evidence**: the product-strategy verdict for each idea, plus the UX-01 approval (FD:389). It doesn't record the 2026-11-08 approvals (DOC-01) |
| [BETA_PLAN.md](BETA_PLAN.md) | The owner-approved beta-capabilities scope (BP:3) |
| [BETA_HOSTING.md](BETA_HOSTING.md) | The hosting comparison and recommendation (CX23 staging, CX33 production). **Not approved** (G2) |
| [PRIVACY_WORDING_DRAFTS.md](PRIVACY_WORDING_DRAFTS.md) | **Draft**: notice wording for NOTICE-B, for owner and legal review |

## Architecture and design (by phase)

| Document | Authority |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | **Design, partly superseded**: the original pre-build architecture. Its targets, phase table, versions and planned tables are out of date; PROJECT_MASTER §2 is current |
| [PHASE_3_DESIGN.md](PHASE_3_DESIGN.md), [PHASE_3_PRODUCTION_READINESS.md](PHASE_3_PRODUCTION_READINESS.md) | Design for image, label, PDF and meal features; its readiness blockers are history |
| [PHASE_4_0_DESIGN.md](PHASE_4_0_DESIGN.md) | Design: safeguards, and **Decisions PD-D1..30** (PD:665–694) |
| [PHASE_4_0_0A_TEST_TARGET_GUARD.md](PHASE_4_0_0A_TEST_TARGET_GUARD.md) | The test-target guard (merged at `56606ee`) |
| [PHASE_4_0_1_IMPLEMENTATION_PLAN.md](PHASE_4_0_1_IMPLEMENTATION_PLAN.md) | The 4.0.1 plan (implemented) |
| [PHASE_4_0_3_DEPLOYMENT.md](PHASE_4_0_3_DEPLOYMENT.md) | **The deployment runbook.** Its last section, "Single-server deployment, option A", is current |
| [PHASE_4_0_3_BACKUP_RECOVERY.md](PHASE_4_0_3_BACKUP_RECOVERY.md) | Backup design and S-14 (the deletion ledger, not built) |
| [PHASE_4_0_4_EMAIL_ACCESS.md](PHASE_4_0_4_EMAIL_ACCESS.md), [PHASE_4_0_5_PLAN.md](PHASE_4_0_5_PLAN.md), [PHASE_4_0_5_DATA_INVENTORY.md](PHASE_4_0_5_DATA_INVENTORY.md), [PHASE_4_0_6_READINESS.md](PHASE_4_0_6_READINESS.md), [PHASE_4_1_PROGRESS.md](PHASE_4_1_PROGRESS.md) | Per-phase design and evidence for 4.0.4–4.1 |

## Outside this repository's history

| Item | Status |
|---|---|
| [../README.md](../README.md) | Setup and Phases 1–2 overview; **stale on status**, points here |
| `docs/BUNNY_AGENT_DESIGN.md` in the main worktree (`FitWorkoutFoodTracker/`) | The owner's **untracked** file. By instruction (SESSION_HANDOFF.md:19) it is never read, changed, staged or deleted. Not part of any plan |
| `feature/ten-user-qa-fixtures` | 3 commits not in the candidate: 10 QA accounts and a browser test (TR) |
| `phase-2.5-review` | A review diff only |
| GitHub | PR #1 (Phase 1, merged); no issues; CI runs under Actions ([PROJECT_MASTER.md](PROJECT_MASTER.md) §2) |
