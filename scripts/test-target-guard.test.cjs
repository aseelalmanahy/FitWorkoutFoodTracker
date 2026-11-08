// Tests for scripts/lib/test-target-guard.cjs: unit tests, negative controls, and a meta-test that
// every write-capable script uses it. No app, no real database, and nothing outside this machine:
// refused URLs use the reserved .invalid domain and are never contacted, and the "server" in the
// end-to-end cases is a local mock that records every request it gets. The mock DATABASE_URL points
// at a closed local port, with no real credentials.
//   node --test scripts/test-target-guard.test.cjs
"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const guard = require("./lib/test-target-guard.cjs");
const { TEST_DB_MARKER_PREFIX } = require("./lib/test-db-guard.cjs");

const {
  baseUrlProblem, databaseUrlProblem, environmentProblems, checkTarget, verifyServerIdentity,
  createFetchGuard, guardBrowserContext, isLoopbackHttpUrl, TargetRefused, createDestinationPolicy, DESTINATION,
  browserRequestAllowed, startGuardProxy, browserLaunchOptions, verifyProviderStub, stubUrlProblem, PROVIDER_STUB_IDENTITY,
} = guard;
const APP = "http://localhost:3000";
const STUB = "http://127.0.0.1:4011";
const POLICY = createDestinationPolicy({ applicationOrigin: APP, stubOrigin: STUB });

const SCRIPTS = __dirname;
const ROOT = path.resolve(SCRIPTS, "..");
const FAKE_DB = "postgresql://u:SECRETPW@127.0.0.1:1/fitdb_test";
const FINGERPRINT = "a".repeat(64);
const MARKER = `${TEST_DB_MARKER_PREFIX}fitdb_test`;
const reasonOf = (p) => (p ? p.reason : null);
const readScript = (f) => fs.readFileSync(path.join(SCRIPTS, f), "utf8");
function mockServer(respond) {
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

// ─── Requirement A: server target ───────────────────────────────────────────

test("control 1: a missing BASE_URL is refused", () => {
  for (const v of [undefined, null, ""]) assert.equal(reasonOf(baseUrlProblem(v)), "base_url_missing");
});

test("control 2: invalid URLs are refused", () => {
  for (const v of ["not a url", "http://", "http://::1:3000", "http://localhost:99999", "//localhost:3000"]) {
    assert.equal(reasonOf(baseUrlProblem(v)), "base_url_malformed", v);
  }
  assert.notEqual(baseUrlProblem("localhost:3000"), null, "this parses with the scheme localhost:, and is refused too");
});

test("control 3: external HTTPS URLs are refused as not loopback", () => {
  for (const v of ["https://example.invalid", "https://fit.example.invalid:443", "http://example.invalid"]) {
    assert.equal(reasonOf(baseUrlProblem(v)), "base_url_not_loopback", v);
  }
});

test("control 4: private-network and other non-loopback addresses are refused", () => {
  for (const v of [
    "http://10.0.0.5:3000", "http://172.16.0.1:3000", "http://192.168.1.10:3000", "http://169.254.169.254",
    "http://0.0.0.0:3000", "http://127.0.0.2:3000", "http://[::]:3000", "http://[::ffff:127.0.0.1]:3000", "http://[fe80::1]:3000",
  ]) assert.equal(reasonOf(baseUrlProblem(v)), "base_url_not_loopback", v);
});

test("control 5: production-like names are refused, including ones that start with localhost", () => {
  for (const v of ["http://fit.production.invalid", "http://localhost.example.invalid:3000", "http://127.0.0.1.nip.invalid", "http://app.internal:3000", "http://localhost./"]) {
    assert.equal(reasonOf(baseUrlProblem(v)), "base_url_not_loopback", v);
  }
});

test("control 6: URLs containing credentials are refused, and never repeated in the message", () => {
  for (const v of ["http://user:SECRETPW@localhost:3000", "http://SECRETPW@127.0.0.1:3000", "http://localhost:3000@example.invalid", "http://127.0.0.1@example.invalid/", "https://user:SECRETPW@example.invalid"]) {
    const p = baseUrlProblem(v);
    assert.equal(reasonOf(p), "base_url_credentials", v);
    assert.doesNotMatch(p.message, /SECRETPW|example\.invalid/);
  }
});

test("control 7: unsupported protocols are refused", () => {
  for (const v of ["https://localhost:3000", "ftp://localhost", "ws://localhost:3000", "gopher://127.0.0.1"]) {
    assert.equal(reasonOf(baseUrlProblem(v)), "base_url_protocol", v);
  }
  assert.notEqual(baseUrlProblem("file://localhost/etc/hosts"), null, "file: has no host once parsed, and is refused too");
});

test("ambiguous spellings that parsers rewrite into loopback are refused", () => {
  for (const v of [
    "http://127.1:3000", "http://2130706433:3000", "http://0x7f.0.0.1:3000", "http://0177.0.0.1:3000", "HTTP://LOCALHOST:3000", "http://LOCALHOST:3000",
    "http:\\\\localhost:3000", "http:/localhost:3000", " http://localhost:3000", "http://localhost:3000 ", "http://local\thost:3000", "http://localhost:3000/",
    "http://localhost:3000/path", "http://localhost:3000?x=1", "http://localhost:3000#x", "http://localhost:03000", "http://localhost:0", "http://[0:0:0:0:0:0:0:1]:3000",
  ]) assert.equal(reasonOf(baseUrlProblem(v)), "base_url_ambiguous", JSON.stringify(v));
});

test("the genuine loopback forms are accepted", () => {
  for (const v of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000", "http://localhost"]) assert.equal(baseUrlProblem(v), null, v);
});

// ─── Requirement C: database ────────────────────────────────────────────────

test("control 11: a missing DATABASE_URL is refused", () => {
  for (const v of [undefined, ""]) {
    const p = databaseUrlProblem(v);
    assert.equal(reasonOf(p), "database_missing");
    assert.match(p.message, /DATABASE_URL must be set/);
  }
});

test("control 12: non-test databases are refused, and only the designated names pass", () => {
  assert.equal(reasonOf(databaseUrlProblem("postgresql://u:SECRETPW@localhost:5432/fitdb")), "database_invalid");
  for (const name of ["latest", "contest_db", "fitdb_test2", "my_test", "fitdb_test_prod", "FITDB_TEST", "test"]) {
    assert.equal(reasonOf(databaseUrlProblem(`postgresql://u:SECRETPW@localhost:5432/${name}`)), "database_not_designated", name);
  }
  for (const url of ["postgresql://u:SECRETPW@db.example.invalid:5432/fitdb_test", "postgresql://u:SECRETPW@localhost:5432/fitdb_test?host=db.example.invalid", "mysql://u:SECRETPW@localhost/fitdb_test"]) {
    const p = databaseUrlProblem(url);
    assert.equal(reasonOf(p), "database_invalid", url);
    assert.doesNotMatch(p.message, /SECRETPW/);
  }
  for (const name of ["fitdb_test", "fitdb_test_other", "fitdb_test_isolated"]) assert.equal(databaseUrlProblem(`postgresql://u:p@localhost:5432/${name}`), null, name);
  assert.deepEqual([...guard.DESIGNATED_TEST_DATABASES], ["fitdb_test", "fitdb_test_other", "fitdb_test_isolated"]);
  // Exactly that name: near misses, the review database and the development database stay refused.
  for (const name of ["fitdb_test_isolated2", "fitdb_test_isolate", "fitdb_review", "fitdb", "fitdb_testisolated"]) {
    assert.equal(reasonOf(databaseUrlProblem(`postgresql://u:p@localhost:5432/${name}`)), name.includes("test") ? "database_not_designated" : "database_invalid", name);
  }
  assert.equal(reasonOf(databaseUrlProblem("postgresql://u:p@db.example.invalid:5432/fitdb_test_isolated")), "database_invalid", "not on another host");
  assert.throws(() => guard.DESIGNATED_TEST_DATABASES.push("fitdb"), TypeError);
});

// ─── Unexpected environment ─────────────────────────────────────────────────

test("control 13: unexpected environment configuration is refused", () => {
  const cases = [
    [{ NODE_ENV: "production" }, "environment_production"],
    [{ HTTP_PROXY: "http://proxy.invalid:8080" }, "environment_proxy"],
    [{ https_proxy: "http://proxy.invalid:8080" }, "environment_proxy"],
    [{ ALL_PROXY: "socks5://proxy.invalid" }, "environment_proxy"],
    [{ NODE_PATH: "/somewhere" }, "environment_node_path"],
    [{ NODE_OPTIONS: "--require ./replace-the-guard.js" }, "environment_preload"],
    [{ NODE_OPTIONS: "-r ./replace-the-guard.js" }, "environment_preload"],
    [{ NODE_OPTIONS: "--import=./replace-the-guard.mjs" }, "environment_preload"],
    [{ LIVE_CHECK_ALLOW_DATABASE: "fitdb" }, "environment_bypass"],
    [{ LABEL_STUB_URL: "https://stub.example.invalid" }, "environment_external_stub"],
    [{ FDC_BASE_URL: "https://api.example.invalid/fdc/v1" }, "environment_external_stub"],
    [{ ANTHROPIC_BASE_URL: "https://api.example.invalid" }, "environment_external_stub"],
  ];
  for (const [env, reason] of cases) assert.deepEqual(environmentProblems(env).map((p) => p.reason), [reason], JSON.stringify(env));
  assert.deepEqual(environmentProblems({}), []);
  assert.deepEqual(environmentProblems({ NODE_OPTIONS: "--max-old-space-size=4096", LABEL_STUB_URL: "http://127.0.0.1:4011", FDC_BASE_URL: "http://localhost:4010/fdc/v1" }), []);
});

test("no environment variable can widen the checks", () => {
  const widening = {
    BASE_URL: "https://fit.production.invalid", DATABASE_URL: "postgresql://u:p@localhost/fitdb",
    TEST_TARGET_ALLOW: "1", ALLOW_REMOTE: "1", GUARD_DISABLED: "1", SKIP_GUARD: "1", LIVE_CHECK_ALLOW_DATABASE: "fitdb", ALLOWED_HOSTS: "fit.production.invalid",
  };
  const r = checkTarget(widening);
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems.map((p) => p.reason), ["base_url_not_loopback", "database_invalid", "environment_bypass"]);
});

test("the live check may use real providers, but nothing else is relaxed", () => {
  const env = { BASE_URL: "http://localhost:3000", DATABASE_URL: FAKE_DB, FDC_BASE_URL: "https://api.example.invalid/fdc/v1" };
  assert.equal(checkTarget(env).ok, false);
  assert.equal(checkTarget(env, { externalProviders: true }).ok, true);
  assert.equal(checkTarget({ ...env, BASE_URL: "https://fit.production.invalid" }, { externalProviders: true }).ok, false);
  assert.equal(checkTarget({ ...env, DATABASE_URL: "postgresql://u:p@localhost/fitdb" }, { externalProviders: true }).ok, false);
});

test("a valid configuration returns the values to use", () => {
  const r = checkTarget({ BASE_URL: "http://127.0.0.1:3000", DATABASE_URL: FAKE_DB });
  assert.deepEqual([r.ok, r.baseUrl, r.dbName, r.dbHost], [true, "http://127.0.0.1:3000", "fitdb_test", "127.0.0.1"]);
});

// ─── Requirement B: server identity ─────────────────────────────────────────

const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ownIdentity = () => ({ fingerprint: FINGERPRINT, marker: MARKER });
const loopbackLookup = async () => [{ address: "127.0.0.1", family: 4 }, { address: "::1", family: 6 }];
/** Runs the check and records whether the database was read. */
async function identity({ response, own = ownIdentity, lookup = loopbackLookup, baseUrl = "http://localhost:3000", databaseUrl = FAKE_DB }) {
  const calls = { fetches: [], databaseReads: 0 };
  const fetchImpl = async (url, init) => { calls.fetches.push({ url, init }); return typeof response === "function" ? response() : response; };
  const readDatabase = async () => { calls.databaseReads++; return own(); };
  try {
    const result = await verifyServerIdentity({ baseUrl, databaseUrl }, { fetchImpl, lookup, readDatabase });
    return { ...calls, result, reason: null };
  } catch (e) {
    assert.ok(e instanceof TargetRefused, `expected a refusal, got: ${e.message}`);
    return { ...calls, reason: e.reason, message: e.message };
  }
}
const good = () => jsonResponse(200, { fingerprint: FINGERPRINT, testMarker: MARKER });

test("a server on the right, marked database passes, using only a read-only GET with redirects off", async () => {
  const r = await identity({ response: good });
  assert.equal(r.reason, null);
  assert.equal(r.fetches.length, 1);
  assert.equal(r.fetches[0].url, "http://localhost:3000/api/health/db-identity");
  assert.equal(r.fetches[0].init.redirect, "manual");
  assert.equal(r.fetches[0].init.method, undefined);
  assert.equal(r.databaseReads, 1);
});

test("control 8: a redirect of the identity check, including to an external target, is refused and not followed", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const r = await identity({ response: () => new Response(null, { status, headers: { Location: "https://fit.production.invalid/api/health/db-identity" } }) });
    assert.equal(r.reason, "identity_redirect", String(status));
    assert.equal(r.fetches.length, 1, "only the first request was made");
    assert.equal(r.databaseReads, 0);
  }
});

