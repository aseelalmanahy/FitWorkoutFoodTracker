// No page scrolls sideways: every critical page, at phone, tablet and desktop widths, in light and dark, with content
// chosen to stress the layout (a long unbroken plan name, a finished workout, a long custom food, a typed food search).
// Fails on any page wider than its viewport, naming the widest elements, or on any browser error. Chromium.
const assert = require("node:assert/strict");
const playwright = require("playwright");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
const VIEWPORTS = [[390, 844], [820, 1180], [1440, 900], [1920, 1080]];
const LONG_PLAN = "Ultralongunbrokenplannamewithoutanyspacesatalltostresstheresponsivecards";

(async () => {
  await target.verifyServer();
  const browser = await playwright.chromium.launch(target.launchOptions("chromium"));
  const { user, token } = await createSignedInUser(prisma, `responsive${run}@test.dev`);
  await prisma.profile.create({ data: { userId: user.id, name: "Responsive Tester", birthDate: new Date("1990-01-01T00:00:00Z"), timezone: "UTC", unitSystem: "METRIC" } });
  const setup = await target.guardContext(await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "UTC" }));
  await setup.addCookies([{ name: "fit_session", value: token, url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
  const sp = await setup.newPage();
  await sp.goto(`${BASE}/dashboard`);
  const api = (method, path, body) => sp.evaluate(async ([m, p, b]) => {
    const r = await fetch(p, { method: m, headers: { "Content-Type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [method, path, body]);

  // Content that stresses the layout, through the app's own API.
  const { body: ex } = await api("GET", "/api/exercises");
  const ids = ex.exercises.filter((e) => !e.userId).slice(0, 3).map((e) => e.id);
  const tpl = (name) => ({ name, notes: null, exercises: ids.map((exerciseId) => ({ exerciseId, targetSets: 3, targetRepsMin: 8, targetRepsMax: 10, targetWeightKg: 40 })) });
  const long = await api("POST", "/api/templates", tpl(LONG_PLAN));
  assert.equal(long.status, 200, "plan created");
  await api("POST", "/api/templates", tpl("Short plan"));
  const started = await api("POST", "/api/sessions", { templateId: long.body.template.id });
  assert.equal(started.status, 200, "workout started");
  const session = (await api("GET", `/api/sessions/${started.body.session.id}`)).body.session;
  for (const se of session.exercises) assert.equal((await api("POST", `/api/sessions/${session.id}/exercises/${se.id}/sets`, { weightKg: 40, reps: 8 })).status, 200, "set logged");
  assert.equal((await api("PATCH", `/api/sessions/${session.id}`, { finish: true })).status, 200, "workout finished");
  assert.equal((await api("POST", "/api/foods", { name: "Extraordinarily long custom food name for responsive layout checks egg", brand: "A brand with a long name too", barcode: null, basisUnit: "G", servingLabel: "1 very large serving portion", servingAmount: 100, perServing: { kcal: 100, protein: 5, carbs: 10, fat: 3, fiber: null } })).status, 200, "custom food created");
  await setup.close();
  console.log("✓ content created");

  const pages = ["/dashboard", "/workouts", "/workouts/history", `/workouts/history/${session.id}`, "/progress", `/progress/${ids[0]}`, "/nutrition", "/nutrition/history", "/progress/weight", "/profile", "/nutrition/add"];
  const failures = [];
  for (const [w, h] of VIEWPORTS) {
    for (const colorScheme of ["light", "dark"]) {
      const ctx = await target.guardContext(await browser.newContext({ viewport: { width: w, height: h }, colorScheme, timezoneId: "UTC" }));
      await ctx.addCookies([{ name: "fit_session", value: token, url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      const check = async (label) => {
        const m = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          widest: [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
            .slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")}`),
        }));
        if (m.width > w) failures.push(`${w}px ${colorScheme} ${label}: ${m.width}px wide (${m.widest.join(", ")})`);
        if (errors.length) failures.push(`${w}px ${colorScheme} ${label}: ${errors.splice(0).join(" | ").slice(0, 200)}`);
      };
      for (const p of pages) {
        await page.goto(BASE + p);
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        await check(p);
      }
      // Food search after typing, with counts on the chips, and with a source chosen.
      await page.getByLabel("Search foods").fill("egg");
      await page.getByTestId("food-result").first().waitFor({ timeout: 10000 });
      await check("/nutrition/add typed");
      await page.locator('[data-testid="food-filter"][data-filter="CUSTOM"]').click();
      await check("/nutrition/add filtered");
      await ctx.close();
    }
    console.log(`✓ ${w}px, light and dark`);
  }
  await browser.close();
  await prisma.$disconnect();
  assert.deepEqual(failures, [], `pages wider than their viewport, or browser errors:\n  ${failures.join("\n  ")}`);
  console.log(`E2E RESPONSIVE PASSED: ${pages.length + 2} views × ${VIEWPORTS.length} widths × 2 themes, none wider than the screen`);
})().catch(async (e) => { console.error(e.message); await prisma.$disconnect().catch(() => {}); process.exit(1); });
