# Development Workflow

Every new feature follows this cycle, in order.

```
PRODUCT STRATEGY REVIEW
        ↓
FEATURE APPROVAL
        ↓
ARCHITECTURE REVIEW
        ↓
SECURITY AND PRIVACY REVIEW
        ↓
IMPLEMENTATION
        ↓
AUTOMATED TESTING
        ↓
GITHUB SOURCE REVIEW
        ↓
UI DEMONSTRATION AND OWNER ACCEPTANCE
        ↓
MERGE APPROVAL
        ↓
MERGE
```

## Independent review comes first

**Every feature proposal gets an independent recommendation from the `product-strategy-agent`,** wherever it came from. The agent may challenge the owner, ChatGPT, Claude Code, existing architecture decisions and the current roadmap, and it must give evidence and explicit reasoning. It must verify in the code that something is missing before saying so.

A recommendation isn't approval. Only the owner approves, and the owner can overrule the agent, with the disagreement recorded. Each record states whether it's still a recommendation or has been approved, and for what scope.

**The agent can't authorize** application implementation, database migrations, paid API requests, production deployment, Git commits, pushes or merges, or major architecture changes. Each needs the owner's explicit approval, however strongly the agent recommends it.

## The stages

| Stage | Who | What it produces | Can't continue until |
|---|---|---|---|
| Product strategy review | `product-strategy-agent` | A decision record in `docs/FEATURE_DECISIONS.md` | The recommendation and its reasons are written down |
| Feature approval | Project owner | A decision on the agreed scope. The owner can overrule the agent, and the record says so | The owner has said yes to a specific scope |
| Architecture review | Implementing engineer, then reviewer | Schema, API and dependency plan, written before any code | Migrations and new dependencies are explicitly approved |
| Security and privacy review | Implementing engineer, then reviewer | Authorization, consent, retention, deletion and logging decisions | Open risks are fixed or accepted by the owner |
| Implementation | Implementing engineer | A feature branch. `main` isn't touched | |
| Automated testing | Implementing engineer | Unit, integration and browser tests, plus negative controls showing the tests can fail. External services are stubbed, and only designated test databases are used | Everything required passes, with failures reported and not hidden |
| GitHub source review | Independent reviewer | Findings on the committed source | Findings are fixed or accepted |
| UI demonstration and owner acceptance | Implementing engineer, then project owner | The section below, with the application running | The owner has tried the phase and said it's accepted. **Automated tests alone never are** |
| Merge approval | Project owner | Explicit approval of a specific commit | The commit is the one reviewed |
| Merge | Implementing engineer | Fast-forward to `main`, normal push, no force | Local and remote `main` match the approved commit |

## UI demonstration and user acceptance

**Every development phase ends with a working local application, a demonstration of what it added, the permanent demo account with realistic data for it, a manual testing guide, and the owner's chance to test and approve it.** This is the owner's standing requirement, and automated testing alone isn't enough for acceptance.

Each phase's report has a section titled **UI DEMONSTRATION AND USER ACCEPTANCE**, with:

1. **What Changed:** what the phase added or changed, focusing on what a user sees.
2. **Before and After:** the difference from the previous phase, with screenshots where useful.
3. **Where to Find It:** the exact place in the app, such as Dashboard → Progress → Weight.
4. **How to Test It:** numbered steps, in simple language, that the owner can follow by hand.
5. **Expected Results:** what should happen after each action.
6. **Test Account:** confirmation that the demo account works, pointing to `demo-account.local.md`.
7. **Known Limitations:** what's incomplete, needs an external integration, is unavailable locally, has known defects, or hasn't been verified on real devices.
8. **Acceptance Status:** implementation complete, automated tests passed, UI demonstration ready, owner acceptance pending, and owner accepted, each stated separately.

**A phase is never marked OWNER ACCEPTED until the owner explicitly approves it.** Don't say the application is running unless it's been checked, and say so if its server has stopped.

**The demo account is reused, and never replaced.** Each phase extends `scripts/lib/demo-account-data.cjs` and `docs/MANUAL_UI_TESTING_GUIDE.md` for what it adds, keeps earlier data and the same password, and creates no duplicates. Populating is idempotent, adds only that account's rows, and runs on `fitdb_test` only. The password stays in the Git-ignored `demo-account.local.md`.

## When this applies

**The full cycle** applies to anything new that a user could notice, and to any new role, table, service or recurring cost.

**Return to product review** if, during any later stage, the work:

- adds a user-visible capability that wasn't approved,
- adds a table, role, external service or paid dependency that wasn't approved,
- starts handling a new kind of personal data, or sharing it with anyone new,
- no longer solves the problem that was approved, or turns out to be much larger than estimated.

**Product review can be skipped** for defect fixes, security hardening, test work and refactoring that don't change what the product does. Testing, source review and merge approval still apply. If there's doubt, it goes to review.

## Standing rules

- No production deployment without the owner's approval. Blockers are in `docs/PHASE_3_PRODUCTION_READINESS.md`, and `docs/PRODUCT_STRATEGY.md` divides them into pre-beta safeguards and pre-launch validation.
- No real users until the pre-beta safeguards are complete.
- No paid AI requests or live third-party calls in tests, unless explicitly approved.
- No migrations, or work on personal databases, without explicit approval.
- Testing never relaxes a safety rule to get a result.
