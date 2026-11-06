// Dry-run tests: no model is called, and nothing is delegated. Run with:
//   node --test .claude/skills/intelligent-model-router/tests/router.test.cjs
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { route, signalsFromText, format, resolveTier, loadPolicy } = require("../scripts/route.cjs");
const { refusalFor } = require("../scripts/guard.cjs");
const { modelsInTranscript, report } = require("../scripts/verify-model.cjs");

const SKILL = path.resolve(__dirname, "..");
const ROOT = path.resolve(SKILL, "..", "..", "..");
const AGENTS = path.join(ROOT, ".claude", "agents");
const fromText = (text, extra = {}) => route({ ...signalsFromText(text), ...extra });
// This repository's own additions. Another repository can leave the file out, and these are skipped.
const PROJECT_FILE = path.join(ROOT, ".claude", "model-router.project.json");
const HAS_PROJECT = fs.existsSync(PROJECT_FILE);

describe("the ten required scenarios", () => {
  const cases = [
    ["Fix a typo in the README", { tier: "haiku", model: "haiku", execution: "main-session", agent: null, silent: true }],
    ["Write documentation for the units module", { tier: "haiku", execution: "delegate", agent: "quick-task-agent" }],
    ["Create a React component for a progress card", { tier: "sonnet", execution: "delegate", agent: "development-agent" }],
    ["Implement an API endpoint listing a person's workouts", { tier: "sonnet", execution: "delegate", agent: "development-agent" }],
    ["Debug a failing test in the overload calculator", { tier: "sonnet", execution: "delegate", agent: "development-agent" }],
    ["Design a database migration for body weight history", { tier: "opus", execution: "delegate", agent: "architecture-agent", blocked: false }],
    ["Review authentication security", { tier: "opus", execution: "delegate", agent: "security-review-agent" }],
    ["Investigate a concurrency failure in session saving", { tier: "opus", execution: "delegate", agent: "architecture-agent" }],
    ["Review a production deployment", { tier: "opus", execution: "delegate", agent: "security-review-agent", blocked: false }],
    ["Apply the pending database migration to the production database", { execution: "none-until-approved", agent: null, blocked: true, requiresHumanApproval: true }],
  ];
  for (const [text, expected] of cases) {
    test(text, () => {
      const d = fromText(text);
      for (const [key, value] of Object.entries(expected)) assert.equal(d[key], value, key);
    });
  }
});

describe("the policy", () => {
  test("is deterministic", () => {
    const signals = { databaseIntegrity: true, failedAttempts: 1 };
    assert.deepEqual(route(signals), route(signals));
  });
  test("defaults to a middle tier, and never to the most expensive", () => {
    assert.equal(route({}).tier, "sonnet");
  });
  test("doesn't escalate because a task is long", () => {
    const words = "Write documentation for the module. ".repeat(500);
    assert.equal(fromText(words).tier, "haiku");
    assert.equal(route({ documentation: true, expectedScope: "very large", estimatedFiles: 400, longTask: true }).tier, "haiku");
    assert.equal(route({ longTask: true }).tier, "sonnet");
  });
  for (const signal of ["securitySensitive", "architecture", "databaseIntegrity", "concurrency", "crossSubsystem"]) {
    test(`${signal} escalates to the strongest tier, and asks for independent review`, () => {
      const d = route({ [signal]: true });
      assert.equal(d.tier, "opus");
      assert.equal(d.agent, "architecture-agent");
      assert.equal(d.independentReview, true);
    });
  }
  test("risk outranks a claim that a task is small", () => {
    assert.equal(route({ trivial: true, securitySensitive: true }).tier, "opus");
    assert.equal(route({ documentation: true, databaseIntegrity: true }).tier, "opus");
    assert.equal(fromText("Fix a typo in the password check").tier, "opus");
  });
  test("two failed attempts move up one tier, and one doesn't", () => {
    assert.equal(route({ failedAttempts: 1 }).tier, "sonnet");
    assert.equal(route({ failedAttempts: 2 }).tier, "opus");
    assert.equal(route({ documentation: true, failedAttempts: 2 }).tier, "sonnet");
    assert.equal(route({ documentation: true, failedAttempts: 2 }).agent, "development-agent");
  });
  test("unresolved review defects go to the strongest tier", () => {
    assert.equal(route({ unresolvedReviewDefects: true }).tier, "opus");
  });
  test("reuses a project's agent for a proposal, whose own definition sets its model", () => {
    const project = { existingAgents: { featureProposal: "product-strategy-agent" } };
    const d = route({ featureProposal: true }, { project });
    assert.equal(d.agent, "product-strategy-agent");
    assert.equal(d.model, "inherit");
    assert.notEqual(route({ featureProposal: true }).agent, "product-strategy-agent", "without that project, it isn't assumed");
  });
});