test("control 9: a missing test-server identity is refused, and the database isn't contacted", async () => {
  const cases = [
    [jsonResponse(404, { error: "Not found" }), "identity_unavailable"],
    [jsonResponse(503, { error: "Database unavailable" }), "identity_unavailable"],
    [jsonResponse(200, { fingerprint: FINGERPRINT, testMarker: null }), "marker_missing"],
    [jsonResponse(200, { fingerprint: FINGERPRINT }), "marker_missing"],
    [jsonResponse(200, { fingerprint: FINGERPRINT, testMarker: "" }), "marker_missing"],
    [jsonResponse(200, {}), "identity_invalid"],
    [jsonResponse(200, { fingerprint: "short", testMarker: MARKER }), "identity_invalid"],
    [new Response("<html>not json</html>", { status: 200 }), "identity_invalid"],
  ];
  for (const [response, reason] of cases) {
    const r = await identity({ response: () => response.clone() });
    assert.equal(r.reason, reason);
    assert.equal(r.databaseReads, 0);
  }
  const down = await identity({ response: () => { throw new Error("ECONNREFUSED"); } });
  assert.equal(down.reason, "identity_unreachable");
  assert.equal(down.databaseReads, 0);
});

test("control 10: an incorrect database identity is refused", async () => {
  const cases = [
    // The dev database, the other test database, and arbitrary comments.
    [{ fingerprint: FINGERPRINT, testMarker: `${TEST_DB_MARKER_PREFIX}fitdb` }, ownIdentity, "marker_wrong", 0],
    [{ fingerprint: FINGERPRINT, testMarker: `${TEST_DB_MARKER_PREFIX}fitdb_test_other` }, ownIdentity, "marker_wrong", 0],
    [{ fingerprint: FINGERPRINT, testMarker: "<non-marker comment>" }, ownIdentity, "marker_wrong", 0],
    // An app using another database that's been labelled with the right marker: only the fingerprint catches this.
    [{ fingerprint: "b".repeat(64), testMarker: MARKER }, ownIdentity, "identity_mismatch", 1],
    // The database this script reads has lost its own marker.
    [{ fingerprint: FINGERPRINT, testMarker: MARKER }, () => ({ fingerprint: FINGERPRINT, marker: null }), "marker_wrong", 1],
  ];
  for (const [body, own, reason, reads] of cases) {
    const r = await identity({ response: () => jsonResponse(200, body), own });
    assert.equal(r.reason, reason, JSON.stringify(body));
    assert.equal(r.databaseReads, reads);
  }
});

