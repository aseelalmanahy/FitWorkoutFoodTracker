// DEPLOY / RC-06: measures the on-device recognition's memory and time on a running review server, reproducibly.
//   node scripts/measure-recognition.cjs --port=3003 --account=<review-tester-N.local.md>
// Start the server fresh first (LABEL_OCR=local, MEAL_RECOGNITION=local), so "startup" is a fresh process. It signs in
// as that review tester, sends one generated label image and one generated meal image twice each through the real
// API, and reads the server process's memory after each step: from Windows, or /proc on Linux. Nothing is stored:
// scans and identifications aren't saved; each counts against the tester's daily scan allowance. Results are for the
// machine it runs on only. The account's password is read from its Git-ignored file and never printed.
"use strict";
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { listeningPid, commandLineOf } = require("./lib/port-owner.cjs");

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const port = Number(arg("port"));
const account = arg("account");
const refuse = (m) => { console.error(`REFUSED: ${m}`); process.exit(4); };
if (![3002, 3003].includes(port) || !account) refuse("use --port=3002|3003 --account=<review-tester-N.local.md>.");
if (!/review-tester-\d\.local\.md$/.test(account)) refuse("only a review tester account is used for measuring.");
const md = fs.readFileSync(account, "utf8");
const field = (n) => md.split(/\r?\n/).map((l) => l.split("|").map((c) => c.trim())).find((c) => c[1] === n)?.[2];
const BASE = `http://localhost:${port}`;

const pid = listeningPid(port);
const cmd = (commandLineOf(pid) ?? "").replace(/\\/g, "/");
if (!pid || !/\/next\/dist\/bin\/next\b.*\bstart\b/.test(cmd)) refuse(`no app server found on port ${port}.`);

/** Resident memory and its peak so far, in MB, of the server process. */
function memory() {
  if (process.platform === "linux") {
    const s = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(s)?.[1] ?? 0);
    return { rss: Math.round(kb("VmRSS") / 1024), peak: Math.round(kb("VmHWM") / 1024) };
  }
  const out = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `$p = Get-Process -Id ${pid}; "$($p.WorkingSet64) $($p.PeakWorkingSet64)"`], { encoding: "utf8" }).stdout.trim().split(" ").map(Number);
  return { rss: Math.round(out[0] / 2 ** 20), peak: Math.round(out[1] / 2 ** 20) };
}

let cookie = "";
const call = async (path, body, type) => {
  const t0 = performance.now();
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": type, Origin: BASE, Cookie: cookie }, body, redirect: "manual" });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("fit_session=")) cookie = c.split(";")[0];
  await r.arrayBuffer();
  return { status: r.status, ms: Math.round(performance.now() - t0) };
};

(async () => {
  const sharp = require("sharp");
  const lines = ["Nutrition Facts", "Serving size 1 bar (40g)", "Amount per serving", "Calories 190", "Total Fat 7g", "Total Carbohydrate 26g", "Protein 6g"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${60 + lines.length * 44}"><rect width="100%" height="100%" fill="#fff"/>${lines.map((l, i) => `<text x="24" y="${56 + i * 44}" font-family="Arial" font-size="30">${l}</text>`).join("")}</svg>`;
  const label = await sharp(Buffer.from(svg)).png().toBuffer();
  const meal = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#d9a441" } }).jpeg().toBuffer();
  const rows = [["fresh server, before any request", null, memory()]];
  const login = await call("/api/auth/login", JSON.stringify({ email: field("Email"), password: field("Password") }), "application/json");
  if (login.status !== 200) refuse(`sign-in answered ${login.status}`);
  rows.push(["after sign-in", login.ms, memory()]);
  for (const [name, path, body, type] of [["label scan (on-device OCR)", "/api/nutrition/label-scans", label, "image/png"], ["meal photo (on-device model)", "/api/nutrition/meal-identifications", meal, "image/jpeg"]]) {
    for (const when of ["first, loads the model", "second, warm"]) {
      const r = await call(path, body, type);
      if (r.status !== 200) refuse(`${name} answered ${r.status}`);
      rows.push([`${name}, ${when}`, r.ms, memory()]);
    }
  }
  console.log(`Server process ${pid} on port ${port}, ${process.platform} ${process.arch}, Node ${process.version}, ${new Date().toISOString()}`);
  console.log("| Step | Request ms | Memory MB | Peak MB |\n|---|---|---|---|");
  for (const [step, ms, m] of rows) console.log(`| ${step} | ${ms ?? ""} | ${m.rss} | ${m.peak} |`);
})().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
