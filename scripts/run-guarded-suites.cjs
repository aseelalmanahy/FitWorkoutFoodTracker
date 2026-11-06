// Runs the integration and E2E suites against local test databases, with stub providers.
// See docs/PHASE_4_0_0A_TEST_TARGET_GUARD.md. Needs a production build.
//   node --env-file=.env.test scripts/run-guarded-suites.cjs [suite names...]
// DATABASE_URL must name fitdb_test. fitdb_test_other is derived from it. Prints no credentials.
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { databaseUrlProblem, environmentProblems, verifyServerIdentity } = require("./lib/test-target-guard.cjs");
const { urlSecrets } = require("./lib/test-db-guard.cjs");
const { ROOT, NEXT_BIN, startStub, freePort, spawnNode, waitForChild, killTree, killAll, runNode } = require("./lib/test-servers.cjs");

const DB = process.env.DATABASE_URL;
const unsafe = [databaseUrlProblem(DB), ...environmentProblems(process.env)].filter(Boolean);
if (!unsafe.length && decodeURIComponent(new URL(DB).pathname.slice(1)) !== "fitdb_test") unsafe.push({ message: "DATABASE_URL must name fitdb_test." });
if (unsafe.length) {
  console.error(`REFUSING to run (no database was touched):\n  - ${unsafe.map((p) => p.message).join("\n  - ")}`);
  process.exit(4);
}
const otherUrl = new URL(DB);
otherUrl.pathname = "/fitdb_test_other";
const OTHER = otherUrl.toString();
// Only stubs and fake keys from here on, including in every child process.
for (const k of ["FDC_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "BASE_URL", "LABEL_STUB_URL", "NODE_TEST_CONTEXT"]) delete process.env[k];

const LOGS = fs.mkdtempSync(path.join(os.tmpdir(), "fit-suites-"));
const secrets = [...urlSecrets(DB), DB, OTHER];
const scrub = (s) => { let o = String(s); for (const x of secrets) o = o.split(x).join("<redacted>"); return o.replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/g, "$1***@"); };
const script = (f) => path.join(ROOT, "scripts", f);
const nodeTest = (f, ...flags) => ["--test", ...flags, script(f)];
const AI_OFF = { ANTHROPIC_API_KEY: "", ANTHROPIC_BASE_URL: "", LABEL_EXTRACTION_MODEL: "", MEAL_IDENTIFICATION_MODEL: "" };

async function withApp(name, { appEnv = {}, stubLog = false }, run) {
  const stubLogFile = path.join(LOGS, `${name}.stub.log`);
  const serverLog = path.join(LOGS, `${name}.server.log`);
  const stub = await startStub(stubLog ? { STUB_LOG_FILE: stubLogFile } : {});
  const port = await freePort();
  const app = spawnNode([NEXT_BIN, "start", "-p", String(port)], {
    DATABASE_URL: DB, FDC_BASE_URL: `${stub.url}/fdc/v1`, OFF_BASE_URL: `${stub.url}/off`, FDC_API_KEY: "stub", EXPOSE_DB_IDENTITY: "1", ...AI_OFF, ...appEnv,
  }, { capture: true });
  const out = fs.createWriteStream(serverLog);
  app.stdout.on("data", (d) => out.write(scrub(d)));
  app.stderr.on("data", (d) => out.write(scrub(d)));
  const url = `http://localhost:${port}`;
  try {
    await waitForChild(`${url}/login`, app);
    await verifyServerIdentity({ baseUrl: url, databaseUrl: DB });
    return await run({ url, stubUrl: stub.url, stubLogFile, serverLog });
  } finally {
    await killTree(app); await killTree(stub.child); out.end();
  }
}
async function withLabelStub(run) {
  const port = await freePort();
  const child = spawnNode([script("stub-label-provider.cjs"), String(port)]);
  const url = `http://127.0.0.1:${port}`;
  await waitForChild(`${url}/__health`, child);
  try { return await run(url); } finally { await killTree(child); }
}
const MANY = { FOOD_RATE_LIMIT_MULTIPLIER: "100" };
const stubModels = (url, extra) => ({ ...MANY, ANTHROPIC_API_KEY: "stub-key-not-real", ANTHROPIC_BASE_URL: url, ...extra });
const e2e = (name, file, models) => () => withLabelStub((stub) => withApp(name, { appEnv: stubModels(stub, models) }, ({ url }) =>
  runNode([script(file)], { BASE_URL: url, LABEL_STUB_URL: stub, SHOTS_DIR: LOGS }, 590_000)));
const unconfigured = (name, file, appEnv) => () => withApp(name, { appEnv }, ({ url }) => runNode([script(file)], { BASE_URL: url, EXPECT_UNCONFIGURED: "1", SHOTS_DIR: LOGS }, 120_000));
const LABEL = { LABEL_EXTRACTION_MODEL: "stub-model" };
const MEAL = { MEAL_IDENTIFICATION_MODEL: "stub-meal-model" };
const SAFETY_ENV = { SAFETY_DB_URL: DB, SAFETY_DB_CONFIRM: "fitdb_test", SAFETY_OTHER_DB_URL: OTHER };

/** Fails if the marker's catalog row was rewritten, not only if its text changed. */
async function markerRow() {
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: DB } } });
  try {
    const rows = await db.$queryRawUnsafe("SELECT description, xmin::text AS version FROM pg_shdescription WHERE objoid = (SELECT oid FROM pg_database WHERE datname = current_database())");
    return JSON.stringify(rows);
  } finally { await db.$disconnect(); }
}
async function withoutMarkerWrite(run) {
  const before = await markerRow();
  if (!before.includes("fitworkoutfoodtracker:test-database:v1:fitdb_test")) throw new Error("fitdb_test isn't marked, and this runner won't mark it");
  const result = await run();
  if ((await markerRow()) !== before) throw new Error("the marker's row changed");
  return result;
}

