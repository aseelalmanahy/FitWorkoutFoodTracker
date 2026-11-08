// Every page, in Chromium, Firefox and WebKit, on the production build with its real Content-Security-Policy: none may
// report a CSP violation. A violation is caught two ways, the page's securitypolicyviolation event and the browser's
// console, and a positive control on each engine proves the detector sees one. The policy itself isn't changed or relaxed.
//   BASE_URL=… DATABASE_URL=<designated test database> CSP_ADMIN_ID=<an id in ADMIN_USER_IDS> node scripts/e2e-csp.cjs
const assert = require("node:assert/strict");
const playwright = require("playwright");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
const step = (s) => console.log(`✓ ${s}`);
const ADMIN_ID = process.env.CSP_ADMIN_ID;

const SIGNED_OUT = ["/login", "/register", "/forgot-password", "/privacy", "/terms"];
const SIGNED_IN = [
  "/dashboard", "/account", "/profile", "/feedback", "/admin/feedback",
  "/nutrition", "/nutrition/add", "/nutrition/history", "/nutrition/meal", "/nutrition/scan", "/nutrition/targets",
  "/progress", "/progress/weight", "/workouts", "/workouts/gyms", "/workouts/history", "/workouts/import", "/workouts/plans/new", "/workouts/schedule",
];

async function account() {
  const email = `csp${run}@test.dev`;
  const { user, token } = ADMIN_ID
    ? { user: await prisma.user.create({ data: { id: ADMIN_ID, email, passwordHash: "unusable" } }), token: await require("./lib/test-users.cjs").addSession(prisma, ADMIN_ID) }
    : await createSignedInUser(prisma, email);
  await prisma.profile.create({ data: { userId: user.id, name: "Policy", birthDate: new Date("1990-01-01T00:00:00Z"), timezone: "UTC", unitSystem: "METRIC" } });
  const bench = await prisma.exercise.findFirst({ where: { userId: null, name: "Barbell Bench Press" } });
  const plan = await prisma.workoutTemplate.create({ data: { userId: user.id, name: "Plan", exercises: { create: { exerciseId: bench.id, position: 0, targetSets: 3, targetRepsMin: 5, targetRepsMax: 8 } } }, include: { exercises: true } });
  const done = await prisma.workoutSession.create({ data: { userId: user.id, name: "Done", status: "COMPLETED", endedAt: new Date(), exercises: { create: { exerciseId: bench.id, position: 0, sets: { create: { setNumber: 1, reps: 5, weightKg: 60 } } } } } });
  const open = await prisma.workoutSession.create({ data: { userId: user.id, name: "Open", templateId: plan.id, exercises: { create: { exerciseId: bench.id, position: 0, templateExerciseId: plan.exercises[0].id } } } });
  await prisma.gymLocation.create({ data: { userId: user.id, name: "Gym" } });
  return { token, extra: [`/workouts/plans/${plan.id}`, `/workouts/history/${done.id}`, `/workouts/session/${open.id}`, `/progress/${bench.id}`] };
}

async function watched(browser, token) {
  const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 1200, height: 900 } }));
  if (token) await ctx.addCookies([{ name: "fit_session", value: token, url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`));
  });
  const page = await ctx.newPage();
  const consoleCsp = [];
  page.on("console", (m) => { if (/Content[- ]Security[- ]Policy|unsafe-eval|violates the following/i.test(m.text())) consoleCsp.push(m.text().slice(0, 300)); });
  return { ctx, page, consoleCsp };
}

async function visitAll(page, consoleCsp, paths, engine) {
  const found = [];
  for (const p of paths) {
    consoleCsp.length = 0;
    const res = await page.goto(BASE + p, { waitUntil: "load" });
    assert.ok(res && res.status() < 500, `${engine} ${p}: ${res?.status()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(300); // a probe may run just after load
    const events = await page.evaluate(() => window.__csp ?? []);
    for (const v of [...events, ...consoleCsp]) found.push(`${p}: ${v}`);
  }
  return found;
}

(async () => {
  await target.verifyServer();
  const { token, extra } = await account();
  for (const engine of ["chromium", "firefox", "webkit"]) {
    const browser = await playwright[engine].launch(target.launchOptions(engine));
    try {
      // Positive control: an inline script with no nonce is refused by the policy, and the detector reports it.
      const control = await watched(browser, null);
      await control.page.goto(`${BASE}/login`);
      await control.page.addScriptTag({ content: "window.__ran = true" }).catch(() => {});
      await control.page.waitForTimeout(300);
      const seen = [...(await control.page.evaluate(() => window.__csp)), ...control.consoleCsp];
      assert.ok(seen.length > 0, `${engine}: the detector saw the blocked inline script`);
      assert.equal(await control.page.evaluate(() => window.__ran), undefined, `${engine}: and it didn't run`);
      await control.ctx.close();

      const out = await watched(browser, null);
      const signedOut = await visitAll(out.page, out.consoleCsp, SIGNED_OUT, engine);
      await out.ctx.close();
      const inn = await watched(browser, token);
      const signedIn = await visitAll(inn.page, inn.consoleCsp, [...SIGNED_IN, ...extra], engine);
      await inn.ctx.close();
      assert.deepEqual([...signedOut, ...signedIn], [], `${engine}: no page reports a CSP violation`);
      step(`${engine}: ${SIGNED_OUT.length + SIGNED_IN.length + extra.length} pages, signed out and in, report no CSP violation; the control's blocked inline script was seen`);
    } finally { await browser.close(); }
  }
  console.log("ALL CSP CHECKS PASSED");
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
