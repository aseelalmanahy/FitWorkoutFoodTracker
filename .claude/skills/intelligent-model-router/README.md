# Intelligent model router

Sends each substantial task to the cheapest Claude model able to do it reliably, through specialist subagents. Checked against Claude Code 2.1.319 and its official documentation on 2026-11-06. **The `onFailure` setting these agents rely on needs 2.1.295 or later.**

**It's advice plus delegation, and it isn't enforcement.** Claude follows the skill's instructions, and nothing forces it to. It also can't change the model of the conversation you're in.

## What's been verified

| Check | Result |
|---|---|
| Routing policy, guard, configuration and report | **Dry-run tests pass, with no model called.** `node --test .claude/skills/intelligent-model-router/tests/router.test.cjs` |
| Whether those tests can fail | 22 deliberate defects, each caught, with every file restored and hash-checked |
| `verify-model.cjs` | Read the real model from one real subagent transcript, in this repository's sessions |
| Claude Code loading the skill | Observed: it appeared in the session without a restart |
| **Claude Code loading the four agents, delegating to them, and running their guard** | **NOT VERIFIED.** The docs say new agent files are picked up within seconds, but the session that wrote them answered `Agent type 'quick-task-agent' not found`, twice. The YAML frontmatter also hasn't been through a real parser |

**To finish that check, in a new session:** ask Claude to use `quick-task-agent` to read `.env.router-smoke`, a file that doesn't exist. **Expect the router's guard to refuse the read,** with "Blocked by the model router". A "file not found" error means the guard didn't run. Then check the model with `/tasks` or `verify-model.cjs`. This is one small Haiku request. **Until it's done, treat the agents as untested.**

## How it works

1. For a substantial task, Claude reads `SKILL.md`, and describes the task as a set of signals, such as `securitySensitive` or `failedAttempts`. This part takes judgement.
2. `scripts/route.cjs` turns those signals into a decision. This part is deterministic, and it's tested.
3. Claude delegates to the named subagent, stays in the main session, or stops for approval.
4. While a specialist works, `scripts/guard.cjs` refuses restricted tool calls.

| File | Purpose |
|---|---|
| `.claude/skills/intelligent-model-router/SKILL.md` | The instructions Claude follows |
| `.../routing-policy.json` | Tiers, agents, the escalation threshold and the guard's general rules |
| `.../scripts/route.cjs` | The decision |
| `.../scripts/guard.cjs` | The hook that refuses restricted calls |
| `.../scripts/verify-model.cjs` | Reads the model from a finished subagent's transcript |
| `.../tests/router.test.cjs` | Dry-run tests. No model is called |
| `.claude/agents/*-agent.md` | The specialists |
| `.claude/model-router.project.json` | This repository's additions. Leave it out when copying the router elsewhere |

## Models and rules

| Tier | Alias | On the Anthropic API today | Agent | Used for |
|---|---|---|---|---|
| Low | `haiku` | Haiku 5.5 | `quick-task-agent` | Documentation, formatting, simple explanations, light analysis |
| Middle | `sonnet` | Sonnet 5.5 | `development-agent` | Routine implementation, refactoring, tests, debugging |
| High | `opus` | Opus 5.5 | `architecture-agent` | Architecture, security, database design, authentication, concurrency, difficult debugging |
| High | `opus` | Opus 5.5 | `security-review-agent` | Read-only review of security work, migrations, account deletion, release readiness |

**The agents use aliases, not full IDs,** so they follow new releases without a change. An alias can mean a different model on Bedrock, Google Cloud or Foundry. `fable` is a documented alias too, but isn't used here, as nothing in this policy needs it by default. **What your account can use isn't something the router can look up:** `/model` shows it.

**The order of the rules, first match wins:**

1. A restricted action waits for the owner's approval, whatever else is true. Once approved, it stays in the main session, and never goes to a specialist.
2. A security or release review goes to `security-review-agent`.
3. A feature proposal goes to the project's own agent, if it has one configured. Here that's `product-strategy-agent`, whose definition sets its model.
4. Unresolved review defects, security, architecture, database integrity, concurrency or complex cross-subsystem work go to `architecture-agent`.
5. Two failed attempts move a task up one tier.
6. A trivial edit stays in the main session, with no routing commentary.
7. Documentation and light analysis go to `quick-task-agent`.
8. Everything else goes to `development-agent`.

**Length is never an input,** so a long, simple task stays cheap.

**If a model is unavailable,** a task moves up to the next available tier, and never down. If only weaker tiers are available, it stops for a decision. Claude Code can also do this by itself: under an `availableModels` restriction, a subagent runs on a fallback model rather than failing, so **the model named in a definition isn't proof of the model used.**

## How delegation happens

The docs give this order for a subagent's model:

1. The Agent tool's `model` parameter for that call
2. The agent's `model` frontmatter
3. `CLAUDE_CODE_SUBAGENT_MODEL`
4. The main conversation's model

**That's why the skill says not to pass `model`,** as it would override the agent's definition. `CLAUDE_CODE_SUBAGENT_MODEL` with `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` overrides everything, and `availableModels` limits all of it.

Claude Code may also delegate by itself when a task matches an agent's `description`, without this skill being involved. The guard and the agent's model still apply then, but the policy's report doesn't.