const SUITES = {
  guard: () => runNode(nodeTest("test-target-guard.test.cjs"), { DATABASE_URL: "" }, 300_000),
  "guard-browser": () => runNode(nodeTest("test-target-guard.browser.test.cjs"), { DATABASE_URL: "" }, 300_000),
  units: () => runNode(nodeTest("live-check.units.test.cjs"), {}, 120_000),
  "live-identity": () => withoutMarkerWrite(() => runNode(nodeTest("live-check.identity.test.cjs"), {}, 300_000)),
  "nutrition-api": () => withApp("nutrition-api", { appEnv: MANY }, ({ url, stubUrl, serverLog }) => runNode(nodeTest("nutrition-api.test.cjs"), { BASE_URL: url, FDC_BASE_URL: `${stubUrl}/fdc/v1`, SERVER_LOG_FILE: serverLog }, 300_000)),
  "release-workflow": () => withApp("release-workflow", { appEnv: MANY }, ({ url }) => runNode(nodeTest("release-workflow.test.cjs"), { BASE_URL: url }, 300_000)),
  "provider-protection": () => withApp("provider-protection", { stubLog: true }, ({ url, stubLogFile }) => runNode(nodeTest("provider-protection.test.cjs"), { BASE_URL: url, STUB_LOG_FILE: stubLogFile }, 300_000)),
  "provider-malformed": () => withApp("provider-malformed", { stubLog: true }, ({ url, stubLogFile }) => runNode(nodeTest("provider-malformed.test.cjs"), { BASE_URL: url, STUB_LOG_FILE: stubLogFile }, 300_000)),
  "provider-config": () => withApp("provider-config", { appEnv: { FDC_API_KEY: "" } }, ({ url, serverLog }) => runNode(nodeTest("provider-config.test.cjs"), { BASE_URL: url, SERVER_LOG_FILE: serverLog }, 180_000)),
  "e2e-smoke": () => withApp("e2e-smoke", { appEnv: MANY }, ({ url }) => runNode([script("e2e-smoke.cjs")], { BASE_URL: url, SHOTS_DIR: LOGS }, 300_000)),
  "e2e-nutrition": () => withApp("e2e-nutrition", { appEnv: MANY }, ({ url }) => runNode([script("e2e-nutrition.cjs")], { BASE_URL: url, SHOTS_DIR: LOGS }, 300_000)),
  eligibility: () => withApp("eligibility", { appEnv: MANY }, ({ url }) => runNode([script("e2e-eligibility.cjs")], { BASE_URL: url, SHOTS_DIR: LOGS }, 590_000)),
  "label-scan": e2e("label-scan", "e2e-label-scan.cjs", LABEL),
  "label-pdf": e2e("label-pdf", "e2e-label-pdf.cjs", LABEL),
  meal: e2e("meal", "e2e-meal.cjs", MEAL),
  hardening: e2e("hardening", "e2e-hardening.cjs", { ...LABEL, ...MEAL }),
  "meal-unconfigured": unconfigured("meal-unconfigured", "e2e-meal.cjs", { LABEL_EXTRACTION_MODEL: "not-the-meal-model" }),
  "label-pdf-unconfigured": unconfigured("label-pdf-unconfigured", "e2e-label-pdf.cjs", {}),
  "label-unconfigured": unconfigured("label-unconfigured", "e2e-label-scan.cjs", {}),
  "usda-missing-nutrients": () => runNode(nodeTest("usda-missing-nutrients.test.cjs"), { SAFETY_DB_URL: DB, SAFETY_DB_CONFIRM: "fitdb_test" }, 420_000),
  "safety-no-marker": () => withoutMarkerWrite(() => runNode(nodeTest("live-provider-check.safety.test.cjs", "--test-skip-pattern=MISSING marker|INVALID marker"), SAFETY_ENV, 900_000)),
  "db-guard-scoped": () => withoutMarkerWrite(() => runNode(nodeTest("test-db-guard.test.cjs"), { SAFETY_DB_URL: DB, GUARD_SNAPSHOT_SCOPE: "designated" }, 600_000)),
};

