// Negative tests for the test-database marker guards (Issue 1 of the Phase 2.5 review).
// Proves that the marking tool (scripts/mark-test-database.cjs) and the safety suite
// (scripts/live-provider-check.safety.test.cjs) REFUSE remote hosts, non-test database names,
// mismatched names, missing confirmations and post-connection mismatches, and that a rejected
// configuration changes NOTHING: the comments (markers) on every database in the cluster and
// the row counts in the test databases are compared before and after. It never connects to the
// dev database: its marker is read through the shared catalog, and its refusals are static.
//
// Reads only, through SAFETY_DB_URL (validated as a local test database first):
//   SAFETY_DB_URL='postgresql://USER:PASSWORD@localhost:5432/fitdb_test' node --test scripts/test-db-guard.test.cjs
// Optional: GUARD_DEV_DB_NAME (default "fitdb"), the dev database the tests try, and must fail, to mark.
// Optional: GUARD_SNAPSHOT_SCOPE=designated reads markers for the target and its companion only (GUARD_SNAPSHOT_DATABASES,
// default fitdb_test,fitdb_test_other), so the dev database's comment isn't read. The before-and-after comparison then
// doesn't cover other databases. Every name in it must be a designated test database.
// B1: the target can be fitdb_test_isolated, whose companion is fitdb_test_isolated_other.
"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { validateTargetUrl, assertConnectedTarget, redact, urlSecrets } = require("./lib/test-db-guard.cjs");
const { ROOT, runNode } = require("./lib/test-servers.cjs");
const { DESIGNATED_TEST_DATABASES, COMPANION_TEST_DATABASES } = require("./lib/test-target-guard.cjs");

const READ_URL = process.env.SAFETY_DB_URL;
const DEV_DB = process.env.GUARD_DEV_DB_NAME || "fitdb";
const NAME = READ_URL ? decodeURIComponent(new URL(READ_URL).pathname.slice(1)) : "fitdb_test";
const COMPANION = COMPANION_TEST_DATABASES[NAME] ?? "fitdb_test_other";
const SCOPE = (process.env.GUARD_SNAPSHOT_DATABASES || "fitdb_test,fitdb_test_other").split(",");
if (!SCOPE.every((n) => DESIGNATED_TEST_DATABASES.includes(n))) throw new Error("GUARD_SNAPSHOT_DATABASES may name designated test databases only.");
const MARK = path.join(ROOT, "scripts", "mark-test-database.cjs");
const SAFETY = path.join(ROOT, "scripts", "live-provider-check.safety.test.cjs");
let reader = null;
const withDb = (url, name) => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const withHost = (url, host) => { const u = new URL(url); u.hostname = host; return u.toString(); };
/** The real password(s) from SAFETY_DB_URL: none may appear in any refusal output. */
const noPassword = (out, label) => {
  for (const s of urlSecrets(READ_URL)) assert.equal(out.includes(s), false, `${label}: no password in output`);
};

/** Markers on every database in the cluster, plus user counts in the test databases. */
async function clusterSnapshot() {
  const comments = await reader.$queryRawUnsafe(
    `SELECT datname, shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE NOT datistemplate ${process.env.GUARD_SNAPSHOT_SCOPE === "designated" ? `AND datname IN (${SCOPE.map((n) => `'${n}'`).join(", ")}) ` : ""}ORDER BY datname`);
  const { PrismaClient } = require("@prisma/client");
  const users = {};
  for (const { datname } of comments) {
    if (!/^fitdb_test/.test(datname)) continue;
    const c = new PrismaClient({ datasources: { db: { url: withDb(READ_URL, datname) } } });
    try { users[datname] = await c.user.count(); } catch { users[datname] = "n/a"; } finally { await c.$disconnect(); }
  }
  return { comments, users };
}

before(async () => {
  const name = READ_URL ? decodeURIComponent(new URL(READ_URL).pathname.slice(1)) : undefined;
  const v = validateTargetUrl(READ_URL, name);
  if (!v.ok) throw new Error(`REFUSING: SAFETY_DB_URL must be a local test database: ${v.errors.join("; ")}`);
  const { PrismaClient } = require("@prisma/client");
  reader = new PrismaClient({ datasources: { db: { url: READ_URL } } });
  await assertConnectedTarget((q) => reader.$queryRawUnsafe(q), v.dbName);
});
after(async () => { if (reader) await reader.$disconnect(); });

