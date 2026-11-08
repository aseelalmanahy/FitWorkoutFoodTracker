// Shared guard for every test script that can write through a running app or to a database.
// See docs/PHASE_4_0_0A_TEST_TARGET_GUARD.md for the design and its limits.
//
//   const target = require("./lib/test-target-guard.cjs").requireSafeTarget(); // static, no I/O, exit 4
//   const BASE = target.baseUrl;
//   await target.verifyServer();                       // before anything else, exit 4
//   const browser = await playwright.chromium.launch(target.launchOptions("chromium"));
//   const ctx = await target.guardContext(await browser.newContext());
//
// Static checks: BASE_URL is exactly a loopback origin, DATABASE_URL is a local designated test
// database, and nothing in the environment could redirect traffic.
// Server checks: the running app reports the test marker of that database, and its fingerprint
// equals the one this process reads from that database directly. So a local app that fell back
// to `.env` is refused even though its address is loopback.
//
// After verification, requests may reach only that exact origin. Being on loopback isn't enough:
// another local port or address could be a different app on a different database. One policy decides
// for fetch and for browsers. A provider stub is allowed only if the script asks for it by name, it
// answers the stub handshake, and only on its control paths.
//
// Browsers go through a local forward proxy, because Playwright's routes don't see redirect targets,
// so a redirect from the verified app could otherwise reach another server.
//
// Nothing here can be relaxed from the environment: there's no allowlist and no bypass flag.
// Requiring this file has no side effects, and nothing connects until verifyServer() runs.
"use strict";
const { createHash } = require("node:crypto");
const dns = require("node:dns");
const http = require("node:http");
const net = require("node:net");
const { validateTargetUrl, assertConnectedTarget, redact, urlSecrets, TEST_DB_MARKER_PREFIX } = require("./test-db-guard.cjs");

// fitdb_test_isolated: a separate, disposable database for the regression suites, so they never touch fitdb_test's demo and QA data.
// fitdb_test_isolated_other (B1): its companion, the second database the two cross-database suites compare it with, so
// they no longer need fitdb_test and fitdb_test_other. The app itself is never started on it, so the app's list omits it.
const DESIGNATED_TEST_DATABASES = Object.freeze(["fitdb_test", "fitdb_test_other", "fitdb_test_isolated", "fitdb_test_isolated_other"]);
/** Each runnable test database and the one companion the cross-database suites compare it with. */
const COMPANION_TEST_DATABASES = Object.freeze({ fitdb_test: "fitdb_test_other", fitdb_test_isolated: "fitdb_test_isolated_other" });
const LOOPBACK_HOSTNAMES = Object.freeze(["localhost", "127.0.0.1", "[::1]"]);
// The exact accepted spelling. URL parsers rewrite forms such as http://127.1, http://2130706433,
// HTTP://LOCALHOST and http:\\localhost into something that looks fine, so the raw text is matched too.
const EXACT_BASE_URL = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[1-9][0-9]{0,4})?$/;
const PROXY_VARIABLES = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
const LOOPBACK_ONLY_VARIABLES = ["LABEL_STUB_URL", "FDC_BASE_URL", "OFF_BASE_URL", "ANTHROPIC_BASE_URL"];
// Must match scripts/stub-label-provider.cjs.
const PROVIDER_STUB_IDENTITY = "fitworkoutfoodtracker-provider-stub:v1";
const PROVIDER_STUB_CONTROL_PATHS = Object.freeze(["/__health", "/__scenario", "/__requests", "/__reset"]);
const DESTINATION = Object.freeze({ APPLICATION: "application", STUB: "stub", FORBIDDEN: "forbidden" });
const IDENTITY_PATH = "/api/health/db-identity";
const IDENTITY_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const EXIT_REFUSED = 4;
const realFetch = globalThis.fetch;

// Must match src/lib/server/db-identity.ts exactly. scripts/test-target-guard.test.cjs checks this.
const DB_IDENTITY_SQL =
  "SELECT current_database() || '|' || (SELECT oid::text FROM pg_database WHERE datname = current_database()) || '|' || extract(epoch from pg_postmaster_start_time())::text AS identity, " +
  "shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') AS marker";
const fingerprintOf = (identity) => createHash("sha256").update(`fwft-db-identity-v1|${identity}`).digest("hex");

