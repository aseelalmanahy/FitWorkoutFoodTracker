// Phase 4.0.1b in real browsers. Part A checks what the form sends, with those requests intercepted, so
// nothing needs a null column. Part B uses real saves, and until the NutritionTarget migration is applied
// to the test database it reports BLOCKED and exits 3, so it's never counted as a pass.
//   BASE_URL=http://localhost:3000 DATABASE_URL=<local test database> node scripts/e2e-nutrition-targets.cjs
const assert = require("node:assert/strict");
const playwright = require("playwright");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser, targetMigrationApplied } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const BROWSERS = ["chromium", "firefox", "webkit"];
let counter = 0;

const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dbDate = (iso) => new Date(`${iso}T00:00:00Z`);

async function signedIn(ctx) {
  const { user, token } = await createSignedInUser(prisma, `ntui${++counter}x${Date.now()}@test.dev`);
  await prisma.profile.create({ data: { userId: user.id, name: "Row", birthDate: dbDate("1990-01-01"), sex: "FEMALE", heightCm: 170, currentWeightKg: 60, goal: "MAINTENANCE", activityLevel: "LIGHT", experience: "BEGINNER", workoutDaysPerWeek: 2, unitSystem: "METRIC", timezone: "UTC" } });
  await ctx.addCookies([{ name: "fit_session", value: token, url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
  return user;
}
const hydrated = async (page, locator) => {
  await locator.waitFor();
  await page.waitForFunction(() => document.readyState === "complete");
  await page.waitForTimeout(300);
};
const today = () => new Date().toISOString().slice(0, 10);

async function inBrowser(name, partB) {
  const browser = await playwright[name].launch(target.launchOptions(name));
  const errors = [];
  const step = (s) => console.log(`✓ [${name}] ${s}`);
  const newPage = async () => {
    const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 390, height: 844 } }));
    const page = await ctx.newPage();
    page.on("pageerror", (e) => {
      if (name === "webkit" && /[?&]_rsc=\S* due to access control checks/.test(e.message)) return;
      errors.push(`${name}: ${e.message}`);
    });
    return { ctx, page };
  };

  // ─── Part A: what the form sends, with the saves intercepted ──────────────
  {
    const { ctx, page } = await newPage();
    await signedIn(ctx);
    const sent = [];
    await page.route("**/api/nutrition/targets", async (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      sent.push(route.request().postDataJSON());
      return route.fulfill({ json: { target: null } });
    });
    await page.goto(`${BASE}/nutrition/targets`);
    const calories = page.getByLabel("Calories (kcal/day)");
    const protein = page.getByLabel("Protein (g)");
    const fat = page.getByLabel("Fat (g)");
    const save = page.getByRole("button", { name: "Save targets" });
    const preview = page.getByTestId("carb-preview");
    await hydrated(page, calories);
    assert.equal(await page.getByRole("button", { name: "Stop using a target" }).count(), 0, "nothing to stop");

    const expectSaved = async (values, body, carbs) => {
      sent.length = 0;
      await calories.fill(values[0]); await protein.fill(values[1]); await fat.fill(values[2]);
      assert.equal(await preview.innerText(), carbs, `carb preview for ${values}`);
      await save.click();
      await page.getByText("Saved. New targets apply from today.").waitFor();
      assert.deepEqual(sent, [body], `sent for ${values}`);
    };
    await expectSaved(["2000", "", ""], { kcal: 2000, proteinG: null, fatG: null }, "Not set");
    await expectSaved(["2000", "150", ""], { kcal: 2000, proteinG: 150, fatG: null }, "Not set");
    await expectSaved(["2000", "", "60"], { kcal: 2000, proteinG: null, fatG: 60 }, "Not set");
    await expectSaved(["2000", "150", "60"], { kcal: 2000, proteinG: 150, fatG: 60 }, "215 g · 43 %");
    await expectSaved(["2000", "0", "0"], { kcal: 2000, proteinG: 0, fatG: 0 }, "500 g · 100 %");
    await expectSaved(["2000", "0", ""], { kcal: 2000, proteinG: 0, fatG: null }, "Not set");
    step("blank is sent as null, zero as zero, and carbs appear only with both macros");

    const expectRefused = async (values, text) => {
      sent.length = 0;
      await calories.fill(values[0]); await protein.fill(values[1]); await fat.fill(values[2]);
      await save.click();
      await page.getByRole("alert").getByText(text).waitFor();
      assert.deepEqual(sent, [], `nothing sent for ${values}`);
    };
    await expectRefused(["", "", ""], "Only calories are required");
    await expectRefused(["2000", "abc", ""], "Only calories are required");
    await expectRefused(["700", "", ""], "not a recommendation");
    await expectRefused(["800", "300", ""], "more energy");
    step("calories are still required, and bad values send nothing");
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage();
    const user = await signedIn(ctx);
    await prisma.nutritionTarget.create({ data: { userId: user.id, effectiveFrom: dbDate(addDays(today(), -3)), kcal: 2000, proteinG: 150, carbsG: 215, fatG: 60, source: "MANUAL" } });
    let stops = 0;
    await page.route("**/api/nutrition/targets/stop", (route) => { stops++; return route.fulfill({ json: { stopped: true } }); });
    await page.goto(`${BASE}/nutrition/targets`);
    const open = page.getByRole("button", { name: "Stop using a target" });
    await hydrated(page, open);
    await open.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Your food log and past targets stay.").or(page.getByText("Stopped. Days from today")).waitFor();
    assert.equal(stops, 0, "opening asks first");
    await dialog.getByRole("button", { name: "Keep my target" }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(stops, 0, "keeping sends nothing");
    await open.click();
    await dialog.getByRole("button", { name: "Stop using a target" }).click();
    await page.getByText("Stopped. Days from today").waitFor();
    assert.equal(stops, 1, "confirming sends one request");
    step("stopping asks first, and only the confirmation sends it");
    await ctx.close();
  }

  // ─── Part B: real saves, which need the migration ─────────────────────────
  if (partB) {
    const { ctx, page } = await newPage();
    const user = await signedIn(ctx);
    const past = addDays(today(), -4);
    await prisma.nutritionTarget.create({ data: { userId: user.id, effectiveFrom: dbDate(past), kcal: 2500, proteinG: 150, carbsG: 288, fatG: 69, source: "MANUAL" } });
    await page.goto(`${BASE}/nutrition/targets`);
    const calories = page.getByLabel("Calories (kcal/day)");
    await hydrated(page, calories);
    await calories.fill("1900");
    await page.getByLabel("Protein (g)").fill("");
    await page.getByLabel("Fat (g)").fill("");
    await page.getByRole("button", { name: "Save targets" }).click();
    await page.getByText("Earlier days keep their previous targets.").waitFor();
    await page.getByText("P Not set · C Not set · F Not set").first().waitFor();
    await page.reload();
    await hydrated(page, calories);
    assert.equal(await page.getByLabel("Protein (g)").inputValue(), "", "not set comes back blank, and not as 0");
    await page.goto(`${BASE}/nutrition`);
    await page.getByText("Not set").first().waitFor();
    assert.equal(await page.getByText("Not set").count(), 3, "each macro reads Not set");
    assert.equal(await page.getByRole("progressbar").count(), 0, "no macro bar without a macro target");
    await page.getByText("kcal left").waitFor();
    step("a calories-only target saves, and its macros read Not set");

    await page.goto(`${BASE}/nutrition/targets`);
    await hydrated(page, calories);
    await page.getByRole("button", { name: "Stop using a target" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Stop using a target" }).click();
    await page.getByText("Stopped. Days from today").waitFor();
    await page.getByText("No target in use.").waitFor();
    await page.getByText("Stopped", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Stop using a target" }).count(), 0, "nothing left to stop");
    await page.goto(`${BASE}/nutrition`);
    await page.getByRole("link", { name: "Add a target" }).waitFor();
    await page.goto(`${BASE}/nutrition?date=${addDays(past, 1)}`);
    await page.getByText("2,500 kcal").waitFor();
    assert.equal(await prisma.nutritionTarget.count({ where: { userId: user.id, effectiveFrom: dbDate(past), kcal: 2500 } }), 1, "the earlier row stays");
    await page.goto(`${BASE}/nutrition/history`);
    await page.getByRole("heading", { name: "Nutrition history" }).or(page.getByText("Days", { exact: true })).first().waitFor();
    step("stopping works, shows in history, and past days keep their target");
    await ctx.close();
  }

  assert.deepEqual(errors, [], "no page errors");
  await browser.close();
}

(async () => {
  await target.verifyServer();
  const migrated = await targetMigrationApplied(prisma);
  for (const name of BROWSERS) await inBrowser(name, migrated);
  await prisma.$disconnect();
  if (!migrated) {
    console.log("PART A PASSED. BLOCKED: part B needs the NutritionTarget migration on this test database, which needs the owner's approval.");
    process.exit(3);
  }
  console.log("ALL NUTRITION TARGET CHECKS PASSED");
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
