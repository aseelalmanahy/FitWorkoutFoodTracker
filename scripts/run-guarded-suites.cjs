// Runs the integration and E2E suites against local test databases, with stub providers.
// See docs/PHASE_4_0_0A_TEST_TARGET_GUARD.md. Needs a production build.
//   node --env-file=.env.test scripts/run-guarded-suites.cjs [suite names...]
// DATABASE_URL must name fitdb_test or fitdb_test_isolated, exactly. Each has one companion, derived from it by name only
// (fitdb_test_other, fitdb_test_isolated_other), which the two cross-database suites compare it with. Prints no credentials.
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { databaseUrlProblem, environmentProblems, verifyServerIdentity, COMPANION_TEST_DATABASES } = require("./lib/test-target-guard.cjs");
const { urlSecrets } = require("./lib/test-db-guard.cjs");
const { ROOT, NEXT_BIN, LOOPBACK_HOST, startStub, freePort, spawnNode, waitForChild, killTree, killAll, runNode: runNodeRaw } = require("./lib/test-servers.cjs");

const DB = process.env.DATABASE_URL;
const unsafe = [databaseUrlProblem(DB), ...environmentProblems(process.env)].filter(Boolean);
// The databases this runner may write to, and nothing else.
const RUNNABLE = ["fitdb_test", "fitdb_test_isolated"];
const TARGET = unsafe.length ? null : decodeURIComponent(new URL(DB).pathname.slice(1));
if (!unsafe.length && !RUNNABLE.includes(TARGET)) unsafe.push({ message: `DATABASE_URL must name ${RUNNABLE.join(" or ")}.` });
if (unsafe.length) {
  console.error(`REFUSING to run (no database was touched):\n  - ${unsafe.map((p) => p.message).join("\n  - ")}`);
  process.exit(4);
}
const OTHER_NAME = COMPANION_TEST_DATABASES[TARGET];
const otherUrl = new URL(DB);
otherUrl.pathname = `/${OTHER_NAME}`;
const OTHER = otherUrl.toString();
// Only stubs and fake keys from here on, including in every child process.
for (const k of ["FDC_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "BASE_URL", "LABEL_STUB_URL", "NODE_TEST_CONTEXT", "MAIL_STUB_DIR"]) delete process.env[k];

// RC-04: one guarded run at a time on this machine. Two at once (or a run beside other browser work) starved the
// browsers of CPU: a traced failure showed Firefox delivering no click and drawing 2 frames in 34 s while the app
// answered in milliseconds. A lock left by a run that no longer exists is taken over.
const LOCK = path.join(os.tmpdir(), "fit-guarded-suites.lock");
function takeLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" }); return; } catch (e) { if (e.code !== "EEXIST") throw e; }
    const holder = Number(fs.readFileSync(LOCK, "utf8"));
    let alive = false;
    try { process.kill(holder, 0); alive = true; } catch (e) { alive = e.code === "EPERM"; }
    if (alive && holder !== process.pid) {
      console.error(`REFUSED: another guarded run (process ${holder}) is in progress. Running two at once starves the browsers and makes results unreliable (RC-04).`);
      process.exit(4);
    }
    fs.rmSync(LOCK, { force: true }); // left by a run that has ended
  }
  throw new Error("couldn't take the run lock");
}
takeLock();
process.on("exit", () => { try { if (Number(fs.readFileSync(LOCK, "utf8")) === process.pid) fs.rmSync(LOCK, { force: true }); } catch { /* already gone */ } });
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
  const app = spawnNode([NEXT_BIN, "start", "-H", LOOPBACK_HOST, "-p", String(port)], {
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
const SAFETY_ENV = { SAFETY_DB_URL: DB, SAFETY_DB_CONFIRM: TARGET, SAFETY_OTHER_DB_URL: OTHER };
// These two compare the target with its companion, so they run only where the companion exists and carries its marker.
const NEEDS_OTHER = new Set(["safety-no-marker", "db-guard-scoped"]);
/** Read only: whether the companion exists here with exactly its own test marker. */
async function companionReady() {
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: DB } } });
  try {
    const rows = await db.$queryRawUnsafe("SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = $1", OTHER_NAME);
    return rows.length === 1 && rows[0].marker === `fitworkoutfoodtracker:test-database:v1:${OTHER_NAME}`;
  } finally { await db.$disconnect(); }
}

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
  if (!before.includes(`"fitworkoutfoodtracker:test-database:v1:${TARGET}"`)) throw new Error(`${TARGET} isn't marked, and this runner won't mark it`);
  const result = await run();
  if ((await markerRow()) !== before) throw new Error("the marker's row changed");
  return result;
}

