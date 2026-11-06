#!/usr/bin/env node
// The routing decision: a pure function of the signals describing a task, so the same signals always route
// the same way. It runs no model, changes no setting and grants nothing. It only says what to recommend.
//   node route.cjs --signals '{"securitySensitive":true}'
//   node route.cjs --text "Fix a typo in the README"     (keyword hints, for dry runs and as a starting point)
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const SKILL_DIR = path.resolve(__dirname, "..");
const loadPolicy = () => JSON.parse(fs.readFileSync(path.join(SKILL_DIR, "routing-policy.json"), "utf8"));

function loadProject(projectDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectDir, ".claude", "model-router.project.json"), "utf8"));
  } catch {
    return {};
  }
}

const RESTRICTED = {
  "migration-apply": "applying a database migration",
  "database-write": "changing a protected database",
  seed: "seeding a database",
  deploy: "deploying",
  production: "touching production",
  merge: "merging or force-pushing",
  "paid-service": "spending on a paid service",
};

/** Tiers from `tier` upward. A weaker model is never substituted for a task that needs this one. */
function resolveTier(policy, wanted, available) {
  const allowed = available ?? Object.keys(policy.tiers);
  const rank = policy.tiers[wanted].rank;
  return Object.keys(policy.tiers)
    .filter((t) => allowed.includes(t) && policy.tiers[t].rank >= rank)
    .sort((a, b) => policy.tiers[a].rank - policy.tiers[b].rank)[0] ?? null;
}

function route(input, { policy = loadPolicy(), project = {} } = {}) {
  const s = input ?? {};
  const failed = Number(s.failedAttempts) || 0;
  const restricted = s.restrictedActions ?? [];
  const highRisk = !!(s.securitySensitive || s.architecture || s.databaseIntegrity || s.concurrency || s.crossSubsystem);

  // Length is deliberately never read: a long, simple task stays on a cheap model.
  const build = (task, tier, agent, execution, reason, extra = {}) => {
    const resolved = resolveTier(policy, tier, s.availableTiers);
    const independentReview = highRisk || restricted.length > 0 || !!s.isReview;
    if (!resolved) {
      return {
        task, tier: null, model: null, agent: null, execution: "owner-decision",
        reason: `The ${tier} tier or stronger isn't available, and a weaker model won't be substituted for this task. Check /model, or ask the owner.`,
        fallback: true, independentReview, requiresHumanApproval: !!extra.requiresHumanApproval, blocked: true, silent: false,
      };
    }
    const fallback = resolved !== tier;
    // A tier's own agent follows the tier, so the model reported is the one its definition runs on. The review
    // agent is kept, as it's read-only and its tier has nothing above it. If that tier is ever unavailable, this
    // stops above rather than giving a review to an agent that can edit files.
    const delegateTo = agent === policy.tiers[tier].agent ? policy.tiers[resolved].agent : agent;
    return {
      task, tier: resolved, model: policy.tiers[resolved].alias, agent: delegateTo, execution,
      reason: fallback ? `${reason} ${tier} isn't available, so this moves up to ${resolved}.` : reason,
      fallback, independentReview, requiresHumanApproval: false, blocked: false, silent: false, ...extra,
    };
  };

  // 1. Restricted actions come first, and no classification can lift them. Approval moves the action to the main
  //    session, where permission prompts apply. It's never handed to a specialist, whatever its model.
  if (restricted.length) {
    const what = restricted.map((a) => RESTRICTED[a] ?? a).join(", ");
    if (!s.approvalConfirmed) {
      return build(`restricted: ${restricted.join(", ")}`, "opus", null, "none-until-approved",
        `Nothing runs: ${what} needs the owner's explicit approval, and routing can't grant it.`,
        { requiresHumanApproval: true, blocked: true });
    }
    return build(`restricted, approved: ${restricted.join(", ")}`, "opus", null, "main-session",
      `The owner approved ${what}, so it stays in the main session under its normal permissions, and specialists can't do it.`,
      { requiresHumanApproval: true });
  }

  // 2. A review is independent of whoever did the work, so it comes before the implementation rules.
  if (s.isReview && (highRisk || s.releaseReadiness)) {
    return build("security or release review", policy.reviewAgent.tier, policy.reviewAgent.agent, "delegate",
      "Security-sensitive review needs the strongest reasoning, from a read-only agent that didn't do the work.");
  }

  // 3. A project's own agents are reused where they cover the task. Their definition decides their model.
  const proposal = project.existingAgents?.featureProposal;
  if (s.featureProposal && proposal) {
    return {
      task: "feature proposal", tier: "inherit", model: "inherit", agent: proposal, execution: "delegate",
      reason: `${proposal} evaluates proposals before any implementation, on the model its own definition sets.`,
      fallback: false, independentReview: highRisk, requiresHumanApproval: false, blocked: false, silent: false,
    };
  }

  // 4. Escalations named by the policy.
  if (s.unresolvedReviewDefects) return build("rework after review", "opus", policy.tiers.opus.agent, "delegate", "An independent review left defects unresolved.");
  if (highRisk) {
    const why = ["securitySensitive", "architecture", "databaseIntegrity", "concurrency", "crossSubsystem"].filter((k) => s[k]).join(", ");
    return build("high-risk engineering", "opus", policy.tiers.opus.agent, "delegate", `Needs the strongest reasoning: ${why}.`);
  }

  // 5. Everything else takes the cheapest capable tier, moving up one after repeated failures.
  const base = s.trivial || s.documentation || s.lightweightAnalysis ? "haiku" : "sonnet";
  if (failed >= policy.escalateAfterFailedAttempts) {
    const next = base === "haiku" ? "sonnet" : "opus";
    return build(`${base} task, escalated`, next, policy.tiers[next].agent, "delegate", `${failed} failed attempts suggest the ${base} tier isn't enough.`);
  }

  // A cold agent has to rebuild what the main session already holds, so a trivial edit isn't worth delegating.
  if (s.trivial) return build("trivial edit", "haiku", null, "main-session", "Small enough that delegating would cost more than doing it.", { silent: true });
  if (base === "haiku") return build("documentation or light analysis", "haiku", policy.tiers.haiku.agent, "delegate", "Documentation and light analysis don't need a stronger model.");
  return build("routine implementation", "sonnet", policy.tiers.sonnet.agent, "delegate", "Routine code, tests and debugging suit the middle tier.");
}