class TargetRefused extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "TargetRefused";
    this.reason = reason;
  }
}
const problem = (reason, message) => ({ reason, message });

/** Reachable only over loopback, for URLs seen while running (redirects, browser requests, stubs). */
function isLoopbackHttpUrl(value) {
  let u;
  try { u = new URL(String(value)); } catch { return false; }
  return u.protocol === "http:" && LOOPBACK_HOSTNAMES.includes(u.hostname) && !u.username && !u.password;
}

/** Messages never repeat the URL, as it may hold credentials. Returns null when acceptable. */
function baseUrlProblem(value) {
  if (value === undefined || value === null || value === "") {
    return problem("base_url_missing", "BASE_URL must be set explicitly. There's no default.");
  }
  let u;
  try { u = new URL(String(value)); } catch { return problem("base_url_malformed", "BASE_URL is not a valid URL."); }
  if (u.username || u.password) return problem("base_url_credentials", "BASE_URL must not contain credentials.");
  if (!LOOPBACK_HOSTNAMES.includes(u.hostname)) {
    return problem("base_url_not_loopback", `BASE_URL host "${u.hostname || "(none)"}" is not local. Allowed: ${LOOPBACK_HOSTNAMES.join(", ")}.`);
  }
  if (u.protocol !== "http:") return problem("base_url_protocol", `BASE_URL protocol "${u.protocol}" isn't supported. Use http: on loopback.`);
  if (!EXACT_BASE_URL.test(String(value))) {
    return problem("base_url_ambiguous", "BASE_URL must be written exactly as http://localhost:<port>, http://127.0.0.1:<port> or http://[::1]:<port>, with no path, query, fragment or other spelling.");
  }
  return null;
}

function databaseNameOf(url) {
  try { return decodeURIComponent(new URL(url).pathname.slice(1)); } catch { return undefined; }
}

/** Reuses the existing database guard, then narrows it to the designated names. Null when acceptable. */
function databaseUrlProblem(url) {
  const name = databaseNameOf(url);
  const v = validateTargetUrl(url, name);
  if (!v.ok) {
    return problem(url ? "database_invalid" : "database_missing",
      `DATABASE_URL must be set to a local test database:\n  - ${redact(v.errors.join("\n  - "), urlSecrets(url))}`);
  }
  if (!DESIGNATED_TEST_DATABASES.includes(name)) {
    return problem("database_not_designated", `database "${name}" isn't a designated test database (${DESIGNATED_TEST_DATABASES.join(", ")}).`);
  }
  return null;
}

/** Settings that could send requests elsewhere, change what runs, or are retired bypasses. */
function environmentProblems(env, { externalProviders = false } = {}) {
  const found = [];
  if (env.NODE_ENV === "production") found.push(problem("environment_production", "NODE_ENV=production is set in the test process."));
  for (const name of PROXY_VARIABLES) {
    if (env[name]) found.push(problem("environment_proxy", `${name} is set, which could route test traffic through another host.`));
  }
  if (env.NODE_PATH) found.push(problem("environment_node_path", "NODE_PATH is set, which could replace the modules this guard relies on."));
  if (/(?:^|\s)(?:-r|--require|--import|--loader|--experimental-loader)(?:[=\s]|$)/.test(env.NODE_OPTIONS || "")) {
    found.push(problem("environment_preload", "NODE_OPTIONS preloads code, which could replace this guard."));
  }
  if (env.LIVE_CHECK_ALLOW_DATABASE) {
    found.push(problem("environment_bypass", "LIVE_CHECK_ALLOW_DATABASE is no longer supported. Only the designated test databases can be used."));
  }
  if (!externalProviders) {
    for (const name of LOOPBACK_ONLY_VARIABLES) {
      if (env[name] && !isLoopbackHttpUrl(env[name])) found.push(problem("environment_external_stub", `${name} must point at a local stub.`));
    }
  }
  return found;
}

/**
 * Every static check. No I/O. `externalProviders` is only for the live check, whose purpose is
 * real provider traffic, and which verifies the server itself.
 */