describe("routing never lifts a restriction", () => {
  for (const action of ["migration-apply", "database-write", "seed", "deploy", "production", "merge", "paid-service"]) {
    test(`${action} waits for approval, however it's classified`, () => {
      for (const extra of [{}, { trivial: true }, { documentation: true }, { securitySensitive: true }, { isReview: true }, { failedAttempts: 9 }, { unresolvedReviewDefects: true }]) {
        const d = route({ restrictedActions: [action], ...extra });
        assert.equal(d.execution, "none-until-approved");
        assert.equal(d.blocked, true);
        assert.equal(d.agent, null, "no specialist is given it");
      }
    });
  }
  test("an unknown restricted action still waits", () => {
    assert.equal(route({ restrictedActions: ["drop-everything"] }).execution, "none-until-approved");
  });
  test("approval moves it to the main session, and never to a specialist", () => {
    const d = route({ restrictedActions: ["migration-apply"], approvalConfirmed: true });
    assert.equal(d.execution, "main-session");
    assert.equal(d.agent, null);
    assert.equal(d.requiresHumanApproval, true);
  });
  test("a truthy-looking approval in the wrong field is ignored", () => {
    assert.equal(route({ restrictedActions: ["deploy"], approved: true, approval: "yes", authorized: true }).execution, "none-until-approved");
  });
  test("no decision carries a permission", () => {
    const d = route({ securitySensitive: true });
    for (const key of Object.keys(d)) assert.doesNotMatch(key, /permission|allow|bypass|grant/i);
  });
  test("the keyword hints recognize restricted requests", () => {
    assert.deepEqual(signalsFromText("Run the migration on the server").restrictedActions, ["migration-apply"]);
    assert.deepEqual(signalsFromText("Deploy this to production").restrictedActions, ["deploy"]);
    assert.deepEqual(signalsFromText("Force-push the branch").restrictedActions, ["merge"]);
    assert.equal(signalsFromText("Review a production deployment").restrictedActions, undefined);
  });
});