/**
 * Keyword hints, for dry runs and as a first draft of the signals. These are guesses from words, and can be wrong
 * in either direction: whoever's routing should correct them from what the task actually involves.
 */
function signalsFromText(text) {
  const t = String(text).toLowerCase();
  const has = (re) => re.test(t);
  const s = {};
  const doing = "(apply|applies|run|execute|deploy|perform|ship|release)";
  const restricted = [];
  if (has(new RegExp(`\\b${doing}\\b[^.]*\\bmigrations?\\b`))) restricted.push("migration-apply");
  if (has(/\bseed(ing)?\b[^.]*\b(database|db|data)\b|\b(database|db)\b[^.]*\bseed\b/)) restricted.push("seed");
  if (has(/\b(deploy|ship|release)\b[^.]*\b(prod|production|server)\b|\bdeploy\b(?!ment)/) && !has(/\b(review|audit|check|plan|design)\b/)) restricted.push("deploy");
  if (has(/\b(force[- ]push|merge\b[^.]*\bmain\b)/)) restricted.push("merge");
  if (restricted.length) s.restrictedActions = restricted;

  s.isReview = has(/\b(review|audit)\b/);
  s.releaseReadiness = has(/\b(production|release|deployment)\b/) && s.isReview;
  s.securitySensitive = has(/\b(auth|authentication|authorization|login|password|session|csrf|xss|injection|secrets?|encrypt\w*|permissions?|security|account deletion)\b/);
  s.databaseIntegrity = has(/\b(migrations?|schema|data[- ]loss|foreign key|transaction|backfill)\b/);
  s.concurrency = has(/\b(concurrency|concurrent|race condition|deadlock)\b/);
  s.architecture = has(/\barchitecture\b|\bdesign (a|an|the)\b[^.]*\b(system|database|service|data model)\b/);
  s.trivial = has(/\b(typo|spelling|whitespace|rename a variable)\b/);
  s.documentation = has(/\b(document|documentation|docs?|readme|comment|format(ting)?|explain|summari[sz]e)\b/);
  s.featureProposal = has(/\b(should we (add|build)|new feature proposal|propose a feature)\b/);
  return Object.fromEntries(Object.entries(s).filter(([, v]) => (Array.isArray(v) ? v.length : v)));
}

function format(d, { actual = "not verified until the work has run" } = {}) {
  if (d.silent) return "";
  const execution = {
    delegate: `Delegated agent: ${d.agent}`,
    "main-session": "Main session",
    "none-until-approved": "None. Waiting for human approval",
    "owner-decision": "None. The owner has to decide",
  }[d.execution];
  return [`TASK:\n${d.task}`, `MODEL:\n${d.model ?? "none available"}`, `REASON:\n${d.reason}`, `EXECUTION:\n${execution}`, `VERIFICATION:\n${actual}`].join("\n\n");
}

if (require.main === module) {
  const [flag, value] = process.argv.slice(2);
  if (!["--signals", "--text"].includes(flag) || value === undefined) {
    console.error("usage: route.cjs --signals '<json>' | --text '<task>'");
    process.exit(2);
  }
  const signals = flag === "--text" ? signalsFromText(value) : JSON.parse(value);
  const project = loadProject(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  const decision = route(signals, { project });
  console.log(JSON.stringify({ signals, decision }, null, 2));
  const text = format(decision);
  if (text) console.log(`\n${text}`);
}

module.exports = { route, signalsFromText, format, resolveTier, loadPolicy, RESTRICTED };