function checkTarget(env = process.env, options = {}) {
  const problems = [
    baseUrlProblem(env.BASE_URL),
    databaseUrlProblem(env.DATABASE_URL),
    ...environmentProblems(env, options),
    options.labelStub ? stubUrlProblem(env.LABEL_STUB_URL, env.BASE_URL) : null,
  ].filter(Boolean);
  if (problems.length) return { ok: false, problems };
  const u = new URL(env.DATABASE_URL);
  return {
    ok: true, problems, baseUrl: env.BASE_URL, databaseUrl: env.DATABASE_URL, dbName: databaseNameOf(env.DATABASE_URL), dbHost: u.hostname,
    stubUrl: options.labelStub && env.LABEL_STUB_URL ? env.LABEL_STUB_URL : undefined,
  };
}

/** The one variable a script can opt in to. It's one exact origin, never a list. Null when acceptable or unset. */
function stubUrlProblem(value, baseUrl) {
  if (!value) return null;
  if (baseUrlProblem(value)) return problem("stub_url_invalid", "LABEL_STUB_URL must be written exactly as a loopback origin.");
  if (!baseUrlProblem(baseUrl) && new URL(value).origin === new URL(baseUrl).origin) {
    return problem("stub_is_application", "LABEL_STUB_URL can't be the application's own address.");
  }
  return null;
}

/**
 * The one decision about where a verified test may send a request, shared by fetch and browsers.
 * The application is its exact origin. A stub is its exact origin AND a control path, so pointing the
 * stub variable at a real app reaches nothing that can write. Everything else is forbidden.
 */
function createDestinationPolicy({ applicationOrigin, stubOrigin = null }) {
  return {
    classify(value) {
      let u;
      try { u = new URL(String(value)); } catch { return DESTINATION.FORBIDDEN; }
      if (u.protocol !== "http:" || u.username || u.password) return DESTINATION.FORBIDDEN;
      if (u.origin === applicationOrigin) return DESTINATION.APPLICATION;
      if (stubOrigin && u.origin === stubOrigin && PROVIDER_STUB_CONTROL_PATHS.includes(u.pathname)) return DESTINATION.STUB;
      return DESTINATION.FORBIDDEN;
    },
  };
}

async function readDatabaseIdentity(databaseUrl, dbName) {
  const { PrismaClient } = require("@prisma/client");
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await assertConnectedTarget((sql) => client.$queryRawUnsafe(sql), dbName);
    const rows = await client.$queryRawUnsafe(DB_IDENTITY_SQL);
    return { fingerprint: fingerprintOf(rows[0].identity), marker: rows[0].marker };
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

/**
 * Proves the app at baseUrl is using the designated test database at databaseUrl. Throws
 * TargetRefused otherwise. Only a read-only GET and a read-only query. The server is checked
 * first, so a wrong server never causes a database connection. `deps` is for tests.
 */
async function verifyServerIdentity({ baseUrl, databaseUrl }, deps = {}) {
  const { fetchImpl = realFetch, lookup = dns.promises.lookup, readDatabase = readDatabaseIdentity } = deps;
  const invalid = baseUrlProblem(baseUrl) || databaseUrlProblem(databaseUrl);
  if (invalid) throw new TargetRefused(invalid.reason, invalid.message);
  const dbName = databaseNameOf(databaseUrl);
  const expectedMarker = TEST_DB_MARKER_PREFIX + dbName;

  if (new URL(baseUrl).hostname === "localhost") {
    let addresses;
    try { addresses = await lookup("localhost", { all: true }); } catch { throw new TargetRefused("localhost_unresolved", "localhost can't be resolved."); }
    const loopback = (a) => (a.family === 6 ? a.address === "::1" : /^127\./.test(a.address));
    if (!addresses.length || !addresses.every(loopback)) {
      throw new TargetRefused("localhost_not_loopback", "localhost resolves to a non-loopback address on this machine.");
    }
  }

  let res;
  try {
    res = await fetchImpl(`${baseUrl}${IDENTITY_PATH}`, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS) });
  } catch {
    throw new TargetRefused("identity_unreachable", `the server at ${baseUrl} can't be reached to verify its database. Is the app running?`);
  }
  if (res.status >= 300 && res.status < 400) {
    throw new TargetRefused("identity_redirect", "the server redirected its identity check, so it wasn't followed.");
  }
  if (!res.ok) {
    throw new TargetRefused("identity_unavailable", `the server doesn't report its database identity (HTTP ${res.status}). Use \`npm run dev\`, or set EXPOSE_DB_IDENTITY=1 for \`next start\`.`);
  }
  const body = await res.json().catch(() => null);
  if (!body || typeof body.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(body.fingerprint)) {
    throw new TargetRefused("identity_invalid", "the server's identity response isn't valid.");
  }
  if (body.testMarker === null || body.testMarker === undefined || body.testMarker === "") {
    throw new TargetRefused("marker_missing", "the server's database has no test-database marker, so it isn't a marked test instance.");
  }
  if (body.testMarker !== expectedMarker) {
    throw new TargetRefused("marker_wrong", `the server's database isn't marked as "${dbName}".`);
  }

  let own;
  try {
    own = await readDatabase(databaseUrl, dbName);
  } catch (e) {
    throw new TargetRefused("database_unreachable", `can't read the identity of database "${dbName}": ${redact(e.message, urlSecrets(databaseUrl))}`);
  }
  if (own.fingerprint !== body.fingerprint) {
    throw new TargetRefused("identity_mismatch", `the server is not using database "${dbName}". Start it with the same DATABASE_URL as this script.`);
  }
  if (own.marker !== expectedMarker) {
    throw new TargetRefused("marker_wrong", `database "${dbName}" doesn't carry its own test-database marker.`);
  }
  return { dbName, fingerprint: body.fingerprint };
}