describe("when a model is unavailable", () => {
  const policy = loadPolicy();
  test("a task moves up to the next available tier", () => {
    const d = route({ documentation: true, availableTiers: ["sonnet", "opus"] });
    assert.equal(d.tier, "sonnet");
    assert.equal(d.fallback, true);
    assert.match(d.reason, /isn't available/);
  });
  test("a task never moves down: it stops for a decision", () => {
    const d = route({ securitySensitive: true, availableTiers: ["haiku", "sonnet"] });
    assert.equal(d.tier, null);
    assert.equal(d.model, null);
    assert.equal(d.execution, "owner-decision");
    assert.equal(d.blocked, true);
    assert.equal(d.fallback, true);
  });
  test("routine work with only a weaker tier also stops", () => {
    assert.equal(route({ availableTiers: ["haiku"] }).execution, "owner-decision");
  });
  test("resolveTier only looks upward", () => {
    assert.equal(resolveTier(policy, "sonnet", ["haiku"]), null);
    assert.equal(resolveTier(policy, "sonnet", ["haiku", "opus"]), "opus");
    assert.equal(resolveTier(policy, "haiku", undefined), "haiku");
  });
});

describe("the model and the agent always agree", () => {
  const policy = loadPolicy();
  const TIERS = ["haiku", "sonnet", "opus"];
  const subsets = [[], ["haiku"], ["sonnet"], ["opus"], ["haiku", "sonnet"], ["haiku", "opus"], ["sonnet", "opus"], ["haiku", "sonnet", "opus"]];
  const modelOf = (agent) => fs.readFileSync(path.join(AGENTS, `${agent}.md`), "utf8").match(/^model: *(.*?)\s*$/m)[1];
  const TASKS = {
    documentation: [{ documentation: true }, "haiku"],
    "light analysis": [{ lightweightAnalysis: true }, "haiku"],
    routine: [{}, "sonnet"],
    "documentation after failures": [{ documentation: true, failedAttempts: 2 }, "sonnet"],
    "routine after failures": [{ failedAttempts: 2 }, "opus"],
    "high risk": [{ securitySensitive: true }, "opus"],
    "review defects": [{ unresolvedReviewDefects: true }, "opus"],
  };

  for (const [label, [signals, wanted]] of Object.entries(TASKS)) {
    for (const available of subsets) {
      test(`${label}, with ${JSON.stringify(available)} available`, () => {
        const d = route({ ...signals, availableTiers: available });
        const expected = TIERS.filter((t) => available.includes(t) && policy.tiers[t].rank >= policy.tiers[wanted].rank)[0];
        if (!expected) {
          assert.equal(d.execution, "owner-decision", "no suitable tier, so it stops");
          assert.equal(d.agent, null);
          assert.equal(d.model, null);
          return;
        }
        assert.equal(d.tier, expected);
        assert.equal(d.agent, policy.tiers[expected].agent, "the tier's own agent");
        assert.equal(modelOf(d.agent), d.model, "the agent's definition runs on the model reported");
        assert.equal(d.fallback, expected !== wanted);
      });
    }
  }
  test("a Haiku task moved up to Sonnet uses the Sonnet agent", () => {
    const d = route({ documentation: true, availableTiers: ["sonnet"] });
    assert.deepEqual([d.model, d.agent, d.fallback], ["sonnet", "development-agent", true]);
  });
  test("a Haiku task moved up to Opus uses the Opus agent", () => {
    const d = route({ documentation: true, availableTiers: ["opus"] });
    assert.deepEqual([d.model, d.agent, d.fallback], ["opus", "architecture-agent", true]);
  });
  test("a Sonnet task moved up to Opus uses the Opus agent", () => {
    const d = route({ availableTiers: ["haiku", "opus"] });
    assert.deepEqual([d.model, d.agent, d.fallback], ["opus", "architecture-agent", true]);
  });
  for (const available of subsets) {
    test(`a review stays with the read-only agent, or stops, with ${JSON.stringify(available)} available`, () => {
      const d = route({ isReview: true, securitySensitive: true, availableTiers: available });
      if (available.includes("opus")) {
        assert.deepEqual([d.agent, d.model, d.execution], ["security-review-agent", "opus", "delegate"]);
      } else {
        assert.deepEqual([d.agent, d.execution, d.blocked], [null, "owner-decision", true], "never an agent that can edit");
      }
    });
    test(`a feature proposal stays with the project's agent, with ${JSON.stringify(available)} available`, () => {
      const project = { existingAgents: { featureProposal: "product-strategy-agent" } };
      const d = route({ featureProposal: true, availableTiers: available }, { project });
      assert.deepEqual([d.agent, d.model, d.tier, d.execution, d.blocked], ["product-strategy-agent", "inherit", "inherit", "delegate", false]);
    });
    test(`a restricted action is never delegated, with ${JSON.stringify(available)} available`, () => {
      for (const approvalConfirmed of [false, true]) {
        const d = route({ restrictedActions: ["deploy"], approvalConfirmed, availableTiers: available });
        assert.equal(d.agent, null);
        assert.notEqual(d.execution, "delegate");
      }
    });
    test(`a trivial edit is never delegated, with ${JSON.stringify(available)} available`, () => {
      assert.equal(route({ trivial: true, availableTiers: available }).agent, null);
    });
  }
  test("every tier's agent runs on that tier's model", () => {
    for (const [tier, def] of Object.entries(policy.tiers)) assert.equal(modelOf(def.agent), tier);
  });
});

describe("the report", () => {
  test("has the required sections, in order", () => {
    const text = format(route({ concurrency: true }));
    const at = ["TASK:", "MODEL:", "REASON:", "EXECUTION:", "VERIFICATION:"].map((h) => text.indexOf(h));
    assert.ok(at.every((i) => i >= 0));
    assert.deepEqual(at, [...at].sort((a, b) => a - b));
  });
  test("never claims a model was used", () => {
    assert.match(format(route({ concurrency: true })), /VERIFICATION:\nnot verified/);
  });
  test("says nothing for a trivial edit", () => {
    assert.equal(format(route({ trivial: true })), "");
  });
  test("names the stop when nothing runs", () => {
    assert.match(format(route({ restrictedActions: ["deploy"] })), /None\. Waiting for human approval/);
  });
  test("the command line reports a project's agent, read from the project file", { skip: !HAS_PROJECT }, () => {
    const out = spawnSync(process.execPath, [path.join(SKILL, "scripts", "route.cjs"), "--signals", '{"featureProposal":true}'], { encoding: "utf8", cwd: ROOT, env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT } });
    assert.match(out.stdout, /product-strategy-agent/);
  });
  test("the command line works, and refuses bad use", () => {
    const script = path.join(SKILL, "scripts", "route.cjs");
    const out = spawnSync(process.execPath, [script, "--text", "Review authentication security"], { encoding: "utf8", cwd: ROOT });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /security-review-agent/);
    assert.equal(spawnSync(process.execPath, [script], { encoding: "utf8" }).status, 2);
  });
});