function report(name, r, ms) {
  const out = scrub(r.out || "");
  fs.writeFileSync(path.join(LOGS, `${name}.out.log`), out);
  const clean = out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  const n = (label) => clean.match(new RegExp(`^ℹ ${label} (\\d+)`, "m"))?.[1] ?? "-";
  const last = clean.trim().split(/\r?\n/).filter((l) => /PASSED|^ℹ fail/.test(l)).pop() ?? "";
  console.log(`${r.code === 0 ? "PASS" : "FAIL"}  ${name.padEnd(24)} exit ${r.code}  tests ${n("tests")}  pass ${n("pass")}  fail ${n("fail")}  skipped ${n("skipped")}  ${Math.round(ms / 1000)}s  ${/PASSED/.test(last) ? last.trim() : ""}`);
  return r.code === 0;
}

(async () => {
  const asked = process.argv.slice(2);
  const unknown = asked.filter((n) => !SUITES[n]);
  if (unknown.length) throw new Error(`unknown suite: ${unknown.join(", ")}. Known: ${Object.keys(SUITES).join(", ")}`);
  let ok = true;
  for (const name of asked.length ? asked : Object.keys(SUITES)) {
    const t0 = Date.now();
    try { ok = report(name, await SUITES[name](), Date.now() - t0) && ok; } catch (e) {
      ok = false;
      console.log(`FAIL  ${name.padEnd(24)} ${scrub(e.message).slice(0, 240)}`);
    }
  }
  console.log(`Logs: ${LOGS}`);
  await killAll();
  process.exit(ok ? 0 : 1);
})().catch(async (e) => { console.error(scrub(e.message)); await killAll(); process.exit(1); });
