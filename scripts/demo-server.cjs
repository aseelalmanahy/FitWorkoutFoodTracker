// The one local application (ENV-01): the newest build, on fitdb_test, with the existing demo account and the live
// USDA and Open Food Facts services, at http://localhost:3400, until stopped with Ctrl+C:
//   npm run local          (the same as: node --env-file=.env.test scripts/demo-server.cjs --confirm=fitdb_test)
// Before starting, it checks, and only reads:
//   - the build is newer than every source file, so it serves the code in this folder;
//   - fitdb_test is the marked local test database, with exactly the migrations this code has. It never migrates:
//     a missing migration is refused, as applying one needs the owner's approval;
//   - the demo account exists. It never creates an account or adds data;
//   - FDC_API_KEY is in .env.test, and USDA and Open Food Facts answer. It never prints the key.
// A1: --app-dir=<folder> serves another folder's existing production build, with that folder's own Next.js.
// Paid AI stays off (label and meal photos are read on this machine), registration stays closed, and mail goes only to
// a temporary folder. Loopback only (SEC-01).
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { databaseUrlProblem, environmentProblems, verifyServerIdentity } = require("./lib/test-target-guard.cjs");
const { assertConnectedTarget, TEST_DB_MARKER_PREFIX } = require("./lib/test-db-guard.cjs");
const { DEMO_EMAIL } = require("./lib/demo-account-data.cjs");
const { ROOT, NEXT_BIN, LOOPBACK_HOST, spawnNode, waitForChild, killTree, portInUse } = require("./lib/test-servers.cjs");

const TARGET = "fitdb_test";
const DEFAULT_PORT = 3400;
const refuse = (message) => { console.error(`REFUSED (nothing was started): ${message}`); process.exit(4); };

const args = process.argv.slice(2);
const portArg = args.find((a) => a.startsWith("--port="));
const appDirArg = args.find((a) => a.startsWith("--app-dir="));
if (!args.includes(`--confirm=${TARGET}`) || args.some((a) => a !== `--confirm=${TARGET}` && a !== portArg && a !== appDirArg)) refuse(`use --confirm=${TARGET}, and optionally --port=<number> and --app-dir=<folder>.`);
const APP_DIR = appDirArg ? path.resolve(appDirArg.slice("--app-dir=".length)) : ROOT;
const APP_NEXT_BIN = appDirArg ? path.join(APP_DIR, "node_modules", "next", "dist", "bin", "next") : NEXT_BIN;
if (appDirArg) {
  let name = null;
  try { name = JSON.parse(fs.readFileSync(path.join(APP_DIR, "package.json"), "utf8")).name; } catch { /* refused below */ }
  if (name !== "fit-workout-food-tracker") refuse("--app-dir must be a folder of this application.");
  if (!fs.existsSync(APP_NEXT_BIN)) refuse("--app-dir has no installed Next.js.");
}
const port = portArg ? Number(portArg.slice("--port=".length)) : DEFAULT_PORT;
if (!Number.isInteger(port) || port < 1024 || port > 65535) refuse("the port must be a number from 1024 to 65535.");
const envFiles = process.execArgv.filter((a) => a.startsWith("--env-file"));
if (envFiles.length !== 1 || !envFiles[0].startsWith("--env-file=") || path.basename(envFiles[0].slice("--env-file=".length)) !== ".env.test") refuse("run this with exactly --env-file=.env.test.");
if (process.env.DATABASE_URL !== parseEnv(fs.readFileSync(envFiles[0].slice("--env-file=".length), "utf8")).DATABASE_URL) refuse("a DATABASE_URL already in this shell differs from .env.test's. In PowerShell, run: Remove-Item Env:DATABASE_URL");
const DB = process.env.DATABASE_URL;
const problems = [databaseUrlProblem(DB), ...environmentProblems(process.env)].filter(Boolean);
if (problems.length) refuse(problems.map((p) => p.message).join(" | "));
if (decodeURIComponent(new URL(DB).pathname.slice(1)) !== TARGET) refuse(`DATABASE_URL must name ${TARGET} exactly.`);
const BUILD_ID = path.join(APP_DIR, ".next", "BUILD_ID");
if (!fs.existsSync(BUILD_ID)) refuse("there's no production build. Run the build in docs/MANUAL_UI_TESTING_GUIDE.md first.");