/** A stub is only trusted once it says what it is. Otherwise any local server could be named as one. */
async function verifyProviderStub(stubUrl, { fetchImpl = realFetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`${stubUrl}/__health`, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS) });
  } catch {
    throw new TargetRefused("stub_unreachable", "the provider stub named by LABEL_STUB_URL can't be reached.");
  }
  const body = res.status === 200 ? await res.json().catch(() => null) : null;
  if (!body || body.stub !== PROVIDER_STUB_IDENTITY) {
    throw new TargetRefused("stub_not_identified", "the server named by LABEL_STUB_URL doesn't identify itself as a provider stub.");
  }
}

/**
 * A fetch that refuses everything until the server is verified, and any destination the policy
 * forbids. Redirects are never followed to another origin, as fetch would otherwise repeat a request
 * elsewhere before this code saw it. Same-origin GET and HEAD redirects are followed if the target is
 * still allowed. A same-origin redirect of any other method is returned unfollowed.
 */
function createFetchGuard(underlying, isVerified, policy) {
  return async function guardedFetch(input, init = {}) {
    if (!isVerified()) throw new TargetRefused("not_verified", "a request was attempted before verifyServer() finished.");
    let url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    if (policy.classify(url) === DESTINATION.FORBIDDEN) throw new TargetRefused("request_forbidden", "a test tried to send a request somewhere other than the verified application.");
    const mode = init.redirect ?? (typeof input === "object" && !(input instanceof URL) ? input.redirect : undefined) ?? "follow";
    const method = String(init.method ?? (typeof input === "object" && !(input instanceof URL) ? input.method : undefined) ?? "GET").toUpperCase();
    let res = await underlying(input, { ...init, redirect: "manual" });
    for (let hops = 0; mode === "follow" && res.status >= 300 && res.status < 400 && res.headers.get("location"); hops++) {
      let next;
      try { next = new URL(res.headers.get("location"), url); } catch { throw new TargetRefused("redirect_refused", "a test received a redirect with an invalid address."); }
      if (policy.classify(next) === DESTINATION.FORBIDDEN || next.origin !== new URL(url).origin) {
        throw new TargetRefused("redirect_refused", "a test was redirected to another origin, which wasn't followed.");
      }
      if (method !== "GET" && method !== "HEAD") return res;
      if (hops >= MAX_REDIRECTS) throw new TargetRefused("redirect_refused", "too many redirects.");
      url = next.href;
      res = await underlying(url, { ...init, redirect: "manual" });
    }
    return res;
  };
}

/** The policy, for URLs a page can also use locally. A blob: URL belongs to the origin that made it. */
function browserRequestAllowed(policy, url) {
  if (/^(?:data|about):/.test(url)) return true;
  if (/^blob:/.test(url)) {
    try { return policy.classify(`${new URL(url).origin}/`) === DESTINATION.APPLICATION; } catch { return false; }
  }
  return policy.classify(url) !== DESTINATION.FORBIDDEN;
}

/**
 * Aborts forbidden browser requests, including URLs a page obtains dynamically. This is the second
 * layer, and it can't see redirect targets. The proxy from launchOptions() is what stops those.
 */
