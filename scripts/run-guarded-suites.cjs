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
const { ROOT, NEXT_BIN, startStub, freePort, spawnNode, waitForChild, killTree, killAll, runNode: runNodeRaw } = require("./lib/test-servers.cjs");

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
for (const k of ["FDC_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "BASE_URL", "LABEL_STUB_URL", "NODE_TEST_CONTEXT", "MAIL_STUB_DIR"]) delete process.env[k];

const LOGS = fs.mkdtempSync(path.join(os.tmpdir(), "fit-suites-"));
// The running app's mail directory, set by withApp for the time it runs. Whatever runs against the app gets it in its
// environment, so helpers (scripts/lib/signup.cjs) can read the emailed links. Each app has its own, under LOGS.
let currentMailDir = null;
const runNode = (args, env, timeoutMs) => runNodeRaw(args, currentMailDir ? { MAIL_STUB_DIR: currentMailDir, ...env } : env, timeoutMs);
const secrets = [...urlSecrets(DB), DB, OTHER];
const scrub = (s) => { let o = String(s); for (const x of secrets) o = o.split(x).join("<redacted>"); return o.replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/g, "$1***@"); };
const script = (f) => path.join(ROOT, "scripts", f);
const nodeTest = (f, ...flags) => ["--test", ...flags, script(f)];
// A production build refuses all of this unless it's a designated test database on this machine. See production-config.ts.
const LOCAL_TEST_SERVER = { FIT_LOCAL_TEST_SERVER: "1", FIT_TEST_OPEN_REGISTRATION: "1" };
const AI_OFF = { ANTHROPIC_API_KEY: "", ANTHROPIC_BASE_URL: "", LABEL_EXTRACTION_MODEL: "", MEAL_IDENTIFICATION_MODEL: "" };

async function withApp(name, { appEnv = {}, stubLog = false }, run) {
  const stubLogFile = path.join(LOGS, `${name}.stub.log`);
  const serverLog = path.join(LOGS, `${name}.server.log`);
  const mailDir = path.join(LOGS, `${name}.mail`);
  fs.mkdirSync(mailDir, { recursive: true });
  const stub = await startStub(stubLog ? { STUB_LOG_FILE: stubLogFile } : {});
  const port = await freePort();
  const app = spawnNode([NEXT_BIN, "start", "-p", String(port)], {
    DATABASE_URL: DB, FDC_BASE_URL: `${stub.url}/fdc/v1`, OFF_BASE_URL: `${stub.url}/off`, FDC_API_KEY: "stub", EXPOSE_DB_IDENTITY: "1", MAIL_STUB_DIR: mailDir, ...LOCAL_TEST_SERVER, ...AI_OFF, ...appEnv,
  }, { capture: true });
  const out = fs.createWriteStream(serverLog);
  app.stdout.on("data", (d) => out.write(scrub(d)));
  app.stderr.on("data", (d) => out.write(scrub(d)));
  const url = `http://localhost:${port}`;
  const outerMailDir = currentMailDir;
  try {
    await waitForChild(`${url}/login`, app);
    await verifyServerIdentity({ baseUrl: url, databaseUrl: DB });
    currentMailDir = mailDir;
    return await run({ url, stubUrl: stub.url, stubLogFile, serverLog, mailDir });
  } finally {
    currentMailDir = outerMailDir;
    fs.rmSync(mailDir, { recursive: true, force: true }); // these files hold live tokens
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

// Only when asked for by name: these bracket applying a migration, which needs the owner's approval.
const ON_DEMAND = new Set(["migration-snapshot", "migration-verify", "profile-migration-snapshot", "profile-migration-verify"]);
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
  "nutrition-targets": () => withApp("nutrition-targets", { appEnv: MANY }, ({ url }) => runNode(nodeTest("nutrition-targets.test.cjs"), { BASE_URL: url }, 300_000)),
  "nutrition-targets-e2e": () => withApp("nutrition-targets-e2e", { appEnv: MANY }, ({ url }) => runNode([script("e2e-nutrition-targets.cjs")], { BASE_URL: url }, 590_000)),
  "migration-snapshot": () => withApp("migration-snapshot", {}, ({ url }) => runNode([script("nutrition-target-migration-check.cjs"), "snapshot"], { BASE_URL: url }, 60_000)),
  "migration-verify": () => withApp("migration-verify", {}, ({ url }) => runNode([script("nutrition-target-migration-check.cjs"), "verify"], { BASE_URL: url }, 60_000)),
  "profile-minimization": () => withApp("profile-minimization", { appEnv: MANY }, ({ url }) => runNode(nodeTest("profile-minimization.test.cjs"), { BASE_URL: url }, 300_000)),
  "profile-nulls": () => withApp("profile-nulls", { appEnv: MANY }, ({ url }) => runNode(nodeTest("profile-nulls.test.cjs"), { BASE_URL: url }, 300_000)),
  "profile-minimization-e2e": () => withApp("profile-minimization-e2e", { appEnv: MANY }, ({ url }) => runNode([script("e2e-profile-minimization.cjs")], { BASE_URL: url }, 590_000)),
  "profile-migration-snapshot": () => withApp("profile-migration-snapshot", {}, ({ url }) => runNode([script("profile-migration-check.cjs"), "snapshot"], { BASE_URL: url }, 60_000)),
  "profile-migration-verify": () => withApp("profile-migration-verify", {}, ({ url }) => runNode([script("profile-migration-check.cjs"), "verify"], { BASE_URL: url }, 60_000)),
  "account-data": () => withApp("account-data", {}, ({ url }) => runNode(nodeTest("account-data.test.cjs"), { BASE_URL: url }, 590_000)),
  // TRUST_PROXY_HOPS lets each request in the suite name its own client in X-Forwarded-For, so the 10-per-15-minutes limits on sign-up and
  // on redeeming a link apply per case and not to the whole suite. Nothing is loosened: every case stays under the limit.
  "account-tokens": () => withApp("account-tokens", { appEnv: { TRUST_PROXY_HOPS: "1" } }, ({ url, serverLog }) => runNode(nodeTest("account-tokens.test.cjs"), { BASE_URL: url, SERVER_LOG_FILE: serverLog }, 590_000)),
  "privacy-consent": () => withApp("privacy-consent", { appEnv: { TRUST_PROXY_HOPS: "1" } }, ({ url }) => runNode(nodeTest("privacy-consent.test.cjs"), { BASE_URL: url }, 590_000)),
  "privacy-e2e": () => withApp("privacy-e2e", {}, ({ url }) => runNode([script("e2e-privacy.cjs")], { BASE_URL: url }, 590_000)),
  "privacy-cleanup": () => withApp("privacy-cleanup", {}, ({ url }) => runNode(nodeTest("e2e-privacy-cleanup.test.cjs"), { BASE_URL: url }, 590_000)),
  "account-data-e2e": () => withApp("account-data-e2e", {}, ({ url }) => runNode([script("e2e-account-data.cjs")], { BASE_URL: url }, 590_000)),
  "production-startup": () => runNode(nodeTest("production-startup.test.cjs"), { DATABASE_URL: "" }, 590_000),
  "production-security": () => {
    const allowed = `invited${Date.now()}@test.dev`;
    return withApp("production-security", { appEnv: { FIT_TEST_OPEN_REGISTRATION: "", REGISTRATION_ALLOWLIST: allowed } }, ({ url, serverLog }) => runNode(nodeTest("production-security.test.cjs"), { BASE_URL: url, ALLOWED_EMAIL: allowed, SERVER_LOG_FILE: serverLog }, 300_000));
  },
  "production-https": () => withApp("production-https", { appEnv: { APP_ORIGIN: "https://app.example.invalid", TRUST_PROXY_HOPS: "1" } }, ({ url }) => runNode(nodeTest("production-security.test.cjs"), { BASE_URL: url, HTTPS_ORIGIN: "https://app.example.invalid" }, 120_000)),
  "production-security-e2e": () => withApp("production-security-e2e", { appEnv: { FIT_TEST_OPEN_REGISTRATION: "" } }, ({ url }) => runNode([script("e2e-production-security.cjs")], { BASE_URL: url }, 590_000)),
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
  for (const name of asked.length ? asked : Object.keys(SUITES).filter((n) => !ON_DEMAND.has(n))) {
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