describe("the guard", () => {
  const bash = (command, profile = "standard") => refusalFor({ tool_name: "Bash", tool_input: { command } }, profile, ROOT);
  const edit = (file_path, profile = "standard") => refusalFor({ tool_name: "Edit", tool_input: { file_path } }, profile, ROOT);
  const read = (file_path) => refusalFor({ tool_name: "Read", tool_input: { file_path } }, "standard", ROOT);

  for (const command of [
    "npx prisma migrate deploy", "npx prisma migrate dev", "npx prisma migrate resolve --applied x", "npx prisma db push", "npm run db:seed", "npx prisma db seed", "npm run db:deploy",
    "psql -c 'DROP TABLE x'", "pg_restore x.dump", "pg_dump fitdb", "docker compose up -d", "kubectl apply -f x",
    "git push origin main", "git push --force", "git merge main", "git rebase main", "git reset --hard", "git commit --amend", "git config user.name x", "gh pr merge 1",
    "claude -p hi", "npx claude --model opus", "echo x; claude -p hi", "curl https://api.anthropic.com/v1/messages", "cat .env", "cat .env.test", "node --env-file=.env.test x.js",
    "cat ~/.claude/settings.json", "echo x > .claude/settings.json",
  ]) {
    test(`refuses: ${command}`, () => assert.ok(bash(command), "should be refused"));
  }
  for (const command of ["DATABASE_URL=postgres://u@localhost/fitdb node x.js", "x --db fitdb_test_other", "node scripts/run-guarded-suites.cjs meal", "npm run test:suites", "node scripts/live-provider-check.cjs"]) {
    test(`this project refuses: ${command}`, { skip: !HAS_PROJECT }, () => assert.ok(bash(command), "should be refused"));
  }
  for (const command of ["npx vitest run src/lib/units.test.ts", "npx tsc --noEmit", "git status", "git diff", "git add src/x.ts", "ls src", "cat .env.example", "npm run lint", "grep -rn claudeClient src"]) {
    test(`allows: ${command}`, () => assert.equal(bash(command), null));
  }
  test("protects routing configuration, agents and project-protected files from writes", () => {
    for (const f of [".claude/agents/development-agent.md", ".claude/agents/product-strategy-agent.md", ".claude/settings.json", ".claude/settings.local.json", ".claude/skills/intelligent-model-router/routing-policy.json", ".claude/model-router.project.json", "CLAUDE.md", ".env", ".env.test"]) {
      assert.ok(edit(f), f);
      assert.ok(edit(path.join(ROOT, f)), `${f}, absolute`);
    }
  });
  test("this project's protected files can't be written", { skip: !HAS_PROJECT }, () => {
    for (const f of ["docs/BUNNY_AGENT_DESIGN.md", "deploy/Caddyfile", "Dockerfile"]) assert.ok(edit(f), f);
  });
  test("protects files outside the project, including global settings", () => {
    assert.match(edit("../outside.txt"), /inside this project/);
    assert.ok(edit(path.join(os.homedir(), ".claude", "settings.json")));
  });
  test("allows ordinary edits", () => {
    for (const f of ["src/lib/units.ts", "docs/README-notes.md", "README.md", ".env.example"]) assert.equal(edit(f), null, f);
  });
  test("refuses reading secrets, however they're named", () => {
    for (const f of [".env", ".env.test", ".env.production", "C:\\repo\\.env", "backups/x.dump", "server.pem", "credentials.json"]) assert.ok(read(f), f);
    for (const f of [".env.example", "src/env.ts", "docs/x.md"]) assert.equal(read(f), null, f);
    assert.ok(refusalFor({ tool_name: "Glob", tool_input: { pattern: ".env.test" } }, "standard", ROOT));
    assert.ok(refusalFor({ tool_name: "Grep", tool_input: { pattern: "x", path: ".env" } }, "standard", ROOT));
  });
  test("the reviewer may only inspect", () => {
    for (const c of ["git status", "git diff main...HEAD", "git log --oneline -5", "git show HEAD", "git merge-base main HEAD"]) assert.equal(bash(c, "read-only"), null, c);
    for (const c of ["git add x", "git commit -m x", "npx vitest run", "rm x", "git diff > out.txt", "git diff; rm x", "git log | tee x", "git diff --output=x", "git log $(rm x)", "cat src/x.ts"]) assert.ok(bash(c, "read-only"), c);
    assert.ok(edit("src/x.ts", "read-only"));
    assert.ok(refusalFor({ tool_name: "Write", tool_input: { file_path: "x" } }, "read-only", ROOT));
  });
  test("a tool it doesn't know is refused", () => {
    assert.ok(refusalFor({ tool_name: "SomeNewTool", tool_input: {} }, "standard", ROOT));
  });
  test("as a hook: a refusal is a deny decision, and a failure blocks", () => {
    const script = path.join(SKILL, "scripts", "guard.cjs");
    const run = (input, env = {}) => spawnSync(process.execPath, [script, "standard"], { input, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, ...env } });
    const denied = run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push" } }));
    assert.equal(denied.status, 0);
    assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, "deny");
    const allowed = run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status" } }));
    assert.equal(allowed.status, 0);
    assert.equal(allowed.stdout, "", "it never answers allow, so permission rules still decide");
    assert.equal(run("not json").status, 2, "unreadable input blocks");
  });
  test("a damaged project file blocks, rather than dropping its rules", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "router-"));
    fs.mkdirSync(path.join(dir, ".claude"));
    fs.writeFileSync(path.join(dir, ".claude", "model-router.project.json"), "{ broken");
    assert.throws(() => refusalFor({ tool_name: "Bash", tool_input: { command: "ls" } }, "standard", dir));
    fs.rmSync(dir, { recursive: true });
  });
  test("works in a repository with no project file, as it's portable", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "router-"));
    assert.equal(refusalFor({ tool_name: "Bash", tool_input: { command: "ls" } }, "standard", dir), null);
    assert.ok(refusalFor({ tool_name: "Bash", tool_input: { command: "git push" } }, "standard", dir));
    fs.rmSync(dir, { recursive: true });
  });
});