// Only when asked for by name: these bracket applying a migration, which needs the owner's approval.
const ON_DEMAND = new Set(["migration-snapshot", "migration-verify", "profile-migration-snapshot", "profile-migration-verify", "demo-account-e2e"]);
const SUITES = {
  guard: () => runNode(nodeTest("test-target-guard.test.cjs"), { DATABASE_URL: "" }, 300_000),
  "mig-04-refusals": () => runNode(nodeTest("mig-04.test.cjs"), { DATABASE_URL: "" }, 120_000),
  "account-facts": () => runNode(nodeTest("account-facts.test.cjs"), { DATABASE_URL: "" }, 120_000),
  "demo-account": () => runNode(nodeTest("demo-account.test.cjs"), { DATABASE_URL: "" }, 120_000),
  // By hand, once the demo account exists. It signs in with the password in demo-account.local.md, which it never prints.
  "demo-account-e2e": () => withApp("demo-account-e2e", {}, ({ url }) => runNode([script("e2e-demo-account.cjs")], { BASE_URL: url, SHOTS_DIR: LOGS }, 590_000)),
  "guard-browser": () => runNode(nodeTest("test-target-guard.browser.test.cjs"), { DATABASE_URL: "" }, 300_000),
  // RC-02: no database or app; stand-in processes only.
  "server-lifecycle": () => runNode(nodeTest("server-lifecycle.test.cjs"), { DATABASE_URL: "" }, 120_000),
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
  // Phase 5: one administrator per run, a fresh ID the app is started with and the suite then creates.
  "feedback-api": () => { const id = `c${require("node:crypto").randomBytes(12).toString("hex")}`; return withApp("feedback-api", { appEnv: { ADMIN_USER_IDS: id } }, ({ url }) => runNode(nodeTest("feedback-api.test.cjs"), { BASE_URL: url, FEEDBACK_ADMIN_ID: id }, 300_000)); },
  // TRUST_PROXY_HOPS lets each request in the suite name its own client in X-Forwarded-For, so the 10-per-15-minutes limits on sign-up and
  // on redeeming a link apply per case and not to the whole suite. Nothing is loosened: every case stays under the limit.
  "account-tokens": () => withApp("account-tokens", { appEnv: { TRUST_PROXY_HOPS: "1" } }, ({ url, serverLog }) => runNode(nodeTest("account-tokens.test.cjs"), { BASE_URL: url, SERVER_LOG_FILE: serverLog }, 590_000)),
  "privacy-consent": () => withApp("privacy-consent", { appEnv: { TRUST_PROXY_HOPS: "1" } }, ({ url }) => runNode(nodeTest("privacy-consent.test.cjs"), { BASE_URL: url }, 590_000)),
  "privacy-e2e": () => withApp("privacy-e2e", {}, ({ url }) => runNode([script("e2e-privacy.cjs")], { BASE_URL: url }, 590_000)),
  "privacy-cleanup": () => withApp("privacy-cleanup", {}, ({ url }) => runNode(nodeTest("e2e-privacy-cleanup.test.cjs"), { BASE_URL: url }, 590_000)),
  "weight-progress": () => withApp("weight-progress", {}, ({ url }) => runNode(nodeTest("weight-progress.test.cjs"), { BASE_URL: url }, 300_000)),
  "weight-e2e": () => withApp("weight-e2e", {}, ({ url }) => runNode([script("e2e-weight.cjs")], { BASE_URL: url }, 590_000)),
  pwa: () => withApp("pwa", {}, ({ url }) => runNode([script("e2e-pwa.cjs")], { BASE_URL: url }, 300_000)),
  barcode: () => withApp("barcode", {}, ({ url }) => runNode([script("e2e-barcode.cjs")], { BASE_URL: url }, 300_000)),
  "workout-import-api": () => withApp("workout-import-api", {}, ({ url }) => runNode(nodeTest("workout-import-api.test.cjs"), { BASE_URL: url }, 300_000)),
  "workout-import": () => withApp("workout-import", {}, ({ url }) => runNode([script("e2e-workout-import.cjs")], { BASE_URL: url }, 590_000)),
  responsive: () => withApp("responsive", { appEnv: MANY }, ({ url }) => runNode([script("e2e-responsive.cjs")], { BASE_URL: url }, 590_000)),
  // Multi-gym: gyms, equipment, machines, swaps and machine-specific history, through the API.
  "gyms-api": () => withApp("gyms-api", {}, ({ url }) => runNode(nodeTest("gyms-api.test.cjs"), { BASE_URL: url }, 300_000)),
  "workout-sets": () => withApp("workout-sets", {}, ({ url }) => runNode(nodeTest("workout-sets.test.cjs"), { BASE_URL: url }, 300_000)),
  "readiness-performance": () => withApp("readiness-performance", {}, ({ url }) => runNode(nodeTest("readiness-performance.test.cjs"), { BASE_URL: url }, 300_000)),
  "readiness-e2e": () => withApp("readiness-e2e", {}, ({ url }) => runNode([script("e2e-readiness.cjs")], { BASE_URL: url, SHOTS_DIR: LOGS }, 590_000)),
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
  // RC-07: on-device label and meal reading, and what the pages say about where images are read.
  "label-local": () => withApp("label-local", { appEnv: { LABEL_OCR: "local", MEAL_RECOGNITION: "local" } }, ({ url }) => runNode([script("e2e-label-scan.cjs")], { BASE_URL: url, EXPECT_LOCAL: "1", SHOTS_DIR: LOGS }, 300_000)),
  "usda-missing-nutrients": () => runNode(nodeTest("usda-missing-nutrients.test.cjs"), { SAFETY_DB_URL: DB, SAFETY_DB_CONFIRM: TARGET }, 420_000),
  "safety-no-marker": () => withoutMarkerWrite(() => runNode(nodeTest("live-provider-check.safety.test.cjs", "--test-skip-pattern=MISSING marker|INVALID marker"), SAFETY_ENV, 900_000)),
  "db-guard-scoped": () => withoutMarkerWrite(() => runNode(nodeTest("test-db-guard.test.cjs"), { SAFETY_DB_URL: DB, GUARD_SNAPSHOT_SCOPE: "designated", GUARD_SNAPSHOT_DATABASES: `${TARGET},${OTHER_NAME}` }, 600_000)),
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
  // Each target has its own companion. Where it isn't prepared yet, the suites needing it are refused if asked for, and
  // otherwise listed as not run; they're never pointed at another database instead.
  const withOther = await companionReady();
  const needsOther = withOther ? [] : asked.filter((n) => NEEDS_OTHER.has(n));
  if (needsOther.length) throw new Error(`${needsOther.join(", ")} compare ${TARGET} with ${OTHER_NAME}, which doesn't exist here with its marker, so they don't run.`);
  if (TARGET !== "fitdb_test" && asked.includes("demo-account-e2e")) throw new Error("demo-account-e2e needs the demo account, which exists only in fitdb_test.");
  let ok = true;
  const defaults = Object.keys(SUITES).filter((n) => !ON_DEMAND.has(n) && (withOther || !NEEDS_OTHER.has(n)));
  if (!asked.length && !withOther) console.log(`On ${TARGET}: not run here, as they need ${OTHER_NAME}, which isn't prepared: ${[...NEEDS_OTHER].join(", ")}.`);
  for (const name of asked.length ? asked : defaults) {
    const t0 = Date.now();
    // RC-08: each suite's guard proxy traces its connections to this run's log folder (no headers or bodies).
    process.env.FIT_GUARD_PROXY_TRACE = path.join(LOGS, `${name}.proxy.jsonl`);
    try { ok = report(name, await SUITES[name](), Date.now() - t0) && ok; } catch (e) {
      ok = false;
      console.log(`FAIL  ${name.padEnd(24)} ${scrub(e.message).slice(0, 240)}`);
    }
  }
  console.log(`Logs: ${LOGS}`);
  await killAll();
  process.exit(ok ? 0 : 1);
})().catch(async (e) => { console.error(scrub(e.message)); await killAll(); process.exit(1); });
