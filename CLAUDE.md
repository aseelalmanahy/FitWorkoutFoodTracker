# FitWorkoutFoodTracker

## New features go through product review first

Before designing or implementing a new feature, or a major scope change to one, run the `product-strategy-agent` (`.claude/agents/product-strategy-agent.md`, or `@agent-product-strategy-agent`) and get the owner's approval. Its recommendation is independent, and applies to proposals from anyone, including the owner, ChatGPT and Claude Code. A recommendation isn't approval, and the agent can't authorize implementation, migrations, paid requests, deployment, merges or architecture changes. Bug fixes and hardening that don't change what the product does don't need it.

The full cycle is in `docs/DEVELOPMENT_WORKFLOW.md`. Decisions so far are in `docs/FEATURE_DECISIONS.md`, and the vision and roadmap are in `docs/PRODUCT_STRATEGY.md`.

## Model routing

For substantial work, use the `intelligent-model-router` skill to choose a model and specialist. An explicit choice by the owner comes first. Routing never grants a permission or an approval: migrations, seeds, deployment, merges, protected databases and paid requests still need the owner's explicit approval, and specialists don't do them. The main session's model can only be changed by the owner.

When a substantial request splits into genuinely independent tasks, use the `parallel-task-orchestrator` skill. The main session stays the single source of truth, at most three workers run at once, and the same restrictions apply.

## Principles that aren't traded away

- AI never invents calories, macros, weights, portions or ingredients.
- Missing nutrition stays null, never 0.
- No fitness calculation claims more precision than its method supports.
- No real users until the pre-beta safeguards in `docs/PRODUCT_STRATEGY.md` are complete.