/** The newest source file that a build compiles in, so a build older than the code is never served. */
function newestSource() {
  let newest = { file: null, mtime: 0 };
  const visit = (p) => {
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) { for (const f of fs.readdirSync(p)) visit(path.join(p, f)); return; }
    if (st.mtimeMs > newest.mtime) newest = { file: path.relative(APP_DIR, p), mtime: st.mtimeMs };
  };
  for (const p of ["src", "public", "prisma/schema.prisma", "package-lock.json", "next.config.ts"]) visit(path.join(APP_DIR, p));
  return newest;
}
const stale = newestSource();
if (stale.mtime > fs.statSync(BUILD_ID).mtimeMs) refuse(`the build is older than ${stale.file}, so it wouldn't serve this folder's code. Run the build in docs/MANUAL_UI_TESTING_GUIDE.md first.`);

const FDC_KEY = process.env.FDC_API_KEY;
if (!FDC_KEY || FDC_KEY === "stub") refuse("FDC_API_KEY isn't in .env.test, so USDA foods can't be searched. Add the free key from https://fdc.nal.usda.gov/api-key-signup (it's never printed).");
// The app's own defaults are the live services; an address left in the shell from a test run must not replace them.
for (const k of ["FDC_BASE_URL", "OFF_BASE_URL", "ANTHROPIC_BASE_URL", "FOOD_RATE_LIMIT_MULTIPLIER"]) delete process.env[k];
const scrub = (s) => { let out = String(s); for (const x of [new URL(DB).password, FDC_KEY]) if (x && x.length >= 3) out = out.split(x).join("<redacted>"); return out; };

/** Read-only: the database's migrations against this code's, and the demo account. Refuses on any mismatch. */
async function checkDatabase() {
  const migrationsDir = path.join(APP_DIR, "prisma", "migrations");
  const expected = fs.readdirSync(migrationsDir).filter((f) => fs.statSync(path.join(migrationsDir, f)).isDirectory()).sort();
  const { PrismaClient } = require("@prisma/client");
  const client = new PrismaClient({ datasources: { db: { url: DB } }, errorFormat: "minimal" });
  try {
    return await client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await assertConnectedTarget((sql) => tx.$queryRawUnsafe(sql), TARGET);
      const [mark] = await tx.$queryRawUnsafe("SELECT shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') AS marker");
      if (!String(mark?.marker ?? "").startsWith(TEST_DB_MARKER_PREFIX)) throw new Error(`${TARGET} doesn't carry the test-database marker`);
      const rows = await tx.$queryRawUnsafe(`SELECT migration_name AS name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS ok FROM "_prisma_migrations"`);
      const failed = rows.filter((r) => !r.ok).map((r) => r.name);
      const applied = new Set(rows.filter((r) => r.ok).map((r) => r.name));
      const missing = expected.filter((m) => !applied.has(m));
      const unknown = [...applied].filter((m) => !expected.includes(m));
      if (failed.length) throw new Error(`${TARGET} has a failed or rolled-back migration: ${failed.join(", ")}`);
      if (missing.length) throw new Error(`${TARGET} doesn't have ${missing.join(", ")}, which this code needs. This never migrates: applying a migration to ${TARGET} needs the owner's approval`);
      if (unknown.length) throw new Error(`${TARGET} has ${unknown.join(", ")}, which this code doesn't know: it's an older build. Use the newest one`);
      const [demo] = await tx.$queryRawUnsafe(
        `SELECT u.id, (SELECT count(*)::int FROM "WorkoutTemplate" WHERE "userId" = u.id) AS plans, (SELECT count(*)::int FROM "WorkoutSession" WHERE "userId" = u.id) AS workouts, (SELECT count(*)::int FROM "FoodEntry" WHERE "userId" = u.id) AS foods FROM "User" u WHERE u.email = $1`, DEMO_EMAIL);
      if (!demo) throw new Error(`the demo account ${DEMO_EMAIL} isn't in ${TARGET}. This never creates accounts`);
      return { migrations: expected.length, demo };
    });
  } finally { await client.$disconnect().catch(() => {}); }
}