// ─── Unit: static validation (no connection) ────────────────────────────────

test("validateTargetUrl rejects remote hosts, host overrides, non-test names, bad names, missing/mismatched confirmation", () => {
  const ok = "postgresql://u:p@localhost:5432/fitdb_test";
  assert.equal(validateTargetUrl(ok, "fitdb_test").ok, true);
  assert.equal(validateTargetUrl("postgresql://u:p@127.0.0.1/fitdb_test", "fitdb_test").ok, true);
  assert.equal(validateTargetUrl("postgresql://u:p@[::1]:5432/fitdb_test", "fitdb_test").ok, true);
  const bad = [
    ["postgresql://u:p@db.example.com:5432/fitdb_test", "fitdb_test", /not local/],
    ["postgresql://u:p@10.0.0.5/fitdb_test", "fitdb_test", /not local/],
    ["postgresql://u:p@localhost.example.com/fitdb_test", "fitdb_test", /not local/],
    ["postgresql://u:p@localhost/fitdb_test?host=/var/run/x", "fitdb_test", /host=/],
    ["postgresql://u:p@localhost/fitdb_test?host=db.example.com", "fitdb_test", /host=/],
    ["postgresql://u:p@localhost/fitdb", "fitdb", /doesn't contain "test"/],
    ["postgresql://u:p@localhost/production", "production", /doesn't contain "test"/],
    ["postgresql://u:p@localhost/fit-test", "fit-test", /letters, digits and _/],
    ["postgresql://u:p@localhost/fitdb_test", undefined, /no confirmation/],
    ["postgresql://u:p@localhost/fitdb_test", "", /no confirmation/],
    ["postgresql://u:p@localhost/fitdb_test", "fitdb_test_other", /doesn't match/],
    ["postgresql://u:p@localhost/fitdb_test", "FITDB_TEST", /doesn't match/],
    ["mysql://u:p@localhost/fitdb_test", "fitdb_test", /unsupported protocol/],
    ["not a url", "x", /can't be parsed/],
    [undefined, "x", /no database URL/],
  ];
  for (const [url, confirm, re] of bad) {
    const v = validateTargetUrl(url, confirm);
    assert.equal(v.ok, false, `${url} / ${confirm} must be rejected`);
    assert.match(v.errors.join("; "), re, `${url} / ${confirm}`);
  }
});

test("assertConnectedTarget rejects a different connected database and a non-local server address", async () => {
  const q = (name, addr) => async () => [{ name, addr }];
  await assertConnectedTarget(q("fitdb_test", null), "fitdb_test"); // local socket
  await assertConnectedTarget(q("fitdb_test", "127.0.0.1"), "fitdb_test");
  await assertConnectedTarget(q("fitdb_test", "::1"), "fitdb_test");
  await assert.rejects(assertConnectedTarget(q("fitdb", "127.0.0.1"), "fitdb_test"), /connected to database "fitdb", expected "fitdb_test"/);
  await assert.rejects(assertConnectedTarget(q("fitdb_test", "10.1.2.3"), "fitdb_test"), /10\.1\.2\.3 is not local/);
});

test("redact removes both encoded and decoded URL passwords", () => {
  const s = urlSecrets("postgresql://u:p%40ss%2Fw0rd@localhost/x");
  assert.equal(redact("auth failed for p%40ss%2Fw0rd / p@ss/w0rd", s), "auth failed for <redacted> / <redacted>");
});

// ─── CLI: mark-test-database.cjs refuses and changes nothing ───────────────

test("mark-test-database.cjs refuses every unsafe configuration; markers and rows unchanged everywhere", { timeout: 120_000 }, async () => {
  const before = await clusterSnapshot();
  const cases = [
    ["remote host", withHost(READ_URL, "db.example.invalid"), ["--confirm", NAME], /not local/],
    ["remote IP", withHost(READ_URL, "10.255.255.1"), ["--confirm", NAME], /not local/],
    ["host= override", `${READ_URL}${READ_URL.includes("?") ? "&" : "?"}host=db.example.invalid`, ["--confirm", NAME], /host=/],
    ["dev database (non-test name)", withDb(READ_URL, DEV_DB), ["--confirm", DEV_DB], /doesn't contain "test"/],
    ["dev database, remove", withDb(READ_URL, DEV_DB), ["--remove", "--confirm", DEV_DB], /doesn't contain "test"/],
    ["mismatched confirmation", READ_URL, ["--confirm", COMPANION], /doesn't match/],
    ["missing confirmation", READ_URL, [], /no confirmation/],
    ["confirmation flag without value", READ_URL, ["--confirm"], /no confirmation/],
    ["missing confirmation, remove", READ_URL, ["--remove"], /no confirmation/],
  ];
  for (const [label, url, args, re] of cases) {
    const t0 = Date.now();
    const r = await runNode([MARK, ...args], { DATABASE_URL: url }, 30_000);
    assert.equal(r.code, 4, `${label}: ${r.out}`);
    assert.match(r.out, /NOT MARKED \(nothing changed\)/, label);
    assert.match(r.out, re, label);
    assert.ok(Date.now() - t0 < 20_000, `${label}: refused without waiting on a connection`);
    noPassword(r.out, label);
  }
  assert.deepEqual(await clusterSnapshot(), before, "no marker or row changed in any database");
});

// ─── Suite level: the safety suite refuses before touching anything ─────────

test("the safety suite refuses unsafe configurations before any database change", { timeout: 300_000 }, async () => {
  const before = await clusterSnapshot();
  const other = withDb(READ_URL, COMPANION);
  const cases = [
    ["dev database as SAFETY_DB_URL", { SAFETY_DB_URL: withDb(READ_URL, DEV_DB), SAFETY_DB_CONFIRM: DEV_DB, SAFETY_OTHER_DB_URL: other }, /doesn't contain "test"/],
    ["remote host", { SAFETY_DB_URL: withHost(READ_URL, "db.example.invalid"), SAFETY_DB_CONFIRM: NAME, SAFETY_OTHER_DB_URL: other }, /not local/],
    ["missing confirmation", { SAFETY_DB_URL: READ_URL, SAFETY_DB_CONFIRM: "", SAFETY_OTHER_DB_URL: other }, /no confirmation/],
    ["mismatched confirmation", { SAFETY_DB_URL: READ_URL, SAFETY_DB_CONFIRM: COMPANION, SAFETY_OTHER_DB_URL: other }, /doesn't match/],
    ["other DB is the same DB", { SAFETY_DB_URL: READ_URL, SAFETY_DB_CONFIRM: NAME, SAFETY_OTHER_DB_URL: READ_URL }, /different database/],
    ["other DB is the dev DB", { SAFETY_DB_URL: READ_URL, SAFETY_DB_CONFIRM: NAME, SAFETY_OTHER_DB_URL: withDb(READ_URL, DEV_DB) }, /SAFETY_OTHER_DB_URL: database name/],
    ["no configuration at all", { SAFETY_DB_URL: "", SAFETY_DB_CONFIRM: "", SAFETY_OTHER_DB_URL: "" }, /no database URL/],
  ];
  for (const [label, env, re] of cases) {
    const r = await runNode(["--test", SAFETY], env, 120_000);
    assert.notEqual(r.code, 0, `${label}: the suite must fail`);
    assert.match(r.out, /REFUSING to run the safety suite \(no database was touched\)/, label);
    assert.match(r.out, re, label);
    assert.doesNotMatch(r.out, /^ok \d+/m, `${label}: no test ran`);
    noPassword(r.out, label);
  }
  assert.deepEqual(await clusterSnapshot(), before, "no marker or row changed in any database");
});

// ─── Credential redaction in live-check output ──────────────────────────────

test("live-provider-check never prints the DATABASE_URL password, on its output OR error path", { timeout: 60_000 }, async () => {
  // A WRONG password equal to the database name: the name is printed on the normal output path
  // (startup line) AND on the error path (the refusal message), so a leak through either path
  // shows up. Authentication fails → refusal (exit 4).
  const url = new URL(READ_URL);
  const dbName = decodeURIComponent(url.pathname.slice(1));
  url.password = dbName;
  const r = await runNode([path.join(ROOT, "scripts", "live-provider-check.cjs")], {
    DATABASE_URL: url.toString(), BASE_URL: "http://localhost:1", FDC_API_KEY: "", LIVE_CHECK_USDA_ORACLE: "off",
  }, 30_000);
  assert.equal(r.code, 4, r.out);
  assert.match(r.out, /REFUSED \(nothing was written\)/);
  assert.match(r.out, /^Live provider check .*<redacted>/m, "output path redacted");
  assert.match(r.out, /^REFUSED .*<redacted>/m, "error path redacted");
  assert.equal(r.out.split(dbName).length - 1, 0, "the password never appears");
});
