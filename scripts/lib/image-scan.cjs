// G1: what must never be inside an image layer. Scans a folder holding a layer's files: by path (env files, local
// account files, evaluation photos, the Git folder, database dumps) and by content (the actual secret values from this
// machine's env and account files). Reports which rule matched and where, never the secret itself.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");

const FORBIDDEN_PATHS = [
  [/(^|\/)\.env(\.[^/]+)?$/, "an env file"],
  [/\.local\.md$/, "a local account file"],
  [/(^|\/)\.git\//, "the Git folder"],
  [/(^|\/)\.cache\/(label-photos|meal-photos)\//, "evaluation photos"],
  [/\.(dump|sql\.gz)$/, "a database dump"],
  [/(^|\/)docs\/BUNNY_AGENT_DESIGN\.md$/, "the protected design file"],
  [/(^|\/)deploy\/production\.env$/, "the production env file"],
];
const ALLOWED = [/(^|\/)\.env\.example$/];

/**
 * Secret values from this machine's env files (DATABASE_URL passwords, *_KEY, *_SECRET, *_PASSWORD) and its local
 * account files' Password rows. Only values long enough to be meaningful are kept, so no common word is searched for.
 */
function localSecrets(files) {
  const out = new Set();
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, "utf8");
    if (file.endsWith(".md")) {
      for (const m of raw.matchAll(/^\|\s*Password\s*\|\s*(\S+)\s*\|/gm)) out.add(m[1]);
      continue;
    }
    for (const [k, v] of Object.entries(parseEnv(raw))) {
      if (/URL$/.test(k)) { try { const u = new URL(v); if (u.password) { out.add(u.password); out.add(decodeURIComponent(u.password)); } } catch { /* not a URL */ } }
      else if (/(KEY|SECRET|PASSWORD|TOKEN)$/.test(k)) out.add(v);
    }
  }
  return [...out].filter((s) => s.length >= 12);
}

/** Every finding in `root`: { file, rule } for a forbidden path, { file, rule: "secret #n" } for a secret's bytes. */
function scanTree(root, secrets, { maxBytes = 64 * 2 ** 20 } = {}) {
  const findings = [];
  const needles = secrets.map((s) => Buffer.from(s, "utf8"));
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile()) continue;
      const hit = FORBIDDEN_PATHS.find(([re]) => re.test(rel));
      if (hit && !ALLOWED.some((re) => re.test(rel))) findings.push({ file: rel, rule: hit[1] });
      const size = fs.statSync(full).size;
      if (!needles.length || size === 0 || size > maxBytes) continue;
      const bytes = fs.readFileSync(full);
      needles.forEach((n, i) => { if (bytes.includes(n)) findings.push({ file: rel, rule: `secret #${i + 1}` }); });
    }
  };
  walk(root);
  return findings;
}

module.exports = { FORBIDDEN_PATHS, localSecrets, scanTree };