test("an unreadable database fails closed, with its password redacted", async () => {
  const r = await identity({ response: good, own: () => { throw new Error("can't reach u:SECRETPW@127.0.0.1"); } });
  assert.equal(r.reason, "database_unreachable");
  assert.doesNotMatch(r.message, /SECRETPW/);
});

test("localhost must resolve only to loopback on this machine", async () => {
  const wrong = [
    [{ address: "203.0.113.5", family: 4 }],
    [{ address: "127.0.0.1", family: 4 }, { address: "10.0.0.5", family: 4 }],
    [{ address: "fe80::1", family: 6 }],
    [],
  ];
  for (const addresses of wrong) {
    const r = await identity({ response: good, lookup: async () => addresses });
    assert.equal(r.reason, "localhost_not_loopback", JSON.stringify(addresses));
    assert.equal(r.fetches.length, 0, "no request before resolution is checked");
  }
  const failed = await identity({ response: good, lookup: async () => { throw new Error("ENOTFOUND"); } });
  assert.equal(failed.reason, "localhost_unresolved");
  const numeric = await identity({ response: good, baseUrl: "http://127.0.0.1:3000", lookup: async () => { throw new Error("must not be called"); } });
  assert.equal(numeric.reason, null);
});

test("the identity check revalidates its inputs", async () => {
  assert.equal((await identity({ response: good, baseUrl: "https://fit.production.invalid" })).reason, "base_url_not_loopback");
  assert.equal((await identity({ response: good, databaseUrl: "postgresql://u:p@localhost/fitdb" })).reason, "database_invalid");
});

test("the identity SQL and marker match the application", () => {
  const source = fs.readFileSync(path.join(ROOT, "src", "lib", "server", "db-identity.ts"), "utf8");
  const parts = guard.DB_IDENTITY_SQL.split("AS identity, ");
  assert.equal(parts.length, 2);
  assert.ok(source.includes(`${parts[0]}AS identity, `), "the identity expression matches");
  assert.ok(source.includes(parts[1]), "the marker expression matches");
  assert.ok(source.includes(`"${TEST_DB_MARKER_PREFIX}"`), "the marker prefix matches");
  assert.ok(source.includes("fwft-db-identity-v1|"), "the fingerprint format matches");
});

// ─── Requests while the tests run ───────────────────────────────────────────

const redirectTo = (location, status = 302) => new Response(null, { status, headers: { Location: location } });
function fakeFetch(...responses) {
  const calls = [];
  const fn = async (input, init) => { calls.push({ url: String(input), init }); return responses.shift() ?? new Response("{}", { status: 200 }); };
  fn.calls = calls;
  return fn;
}
const rejectsWith = (promise, reason) => assert.rejects(promise, (e) => e instanceof TargetRefused && e.reason === reason);

test("no request can be sent before verification", async () => {
  const f = fakeFetch();
  await rejectsWith(createFetchGuard(f, () => false, POLICY)("http://localhost:3000/api/auth/register", { method: "POST" }), "not_verified");
  assert.equal(f.calls.length, 0);
});

test("requests outside the verified origin are refused, in any input form", async () => {
  const f = fakeFetch();
  const guarded = createFetchGuard(f, () => true, POLICY);
  for (const input of ["https://fit.production.invalid/api/auth/register", new URL("https://fit.production.invalid"), new Request("https://fit.production.invalid/x", { method: "POST", body: "{}" }), "http://192.168.1.10:3000/", "http://user:p@localhost:3000/",
    "http://localhost:3001/api/auth/register", new URL("http://localhost:3001/x"), new Request("http://localhost:3001/x", { method: "POST", body: "{}" }), "http://127.0.0.1:3000/api/auth/register", "http://[::1]:3000/x", "http://127.0.0.2:3000/x"]) {
    await rejectsWith(guarded(input), "request_forbidden");
  }
  assert.equal(f.calls.length, 0);
});

test("redirects to another origin are never followed, for any method", async () => {
  for (const method of ["GET", "POST", "PUT", "DELETE"]) {
    for (const location of ["https://fit.production.invalid/steal", "http://localhost:9999/other-port", "//fit.production.invalid/x"]) {
      const f = fakeFetch(redirectTo(location, 307));
      await rejectsWith(createFetchGuard(f, () => true, POLICY)("http://localhost:3000/a", { method, body: method === "GET" ? undefined : "{}" }), "redirect_refused");
      assert.equal(f.calls.length, 1, `${method} ${location}`);
      assert.equal(f.calls[0].init.redirect, "manual");
    }
  }
});

test("same-origin GET redirects are followed, and writes aren't repeated", async () => {
  const get = fakeFetch(redirectTo("/next"), new Response("done", { status: 200 }));
  const r = await createFetchGuard(get, () => true, POLICY)("http://localhost:3000/a");
  assert.equal(await r.text(), "done");
  assert.deepEqual(get.calls.map((c) => c.url), ["http://localhost:3000/a", "http://localhost:3000/next"]);

  const post = fakeFetch(redirectTo("/next", 307));
  const res = await createFetchGuard(post, () => true, POLICY)("http://localhost:3000/a", { method: "POST", body: "{}" });
  assert.equal(res.status, 307);
  assert.equal(post.calls.length, 1);

  const manual = fakeFetch(redirectTo("https://fit.production.invalid/x"));
  assert.equal((await createFetchGuard(manual, () => true, POLICY)("http://localhost:3000/a", { redirect: "manual" })).status, 302, "a caller inspecting redirects still can");
  assert.equal(manual.calls.length, 1);

  const loop = fakeFetch(...Array.from({ length: 20 }, () => redirectTo("/again")));
  await rejectsWith(createFetchGuard(loop, () => true, POLICY)("http://localhost:3000/a"), "redirect_refused");
  assert.ok(loop.calls.length <= 6);
});

test("browser requests outside the policy are aborted, and contexts can't open before verification", async () => {
  await rejectsWith(guardBrowserContext({ route: async () => assert.fail("no route") }, () => false, POLICY), "not_verified");
  let handler;
  const context = { route: async (pattern, fn) => { assert.equal(pattern, "**/*"); handler = fn; } };
  const blocked = [];
  assert.equal(await guardBrowserContext(context, () => true, POLICY, (u) => blocked.push(u)), context);
  const visit = (url) => {
    const seen = [];
    handler({ request: () => ({ url: () => url }), fallback: () => seen.push("allowed"), abort: () => seen.push("aborted") });
    return seen[0];
  };
  for (const url of ["http://localhost:3000/register", "http://127.0.0.1:4011/__reset", "data:image/png;base64,AA", "blob:http://localhost:3000/id"]) assert.equal(visit(url), "allowed", url);
  const refused = ["https://fit.production.invalid/", "http://192.168.1.10/", "https://localhost:3000/", "http://user:p@localhost:3000/", "http://localhost:3001/", "http://127.0.0.1:3000/", "http://127.0.0.1:4011/api/auth/register", "blob:http://localhost:3001/id"];
  for (const url of refused) assert.equal(visit(url), "aborted", url);
  assert.equal(blocked.length, refused.length);
});