## What it can't do

| Capability | State |
|---|---|
| Delegate to an agent on a chosen model | **Supported,** and what this uses |
| Change the main session's model automatically | **Not supported.** Only you can, with `/model`, `--model`, `ANTHROPIC_MODEL` or the `model` setting. The docs mention `setModel()` for the Agent SDK only |
| A hook choosing a model | **Not documented.** `PreModelSwitch` can only block a switch |
| A skill changing the model for the rest of one turn | **Documented, through the skill's `model` field, and not used.** It would set one fixed model, whatever the task, so it can't route |
| `opusplan` | **Documented, and not used.** It's a session setting, and you can choose it yourself |
| Enforcing that routing happens | **No.** Claude follows the instructions, and may misjudge a signal. Keyword hints are a dry-run aid, and can be wrong in both directions |

## Safety

**A stronger model gets no extra permission.** No agent sets `permissionMode`, and in `auto`, `acceptEdits` or `bypassPermissions` the main session's mode applies to subagents anyway.

| Control | How |
|---|---|
| No nesting | No agent has the `Agent` tool, so none can start another. The guard also refuses a `claude` command |
| Restricted commands | Migrations, seeds, direct database clients, deployment, push, merge, commit, history rewrites, external requests and secret files are refused. So, here, are `fitdb`, `fitdb_test_other`, the database-backed suites and the paid provider check |
| Protected files | Agent definitions, Claude settings, this router, `CLAUDE.md`, anything outside the project, and project-listed files can't be written |
| Read-only review | `security-review-agent` has no edit tools, and may only run read-only `git` commands |
| Fails closed | The hook uses `onFailure: block`, and any error inside it blocks the call |
| Never allows | The guard only refuses. It never answers "allow", so permission rules and prompts still decide everything else |

**Limits you should know:**

- **The guard matches patterns, and it isn't a sandbox.** A command written to evade it, for example through a script file, can get past it. **Use `permissions.deny` rules for anything that must never happen.** This router adds none, as global and project permission settings need your approval.
- **Hooks in project agents need folder trust.** The docs say that without it, Claude Code skips them.
- **Main-session work has no guard.** There, your permission mode and rules apply, as they always did.
- **Being blocked can be inconvenient by design.** A specialist can't commit or run database-backed suites, so the main session does that, with your authorization.
- `security-review-agent` is independent of the conversation that did the work, but it's still the same vendor's model. **It supplements a required external or human review, and never replaces it.**

## Seeing the model actually used

| Where | How | Status |
|---|---|---|
| Main session | `/status`, or the status line's `model.id` | Documented |
| A running subagent | `/tasks` names the model on its row | Documented, 2.1.242 and later |
| A finished subagent | `node .claude/skills/intelligent-model-router/scripts/verify-model.cjs <transcript>` | **The transcript's format isn't documented,** so this reports "unverified" rather than guessing if it changes |

## Cost and performance

- **Cheaper tiers save the most on large, simple work,** like long documentation.
- **Delegating isn't free.** A subagent starts with no context, and has to re-read what the main session already knows. That's why trivial edits aren't delegated, and why a small task in a session already on the right model may be better left there.
- **Escalating costs more,** so it needs a signal. Repeated failure at a low tier also costs more than starting higher, which is why risk goes straight to Opus.
- **Reviews add a whole extra pass,** so `independentReview` is a recommendation, for tasks worth it.
- `maxTurns` bounds each specialist's run. It's a judgement, not a measurement, and an agent that hits it stops with its work unfinished.
- **No savings have been measured,** as benchmarking would itself cost money.

## Overriding and disabling

| To | Do this |
|---|---|
| Choose a model for one task | Ask: "use architecture-agent", or `@agent-architecture-agent` |
| Change a tier's model | Edit that agent's `model` field, and `routing-policy.json` to match. The tests check they agree |
| Change the main session's model | `/model opus` |
| Cap what subagents can use | An `availableModels` managed setting, or a `permissions.deny` rule such as `Agent(model:opus)` |
| Turn off the skill | `{"skillOverrides": {"intelligent-model-router": "off"}}` in `.claude/settings.local.json` |
| Turn off one agent | `{"permissions": {"deny": ["Agent(development-agent)"]}}`, or delete its file |
| Remove it | Delete the skill folder, the four agent files, `.claude/model-router.project.json`, and the section in `CLAUDE.md` |

## When Claude releases new models

1. Aliases move on their own, so usually nothing needs editing. Read the [model configuration docs](https://code.claude.com/docs/en/model-config) for changes.
2. To add or rename a tier, edit `routing-policy.json` and the agents' `model` fields.
3. Update the version and date at the top of this file and in `routing-policy.json`, after checking the docs again.
4. Run `node --test .claude/skills/intelligent-model-router/tests/router.test.cjs`.

## Using it in another repository

Copy the skill folder and the four agent files into the same places. Leave out `.claude/model-router.project.json`, or write your own. It can name `existingAgents` and add guard rules. **Review the guard's rules for that repository,** as it may need more.

Hooks refer to the skill through `${CLAUDE_PROJECT_DIR}`, so this is for project-level installs. A personal install under `~/.claude` would need those paths changed.
