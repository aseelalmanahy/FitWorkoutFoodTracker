// Phase 4.0.6 in real browsers, one at a time: a set whose response is lost, and days whose foods report nothing.
const assert = require("node:assert/strict");
const playwright = require("playwright");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
const created = [];
const today = new Date().toISOString().slice(0, 10);

async function signedIn(browser, label) {
  const { user, token } = await createSignedInUser(prisma, `ready${label}x${run}@test.dev`);
  created.push(user.id);
  await prisma.profile.create({ data: { userId: user.id, name: "Ready", birthDate: new Date("1990-01-01T00:00:00Z"), timezone: "UTC", unitSystem: "METRIC" } });
  const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "UTC" }));
  await ctx.addCookies([{ name: "fit_session", value: token, url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
  return { user, ctx, page: await ctx.newPage() };
}
const settled = (page) => page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

async function inBrowser(name) {
  const step = (s) => console.log(`✓ [${name}] ${s}`);
  const browser = await playwright[name].launch(target.launchOptions(name));

  // ─── A lost response ───────────────────────────────────────────────────────
  {
    const { user, ctx, page } = await signedIn(browser, `set${name}`);
    const exercise = await prisma.exercise.create({ data: { userId: user.id, name: `Row ${run}`, primaryMuscle: "BACK", equipment: "CABLE" } });
    const session = await prisma.workoutSession.create({ data: { userId: user.id, name: "Session", exercises: { create: { exerciseId: exercise.id, position: 0 } } }, include: { exercises: true } });
    const seId = session.exercises[0].id;
    const rows = () => prisma.setEntry.findMany({ where: { sessionExerciseId: seId } });
    await page.goto(`${BASE}/workouts/session/${session.id}`);
    await settled(page);

    const keys = [];
    let lose = true;
    await page.route(`**/exercises/${seId}/sets`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      keys.push(route.request().headers()["idempotency-key"]);
      if (!lose) return route.continue();
      lose = false;
      await route.fetch(); // The server saves it, and the response never arrives.
      await route.abort("connectionreset");
    });
    await page.getByLabel("Weight", { exact: true }).fill("60");
    await page.getByLabel("Reps", { exact: true }).fill("8");
    await page.getByRole("button", { name: "Log set" }).click();
    await page.getByText("We can't tell whether this was saved").waitFor({ timeout: 8000 });
    assert.equal((await rows()).length, 1, "the server did save it");
    assert.equal(await page.getByLabel("Reps", { exact: true }).inputValue(), "8", "what was typed is still there");
    step("a lost response says so, and keeps what was typed");

    await page.getByRole("button", { name: "Log set" }).click();
    await page.getByText("We can't tell whether this was saved").waitFor({ state: "detached", timeout: 8000 });
    await page.getByRole("button", { name: "Log set" }).waitFor();
    for (let i = 0; i < 40 && keys.length < 2; i++) await page.waitForTimeout(100);
    assert.equal(keys.length, 2);
    assert.ok(keys[0], "a key was sent");
    assert.equal(keys[1], keys[0], "the retry uses the same key");
    assert.equal((await rows()).length, 1, "trying again didn't log it twice");
    step("trying again doesn't log the set twice");

    for (let i = 0; i < 40 && (await page.getByLabel("Reps", { exact: true }).inputValue()) !== ""; i++) await page.waitForTimeout(100);
    await page.getByLabel("Reps", { exact: true }).fill("6");
    await page.getByRole("button", { name: "Log set" }).click();
    for (let i = 0; i < 40 && (await rows()).length < 2; i++) await page.waitForTimeout(100);
    assert.deepEqual((await rows()).map((r) => r.reps).sort(), [6, 8]);
    assert.notEqual(keys[2], keys[0], "the next set is a new one");
    step("the next set logs as a new one");
    await ctx.close();
  }

  // ─── Foods that report nothing ─────────────────────────────────────────────
  {
    const { user, ctx, page } = await signedIn(browser, `null${name}`);
    await prisma.nutritionTarget.create({ data: { userId: user.id, effectiveFrom: new Date(`${today}T00:00:00Z`), source: "MANUAL", kcal: 2000, proteinG: 150, carbsG: 215, fatG: 60 } });
    const food = await prisma.food.create({ data: { source: "CUSTOM", sourceId: `null-${user.id}`, userId: user.id, name: "Reports nothing" } });
    await page.goto(`${BASE}/nutrition`);
    const added = await page.evaluate(async (foodId) => (await fetch("/api/nutrition/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: new Date().toISOString().slice(0, 10), mealType: "LUNCH", foodId, servingId: null, quantity: 100 }) })).status, food.id);
    assert.equal(added, 200);
    await page.reload();
    await settled(page);
    assert.equal(await page.getByText(/^0 kcal/).count(), 0, "unknown calories aren't shown as 0");
    assert.equal(await page.getByText("— kcal *").count(), 1, "they're shown as a dash, marked as incomplete");
    assert.equal(await page.getByText(/^0 \/ 150 g/).count(), 0, "unknown protein isn't shown as 0");
    assert.equal(await page.getByText(/^— \/ 150 g/).count(), 1, "it's shown as a dash");
    assert.equal(await page.getByRole("progressbar", { name: "Protein" }).count(), 0, "with no bar to fill");
    assert.equal(await page.getByText("A dash means none of them do.").count(), 1);
    step("a day whose foods report nothing shows a dash, and no 0");

    await page.goto(`${BASE}/nutrition/history`);
    await settled(page);
    assert.equal(await page.getByText("P — · C — · F — g").count(), 1, "the day's macros are dashes");
    assert.equal(await page.getByText("Protein below target").count(), 0, "unknown isn't below target");
    assert.equal(await page.getByText("Protein on target").count(), 0, "or on it");
    step("history doesn't count it as below target");
    await ctx.close();
  }
  await browser.close();
}

async function cleanUp() {
  await prisma.foodEntry.deleteMany({ where: { userId: { in: created } } });
  await prisma.food.deleteMany({ where: { userId: { in: created } } });
  await prisma.nutritionTarget.deleteMany({ where: { userId: { in: created } } });
  await prisma.workoutSession.deleteMany({ where: { userId: { in: created } } });
  await prisma.exercise.deleteMany({ where: { userId: { in: created } } });
  await prisma.session.deleteMany({ where: { userId: { in: created } } });
  await prisma.profile.deleteMany({ where: { userId: { in: created } } });
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
}

(async () => {
  await target.verifyServer();
  for (const name of ["chromium", "firefox", "webkit"]) await inBrowser(name);
  await cleanUp();
  console.log("ALL READINESS CHECKS PASSED");
})().catch(async (e) => { console.error(e); await cleanUp().catch(() => {}); process.exit(1); });