test("requireSafeTarget gates requests until the server is verified, verifies once, and refuses with exit 4", async () => {
  const realGlobalFetch = globalThis.fetch;
  const env = { BASE_URL: "http://127.0.0.1:1", DATABASE_URL: FAKE_DB };
  const readDatabase = async () => ownIdentity();
  try {
    let fetches = 0;
    let release;
    const held = new Promise((r) => { release = r; });
    const ok = guard.requireSafeTarget({ env, exit: () => assert.fail("must not exit"), deps: { fetchImpl: async () => { fetches++; await held; return good(); }, readDatabase } });
    await rejectsWith(globalThis.fetch("http://127.0.0.1:1/api/auth/register", { method: "POST" }), "not_verified");
    const both = [ok.verifyServer(), ok.verifyServer()];
    await rejectsWith(globalThis.fetch("http://127.0.0.1:1/api/auth/register", { method: "POST" }), "not_verified");
    release();
    await Promise.all(both);
    await ok.verifyServer();
    assert.equal(fetches, 1, "verifies once, however many hooks ask");
    assert.equal(ok.launchOptions("webkit").proxy.server.startsWith("http://127.0.0.1:"), true);

    const exits = [];
    const refused = guard.requireSafeTarget({ env, exit: (c) => exits.push(c), deps: { fetchImpl: async () => jsonResponse(200, { fingerprint: FINGERPRINT, testMarker: null }), readDatabase } });
    await refused.verifyServer();
    assert.deepEqual(exits, [4]);
    await rejectsWith(globalThis.fetch("http://127.0.0.1:1/x"), "not_verified");
    await rejectsWith(refused.guardContext({ route: async () => assert.fail("no route") }), "not_verified");
    assert.throws(() => refused.launchOptions("chromium"), (e) => e.reason === "not_verified");

    const staticExits = [];
    assert.equal(guard.requireSafeTarget({ env: {}, exit: (c) => staticExits.push(c) }), null);
    assert.deepEqual(staticExits, [4]);
  } finally {
    globalThis.fetch = realGlobalFetch;
  }
});

// ─── The verified origin is the boundary, not "somewhere on loopback" ──────────

const FORBIDDEN_DESTINATIONS = [
  "http://localhost:3001/", "http://localhost:3001/api/auth/register", "http://localhost/", "http://127.0.0.1:3000/", "http://[::1]:3000/", "http://127.0.0.2:3000/",
  "https://localhost:3000/", "http://user:p@localhost:3000/", "https://fit.production.invalid/", "http://192.168.1.10:3000/", "http://127.0.0.1:4011/", "http://127.0.0.1:4011/api/auth/register",
  "http://127.0.0.1:4011/v1/messages", "http://127.0.0.1:4012/__reset", "http://localhost:4011/__reset", "not a url",
];
const ALLOWED_DESTINATIONS = [
  ["http://localhost:3000/", DESTINATION.APPLICATION], ["http://localhost:3000/api/auth/register?x=1", DESTINATION.APPLICATION],
  ["http://127.0.0.1:4011/__health", DESTINATION.STUB], ["http://127.0.0.1:4011/__scenario", DESTINATION.STUB], ["http://127.0.0.1:4011/__requests", DESTINATION.STUB], ["http://127.0.0.1:4011/__reset", DESTINATION.STUB],
];

test("the policy allows only the exact verified origin and a named stub's control paths", () => {
  for (const url of FORBIDDEN_DESTINATIONS) assert.equal(POLICY.classify(url), DESTINATION.FORBIDDEN, url);
  for (const [url, kind] of ALLOWED_DESTINATIONS) assert.equal(POLICY.classify(url), kind, url);
  for (const url of ["http://127.0.0.1:4011/__x/../api/auth/register", "http://127.0.0.1:4011/%2e%2e/api", "http://127.0.0.1:4011/__health/../api"]) assert.equal(POLICY.classify(url), DESTINATION.FORBIDDEN, url);
  const noStub = createDestinationPolicy({ applicationOrigin: APP });
  assert.equal(noStub.classify("http://127.0.0.1:4011/__reset"), DESTINATION.FORBIDDEN, "no stub unless one was named");
});

test("verifying one server doesn't permit a request to another local server, in the entry point itself", async () => {
  const realGlobalFetch = globalThis.fetch;
  try {
    const sent = [];
    const target = guard.requireSafeTarget({
      env: { BASE_URL: "http://127.0.0.1:3001", DATABASE_URL: FAKE_DB },
      exit: () => assert.fail("must not exit"),
      deps: { fetchImpl: async () => good(), readDatabase: async () => ownIdentity() },
    });
    await target.verifyServer();
    assert.equal(target.baseUrl, "http://127.0.0.1:3001");
    void sent;
    await rejectsWith(globalThis.fetch("http://127.0.0.1:3000/api/auth/register", { method: "POST", body: "{}" }), "request_forbidden");
    await rejectsWith(globalThis.fetch("http://localhost:3001/api/auth/register", { method: "POST", body: "{}" }), "request_forbidden");
  } finally { globalThis.fetch = realGlobalFetch; }
});

test("approved stub requests pass, and the stub must be named, valid, identified and separate", async () => {
  const f = fakeFetch(new Response("{}"), new Response("{}"));
  const guarded = createFetchGuard(f, () => true, POLICY);
  assert.equal((await guarded(`${STUB}/__reset`, { method: "POST" })).status, 200);
  assert.equal((await guarded(`${APP}/api/profile`)).status, 200);
  await rejectsWith(guarded(`${STUB}/api/auth/register`, { method: "POST" }), "request_forbidden");
  assert.equal(f.calls.length, 2);

  // Redirects can't move from the stub or the app to anywhere else, including each other.
  for (const [from, location] of [[`${STUB}/__health`, `${APP}/api`], [`${APP}/x`, `${STUB}/__reset`], [`${STUB}/__health`, "/api/auth/register"]]) {
    const hop = fakeFetch(redirectTo(location));
    await rejectsWith(createFetchGuard(hop, () => true, POLICY)(from), "redirect_refused");
    assert.equal(hop.calls.length, 1, `${from} -> ${location}`);
  }

  assert.equal(stubUrlProblem(undefined, APP), null);
  assert.equal(stubUrlProblem(STUB, APP), null);
  assert.equal(reasonOf(stubUrlProblem("http://127.0.0.1:4011/__reset", APP)), "stub_url_invalid");
  assert.equal(reasonOf(stubUrlProblem("https://stub.example.invalid", APP)), "stub_url_invalid");
  assert.equal(reasonOf(stubUrlProblem("http://u:p@127.0.0.1:4011", APP)), "stub_url_invalid");
  assert.equal(reasonOf(stubUrlProblem(APP, APP)), "stub_is_application");

  // Only a script that asks gets a stub, so setting the variable alone adds no destination.
  const env = { BASE_URL: APP, DATABASE_URL: FAKE_DB, LABEL_STUB_URL: STUB };
  assert.equal(checkTarget(env).stubUrl, undefined);
  assert.equal(checkTarget(env, { labelStub: true }).stubUrl, STUB);
  assert.equal(checkTarget({ ...env, LABEL_STUB_URL: APP }, { labelStub: true }).ok, false);

  const answers = [
    [() => jsonResponse(200, { ok: true, stub: PROVIDER_STUB_IDENTITY }), null],
    [() => jsonResponse(200, { ok: true }), "stub_not_identified"],
    [() => jsonResponse(404, {}), "stub_not_identified"],
    [() => new Response("<html></html>"), "stub_not_identified"],
    [() => redirectTo("https://fit.production.invalid/__health"), "stub_not_identified"],
    [() => { throw new Error("ECONNREFUSED"); }, "stub_unreachable"],
  ];
  for (const [answer, reason] of answers) {
    const check = verifyProviderStub(STUB, { fetchImpl: async () => answer() });
    if (reason) await rejectsWith(check, reason); else await check;
  }
  assert.ok(readScript("stub-label-provider.cjs").includes(PROVIDER_STUB_IDENTITY), "the real stub gives this identity");
});

test("an entry point with a stub that doesn't identify itself refuses with exit 4", async () => {
  const realGlobalFetch = globalThis.fetch;
  try {
    const exits = [];
    const target = guard.requireSafeTarget({
      labelStub: true, exit: (c) => exits.push(c),
      env: { BASE_URL: APP, DATABASE_URL: FAKE_DB, LABEL_STUB_URL: STUB },
      deps: { fetchImpl: async (url) => (String(url).startsWith(APP) ? good() : jsonResponse(200, { ok: true })), readDatabase: async () => ownIdentity(), lookup: loopbackLookup },
    });
    await target.verifyServer();
    assert.deepEqual(exits, [4]);
    await rejectsWith(globalThis.fetch(`${APP}/x`), "not_verified");
  } finally { globalThis.fetch = realGlobalFetch; }
});

