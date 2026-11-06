#!/usr/bin/env node
// PreToolUse hook for the specialist agents. Keeps restricted work with the main session, where the owner's
// approval and permission prompts apply. Defence in depth, and not a sandbox: a determined command can get past
// pattern matching, so this never replaces permission rules. It can only refuse, and never allows anything.
//   node guard.cjs standard | read-only     (hook JSON on stdin)
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const SKILL_DIR = path.resolve(__dirname, "..");

function loadRules(projectDir) {
  const policy = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, "routing-policy.json"), "utf8")).guard;
  let extra = {};
  try {
    extra = JSON.parse(fs.readFileSync(path.join(projectDir, ".claude", "model-router.project.json"), "utf8")).guard ?? {};
  } catch (err) {
    if (err.code !== "ENOENT") throw err; // a damaged file must not quietly drop its rules
  }
  const merge = (key) => [...policy[key], ...(extra[key] ?? [])];
  return {
    secretRead: merge("secretReadPatterns").map((p) => new RegExp(p, "i")),
    protectedWrite: merge("protectedWritePatterns").map((p) => new RegExp(p, "i")),
    commands: merge("restrictedCommands").map(({ label, pattern }) => ({ label, re: new RegExp(pattern, "i") })),
  };
}

const normalize = (p) => String(p ?? "").replace(/\\/g, "/");

function isOutside(projectDir, file) {
  const relative = path.relative(projectDir, path.resolve(projectDir, file));
  return relative.startsWith("..") || path.isAbsolute(relative);
}

// Only these inspect, and none of the options they could take here writes a file. Anything chained is refused.
const READ_ONLY_COMMAND = /^\s*git\s+(status|diff|log|show|rev-parse|ls-files|blame|grep|merge-base)\b[^;&|<>`$\n]*$/;
const WRITES_ANYWAY = /--output\b|--ext-diff\b|--textconv\b/;

/** Why this call must not run, or null. */
function refusalFor(input, profile, projectDir) {
  const rules = loadRules(projectDir);
  const tool = input.tool_name;
  const args = input.tool_input ?? {};

  if (tool === "Bash" || tool === "PowerShell") {
    const command = String(args.command ?? "");
    if (profile === "read-only") {
      if (!READ_ONLY_COMMAND.test(command) || WRITES_ANYWAY.test(command)) return "this reviewer may only run read-only git commands";
    }
    for (const { label, re } of rules.commands) if (re.test(command)) return `${label} isn't for a specialist agent`;
    return null;
  }

  const target = normalize(args.file_path ?? args.notebook_path ?? args.path ?? "");
  if (["Read", "Grep", "Glob"].includes(tool)) {
    const fields = [target, normalize(args.pattern && tool === "Glob" ? args.pattern : ""), normalize(args.glob ?? "")];
    if (fields.some((f) => f && rules.secretRead.some((re) => re.test(f)))) return "secret files aren't for a specialist agent";
    return null;
  }

  if (["Edit", "Write", "NotebookEdit"].includes(tool)) {
    if (profile === "read-only") return "this reviewer doesn't change files";
    if (!target) return "no file was named";
    const absolute = normalize(path.resolve(projectDir, target));
    if (rules.secretRead.some((re) => re.test(absolute))) return "secret files aren't for a specialist agent";
    if (isOutside(projectDir, target)) return "specialist agents only change files inside this project";
    if (rules.protectedWrite.some((re) => re.test(absolute))) return "this file is protected: routing configuration and project-protected files stay with the main session";
    return null;
  }
  // Only the tools named by the agents' matcher arrive here. Anything else is refused, so a new tool is closed.
  return `the router's guard doesn't recognize ${tool}`;
}

if (require.main === module) {
  let raw = "";
  process.stdin.on("data", (d) => { raw += d; }).on("end", () => {
    try {
      const input = JSON.parse(raw);
      const profile = process.argv[2] === "read-only" ? "read-only" : "standard";
      const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
      const reason = refusalFor(input, profile, projectDir);
      if (reason) {
        console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `Blocked by the model router: ${reason}. Report back, so the main session and owner can decide.` } }));
      }
      process.exit(0);
    } catch (err) {
      console.error(`Model router guard failed, so this call is refused: ${err.message}`);
      process.exit(2); // blocks the tool
    }
  });
}

module.exports = { refusalFor, loadRules };
