// Real browsers against harmless local servers, with no app and no database. One server plays the
// verified application, and others play forbidden local apps. Each forbidden server records every
// request, so "blocked" means it received nothing, not that a page saw an error.
//
// A zero only counts if the request was really attempted. So each step waits until the guard records
// stopping that exact request, and fails if it never does. Waiting for page events wouldn't work: when a
// route aborts an image or iframe, WebKit and Firefox may never fire load or error, and after a blocked
// navigation Chromium moves the page to an error page, interrupting whatever the page does next. So each
// attempt gets its own context. The controls at the end show these servers do receive the requests when
// protection is removed.
//   npm run test:guard:browser
// BROWSERS=chromium limits the engines. The default is all three.
"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const playwright = require("playwright");
const { createDestinationPolicy, startGuardProxy, browserLaunchOptions, guardBrowserContext, PROVIDER_STUB_IDENTITY } = require("./lib/test-target-guard.cjs");
const { watchAppScripts } = require("./lib/app-load-watch.cjs");

const BROWSERS = (process.env.BROWSERS || "chromium,firefox,webkit").split(",");
const GUARD_RECORD_MS = 5_000;

function recordingServer(respond) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    respond(req, res);
  });
  server.on("upgrade", (req, socket) => { hits.push(`UPGRADE ${req.url}`); socket.destroy(); });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    origin: `http://127.0.0.1:${server.address().port}`, port: server.address().port, hits,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  })));
}
const html = (res, body) => { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><title>t</title>${body}`); };

let app, forbidden, secondForbidden, stub, proxy, policy;
const stopped = []; // every request either guard layer stopped

before(async () => {
  forbidden = await recordingServer((_req, res) => { res.setHeader("Access-Control-Allow-Origin", "*"); html(res, "FORBIDDEN"); });
  secondForbidden = await recordingServer((_req, res) => { res.setHeader("Access-Control-Allow-Origin", "*"); html(res, "SECOND"); });
  stub = await recordingServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.url === "/__health" ? { ok: true, stub: PROVIDER_STUB_IDENTITY } : { reached: req.url }));
  });
  app = await recordingServer((req, res) => {
    if (req.url === "/nav") { res.writeHead(302, { Location: `${forbidden.origin}/nav-redirected` }); return res.end(); }
    if (req.url === "/post") { res.writeHead(307, { Location: `${forbidden.origin}/post-redirected` }); return res.end(); }
    if (req.url === "/chain") { res.writeHead(302, { Location: "/chain2" }); return res.end(); }
    if (req.url === "/chain2") { res.writeHead(302, { Location: `${secondForbidden.origin}/chain-escaped` }); return res.end(); }
    if (req.url === "/ok") { res.writeHead(302, { Location: "/landed" }); return res.end(); }
    if (req.url === "/to-stub") { res.writeHead(302, { Location: `${stub.origin}/api/auth/register` }); return res.end(); }
    if (req.url === "/upload") {
      let n = 0;
      req.on("data", (d) => (n += d.length));
      return req.on("end", () => { res.setHeader("Set-Cookie", "session=1; Path=/; HttpOnly; SameSite=Lax"); res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ n })); });
    }
    // RC-08: a page with two of its own scripts, each recording that it ran; the app drops the third's connection.
    if (req.url === "/hydrate") return html(res, `<script src="/chunk-ok.js"></script><script src="/chunk-broken.js"></script>`);
    if (req.url === "/hydrate-dropped") return html(res, `<script src="/chunk-ok.js"></script><script src="/chunk-dropped.js"></script>`);
    if (req.url === "/chunk-ok.js") { res.setHeader("Content-Type", "text/javascript"); return res.end("window.okRan = 1;"); }
    if (req.url === "/chunk-broken.js") { res.setHeader("Content-Type", "text/javascript"); return res.end("window.brokenRan = 1;"); }
    if (req.url === "/chunk-dropped.js") return req.socket.destroy();
    if (req.url === "/slow") return html(res, `<script src="/chunk-slow.js"></script>`);
    if (req.url === "/chunk-slow.js") { const t = setTimeout(() => res.end("window.slowRan = 1;"), 10_000); return res.on("close", () => clearTimeout(t)); }
    if (req.url === "/cookie") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ cookie: req.headers.cookie || null })); }
    html(res, "APPLICATION");
  });
  policy = createDestinationPolicy({ applicationOrigin: app.origin, stubOrigin: stub.origin });
  proxy = await startGuardProxy(policy, (u) => stopped.push(u));
});
after(async () => { await proxy.close(); await Promise.all([app, forbidden, secondForbidden, stub].map((s) => s.close())); });

// QA-03: Firefox's session store intermittently throws while a context closes with a window still settling
// ("_maybeDontRestoreTabs ... is undefined", Browser.removeBrowserContext). That is teardown, after every assertion;
// any other error from close still fails the test.
const closeContext = async (context) => {
  try { await context.close(); } catch (e) { if (!/_maybeDontRestoreTabs/.test(String(e?.message))) throw e; }
};
const guardedBrowser = (name) => playwright[name].launch(browserLaunchOptions(name, proxy.url));
/** A fresh context on the application, so one blocked request can't disturb the next. */
async function pageOnApp(browser, { guarded = true } = {}) {
  const context = await browser.newContext();
  if (guarded) await guardBrowserContext(context, () => true, policy, (u) => stopped.push(u));
  const page = await context.newPage();
  await page.goto(`${app.origin}/`);
  return { context, page };
}
function reset() {
  stopped.length = 0;
  for (const s of [app, forbidden, secondForbidden, stub]) s.hits.length = 0;
}
const fetchStatus = (page, url, init) => page.evaluate(([u, i]) => fetch(u, i).then((r) => r.status, () => "failed"), [url, init ?? {}]);
const noForbiddenHits = (label) => {
  assert.deepEqual(forbidden.hits, [], `${label}: first forbidden server`);
  assert.deepEqual(secondForbidden.hits, [], `${label}: second forbidden server`);
};
async function waitUntilStopped(marks, label) {
  const deadline = Date.now() + GUARD_RECORD_MS;
  while (![marks].flat().some((mark) => stopped.some((u) => u.includes(mark)))) {
    assert.ok(Date.now() < deadline, `${label}: the guard never recorded stopping this, so a zero count would prove nothing`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
/** Sends one forbidden request, proves the guard stopped it, and proves nothing arrived. */
async function assertStopped(browser, label, send, mark) {
  const { context, page } = await pageOnApp(browser);
  stopped.length = 0; // so only this attempt can count as evidence
  try {
    await send(page, context);
    await waitUntilStopped(mark, label);
    noForbiddenHits(label);
  } finally { await closeContext(context); }
}
async function expectSoon(condition, label) {
  const deadline = Date.now() + GUARD_RECORD_MS;
  while (!condition()) { assert.ok(Date.now() < deadline, label); await new Promise((r) => setTimeout(r, 20)); }
}
const navigate = (url) => (page) => page.goto(url).catch(() => {});

for (const name of BROWSERS) {
  test(`${name}: the verified application works: pages, redirects, uploads and cookies`, { timeout: 120_000 }, async () => {
    reset();
    const browser = await guardedBrowser(name);
    try {
      const { page } = await pageOnApp(browser);
      assert.match(await page.content(), /APPLICATION/);
      await page.goto(`${app.origin}/ok`);
      assert.equal(new URL(page.url()).pathname, "/landed", "a same-origin redirect is followed");
      const upload = await page.evaluate(() => fetch("/upload", { method: "POST", body: "x".repeat(200_000) }).then((r) => r.json()));
      assert.equal(upload.n, 200_000);
      const after = await page.evaluate(() => fetch("/cookie").then((r) => r.json()));
      assert.equal(after.cookie, "session=1", "cookies set through the proxy are sent back");
      noForbiddenHits("normal use");
      assert.deepEqual(stopped, [], "nothing legitimate was stopped");
    } finally { await browser.close(); }
  });

  // RC-08: the failure seen in label-pdf, made deterministic: one of the page's own scripts can't be loaded.
  test(`${name}: RC-08: an app script whose connection fails is reported at once, by path, and never ran`, { timeout: 120_000 }, async () => {
    reset();
    const browser = await guardedBrowser(name);
    try {
      const { context, page } = await pageOnApp(browser);
      const watch = watchAppScripts(page, app.origin);
      await page.route("**/chunk-broken.js", (route) => route.abort("connectionfailed"));
      await page.goto(`${app.origin}/hydrate`);
      assert.deepEqual(await page.evaluate(() => [window.okRan ?? 0, window.brokenRan ?? 0]), [1, 0], "the working script ran, the failed one didn't");
      assert.equal(watch.failures.length, 1, `exactly the failed script is reported: ${watch.failures}`);
      assert.match(watch.failures[0], /^\/chunk-broken\.js \S/);
      assert.throws(() => watch.assertNone("opening the page"), /^Error: opening the page: the application's own script failed to load.*\/chunk-broken\.js/);
      watch.clear();
      watch.assertNone("after clearing");
      await closeContext(context);
    } finally { await browser.close(); }
  });

  test(`${name}: RC-08: an app script the proxy answers with 502 is reported; a cancelled load isn't`, { timeout: 120_000 }, async () => {
    reset();
    const browser = await guardedBrowser(name);
    try {
      const { context, page } = await pageOnApp(browser);
      const watch = watchAppScripts(page, app.origin);
      await page.goto(`${app.origin}/hydrate-dropped`);
      assert.deepEqual(watch.failures, ["/chunk-dropped.js HTTP 502"], "the app dropped the connection, and the proxy said so");
      assert.equal(await page.evaluate(() => window.okRan ?? 0), 1);
      watch.clear();
      // A real cancellation: leave the page while its script is still loading.
      const cancelled = [];
      page.on("requestfailed", (r) => { if (r.url().endsWith("/chunk-slow.js")) cancelled.push(r.failure()?.errorText); });
      const slowRequested = page.waitForRequest((r) => r.url().endsWith("/chunk-slow.js"));
      await page.goto(`${app.origin}/slow`, { waitUntil: "commit" });
      await slowRequested;
      await page.goto(`${app.origin}/`);
      // Chromium and Firefox don't report a load cancelled by leaving the page; WebKit does, so there it's really tested.
      if (name === "webkit") await expectSoon(() => cancelled.length > 0, "WebKit reported the cancelled load");
      assert.deepEqual(watch.failures, [], `a load cancelled by navigating away (${cancelled}) is the navigation's doing, not a failure`);
      await closeContext(context);
    } finally { await browser.close(); }
  });

  test(`${name}: navigating to another local application sends it nothing`, { timeout: 120_000 }, async () => {
    reset();
    const browser = await guardedBrowser(name);
    try {
      await assertStopped(browser, "another port", navigate(`${forbidden.origin}/direct`), "/direct");
      await assertStopped(browser, "the same port under another name", navigate(`http://localhost:${app.port}/other-name`), "/other-name");
      assert.deepEqual(app.hits.filter((h) => h.includes("/other-name")), [], "the same port under another name is another origin");
    } finally { await browser.close(); }
  });

  test(`${name}: redirects from the application can't reach another server`, { timeout: 120_000 }, async () => {
    reset();
    const browser = await guardedBrowser(name);
    try {
      await assertStopped(browser, "302 navigation", navigate(`${app.origin}/nav`), "/nav-redirected");
      await assertStopped(browser, "307 POST", (page) => fetchStatus(page, `${app.origin}/post`, { method: "POST", body: "secret" }).then((s) => assert.equal(s, "failed")), "/post-redirected");
      await assertStopped(browser, "redirect chain", navigate(`${app.origin}/chain`), "/chain-escaped");
      await assertStopped(browser, "redirect to a stub's other path", navigate(`${app.origin}/to-stub`), "/api/auth/register");
      assert.deepEqual(stub.hits, [], "a redirect can't reach a stub's non-control path");
    } finally { await browser.close(); }
  });

  test(`${name}: page requests of every kind can't reach another server`, { timeout: 120_000 }, async () => {
    reset();
    const browser = await guardedBrowser(name);
    const url = (path) => `${forbidden.origin}${path}`;
    try {
      await assertStopped(browser, "fetch", (page) => fetchStatus(page, url("/fetch")).then((s) => assert.equal(s, "failed")), "/fetch");
      await assertStopped(browser, "fetch POST", (page) => fetchStatus(page, url("/write"), { method: "POST", body: "secret" }).then((s) => assert.equal(s, "failed")), "/write");
      await assertStopped(browser, "image", (page) => page.evaluate((u) => { new Image().src = u; }, url("/image.png")), "/image.png");
      await assertStopped(browser, "script", (page) => page.evaluate((u) => { const s = document.createElement("script"); s.src = u; document.head.append(s); }, url("/script.js")), "/script.js");
      await assertStopped(browser, "iframe", (page) => page.evaluate((u) => { const f = document.createElement("iframe"); f.src = u; document.body.append(f); }, url("/frame")), "/frame");
      // A tunnel names the host and port, and an upgrade names the path, depending on the engine.
      await assertStopped(browser, "WebSocket", (page) => page.evaluate((u) => { new WebSocket(u); }, `${forbidden.origin.replace("http", "ws")}/socket`), ["/socket", `:${forbidden.port}`]);
      await assertStopped(browser, "beacon", (page) => page.evaluate((u) => { navigator.sendBeacon(u, "secret"); }, url("/beacon")), "/beacon");
      await assertStopped(browser, "popup", (page) => page.evaluate((u) => { window.open(u); }, url("/popup")), "/popup");
      await assertStopped(browser, "form POST", (page) => page.evaluate((u) => { const f = document.createElement("form"); f.method = "POST"; f.action = u; document.body.append(f); f.submit(); }, url("/form")), "/form");
    } finally { await browser.close(); }
  });

  test(`${name}: an approved stub's control paths work, and its other paths don't`, { timeout: 120_000 }, async () => {
    reset();
    const browser = await guardedBrowser(name);
    try {
      const { page } = await pageOnApp(browser);
      assert.equal(await fetchStatus(page, `${stub.origin}/__requests`), 200);
      assert.deepEqual(stub.hits, ["GET /__requests"]);
      stub.hits.length = 0;
      assert.equal(await fetchStatus(page, `${stub.origin}/api/auth/register`, { method: "POST", body: "{}" }), "failed");
      assert.equal(await fetchStatus(page, `${stub.origin}/v1/messages`, { method: "POST", body: "{}" }), "failed");
      assert.deepEqual(stub.hits, [], "only control paths");
    } finally { await browser.close(); }
  });

  // Controls: the same requests with protection removed. If these stopped arriving, the zero counts
  // above would prove nothing.
  test(`${name}: control: with no guard, the forbidden server does receive the requests`, { timeout: 120_000 }, async () => {
    reset();
    const browser = await playwright[name].launch();
    try {
      for (const send of [
        (page) => page.goto(`${forbidden.origin}/direct`),
        (page) => fetchStatus(page, `${forbidden.origin}/fetch`),
        (page) => page.goto(`${app.origin}/nav`),
      ]) {
        const { context, page } = await pageOnApp(browser, { guarded: false });
        await send(page);
        await closeContext(context);
      }
      assert.ok(forbidden.hits.includes("GET /direct"), "direct navigation arrived");
      assert.ok(forbidden.hits.includes("GET /fetch"), "fetch arrived");
      assert.ok(forbidden.hits.includes("GET /nav-redirected"), "the redirect arrived");
    } finally { await browser.close(); }
  });

  test(`${name}: control: a route guard alone stops direct requests, but not redirects or WebSockets. This is why the proxy exists`, { timeout: 120_000 }, async () => {
    reset();
    const browser = await playwright[name].launch();
    const untilHit = async (mark) => {
      const deadline = Date.now() + GUARD_RECORD_MS;
      while (!forbidden.hits.some((h) => h.includes(mark)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    };
    try {
      const direct = await pageOnApp(browser);
      await direct.page.goto(`${forbidden.origin}/direct`).catch(() => {});
      await waitUntilStopped("/direct", "direct navigation");
      assert.equal(forbidden.hits.some((h) => h.includes("/direct")), false, "direct navigation is stopped by the route");
      await closeContext(direct.context);

      const redirected = await pageOnApp(browser);
      await redirected.page.goto(`${app.origin}/nav`).catch(() => {});
      await untilHit("/nav-redirected");
      assert.ok(forbidden.hits.includes("GET /nav-redirected"), "the redirect still arrives without the proxy");
      await closeContext(redirected.context);

      const socket = await pageOnApp(browser);
      await socket.page.evaluate((u) => { new WebSocket(u); }, `${forbidden.origin.replace("http", "ws")}/socket`);
      await untilHit("/socket");
      assert.ok(forbidden.hits.includes("UPGRADE /socket"), "the WebSocket still arrives without the proxy");
      await closeContext(socket.context);
    } finally { await browser.close(); }
  });
}