test("direct requests, browser routes and the browser proxy make the same decision for every destination", async () => {
  const upstreamHits = [];
  const upstream = await mockServer((req, res) => { upstreamHits.push(req.url); res.end("ok"); });
  const hostOf = new URL(upstream.url);
  const app = upstream.url;
  const policy = createDestinationPolicy({ applicationOrigin: app, stubOrigin: STUB });
  const proxy = await startGuardProxy(policy);
  const viaProxy = (url) => new Promise((resolve) => {
    const p = new URL(proxy.url);
    const req = http.request({ host: p.hostname, port: p.port, method: "GET", path: url, headers: { Host: new URL(url).host } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", () => resolve("error"));
    req.end();
  });
  try {
    const refused = [`http://localhost:${hostOf.port}/`, `http://127.0.0.1:${Number(hostOf.port) + 1}/`, "https://fit.production.invalid/", "http://192.168.1.10:3000/", "http://127.0.0.2/", `${STUB}/api/auth/register`, "http://user:p@127.0.0.1:1/"];
    for (const url of refused) {
      assert.equal(policy.classify(url), DESTINATION.FORBIDDEN, url);
      assert.equal(browserRequestAllowed(policy, url), false, url);
      await rejectsWith(createFetchGuard(fakeFetch(), () => true, policy)(url), "request_forbidden");
      if (url.startsWith("http://") && !url.includes("user:p")) assert.equal(await viaProxy(url), 403, url);
    }
    assert.deepEqual(upstreamHits, [], "nothing forbidden reached a server");

    const allowed = `${app}/page?x=1`;
    assert.equal(browserRequestAllowed(policy, allowed), true);
    assert.equal((await createFetchGuard(fakeFetch(), () => true, policy)(allowed)).status, 200);
    assert.equal(await viaProxy(allowed), 200);
    assert.deepEqual(upstreamHits, ["/page?x=1"]);
  } finally { await proxy.close(); await upstream.close(); }
});

test("the browser proxy refuses tunnels and WebSocket upgrades, except a tunnel to the verified application", async () => {
  const other = await mockServer((_req, res) => res.end("other"));
  const application = await mockServer((_req, res) => res.end("application"));
  const blocked = [];
  const policy = createDestinationPolicy({ applicationOrigin: application.url, stubOrigin: STUB });
  const proxy = await startGuardProxy(policy, (u) => blocked.push(u));
  const p = new URL(proxy.url);
  const connect = (destination) => new Promise((resolve) => {
    const req = http.request({ host: p.hostname, port: p.port, method: "CONNECT", path: destination });
    req.on("connect", (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.on("error", () => resolve("error"));
    req.end();
  });
  const hostOf = (url) => new URL(url).host;
  try {
    for (const refused of ["fit.production.invalid:443", hostOf(other.url), hostOf(STUB), `localhost:${new URL(application.url).port}`, `user:p@${hostOf(application.url)}`]) {
      assert.equal(await connect(refused), 403, refused);
    }
    assert.equal(blocked.length, 5);
    assert.deepEqual(other.requests, [], "nothing reached the other server");
    assert.equal(await connect(hostOf(application.url)), 200, "the verified application is allowed");
  } finally { await proxy.close(); await other.close(); await application.close(); }
});

test("each browser engine is told not to skip the proxy for loopback, and only known engines launch", () => {
  assert.deepEqual(browserLaunchOptions("chromium", "http://127.0.0.1:1"), { proxy: { server: "http://127.0.0.1:1" }, args: ["--proxy-bypass-list=<-loopback>"] });
  assert.equal(browserLaunchOptions("firefox", "http://127.0.0.1:1").firefoxUserPrefs["network.proxy.allow_hijacking_localhost"], true);
  assert.deepEqual(browserLaunchOptions("webkit", "http://127.0.0.1:1"), { proxy: { server: "http://127.0.0.1:1" } });
  assert.throws(() => browserLaunchOptions("other", "http://127.0.0.1:1"), (e) => e.reason === "unknown_browser");
});

test("isLoopbackHttpUrl handles URLs seen at runtime", () => {
  for (const u of ["http://localhost:3000/a?b=c", "http://127.0.0.1:1/", "http://[::1]:3000/x"]) assert.equal(isLoopbackHttpUrl(u), true, u);
  for (const u of ["https://localhost/", "http://localhost.example.invalid/", "http://10.0.0.1/", "not a url", "", undefined]) assert.equal(isLoopbackHttpUrl(u), false, String(u));
});

test("the guard has no import-time side effects", () => {
  const source = fs.readFileSync(path.join(SCRIPTS, "lib", "test-target-guard.cjs"), "utf8");
  const topLevel = source.replace(/\/\/.*$/gm, "").split(/\r?\n/).filter((l) => /^[a-zA-Z(]/.test(l) && !/^(?:async )?function /.test(l)).join("\n");
  assert.doesNotMatch(topLevel, /\bfetch\(|PrismaClient|process\.exit|globalThis\.fetch\s*=/);
  assert.match(source, /const \{ PrismaClient \} = require\("@prisma\/client"\);/, "Prisma loads only when reading the identity");
});

// ─── Coverage: every script is classified, and write-capable ones use the guard ─

const GUARDED = [
  "e2e-demo-account.cjs",
  "workout-sets.test.cjs", "e2e-readiness.cjs", "readiness-performance.test.cjs",
  "account-data.test.cjs", "account-tokens.test.cjs", "privacy-consent.test.cjs", "e2e-privacy.cjs", "e2e-privacy-cleanup.test.cjs", "e2e-account-data.cjs", "e2e-eligibility.cjs", "e2e-production-security.cjs", "e2e-hardening.cjs", "e2e-label-pdf.cjs", "e2e-label-scan.cjs", "e2e-meal.cjs", "e2e-nutrition-targets.cjs", "e2e-nutrition.cjs", "e2e-profile-minimization.cjs", "e2e-smoke.cjs",
  "nutrition-api.test.cjs", "nutrition-target-migration-check.cjs", "nutrition-targets.test.cjs", "production-security.test.cjs", "profile-migration-check.cjs", "profile-minimization.test.cjs", "profile-nulls.test.cjs", "provider-config.test.cjs", "provider-malformed.test.cjs", "provider-protection.test.cjs", "release-workflow.test.cjs",
  "weight-progress.test.cjs", "e2e-weight.cjs", "e2e-responsive.cjs",
];
const OTHER_WRITE_CAPABLE = {
  "demo-account.cjs": { must: ["databaseUrlProblem(", "environmentProblems(", "readDatabaseIdentity(", "assertConnectedTarget(", "process.env.DATABASE_URL !== parseEnv("], reason: "by hand, on fitdb_test: adds only the demo account's own rows" },
  "demo-server.cjs": { must: ["databaseUrlProblem(", "environmentProblems(", "verifyServerIdentity(", "process.env.DATABASE_URL !== parseEnv("], reason: "by hand: starts the app on fitdb_test for hands-on testing, and verifies it first" },
  "account-facts.cjs": { must: ["databaseUrlProblem(", "environmentProblems(", "readDatabaseIdentity(", "SET TRANSACTION READ ONLY"], reason: "reads counts only, by hand, on fitdb_test, in a read-only transaction" },
  "mig-04.cjs": { must: ["databaseUrlProblem(", "environmentProblems(", "readDatabaseIdentity(", "--owner-authorized=MIG-04", "process.env.DATABASE_URL !== fromFile"], reason: "by hand, only with the owner's authorization, on fitdb_test: reads and backs up, and applies only with the flag" },
  "live-provider-check.cjs": { must: ["checkTarget("], reason: "shared static checks, plus its own stricter server verification" },
  "usda-missing-nutrients.test.cjs": { must: ["databaseUrlProblem(", "verifyServerIdentity("], reason: "starts its own app, then verifies it" },
  "live-provider-check.safety.test.cjs": { must: ["databaseUrlProblem("], reason: "starts its own apps, and tests the live check's refusals" },
  "live-check.identity.test.cjs": { must: ["databaseUrlProblem("], reason: "the live check's refusals against a mock server, reading the test database" },
  "run-guarded-suites.cjs": { must: ["databaseUrlProblem(", "verifyServerIdentity("], reason: "starts apps for the suites, and verifies each one first" },
  "local-db.cjs": { must: ["envFileProblem(", "localDatabaseProblem(", "readLocalIdentity(", "LOCAL_DATABASES"], reason: "by hand: creates and migrates fitdb_review or fitdb_test_isolated only, refuses any database it didn't prepare, never drops" },
  "review-server.cjs": { must: ["envFileProblem(", "localDatabaseProblem(", "readLocalIdentity(", "REVIEW_MARKER", "-H\", \"127.0.0.1"], reason: "by hand: serves the review build on fitdb_review, on loopback only, after checking its marker" },
  "review-account.cjs": { must: ["envFileProblem(", "localDatabaseProblem(", "readLocalIdentity(", "REVIEW_MARKER", "check-ignore"], reason: "by hand, on fitdb_review: adds one User row per account, never changes one" },
  "restore-check.cjs": { must: ["envFileProblem(", "localDatabaseProblem(", "readLocalIdentity(", "REVIEW_MARKER", "--confirm=${SCRATCH}", "isn't empty"], reason: "by hand: restores a backup only into an empty fitdb_restore_check the owner created, reads fitdb_review, never creates or drops a database (DEPLOY-03)" },
  "measure-recognition.cjs": { must: ["review-tester-", "listeningPid(", "[3002, 3003]"], reason: "by hand: signs in as a review tester on the local review server only, sends generated images that aren't stored, and reads the server process's memory (RC-06)" },
};
const NOT_GUARDED = {
  "demo-account.test.cjs": "the demo data's rules, and what the demo scripts must refuse, spawning them, with no database",
  "account-facts.test.cjs": "the report's rules, and spawns the script for what it must refuse, with no database",
  "mig-04.test.cjs": "what mig-04.cjs must refuse, spawning it, with no database",
  "production-startup.test.cjs": "starts the server only with fake settings it must refuse, with a host that can't resolve",
  "mark-test-database.cjs": "changes only the marker comment, with validateTargetUrl and an exact --confirm",
  "test-db-guard.test.cjs": "reads through a validated URL, and spawns tools that must refuse",
  "live-check.units.test.cjs": "unit tests, and spawns suites that must refuse",
  "test-target-guard.test.cjs": "this file: no app or database, only a local mock",
  "test-target-guard.browser.test.cjs": "real browsers against local mocks only, with no app or database",
  "stub-food-apis.cjs": "a local stand-in server, sends no requests",
  "stub-label-provider.cjs": "a local stand-in server, sends no requests",
  "server-lifecycle.test.cjs": "starts only stand-in processes it writes itself, on free loopback ports; no app, database or request (RC-02)",
  "food-benchmark-record.cjs": "reads search results from USDA FoodData Central and Open Food Facts only, to a file; never the app or a database (RC-01)",
  "label-photo-fetch.cjs": "downloads label photos and their reference values from Open Food Facts only, to a Git-ignored folder; never the app or a database (RC-03)",
  "meal-model-fetch.cjs": "downloads the pinned meal model from huggingface.co only, to a Git-ignored folder, and checks its hashes; never the app or a database (AI-02)",
  "meal-photo-fetch.cjs": "downloads labelled photos from Wikimedia Commons only, to a Git-ignored folder; never the app or a database (AI-02)",
};
// food-benchmark-record.cjs, label-photo-fetch.cjs and meal-photo-fetch.cjs are here only because they fetch from public services; they reach no app or database.
const NOT_GUARDED_MAY_WRITE = new Set(["food-benchmark-record.cjs", "label-photo-fetch.cjs", "meal-photo-fetch.cjs", "account-facts.test.cjs", "mark-test-database.cjs", "test-db-guard.test.cjs", "live-check.units.test.cjs", "test-target-guard.test.cjs", "test-target-guard.browser.test.cjs"]);
const WRITE_CAPABLE = /\bfetch\(|PrismaClient|newContext\(|require\(["']playwright["']\)|\/api\/auth\/register|http\.request\(/;

/** Problems in a guarded script's source. Comments are ignored, so a mention can't satisfy this. */
function auditGuardedSource(raw) {
  const source = raw.replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
  const problems = [];
  const at = source.indexOf("requireSafeTarget(");
  if (at < 0) problems.push("doesn't call requireSafeTarget()");
  if (!/\btarget\.verifyServer\(\)/.test(source)) problems.push("doesn't call verifyServer()");
  if (/process\.env\.BASE_URL|process\.env\[/.test(source)) problems.push("reads BASE_URL itself");
  if (/process\.env\.LABEL_STUB_URL/.test(source)) problems.push("reads the stub address itself");
  const launches = source.match(/\.launch\(/g)?.length ?? 0;
  const guardedLaunches = source.match(/\.launch\(target\.launchOptions\(/g)?.length ?? 0;
  if (launches !== guardedLaunches) problems.push("launches a browser without launchOptions()");
  if (/launchPersistentContext|launchServer|connectOverCDP|\.connect\(|browser\.newPage\(|\bproxy:/.test(source)) problems.push("opens a browser outside the guarded launch");
  if (/["'`]https?:\/\/(?:localhost|127\.0\.0\.1)/.test(source)) problems.push("has a default server address");
  if (/new PrismaClient\(\s*\)/.test(source)) problems.push("opens a default Prisma client");
  if (/requireTestDatabaseUrl|validateTargetUrl/.test(source)) problems.push("uses a weaker database check");
  if (/\bhttps?\.(?:request|get)\(|\.request\.(?:post|put|patch|delete|fetch|get)\(|newContext\(\)\.request|playwright\.request/.test(source)) problems.push("sends requests through an unguarded client");
  const firstUse = source.search(/\bfetch\(|new PrismaClient\(|newContext\(|\.launch\(|\bbefore\(/);
  if (at >= 0 && firstUse >= 0 && firstUse < at) problems.push("uses the network before requireSafeTarget()");
  const contexts = source.match(/\bnewContext\(/g)?.length ?? 0;
  const wrapped = source.match(/target\.guardContext\(await \w+\.newContext\(/g)?.length ?? 0;
  if (contexts !== wrapped) problems.push("opens a browser context without guardContext()");
  // node:test doesn't wait for one before() hook ahead of the next, and the fetch gate doesn't cover
  // Prisma. So every hook has to start with verification, and a suite must have at least one.
  const hooks = source.match(/\bbefore\(/g)?.length ?? 0;
  const verifiedHooks = source.match(/\bbefore\((?:\(\) => target\.verifyServer\(\)\)|async \(\) => \{\s*await target\.verifyServer\(\);)/g)?.length ?? 0;
  if (/require\("node:test"\)/.test(source) && (hooks === 0 || hooks !== verifiedHooks)) problems.push("a before() hook must start with verifyServer()");
  if (!/require\("node:test"\)/.test(source) && !/\(async \(\) => \{\s*await target\.verifyServer\(\);/.test(source)) problems.push("verifyServer() isn't the first step of main");
  return problems;
}

test("every script in scripts/ is classified, so a new one can't be missed", () => {
  const known = new Set([...GUARDED, ...Object.keys(OTHER_WRITE_CAPABLE), ...Object.keys(NOT_GUARDED)]);
  const onDisk = fs.readdirSync(SCRIPTS).filter((f) => /\.(c?js|mjs|ts)$/.test(f));
  assert.deepEqual(onDisk.filter((f) => !known.has(f)), [], "classify new scripts here");
  assert.deepEqual([...known].filter((f) => !onDisk.includes(f)), [], "remove deleted scripts here");
});

test("scripts classified as not write-capable send nothing", () => {
  for (const f of Object.keys(NOT_GUARDED)) {
    if (!NOT_GUARDED_MAY_WRITE.has(f)) assert.doesNotMatch(readScript(f), WRITE_CAPABLE, f);
  }
});

test("every write-capable script uses the shared guard before doing anything", () => {
  for (const f of GUARDED) assert.deepEqual(auditGuardedSource(readScript(f)), [], f);
  for (const [f, { must }] of Object.entries(OTHER_WRITE_CAPABLE)) {
    for (const call of must) assert.ok(readScript(f).includes(call), `${f} calls ${call}`);
  }
});

test("the retired checks are gone from every script", () => {
  for (const f of [...GUARDED, ...Object.keys(OTHER_WRITE_CAPABLE)]) {
    const code = readScript(f).replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /requireTestDatabaseUrl|\bBASE_URL \|\||LIVE_CHECK_ALLOW_DATABASE/, f);
  }
  assert.doesNotMatch(readScript("lib/test-db-guard.cjs"), /requireTestDatabaseUrl/);
});

test("control 14: a script that omits or weakens the shared guard fails the audit", () => {
  const original = readScript("e2e-smoke.cjs");
  const replaceOnce = (s, from, to) => {
    assert.ok(s.includes(from), `fixture still has: ${from}`);
    return s.replace(from, to);
  };
  const guardLine = "const target = require('./lib/test-target-guard.cjs').requireSafeTarget();\r\nconst BASE = target.baseUrl;";
  const smoke = original.includes(guardLine) ? original : original.replace(/\r?\n/g, "\r\n");
  assert.deepEqual(auditGuardedSource(smoke), []);
  const omit = (reason, mutated) => assert.ok(auditGuardedSource(mutated).some((p) => p.includes(reason)), `${reason}: ${auditGuardedSource(mutated)}`);

  omit("requireSafeTarget", replaceOnce(smoke, guardLine, "const BASE = 'http://example.invalid';"));
  omit("reads BASE_URL", replaceOnce(smoke, guardLine, "const target = require('./lib/test-target-guard.cjs').requireSafeTarget();\r\nconst BASE = process.env.BASE_URL;"));
  omit("default server address", replaceOnce(smoke, "const BASE = target.baseUrl;", "const BASE = target.baseUrl || 'http://localhost:3000';"));
  omit("verifyServer()", replaceOnce(smoke, "await target.verifyServer();", ""));
  omit("first step of main", replaceOnce(smoke, "await target.verifyServer();\r\n  const browser = await chromium.launch(target.launchOptions('chromium'));", "const browser = await chromium.launch(target.launchOptions('chromium'));\r\n  await target.verifyServer();"));
  omit("without guardContext", replaceOnce(smoke, "await target.guardContext(await browser.newContext());", "await browser.newContext();"));
  omit("without launchOptions", replaceOnce(smoke, "chromium.launch(target.launchOptions('chromium'))", "chromium.launch()"));
  omit("outside the guarded launch", `${smoke}\nawait chromium.launchPersistentContext("x");`);
  omit("outside the guarded launch", `${smoke}\nawait browser.newPage();`);
  omit("outside the guarded launch", replaceOnce(smoke, "chromium.launch(target.launchOptions('chromium'))", "chromium.launch({ ...target.launchOptions('chromium'), proxy: undefined })"));
  omit("reads the stub address", `${smoke}\nconst STUB = process.env.LABEL_STUB_URL;`);
  omit("doesn't call verifyServer", "const target = require('./lib/test-target-guard.cjs').requireSafeTarget(); // target.verifyServer() is only mentioned here\n(async () => {})();");
  omit("network before", `fetch("/x");\n${smoke}`);
  omit("unguarded client", `${smoke}\nrequire("node:http").get; http.request(u);`);
  omit("weaker database check", `${smoke}\nrequireTestDatabaseUrl();`);
  omit("default Prisma client", `${smoke}\n${"new Prisma"}Client();`);

  const suite = readScript("provider-config.test.cjs").replace(/\r\n/g, "\n");
  assert.deepEqual(auditGuardedSource(suite), []);
  omit("must start with", replaceOnce(suite, "before(() => target.verifyServer());", "test('later', () => target.verifyServer());"));
  omit("must start with", `${suite}\nbefore(async () => { await prisma.user.create({}); });`);
  const withFixtures = readScript("release-workflow.test.cjs").replace(/\r\n/g, "\n");
  assert.deepEqual(auditGuardedSource(withFixtures), []);
  omit("must start with", replaceOnce(withFixtures, "await target.verifyServer(); // first: hooks don't wait for each other\n", "\n"));
});

// ─── End to end: the real scripts, against a mock that records every request ─

function cleanEnv(extra) {
  const env = { ...process.env };
  for (const k of ["BASE_URL", "DATABASE_URL", "LABEL_STUB_URL", "FDC_BASE_URL", "OFF_BASE_URL", "ANTHROPIC_BASE_URL", "NODE_TEST_CONTEXT", "NODE_PATH", "NODE_OPTIONS", "EXPECT_UNCONFIGURED", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "NODE_ENV"]) delete env[k];
  return { ...env, SHOTS_DIR: require("node:os").tmpdir(), ...extra };
}
function runScript(file, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS, file)], { cwd: ROOT, env: cleanEnv(env), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}
/** Runs in small batches: each script loads Prisma, and some load Playwright and sharp. */
async function eachScript(files, fn) {
  for (let i = 0; i < files.length; i += 4) await Promise.all(files.slice(i, i + 4).map(fn));
}
const json = (res, status, body, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
const ALL_SCRIPTS = [...GUARDED, "live-provider-check.cjs"];
const REFUSAL = /REFUS(?:ING|ED)/;

let elsewhere; // stands in for an external target. It must never be reached.
before(async () => { elsewhere = await mockServer((_req, res) => json(res, 200, {})); });
after(() => elsewhere.close());

test("every script refuses a missing BASE_URL, with exit 4 and no request", async () => {
  await eachScript(ALL_SCRIPTS, async (f) => {
    const r = await runScript(f, { DATABASE_URL: FAKE_DB });
    assert.equal(r.code, 4, `${f}: ${r.out}`);
    assert.match(r.out, REFUSAL, f);
    assert.match(r.out, /BASE_URL must be set explicitly/, f);
    assert.doesNotMatch(r.out, /SECRETPW/, f);
  });
});

test("every script refuses an external URL before sending anything", async () => {
  await eachScript(ALL_SCRIPTS, async (f) => {
    const r = await runScript(f, { BASE_URL: "https://fit.production.invalid", DATABASE_URL: FAKE_DB });
    assert.equal(r.code, 4, `${f}: ${r.out}`);
    assert.match(r.out, /is not local/, f);
  });
});

test("every script refuses a missing DATABASE_URL, and the development database by name", async () => {
  await eachScript(ALL_SCRIPTS, async (f) => {
    const missing = await runScript(f, { BASE_URL: elsewhere.url });
    assert.equal(missing.code, 4, `${f}: ${missing.out}`);
    assert.match(missing.out, /DATABASE_URL must be set/, f);
    // Static: this script never connects. Port 1 is closed in any case.
    const dev = await runScript(f, { BASE_URL: elsewhere.url, DATABASE_URL: "postgresql://u:SECRETPW@127.0.0.1:1/fitdb" });
    assert.equal(dev.code, 4, `${f}: ${dev.out}`);
    assert.match(dev.out, /doesn't contain "test"/, f);
    assert.doesNotMatch(dev.out, /SECRETPW/, f);
  });
  assert.deepEqual(elsewhere.requests, [], "no script contacted the server");
});

test("suites that start their own app refuse a database that isn't designated, before starting anything", async () => {
  const url = (name) => `postgresql://u:SECRETPW@127.0.0.1:1/${name}`;
  const cases = [
    ["usda-missing-nutrients.test.cjs", { SAFETY_DB_URL: url("latest"), SAFETY_DB_CONFIRM: "latest" }],
    ["live-provider-check.safety.test.cjs", { SAFETY_DB_URL: url("latest"), SAFETY_DB_CONFIRM: "latest", SAFETY_OTHER_DB_URL: url("fitdb_test_other") }],
    ["live-provider-check.safety.test.cjs", { SAFETY_DB_URL: url("fitdb_test"), SAFETY_DB_CONFIRM: "fitdb_test", SAFETY_OTHER_DB_URL: url("contest") }],
  ];
  for (const [f, env] of cases) {
    const r = await runScript(f, env);
    assert.notEqual(r.code, 0, f);
    assert.match(r.out, /REFUSING/, f);
    assert.match(r.out, /isn't a designated test database/, f);
    assert.doesNotMatch(r.out, /SECRETPW/, f);
  }
});

test("a server with no test marker gets only the identity GET from every script: no sign-up, no write", async () => {
  const server = await mockServer((_req, res) => json(res, 200, { fingerprint: FINGERPRINT, testMarker: null }));
  try {
    await eachScript(GUARDED, async (f) => {
      const r = await runScript(f, { BASE_URL: server.url, DATABASE_URL: FAKE_DB, STUB_LOG_FILE: "unused", SERVER_LOG_FILE: "unused" });
      assert.equal(r.code, 4, `${f}: ${r.out}`);
      assert.match(r.out, /no test-database marker/, f);
    });
    assert.ok(server.requests.length >= GUARDED.length);
    assert.deepEqual([...new Set(server.requests)], ["GET /api/health/db-identity"]);
  } finally { await server.close(); }
});

test("a server marked as the development database is refused by every script", async () => {
  const server = await mockServer((_req, res) => json(res, 200, { fingerprint: FINGERPRINT, testMarker: `${TEST_DB_MARKER_PREFIX}fitdb` }));
  try {
    await eachScript(GUARDED, async (f) => {
      const r = await runScript(f, { BASE_URL: server.url, DATABASE_URL: FAKE_DB, STUB_LOG_FILE: "unused", SERVER_LOG_FILE: "unused" });
      assert.equal(r.code, 4, `${f}: ${r.out}`);
      assert.match(r.out, /isn't marked as "fitdb_test"/, f);
    });
    assert.deepEqual([...new Set(server.requests)], ["GET /api/health/db-identity"]);
  } finally { await server.close(); }
});

test("a redirecting server can't lead any script to an external target", async () => {
  const server = await mockServer((_req, res) => { res.writeHead(307, { Location: `${elsewhere.url}/api/health/db-identity` }); res.end(); });
  try {
    await eachScript(GUARDED, async (f) => {
      const r = await runScript(f, { BASE_URL: server.url, DATABASE_URL: FAKE_DB, STUB_LOG_FILE: "unused", SERVER_LOG_FILE: "unused" });
      assert.equal(r.code, 4, `${f}: ${r.out}`);
      assert.match(r.out, /redirected its identity check/, f);
    });
    assert.deepEqual([...new Set(server.requests)], ["GET /api/health/db-identity"]);
    assert.deepEqual(elsewhere.requests, [], "the redirect target was never contacted");
  } finally { await server.close(); }
});

test("a server claiming the right marker still can't pass without the database's own fingerprint", async () => {
  const server = await mockServer((_req, res) => json(res, 200, { fingerprint: FINGERPRINT, testMarker: MARKER }));
  try {
    await eachScript(GUARDED, async (f) => {
      const r = await runScript(f, { BASE_URL: server.url, DATABASE_URL: FAKE_DB, STUB_LOG_FILE: "unused", SERVER_LOG_FILE: "unused" });
      assert.equal(r.code, 4, `${f}: ${r.out}`);
      assert.match(r.out, /can't read the identity of database "fitdb_test"/, f);
      assert.doesNotMatch(r.out, /SECRETPW/, f);
    });
    assert.deepEqual([...new Set(server.requests)], ["GET /api/health/db-identity"]);
  } finally { await server.close(); }
});

// ─── SEC-01: everything these scripts start listens on loopback only ─────────

test("every script that starts the app binds it to loopback, and every server it opens listens on loopback", () => {
  const files = [...fs.readdirSync(SCRIPTS).filter((f) => f.endsWith(".cjs")).map((f) => path.join(SCRIPTS, f)),
    ...fs.readdirSync(path.join(SCRIPTS, "lib")).filter((f) => f.endsWith(".cjs")).map((f) => path.join(SCRIPTS, "lib", f))];
  const unbound = [];
  let starts = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "");
    for (const m of source.matchAll(/NEXT_BIN,\s*"start",([^\]]*)\]/g)) {
      starts++;
      if (!/^\s*"-H",\s*(LOOPBACK_HOST|"127\.0\.0\.1")/.test(m[1])) unbound.push(`${path.basename(file)}: next start without -H loopback`);
    }
    // A server opened with .listen(port …) names loopback on the same line. (This audit's own pattern is excluded.)
    for (const line of source.split("\n").filter((l) => /\.listen\(\s*\S/.test(l) && !l.includes("unbound.push"))) {
      if (!line.includes('"127.0.0.1"')) unbound.push(`${path.basename(file)}: ${line.trim().slice(0, 80)}`);
    }
  }
  assert.ok(starts >= 4, `found ${starts} app starts`);
  assert.deepEqual(unbound, []);
  assert.equal(require("./lib/test-servers.cjs").LOOPBACK_HOST, "127.0.0.1");
});

// RC-08: the guard proxy must behave as a proxy. It forwarded the app's hop-by-hop headers, "Connection: close"
// among them, so a browser opened a new connection to it for every request: about seven per page load. One such
// connection failed in a traced label-pdf run, leaving a page without a script it needed.
test("the guard proxy doesn't forward hop-by-hop headers, so a browser can keep its connection to it", async () => {
  const app = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain", Connection: "close, X-Hop", "Keep-Alive": "timeout=5", "X-Hop": "1", "X-Kept": "yes", "Set-Cookie": ["a=1", "b=2"] });
    res.end(`seen connection=${req.headers.connection ?? "none"} x-req-hop=${req.headers["x-req-hop"] ?? "none"}`);
  });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${app.address().port}`;
  const proxy = await startGuardProxy(createDestinationPolicy({ applicationOrigin: origin, stubOrigin: null }));
  const { port } = new URL(proxy.url);
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const sockets = new Set();
  const get = () => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: `${origin}/x`, agent, headers: { Connection: "keep-alive, X-Req-Hop", "X-Req-Hop": "1", "Proxy-Connection": "keep-alive" } }, (res) => {
      sockets.add(req.socket);
      let body = "";
      res.on("data", (d) => { body += d; });
      res.on("end", () => resolve({ headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
  try {
    const answers = [await get(), await get(), await get()];
    for (const { headers, body } of answers) {
      assert.notEqual(headers.connection, "close", "the app's Connection: close isn't passed on");
      assert.equal(headers["keep-alive"] === "timeout=5", false, "nor its Keep-Alive");
      assert.equal(headers["x-hop"], undefined, "nor a header its Connection names");
      assert.equal(headers["x-kept"], "yes", "ordinary headers are kept");
      assert.deepEqual(headers["set-cookie"], ["a=1", "b=2"], "repeated headers are kept, each one");
      assert.match(body, /x-req-hop=none/, "the browser's own hop-by-hop headers aren't sent on to the app");
    }
    assert.equal(sockets.size, 1, "three requests went over one connection to the proxy");
  } finally {
    agent.destroy();
    await proxy.close();
    await new Promise((r) => app.close(r));
  }
});
