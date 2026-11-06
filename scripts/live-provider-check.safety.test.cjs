// Regression tests for the database-safety and cleanup guarantees of
// scripts/live-provider-check.cjs. Proves the script verifies the RUNNING SERVER's
// database, and its explicit test-database marker, before any write, and that every
// record it creates is removed, including after interrupted HTTP requests and SIGTERM.
//
// THIS SUITE MODIFIES the test-database marker of SAFETY_DB_URL's database (it unmarks,
// tampers with and re-marks it). It refuses to start (and changes nothing) unless BOTH
// databases pass scripts/lib/test-db-guard.cjs: a local host, a name containing "test",
// and, for the database it modifies, SAFETY_DB_CONFIRM equal to that exact database name.
// After connecting, it re-checks the connected database name and that the server is local.
// There are no default URLs.
//
// Required environment (example values, bash):
//   SAFETY_DB_URL='postgresql://USER:PASSWORD@localhost:5432/fitdb_test'          (dedicated test DB)
//   SAFETY_DB_CONFIRM='fitdb_test'                                               (its exact name)
//   SAFETY_OTHER_DB_URL='postgresql://USER:PASSWORD@localhost:5432/fitdb_test_other' (a second test DB)
//   node --test scripts/live-provider-check.safety.test.cjs
// PowerShell: $env:SAFETY_DB_URL="..."; $env:SAFETY_DB_CONFIRM="fitdb_test"; $env:SAFETY_OTHER_DB_URL="..."; node --test scripts/live-provider-check.safety.test.cjs
// Both databases must be migrated. Requires a production build (npm run build).
"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { validateTargetUrl, assertConnectedTarget, TEST_DB_MARKER_PREFIX } = require("./lib/test-db-guard.cjs");
const { ROOT, startApp, startStub, runNode, killTree, killAll, freePort } = require("./lib/test-servers.cjs");
const { databaseUrlProblem } = require("./lib/test-target-guard.cjs");

const DB = process.env.SAFETY_DB_URL;
const CONFIRM = process.env.SAFETY_DB_CONFIRM;
const OTHER = process.env.SAFETY_OTHER_DB_URL;
const SCRIPT = path.join(ROOT, "scripts", "live-provider-check.cjs");
const MARK = path.join(ROOT, "scripts", "mark-test-database.cjs");
const reports = [];
let dbs = null, stub = null, serverDbName = null;

/** Static validation of the whole configuration. Returns a list of problems (empty = OK). */
function configProblems() {
  const problems = [];
  const main = validateTargetUrl(DB, CONFIRM);
  if (!main.ok) problems.push(...main.errors.map((e) => `SAFETY_DB_URL/SAFETY_DB_CONFIRM: ${e}`));
  let otherName = null;
  try { otherName = OTHER ? decodeURIComponent(new URL(OTHER).pathname.slice(1)) : undefined; } catch {}
  // The other database is never modified, but it's still connected to, so it must be a local test database too.
  const other = validateTargetUrl(OTHER, otherName);
  if (!other.ok) problems.push(...other.errors.map((e) => `SAFETY_OTHER_DB_URL: ${e}`));
  for (const [label, url, v] of [["SAFETY_DB_URL", DB, main], ["SAFETY_OTHER_DB_URL", OTHER, other]]) {
    const unsafe = v.ok ? databaseUrlProblem(url) : null;
    if (unsafe) problems.push(`${label}: ${unsafe.message}`);
  }
  if (main.ok && other.ok && main.dbName === other.dbName) problems.push("SAFETY_OTHER_DB_URL must be a different database from SAFETY_DB_URL");
  return { problems, dbName: main.dbName };
}