/** One small request to each food service, so a missing key or an outage is said before testing starts. */
async function checkFoodServices() {
  const get = async (url, headers) => {
    try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) }); return r.ok ? "answers" : `answered ${r.status}`; }
    catch (e) { return `didn't answer (${e.name === "TimeoutError" ? "timed out" : "unreachable"})`; }
  };
  const [usda, off] = await Promise.all([
    get("https://api.nal.usda.gov/fdc/v1/foods/search?query=apple&pageSize=1", { "X-Api-Key": FDC_KEY, Accept: "application/json" }),
    get("https://world.openfoodfacts.org/api/v2/product/3017620422003.json?fields=code", { "User-Agent": "FitWorkoutFoodTracker/0.2 (https://github.com/aseelalmanahy/fitworkoutfoodtracker)", Accept: "application/json" }),
  ]);
  return { usda, off };
}

(async () => {
  if (await portInUse(port)) refuse(`port ${port} is already in use. Stop what's using it, or add --port=<number>.`);
  let db;
  try { db = await checkDatabase(); } catch (e) { refuse(scrub(e.message)); }
  console.log(`${TARGET}: the marked local test database, with all ${db.migrations} migrations this code has, and nothing else.`);
  console.log(`Demo account ${DEMO_EMAIL}: present, with ${db.demo.plans} plans, ${db.demo.workouts} workouts and ${db.demo.foods} food entries.`);
  const food = await checkFoodServices();
  console.log(`USDA FoodData Central (key from .env.test): ${food.usda}. Open Food Facts: ${food.off}.`);
  if (food.usda !== "answers" || food.off !== "answers") console.log("The app starts anyway; searches of a service that doesn't answer will say so.");
  const mailDir = fs.mkdtempSync(path.join(os.tmpdir(), "fit-demo-mail-"));
  // Only this machine can reach it (SEC-01): it holds the demo sign-in and publishes its database identity.
  const app = spawnNode([APP_NEXT_BIN, "start", "-H", LOOPBACK_HOST, "-p", String(port)], {
    DATABASE_URL: DB, FDC_API_KEY: FDC_KEY, EXPOSE_DB_IDENTITY: "1", MAIL_STUB_DIR: mailDir, FIT_LOCAL_TEST_SERVER: "1",
    ANTHROPIC_API_KEY: "", LABEL_EXTRACTION_MODEL: "", MEAL_IDENTIFICATION_MODEL: "", LABEL_OCR: "local", MEAL_RECOGNITION: "local",
  }, { cwd: APP_DIR });
  let stopping = false;
  const stop = async (code) => {
    if (stopping) return;
    stopping = true;
    await killTree(app).catch(() => {});
    fs.rmSync(mailDir, { recursive: true, force: true });
    process.exit(code);
  };
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));
  app.once("exit", () => { console.error("The application stopped."); stop(1); });
  const url = `http://localhost:${port}`;
  try {
    await waitForChild(`${url}/login`, app);
    await verifyServerIdentity({ baseUrl: url, databaseUrl: DB });
  } catch (e) {
    console.error(`REFUSED: the server couldn't be verified as using ${TARGET}: ${scrub(e.message)}`);
    return stop(4);
  }
  console.log(`Running at ${url} (127.0.0.1 only) from ${APP_DIR}, verified on ${TARGET}. Sign-in details are in demo-account.local.md. Press Ctrl+C to stop.`);
})().catch((e) => { console.error(`FAILED: ${scrub(e.message).slice(0, 200)}`); process.exit(1); });
