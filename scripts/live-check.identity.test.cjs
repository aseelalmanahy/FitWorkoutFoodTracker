// The live check's refusals, without changing any database marker. The "server" is a local mock that
// reports whatever identity a case needs, and records every request. The script's own read of the
// database is real, read-only, and limited to a designated test database. Covers the same refusals as
// the MISSING and INVALID marker tests in live-provider-check.safety.test.cjs, which change the marker.
//   DATABASE_URL=<fitdb_test URL> node --test scripts/live-check.identity.test.cjs
"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { databaseUrlProblem, readDatabaseIdentity } = require("./lib/test-target-guard.cjs");
const { TEST_DB_MARKER_PREFIX } = require("./lib/test-db-guard.cjs");

const DB = process.env.DATABASE_URL;
const SCRIPT = path.join(__dirname, "live-provider-check.cjs");
const IDENTITY = "GET /api/health/db-identity";
let own, dbName, prisma;

before(async () => {
  const unsafe = databaseUrlProblem(DB);
  if (unsafe) throw new Error(`REFUSING: ${unsafe.message}`);
  dbName = decodeURIComponent(new URL(DB).pathname.slice(1));
  own = await readDatabaseIdentity(DB, dbName);
  assert.equal(own.marker, TEST_DB_MARKER_PREFIX + dbName, "the test database is already marked. This suite never marks it.");
  const { PrismaClient } = require("@prisma/client");
  prisma = new PrismaClient({ datasources: { db: { url: DB } } });
});
after(async () => { if (prisma) await prisma.$disconnect(); });

function mock(respond) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    respond(req, res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, requests,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  })));
}
const send = (res, status, body, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
const identityOnly = (status, body, headers) => (_req, res) => send(res, status, body, headers);

function runLiveCheck(baseUrl) {
  const report = path.join(os.tmpdir(), `lpc-identity-${process.pid}-${Date.now()}.json`);
  const env = { ...process.env, BASE_URL: baseUrl, DATABASE_URL: DB, REPORT_FILE: report, LIVE_CHECK_USDA_ORACLE: "off", FDC_API_KEY: "", LIVE_CHECK_REQUEST_TIMEOUT_MS: "2000", LIVE_CHECK_CLEANUP_GRACE_MS: "100" };
  delete env.NODE_TEST_CONTEXT;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("close", (code) => { clearTimeout(timer); fs.rmSync(report, { force: true }); resolve({ code, out }); });
  });
}
const users = () => prisma.user.count();

const REFUSALS = [
  ["identity endpoint disabled", () => identityOnly(404, { error: "Not found" }), /doesn't expose \/api\/health\/db-identity/],
  ["identity endpoint failing", () => identityOnly(503, { error: "Database unavailable" }), /couldn't report its database identity/],
  ["identity check redirected, not followed", () => identityOnly(302, {}, { Location: "https://fit.production.invalid/api/health/db-identity" }), /couldn't report its database identity \(HTTP 302\)/],
  ["server on another database", () => identityOnly(200, { fingerprint: "b".repeat(64), testMarker: own.marker }), /does not match this script's database/],
  ["MISSING marker", () => identityOnly(200, { fingerprint: own.fingerprint, testMarker: null }), /has no test-database marker/],
  ["INVALID marker: garbage, as the endpoint reports it", () => identityOnly(200, { fingerprint: own.fingerprint, testMarker: "<non-marker comment>" }), /has an invalid test-database marker/],
  ["INVALID marker: for a different database", () => identityOnly(200, { fingerprint: own.fingerprint, testMarker: `${TEST_DB_MARKER_PREFIX}fitdb` }), /has an invalid test-database marker/],
  ["INVALID marker: wrong version", () => identityOnly(200, { fingerprint: own.fingerprint, testMarker: `fitworkoutfoodtracker:test-database:v0:${dbName}` }), /has an invalid test-database marker/],
];

for (const [label, respond, expected] of REFUSALS) {
  test(`${label} → exit 4, and only the identity GET was sent`, { timeout: 180_000 }, async () => {
    const server = await mock(respond());
    const before = await users();
    try {
      const r = await runLiveCheck(server.url);
      assert.equal(r.code, 4, r.out);
      assert.match(r.out, /REFUSED \(nothing was written\)/);
      assert.match(r.out, expected);
      assert.doesNotMatch(r.out, /Verified before any write/);
      assert.deepEqual(server.requests, [IDENTITY]);
      assert.equal(await users(), before, "no rows created");
    } finally { await server.close(); }
  });
}

test("a matching identity passes, and verification comes before the first write", { timeout: 180_000 }, async () => {
  const server = await mock((req, res) => {
    if (`${req.method} ${req.url}` === IDENTITY) return send(res, 200, { fingerprint: own.fingerprint, testMarker: own.marker });
    return send(res, 500, { error: "mock" }); // nothing is accepted, so no account can exist
  });
  const before = await users();
  try {
    const r = await runLiveCheck(server.url);
    assert.match(r.out, /Verified before any write/);
    assert.equal(server.requests[0], IDENTITY);
    assert.ok(server.requests.length > 1, "the script went on once verified");
    assert.equal(await users(), before, "the database is unchanged");
  } finally { await server.close(); }
});
