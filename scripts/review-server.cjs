// Runs the local review environment: this folder's production build, on fitdb_review, with the real USDA FoodData
// Central and Open Food Facts services, served only on this machine. Leave the window open; Ctrl+C stops it.
//   node --env-file=.env.review scripts/review-server.cjs --confirm=fitdb_review [--port=3003]
// --port=3003 runs a candidate build from another folder beside the stable one on 3002, on the same database. Only
// those two ports are accepted.
//   node scripts/review-server.cjs --stop --port=3003
// stops a server left running on that port, only if it is provably this folder's own (RC-02). Nothing else is stopped.
// Needs a production build, and fitdb_review prepared with scripts/local-db.cjs. Registration stays closed, no email
// is sent, and paid AI stays off. The app's own startup check refuses anything else, and so does this first.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { REVIEW_MARKER, localDatabaseProblem, envFileProblem, readLocalIdentity, scrubber } = require("./lib/local-databases.cjs");
const { describePortOwner, stopOwnServer } = require("./lib/port-owner.cjs");
const EXIT_WITH_PARENT = path.join(__dirname, "lib", "exit-with-parent.cjs");

const NAME = "fitdb_review";
const PORTS = ["3002", "3003"];
const ROOT = path.join(__dirname, "..");
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const refuse = (m) => { console.error(`REFUSED (nothing was started): ${m}`); process.exit(4); };

const args = process.argv.slice(2);
const portArg = args.find((a) => a.startsWith("--port="));
const stopMode = args[0] === "--stop";
if (stopMode ? args.length !== 2 || !portArg : args[0] !== `--confirm=${NAME}` || args.length > 2 || (args.length === 2 && !portArg)) {
  refuse(`use --confirm=${NAME}, and optionally --port=3003; or --stop --port=<port>.`);
}
const portValue = portArg ? portArg.slice("--port=".length) : "3002";
if (!PORTS.includes(portValue)) refuse(`the port can only be ${PORTS.join(" or ")}.`);
const PORT = Number(portValue);

if (stopMode) {
  // Stops only this folder's own server on this port, identified by its command line; never anything else.
  stopOwnServer(PORT, { bin: NEXT_BIN }).then((r) => {
    if (r.stopped) { console.log(`Stopped this folder's server on port ${PORT} (process ${r.pid}). The port is free.`); process.exit(0); }
    console.error(`NOT STOPPED: ${r.reason}`); process.exit(5);
  }, (e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
  return;
}
const fileProblem = envFileProblem(NAME);
if (fileProblem) refuse(fileProblem);
const DB = process.env.DATABASE_URL;
const urlProblem = localDatabaseProblem(DB, NAME);
if (urlProblem) refuse(urlProblem);
if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) refuse("there's no production build in this folder.");
const usdaKey = (process.env.FDC_API_KEY ?? "").trim();
const scrub = scrubber(DB);

// Settings that would swap in stand-ins, open sign-up, publish the database identity, or turn on paid AI. Never passed on.
const NEVER = ["FDC_BASE_URL", "OFF_BASE_URL", "LABEL_STUB_URL", "STUB_LOG_FILE", "MAIL_STUB_DIR", "FIT_LOCAL_TEST_SERVER", "FIT_TEST_OPEN_REGISTRATION",
  "EXPOSE_DB_IDENTITY", "FOOD_RATE_LIMIT_MULTIPLIER", "SAFETY_DB_URL", "SAFETY_DB_CONFIRM", "SAFETY_OTHER_DB_URL", "GUARD_SNAPSHOT_SCOPE", "BASE_URL",
  "SHOTS_DIR", "SERVER_LOG_FILE", "EXPECT_UNCONFIGURED", "NODE_TEST_CONTEXT", "TRUST_PROXY_HOPS", "REGISTRATION_ALLOWLIST", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_OPTIONS",
  "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "LABEL_EXTRACTION_MODEL", "LABEL_EXTRACTION_EFFORT", "MEAL_IDENTIFICATION_MODEL", "MEAL_IDENTIFICATION_EFFORT", "NODE_PATH"];

const portInUse = (port) => new Promise((resolve) => {
  const s = net.connect({ port, host: "127.0.0.1" });
  s.once("connect", () => { s.destroy(); resolve(true); });
  s.once("error", () => resolve(false));
});

(async () => {
  if (await portInUse(PORT)) {
    const owner = describePortOwner(PORT, { bin: NEXT_BIN });
    refuse(owner.own
      ? `${owner.text} Use it, or stop it first with: node scripts/review-server.cjs --stop --port=${PORT}`
      : `${owner.text} Nothing was stopped. Choose the other port, or stop that program yourself.`);
  }
  // The database is fitdb_review, on this machine, carrying its review marker. Read-only.
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: DB } }, errorFormat: "minimal" });
  try {
    const id = await readLocalIdentity(db, NAME);
    if (id.marker !== REVIEW_MARKER) refuse(`${NAME} doesn't carry its review marker. Prepare it with scripts/local-db.cjs first.`);
    console.log(`Database ${NAME} verified: local, marked, fingerprint ${id.fingerprint.slice(0, 12)}…`);
  } catch (e) { refuse(scrub(e.message)); } finally { await db.$disconnect().catch(() => {}); }

  const env = { ...process.env };
  for (const k of NEVER) delete env[k];
  Object.assign(env, { NODE_ENV: "production", FIT_LOCAL_REVIEW_SERVER: "1", APP_ORIGIN: `http://localhost:${PORT}`, DATABASE_URL: DB });
  if (usdaKey) env.FDC_API_KEY = usdaKey; else delete env.FDC_API_KEY;
  // Bound to this machine's loopback address only, so nothing else on the network can reach it.
  // The app ends with this script, however this script ends (RC-02): it watches a pipe the operating system closes.
  env.FIT_EXIT_WITH_PARENT = "1";
  const app = spawn(process.execPath, ["-r", EXIT_WITH_PARENT, NEXT_BIN, "start", "-H", "127.0.0.1", "-p", String(PORT)], { cwd: ROOT, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const relay = (d) => { for (const line of scrub(d).split(/\r?\n/)) if (/preflight|error|Error|warn/i.test(line)) console.log(`  app: ${line.trim()}`); };
  app.stdout.on("data", relay);
  app.stderr.on("data", relay);
  let stopping = false;
  const stop = (code) => { if (stopping) return; stopping = true; try { app.kill(); } catch { /* already gone */ } setTimeout(() => process.exit(code), 500); };
  // Ctrl+C, a stop request, the console window closing (SIGHUP on Windows) and Ctrl+Break all stop the app first.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) { try { process.on(signal, () => stop(0)); } catch { /* not on this platform */ } }
  app.once("exit", (code) => { console.error(`The review server stopped (exit ${code}).`); stop(code === 0 ? 0 : 1); });

  const url = `http://localhost:${PORT}`;
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/login`, { redirect: "manual" }); if (r.status === 200) break; } catch { /* not yet */ }
    if (stopping) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`Running at ${url}, on ${NAME}, with the real USDA ${usdaKey ? "FoodData Central (key present)" : "service UNAVAILABLE: no FDC_API_KEY"} and Open Food Facts. Press Ctrl+C to stop.`);
})().catch((e) => { console.error(`FAILED: ${scrub(e.message).slice(0, 200)}`); process.exit(1); });