describe("verifying the model used", () => {
  const assistant = (model) => JSON.stringify({ type: "assistant", message: { model } });
  test("reads the model from a transcript, ignoring what can't be read", () => {
    const text = [JSON.stringify({ type: "user", message: { model: "not-this" } }), "{ partial", assistant("claude-haiku-5-5"), assistant("claude-haiku-5-5"), assistant("<synthetic>")].join("\n");
    assert.deepEqual(modelsInTranscript(text), ["claude-haiku-5-5"]);
    assert.equal(report(modelsInTranscript(text)), "verified from the transcript: claude-haiku-5-5");
  });
  test("reports a fallback during the run", () => {
    assert.match(report(modelsInTranscript([assistant("a"), assistant("b")].join("\n"))), /changed during the run: a, b/);
  });
  test("says unverified rather than guessing", () => {
    assert.match(report(modelsInTranscript("")), /^unverified/);
    const out = spawnSync(process.execPath, [path.join(SKILL, "scripts", "verify-model.cjs"), "missing.jsonl"], { encoding: "utf8" });
    assert.match(out.stdout, /^unverified/);
  });
});

describe("the configuration", () => {
  const parse = (file) => {
    const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const match = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(match, `${file} has frontmatter`);
    const field = (name) => match[1].match(new RegExp(`^${name}: *(.*)$`, "m"))?.[1];
    return { text, frontmatter: match[1], field };
  };
  const SPECIALISTS = { "quick-task-agent": "haiku", "development-agent": "sonnet", "architecture-agent": "opus", "security-review-agent": "opus" };
  const DOCUMENTED_MODELS = new Set(["haiku", "sonnet", "opus", "fable", "inherit"]);

  for (const [name, model] of Object.entries(SPECIALISTS)) {
    describe(name, () => {
      const agent = parse(path.join(AGENTS, `${name}.md`));
      const tools = agent.field("tools").split(",").map((t) => t.trim());
      test("names itself and its documented model alias", () => {
        assert.equal(agent.field("name"), name);
        assert.equal(agent.field("model"), model);
        assert.ok(DOCUMENTED_MODELS.has(agent.field("model")));
      });
      test("can't start further agents, or reach other tools", () => {
        assert.ok(!tools.includes("Agent") && !tools.includes("Task"));
        assert.ok(tools.every((t) => ["Read", "Grep", "Glob", "Edit", "Write", "Bash"].includes(t)), tools.join());
      });
      test("sets no permission mode, so a stronger model gets nothing extra", () => {
        assert.equal(agent.field("permissionMode"), undefined);
        assert.doesNotMatch(agent.frontmatter, /bypass|dontAsk|acceptEdits/);
      });
      test("keeps the project's instructions", () => {
        assert.doesNotMatch(agent.frontmatter, /omitClaudeMd/);
      });
      test("its guard covers every tool it has, and fails closed", () => {
        const matcher = agent.frontmatter.match(/matcher: "([^"]+)"/)[1].split("|");
        assert.deepEqual([...matcher].sort(), [...tools].sort());
        assert.match(agent.frontmatter, /onFailure: block/);
        assert.match(agent.frontmatter, /scripts\/guard\.cjs/);
        assert.match(agent.frontmatter, name === "security-review-agent" ? /"read-only"/ : /"standard"/);
      });
    });
  }
  test("the reviewer can't change files", () => {
    const tools = parse(path.join(AGENTS, "security-review-agent.md")).field("tools");
    assert.doesNotMatch(tools, /Edit|Write/);
  });
  test("the policy's agents all exist, with the tier it says", () => {
    const policy = loadPolicy();
    for (const [tier, def] of Object.entries(policy.tiers)) {
      assert.equal(parse(path.join(AGENTS, `${def.agent}.md`)).field("model"), def.alias, tier);
      assert.equal(def.alias, tier);
    }
    assert.equal(parse(path.join(AGENTS, `${policy.reviewAgent.agent}.md`)).field("model"), policy.reviewAgent.tier);
  });
  test("every guard pattern compiles", () => {
    for (const file of [path.join(SKILL, "routing-policy.json"), ...(HAS_PROJECT ? [PROJECT_FILE] : [])]) {
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      const guard = json.guard ?? {};
      for (const p of [...(guard.secretReadPatterns ?? []), ...(guard.protectedWritePatterns ?? []), ...(guard.restrictedCommands ?? []).map((c) => c.pattern)]) assert.doesNotThrow(() => new RegExp(p, "i"));
    }
  });
  test("the skill follows the documented shape, and says what it can't do", () => {
    const skill = parse(path.join(SKILL, "SKILL.md"));
    assert.equal(skill.field("name"), "intelligent-model-router");
    assert.ok(skill.field("description").length > 40);
    assert.ok(skill.text.split("\n").length < 500, "docs suggest under 500 lines");
    assert.doesNotMatch(skill.frontmatter, /allowed-tools|^model:|disable-model-invocation/m);
    assert.match(skill.text, /can't\*\* change the main session's model/);
    assert.match(skill.text, /authorizes nothing/);
  });
  test("this project's own agent is still there", { skip: !HAS_PROJECT }, () => {
    const names = fs.readdirSync(AGENTS).map((f) => f.replace(/\.md$/, "")).sort();
    assert.deepEqual(names, ["architecture-agent", "development-agent", "product-strategy-agent", "quick-task-agent", "security-review-agent"]);
  });
});