/** Every write to the marker goes through here: re-validate, re-check the connection, then write. */
async function guardedMarkerWrite(sql) {
  const { problems, dbName } = configProblems();
  if (problems.length) throw new Error(`refusing to modify the marker: ${problems.join("; ")}`);
  await assertConnectedTarget((q) => dbs.server.$queryRawUnsafe(q), dbName);
  await dbs.server.$executeRawUnsafe(sql);
}
const setMarkerRaw = (value) => guardedMarkerWrite(
  `COMMENT ON DATABASE "${serverDbName}" IS ${value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`}`);
const markScript = (args) => runNode([MARK, ...args], { DATABASE_URL: DB }, 60_000);
async function markProperly() {
  const { problems } = configProblems();
  if (problems.length) throw new Error(`refusing to mark: ${problems.join("; ")}`);
  const r = await markScript(["--confirm", CONFIRM]);
  assert.equal(r.code, 0, r.out);
}
const readMarker = async () =>
  (await dbs.server.$queryRawUnsafe("SELECT shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') AS m"))[0].m;

/** Every row the script could create, in a database. */
async function counts(db) {
  const [users, sessions, entries, targets, customFoods] = await Promise.all([
    db.user.count(), db.session.count(), db.foodEntry.count(), db.nutritionTarget.count(), db.food.count({ where: { userId: { not: null } } }),
  ]);
  return { users, sessions, entries, targets, customFoods };
}
const snapshot = async () => ({ server: await counts(dbs.server), other: await counts(dbs.other) });

const appEnv = (extra = {}) => ({
  DATABASE_URL: DB, FDC_BASE_URL: `${stub.url}/fdc/v1`, OFF_BASE_URL: `${stub.url}/off`, FDC_API_KEY: "stub", ...extra,
});
function runScript(env, timeoutMs = 240_000) {
  const report = path.join(os.tmpdir(), `lpc-safety-${process.pid}-${Date.now()}-${reports.length}.json`);
  reports.push(report);
  const e = { REPORT_FILE: report, LIVE_CHECK_USDA_ORACLE: "off", ...env };
  return runNode([SCRIPT], { ...e, FDC_API_KEY: "" }, timeoutMs);
}

before(async () => {
  const { problems, dbName } = configProblems();
  if (problems.length) {
    throw new Error(`REFUSING to run the safety suite (no database was touched):\n  - ${problems.join("\n  - ")}`);
  }
  serverDbName = dbName;
  const { PrismaClient } = require("@prisma/client");
  dbs = { server: new PrismaClient({ datasources: { db: { url: DB } } }), other: new PrismaClient({ datasources: { db: { url: OTHER } } }) };
  await assertConnectedTarget((q) => dbs.server.$queryRawUnsafe(q), serverDbName);
  await assertConnectedTarget((q) => dbs.other.$queryRawUnsafe(q), decodeURIComponent(new URL(OTHER).pathname.slice(1)));
  await markProperly(); // deliberate, guarded provisioning step for the dedicated test database
  assert.equal(await readMarker(), TEST_DB_MARKER_PREFIX + serverDbName);
  stub = await startStub();
});
after(async () => {
  try { if (dbs && !configProblems().problems.length) await markProperly(); } catch {} // leave the test DB validly marked
  await killAll();
  for (const r of reports) fs.rmSync(r, { force: true });
  if (dbs) { await dbs.server.$disconnect(); await dbs.other.$disconnect(); }
});

test("mismatch: server on one test DB, script on another → exit 4 before any write; no rows in either DB", { timeout: 180_000 }, async () => {
  const app = await startApp(appEnv({ EXPOSE_DB_IDENTITY: "1" }));
  try {
    const before = await snapshot();
    const r = await runScript({ BASE_URL: app.url, DATABASE_URL: OTHER });
    const after = await snapshot();
    assert.equal(r.code, 4, r.out);
    assert.match(r.out, /REFUSED \(nothing was written\): the server's database does not match/);
    assert.doesNotMatch(r.out, /Verified before any write|PASS|Cleanup/);
    assert.deepEqual(after, before, "no rows created in the server's DB or the script's DB");
  } finally { await killTree(app.child); }
});

test("server can't prove its database (identity endpoint disabled) → exit 4, no rows", { timeout: 180_000 }, async () => {
  const app = await startApp(appEnv({})); // production build without EXPOSE_DB_IDENTITY → endpoint returns 404
  try {
    const before = await snapshot();
    const r = await runScript({ BASE_URL: app.url, DATABASE_URL: DB });
    assert.equal(r.code, 4, r.out);
    assert.match(r.out, /doesn't expose \/api\/health\/db-identity/);
    assert.deepEqual(await snapshot(), before);
  } finally { await killTree(app.child); }
});

test("server unreachable → exit 4, no rows", { timeout: 60_000 }, async () => {
  const before = await snapshot();
  const r = await runScript({ BASE_URL: `http://localhost:${await freePort()}`, DATABASE_URL: DB });
  assert.equal(r.code, 4, r.out);
  assert.match(r.out, /can't reach/);
  assert.deepEqual(await snapshot(), before);
});