async function guardBrowserContext(context, isVerified, policy, onBlocked = () => {}, { serviceWorkers = false } = {}) {
  if (!isVerified()) throw new TargetRefused("not_verified", "a browser context was opened before verifyServer() finished.");
  // Phase 1: once the app's service worker controls a page, its requests pass through the worker, where this route
  // layer and a suite's own routes and request records can't see them (the proxy still applies). So a guarded page
  // doesn't get the service worker API, and the app doesn't register one, unless a suite tests the worker itself.
  if (!serviceWorkers) await context.addInitScript(() => { try { delete Navigator.prototype.serviceWorker; } catch { /* left as is */ } });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (browserRequestAllowed(policy, url)) return route.fallback();
    onBlocked(url);
    return route.abort("blockedbyclient");
  });
  return context;
}

/**
 * A local forward proxy that applies the policy to every request a browser sends, including each
 * redirect hop. A tunnel is allowed only to the exact verified application, as Playwright's route.fetch()
 * uses one even for plain http. Any other tunnel, and any WebSocket upgrade, is refused.
 */
/** Headers that describe one connection, not the message (RFC 9110 7.6.1), including any the Connection header names. */
const HOP_BY_HOP = ["connection", "keep-alive", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"];
function withoutHopByHop(headers) {
  const named = String(headers.connection ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  const out = { ...headers };
  for (const h of [...HOP_BY_HOP, ...named]) delete out[h];
  return out;
}

function startGuardProxy(policy, onBlocked = () => {}) {
  const server = http.createServer((req, res) => {
    let target;
    try { target = new URL(req.url); } catch { res.writeHead(400, { Connection: "close" }); return res.end(); }
    if (policy.classify(target) === DESTINATION.FORBIDDEN) {
      onBlocked(target.href);
      res.writeHead(403, { "Content-Type": "text/plain", Connection: "close" });
      return res.end("Blocked by the test-target guard.");
    }
    const headers = withoutHopByHop(req.headers);
    delete headers["proxy-authorization"];
    // agent: false, so a request is never sent on a connection the app has already closed.
    const upstream = http.request({ host: target.hostname.replace(/^\[|\]$/g, ""), port: target.port || 80, path: target.pathname + target.search, method: req.method, headers, agent: false }, (answer) => {
      // RC-08: hop-by-hop headers belong to one connection and are never forwarded. Passing on the app's
      // "Connection: close" made the browser open a new connection to this proxy for every request.
      res.writeHead(answer.statusCode, withoutHopByHop(answer.headers));
      answer.pipe(res);
    });
    upstream.on("error", () => { if (res.headersSent) res.destroy(); else { res.writeHead(502, { Connection: "close" }); res.end(); } });
    res.on("close", () => upstream.destroy());
    req.on("error", () => upstream.destroy());
    req.pipe(upstream);
  });
  const refuseTunnel = (req, socket) => {
    onBlocked(String(req.url));
    socket.on("error", () => {});
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  };
  server.on("connect", (req, socket, head) => {
    if (policy.classify(`http://${req.url}/`) !== DESTINATION.APPLICATION) return refuseTunnel(req, socket);
    const destination = new URL(`http://${req.url}/`);
    const upstream = net.connect(Number(destination.port) || 80, destination.hostname.replace(/^\[|\]$/g, ""), () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  server.on("upgrade", refuseTunnel);
  server.on("clientError", (_e, socket) => socket.destroy());
  server.requestTimeout = 0;
  server.keepAliveTimeout = 120_000;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.unref();
      resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) });
    });
  });
}

/** Browsers skip proxies for loopback unless told otherwise, and each engine is told differently. */
function browserLaunchOptions(engine, proxyUrl) {
  const proxy = { server: proxyUrl };
  if (engine === "chromium") return { proxy, args: ["--proxy-bypass-list=<-loopback>"] };
  if (engine === "firefox") return { proxy, firefoxUserPrefs: { "network.proxy.allow_hijacking_localhost": true, "network.proxy.no_proxies_on": "" } };
  if (engine === "webkit") return { proxy };
  throw new TargetRefused("unknown_browser", `no guarded launch options exist for browser "${engine}".`);
}

function refuseAndExit(message, secretSource, exit) {
  console.error(`REFUSING to run ${message}`.split("\n").map((l) => redact(l, urlSecrets(secretSource))).join("\n"));
  exit(EXIT_REFUSED);
}

