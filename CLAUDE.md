# FitWorkoutFoodTracker

## Start with the canonical documents

Read these before relying on any other document or on memory of earlier sessions:
- `docs/PROJECT_MASTER.md`: what the project is, the architecture as built, the phase matrix.
- `docs/PROJECT_STATUS.md`: the current branch and commit, the verdict, blockers, next steps.
- `docs/FEATURE_INVENTORY.md`: what exists, verified against the code.
- `docs/ROADMAP.md`: what comes next; nothing there is approved unless marked.
- `docs/DECISION_REGISTER.md`: owner decisions, open questions, rejections, risks, defects.
- `docs/DOCUMENTATION_INDEX.md`: every document and its authority.

When documents disagree, the canonical ones win, and the latest part of `docs/RELEASE_ACCEPTANCE.md` wins over earlier parts and the tracker. When work changes the project's state, update the canonical documents in the same commit. Evidence documents (the tracker, `RELEASE_ACCEPTANCE.md`) are append-only: add to them, don't rewrite their history.

## New features go through product review first

Before designing or implementing a new feature, or a major scope change to one, run the `product-strategy-agent` (`.claude/agents/product-strategy-agent.md`, or `@agent-product-strategy-agent`) and get the owner's approval. Its recommendation is independent, and applies to proposals from anyone, including the owner, ChatGPT and Claude Code. A recommendation isn't approval, and the agent can't authorize implementation, migrations, paid requests, deployment, merges or architecture changes. Bug fixes and hardening that don't change what the product does don't need it.

The full cycle is in `docs/DEVELOPMENT_WORKFLOW.md`. Decisions so far are consolidated in `docs/DECISION_REGISTER.md` (the reasoning for each verdict stays in `docs/FEATURE_DECISIONS.md`), and the vision and roadmap are in `docs/PROJECT_MASTER.md` and `docs/ROADMAP.md` (the original recommendations are in `docs/PRODUCT_STRATEGY.md`).

## Every phase ends with a UI demonstration

Every development phase ends with a working local application, the permanent demo account extended for what it added, `docs/MANUAL_UI_TESTING_GUIDE.md` updated, and a report section titled **UI DEMONSTRATION AND USER ACCEPTANCE**. Its required contents are in `docs/DEVELOPMENT_WORKFLOW.md`. Automated tests alone aren't acceptance, and nothing is marked OWNER ACCEPTED until the owner explicitly says so. Never commit `demo-account.local.md`.

## Model routing

For substantial work, use the `intelligent-model-router` skill to choose a model and specialist. An explicit choice by the owner comes first. Routing never grants a permission or an approval: migrations, seeds, deployment, merges, protected databases and paid requests still need the owner's explicit approval, and specialists don't do them. The main session's model can only be changed by the owner.

When a substantial request splits into genuinely independent tasks, use the `parallel-task-orchestrator` skill. The main session stays the single source of truth, at most three workers run at once, and the same restrictions apply.

## Principles that aren't traded away

- AI never invents calories, macros, weights, portions or ingredients.
- Missing nutrition stays null, never 0.
- No fitness calculation claims more precision than its method supports.
- No real users until the pre-beta safeguards in `docs/PRODUCT_STRATEGY.md` are complete.