test("non-test database name and non-local BASE_URL → exit 4, no rows", { timeout: 60_000 }, async () => {
  const before = await snapshot();
  const devName = await runScript({ BASE_URL: "http://localhost:1", DATABASE_URL: DB.replace(/\/[^/?]+(\?|$)/, "/fitdb$1") });
  const remote = await runScript({ BASE_URL: "https://example.com", DATABASE_URL: DB });
  assert.equal(devName.code, 4, devName.out);
  assert.match(devName.out, /doesn't contain "test"/);
  assert.equal(remote.code, 4, remote.out);
  assert.match(remote.out, /is not local/);
  assert.deepEqual(await snapshot(), before);
});

test("matching DB: verification passes BEFORE the first write; run proceeds; cleanup restores row counts", { timeout: 300_000 }, async () => {
  const app = await startApp(appEnv({ EXPOSE_DB_IDENTITY: "1" }));
  try {
    const before = await snapshot();
    const r = await runScript({ BASE_URL: app.url, DATABASE_URL: DB });
    const after = await snapshot();
    assert.match(r.out, /Verified before any write: the server uses this script's database \("[^"]+"\), and it carries a valid test-database marker/);
    assert.ok(r.out.indexOf("Verified before any write") < r.out.indexOf("PASS"), "verification is reported before any check");
    assert.equal(r.code, 3, "stub data must be reported NOT LIVE");
    assert.match(r.out, /LIVE VERIFICATION: NOT LIVE/);
    assert.match(r.out, /remaining → users 0, entries 0, custom foods 0, targets 0/);
    assert.deepEqual(after, before, "every row the run created was removed, and the other DB is untouched");
  } finally { await killTree(app.child); }
});

// ─── Explicit test-database marker ──────────────────────────────────────────

test("provisioning script refuses without the exact --confirm name and leaves the marker unchanged", { timeout: 60_000 }, async () => {
  const before = await readMarker();
  for (const args of [[], ["--confirm"], ["--confirm", "fitdb"], ["--remove", "--confirm", "wrong"]]) {
    const r = await markScript(args);
    assert.equal(r.code, 4, `${args.join(" ")}: ${r.out}`);
    assert.match(r.out, /NOT MARKED \(nothing changed\)/);
  }
  assert.equal(await readMarker(), before);
});

test("MISSING marker: matching DB but no test-database marker → exit 4 before any write, no rows", { timeout: 180_000 }, async () => {
  const unmark = await markScript(["--remove", "--confirm", CONFIRM]);
  assert.equal(unmark.code, 0, unmark.out);
  assert.equal(await readMarker(), null);
  const app = await startApp(appEnv({ EXPOSE_DB_IDENTITY: "1" }));
  try {
    const ident = await (await fetch(`${app.url}/api/health/db-identity`)).json();
    assert.equal(ident.testMarker, null, "endpoint reports the marker as missing");
    const before = await snapshot();
    const r = await runScript({ BASE_URL: app.url, DATABASE_URL: DB });
    assert.equal(r.code, 4, r.out);
    assert.match(r.out, /REFUSED \(nothing was written\): the server's database "[^"]+" has no test-database marker/);
    assert.doesNotMatch(r.out, /Verified before any write|PASS|Cleanup/);
    assert.deepEqual(await snapshot(), before, "no rows created in either DB");
  } finally {
    await killTree(app.child);
    await markProperly();
  }
});

for (const [label, value] of [
  ["garbage value", "not a marker"],
  ["marker for a different database (e.g. restored copy)", `${TEST_DB_MARKER_PREFIX}fitdb`],
  ["wrong marker version", "fitworkoutfoodtracker:test-database:v0:SELF"],
]) {
  test(`INVALID marker (${label}) → exit 4 before any write, no rows`, { timeout: 180_000 }, async () => {
    await setMarkerRaw(value.replace("SELF", serverDbName));
    const app = await startApp(appEnv({ EXPOSE_DB_IDENTITY: "1" }));
    try {
      const ident = await (await fetch(`${app.url}/api/health/db-identity`)).json();
      if (label === "garbage value") {
        assert.equal(ident.testMarker, "<non-marker comment>", "arbitrary comment text is never echoed by the endpoint");
      }
      const before = await snapshot();
      const r = await runScript({ BASE_URL: app.url, DATABASE_URL: DB });
      assert.equal(r.code, 4, r.out);
      assert.match(r.out, /REFUSED \(nothing was written\): the server's database "[^"]+" has an invalid test-database marker/);
      assert.doesNotMatch(r.out, /Verified before any write|PASS|Cleanup/);
      assert.deepEqual(await snapshot(), before, "no rows created in either DB");
    } finally {
      await killTree(app.child);
      await markProperly();
    }
  });
}

// ─── Cleanup after interrupted HTTP requests ────────────────────────────────

/**
 * HTTP proxy to the app that holds `POST /api/auth/register` for `delayMs` BEFORE forwarding it.
 * The request body is buffered as soon as it arrives, so the delayed sign-up still reaches the app
 * (and writes) even after the client has aborted, which is exactly the late write cleanup must catch.
 */
async function delayingProxy(appUrl, delayMs) {
  const target = new URL(appUrl);
  const port = await freePort();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const forward = () => {
        const up = http.request({ host: "127.0.0.1", port: target.port, path: req.url, method: req.method, headers: req.headers }, (ur) => {
          if (res.writableEnded || res.destroyed) { ur.resume(); return; } // client already gone; the write still happened
          res.writeHead(ur.statusCode, ur.headers);
          ur.pipe(res);
        });
        up.on("error", () => { try { res.destroy(); } catch {} });
        up.end(body);
      };
      if (req.method === "POST" && req.url === "/api/auth/register") setTimeout(forward, delayMs);
      else forward();
    });
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { url: `http://localhost:${port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

test("request TIMEOUT: a sign-up that lands after the client gave up is removed by the second sweep", { timeout: 180_000 }, async () => {
  const app = await startApp(appEnv({ EXPOSE_DB_IDENTITY: "1" }));
  const proxy = await delayingProxy(app.url, 2_500);
  try {
    const before = await snapshot();
    const r = await runScript({ BASE_URL: proxy.url, DATABASE_URL: DB, LIVE_CHECK_REQUEST_TIMEOUT_MS: "1000", LIVE_CHECK_CLEANUP_GRACE_MS: "5000" });
    assert.match(r.out, /request timed out after 1000 ms/);
    assert.match(r.out, /second sweep removed 1 late-created test user/);
    assert.match(r.out, /remaining → users 0, entries 0, custom foods 0, targets 0/);
    assert.equal(r.code, 1, r.out); // stopped early → INCOMPLETE, cleanup succeeded
    assert.deepEqual(await snapshot(), before, "no rows left behind");
  } finally { await proxy.close(); await killTree(app.child); }
});

test("SIGTERM during a hung request: aborts it, waits for the late write, removes it, exits 130", { timeout: 180_000, skip: process.platform === "win32" && "POSIX signal delivery; on Windows termination is covered by SIGBREAK/SIGHUP handlers, untested here" }, async () => {
  const app = await startApp(appEnv({ EXPOSE_DB_IDENTITY: "1" }));
  const proxy = await delayingProxy(app.url, 3_000);
  try {
    const before = await snapshot();
    const report = path.join(os.tmpdir(), `lpc-safety-sigterm-${process.pid}.json`);
    reports.push(report);
    const pending = runNode([SCRIPT], { BASE_URL: proxy.url, DATABASE_URL: DB, REPORT_FILE: report, LIVE_CHECK_USDA_ORACLE: "off",
      LIVE_CHECK_CLEANUP_GRACE_MS: "6000", FDC_API_KEY: "" }, 120_000);
    await new Promise((r) => setTimeout(r, 1_500)); // the first sign-up is now held by the proxy
    const { children } = require("./lib/test-servers.cjs");
    const scriptChild = [...children].find((c) => c.spawnargs.includes(SCRIPT));
    assert.ok(scriptChild, "script process found");
    process.kill(scriptChild.pid, "SIGTERM");
    const r = await pending;
    assert.equal(r.code, 130, r.out);
    assert.match(r.out, /Interrupted \(SIGTERM\)/);
    assert.match(r.out, /second sweep removed 1 late-created test user/);
    assert.match(r.out, /remaining → users 0/);
    assert.deepEqual(await snapshot(), before, "no rows left behind");
  } finally { await proxy.close(); await killTree(app.child); }
});