/**
 * The entry point for write-capable tests. Static checks run now, and any failure exits with 4
 * before a connection is opened. It replaces global fetch, so a request made before
 * verifyServer() finishes is refused rather than sent. That gate doesn't cover Prisma, and
 * node:test doesn't wait for one before() hook ahead of the next, so every hook must start by
 * awaiting verifyServer(). scripts/test-target-guard.test.cjs enforces this.
 * A script that talks to the label provider stub passes { labelStub: true }.
 */
function requireSafeTarget({ env = process.env, exit = process.exit, deps = {}, labelStub = false } = {}) {
  const checked = checkTarget(env, { labelStub });
  if (!checked.ok) {
    refuseAndExit(`(no database was touched):\n  - ${checked.problems.map((p) => p.message).join("\n  - ")}`, env.DATABASE_URL, exit);
    return null; // only reached when a test supplies `exit`
  }
  let verified = false;
  let verification = null;
  let proxy = null;
  const isVerified = () => verified;
  const policy = createDestinationPolicy({
    applicationOrigin: new URL(checked.baseUrl).origin,
    stubOrigin: checked.stubUrl ? new URL(checked.stubUrl).origin : null,
  });
  const reportBlocked = () => console.error("BLOCKED: a browser request outside the verified application was stopped.");
  globalThis.fetch = createFetchGuard(realFetch, isVerified, policy);
  return {
    baseUrl: checked.baseUrl,
    stubUrl: checked.stubUrl,
    databaseUrl: checked.databaseUrl,
    dbName: checked.dbName,
    // Runs once. Every caller waits for the same result, so it's safe to call from each hook.
    verifyServer() {
      verification ??= (async () => {
        await verifyServerIdentity(checked, deps);
        if (checked.stubUrl) await verifyProviderStub(checked.stubUrl, deps);
        proxy = await startGuardProxy(policy, reportBlocked);
      })().then(
        () => { verified = true; },
        (e) => refuseAndExit(`(nothing was written): ${e instanceof TargetRefused ? e.message : "the target couldn't be verified."}`, checked.databaseUrl, exit),
      );
      return verification;
    },
    /**
     * The guarded launch. Phase 2: { fakeCamera } adds only Chromium's fake-camera flags (a video file, a device count,
     * auto-granted prompts), from this fixed list, so nothing can replace the proxy or its bypass rule.
     */
    launchOptions(engine, { fakeCamera } = {}) {
      if (!verified) throw new TargetRefused("not_verified", "a browser was launched before verifyServer() finished.");
      const options = browserLaunchOptions(engine, proxy.url);
      if (!fakeCamera) return options;
      if (engine !== "chromium") throw new TargetRefused("unknown_browser", "a fake camera exists only in Chromium.");
      const { video = null, devices = 1, grant = true } = fakeCamera;
      if (!Number.isInteger(devices) || devices < 1 || devices > 4) throw new TargetRefused("bad_option", "fakeCamera.devices must be 1 to 4.");
      if (video !== null && (typeof video !== "string" || !/\.y4m$/.test(video) || /[\s"=]/.test(video))) throw new TargetRefused("bad_option", "fakeCamera.video must be a .y4m path with no spaces.");
      return { ...options, args: [...options.args, `--use-fake-device-for-media-stream=device-count=${devices}`, ...(grant ? ["--use-fake-ui-for-media-stream"] : []), ...(video ? [`--use-file-for-fake-video-capture=${video}`] : [])] };
    },
    guardContext: (context, options) => guardBrowserContext(context, isVerified, policy, reportBlocked, options),
  };
}

module.exports = {
  DESIGNATED_TEST_DATABASES, COMPANION_TEST_DATABASES, LOOPBACK_HOSTNAMES, DB_IDENTITY_SQL, EXIT_REFUSED, TargetRefused,
  DESTINATION, PROVIDER_STUB_IDENTITY, isLoopbackHttpUrl, baseUrlProblem, databaseUrlProblem, environmentProblems,
  stubUrlProblem, checkTarget, createDestinationPolicy, readDatabaseIdentity, verifyServerIdentity, verifyProviderStub,
  createFetchGuard, browserRequestAllowed, guardBrowserContext, startGuardProxy, browserLaunchOptions, requireSafeTarget,
};
