// Phase 1 in real browsers, on the production build: the app is installable, and its service worker stores nothing
// private. Signed in, a person browses pages and the app calls its APIs; then every cached URL is listed, and each must
// be a build file, an icon or the offline page. Offline, a page shows the offline page, with nothing of the person's.
// Service workers are checked in Chromium (and Firefox); WebKit here checks what installing on an iPhone reads.
//   BASE_URL=… DATABASE_URL=<designated test database> node scripts/e2e-pwa.cjs
const assert = require("node:assert/strict");
const playwright = require("playwright");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
const step = (s) => console.log(`✓ ${s}`);
const ALLOWED = (path) => path.startsWith("/_next/static/") || path.startsWith("/icons/") || path === "/offline.html";

async function signedIn(browser, label) {
  const email = `pwa${label}x${run}@test.dev`;
  const { user, token } = await createSignedInUser(prisma, email);
  await prisma.profile.create({ data: { userId: user.id, name: `Pwa Person ${run}`, birthDate: new Date("1990-01-01T00:00:00Z"), timezone: "UTC", unitSystem: "METRIC" } });
  const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 390, height: 844 } }));
  await ctx.addCookies([{ name: "fit_session", value: token, url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
  return { ctx, page: await ctx.newPage(), email, user };
}

async function installable(name) {
  const browser = await playwright[name].launch(target.launchOptions(name));
  try {
    const { page } = await signedIn(browser, `meta${name}`);
    await page.goto(`${BASE}/dashboard`);
    const head = await page.evaluate(() => ({
      manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href"),
      apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href"),
      capable: document.querySelector('meta[name="mobile-web-app-capable"], meta[name="apple-mobile-web-app-capable"]')?.getAttribute("content"),
      appTitle: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute("content"),
      viewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content"),
      theme: document.querySelectorAll('meta[name="theme-color"]').length,
      title: document.title,
    }));
    assert.equal(head.manifest, "/manifest.webmanifest");
    assert.equal(head.apple, "/icons/apple-touch-icon.png");
    assert.equal(head.capable, "yes");
    assert.equal(head.appTitle, "FitTracker");
    assert.match(head.viewport, /width=device-width/);
    assert.match(head.viewport, /viewport-fit=cover/);
    assert.ok(head.theme >= 1);
    assert.match(head.title, /FitWorkoutFoodTracker/);
    // In-page requests, so they go through the guarded browser like everything else here.
    const get = (path) => page.evaluate(async (u) => { const r = await fetch(u, { cache: "no-store" }); return { status: r.status, type: r.headers.get("content-type"), cache: r.headers.get("cache-control"), text: await r.text() }; }, path);
    const manifest = JSON.parse((await get("/manifest.webmanifest")).text);
    assert.equal(manifest.name, "FitWorkoutFoodTracker");
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.start_url, "/dashboard");
    for (const icon of [...manifest.icons, { src: head.apple }]) {
      const r = await get(icon.src);
      assert.equal(r.status, 200, icon.src);
      assert.equal(r.type, "image/png", icon.src);
    }
    const sw = await get("/sw.js");
    assert.equal(sw.status, 200);
    assert.match(sw.cache, /no-store/, "the worker is never served from a cache");
    step(`${name}: installable: manifest, icons, standalone, viewport, home-screen title`);
  } finally { await browser.close(); }
}

async function cacheSafety(name) {
  const browser = await playwright[name].launch(target.launchOptions(name));
  try {
    const { ctx, page, email } = await signedIn(browser, `sw${name}`);
    await page.goto(`${BASE}/dashboard`);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload(); // now controlled by the worker
    assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true, "the worker controls the page");
    for (const path of ["/nutrition", "/workouts", "/progress", "/profile", "/feedback", "/dashboard"]) {
      await page.goto(`${BASE}${path}`);
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    }
    await page.evaluate(() => Promise.all(["/api/nutrition/day", "/api/foods/recent", "/api/templates", "/api/feedback", "/api/profile"].map((u) => fetch(u).then((r) => r.text()))));
    const cached = await page.evaluate(async () => {
      const out = [];
      for (const k of await caches.keys()) for (const req of await (await caches.open(k)).keys()) out.push(new URL(req.url).pathname + new URL(req.url).search);
      return out;
    });
    assert.ok(cached.some((p) => p.startsWith("/_next/static/")), `build files are cached (${cached.length})`);
    assert.deepEqual(cached.filter((p) => !ALLOWED(p) || p.includes("?")), [], "nothing but build files, icons and the offline page");
    const bodies = await page.evaluate(async () => {
      const texts = [];
      for (const k of await caches.keys()) for (const res of await (await (await caches.open(k)).matchAll())) if (/text|json|html/.test(res.headers.get("content-type") ?? "")) texts.push(await res.text());
      return texts.join("\n");
    });
    assert.equal(bodies.includes(email), false, "no address in any cached file");
    assert.equal(bodies.includes(`Pwa Person ${run}`), false, "no name in any cached file");
    step(`${name}: after signed-in pages and API calls, the cache holds only build files, icons and the offline page (${cached.length} entries)`);

    await ctx.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.getByTestId("offline-banner").waitFor({ timeout: 5000 });
    // Playwright's Firefox offline mode bypasses service workers for page loads (its own "Problem loading page"
    // appears, uncontrolled), so it can't stand in for a phone without signal; the offline page is checked in Chromium,
    // and on the real phones (manual guide, H).
    if (name === "chromium") {
      await page.goto(`${BASE}/nutrition`).catch(() => {});
      await page.getByTestId("offline-page").waitFor({ timeout: 8000 }).catch(async (e) => {
        const shown = await page.evaluate(() => ({ url: location.href, title: document.title, controlled: Boolean(navigator.serviceWorker && navigator.serviceWorker.controller), text: document.body ? document.body.innerText.slice(0, 160) : "" })).catch((err) => ({ unreadable: String(err.message).slice(0, 120) }));
        throw new Error(`${name}: no offline page; shown ${JSON.stringify(shown)}. ${e.message.split(/\r?\n/)[0]}`);
      });
      const offlineText = await page.textContent("body");
      assert.match(offlineText, /You're offline/);
      assert.equal(offlineText.includes(email) || offlineText.includes("Pwa Person"), false, "the offline page shows no one's data");
    }
    await ctx.setOffline(false);
    step(`${name}: offline: a banner on an open page${name === "chromium" ? ", and the offline page for a new one, with nothing of the person's" : ""}`);

    // Signed out, a page isn't served from the worker: the network answers, and redirects to sign-in.
    await page.goto(`${BASE}/dashboard`);
    await ctx.clearCookies();
    await page.goto(`${BASE}/nutrition`);
    assert.match(new URL(page.url()).pathname, /^\/login/, "after signing out, a page goes to sign-in, not to a stored copy");
    step(`${name}: signed out, pages come from the network, not a stored copy`);
  } finally { await browser.close(); }
}

(async () => {
  await target.verifyServer();
  for (const name of ["chromium", "firefox", "webkit"]) await installable(name);
  for (const name of ["chromium", "firefox"]) await cacheSafety(name);
  console.log("ALL PWA CHECKS PASSED");
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
