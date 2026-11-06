// Phase 4.0.1c in real browsers. Part A checks what the form asks for and sends, with its saves intercepted,
// so nothing needs a nullable column. Part B uses real saves, and until the Profile
// migration is applied to the test database it reports BLOCKED and exits 3, so it's never counted as a pass.
//   BASE_URL=http://localhost:3000 DATABASE_URL=<local test database> node scripts/e2e-profile-minimization.cjs
const assert = require("node:assert/strict");
const playwright = require("playwright");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser, profileMigrationApplied } = require("./lib/test-users.cjs");
const { fillProfile } = require("./lib/e2e-onboarding.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const BROWSERS = ["chromium", "firefox", "webkit"];
let counter = 0;

const dbDate = (iso) => new Date(`${iso}T00:00:00Z`);
const yearsAgo = (n) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - n); return d.toISOString().slice(0, 10); };
const LEGACY = { name: "Row", birthDate: dbDate("1990-01-01"), sex: "FEMALE", heightCm: 170.33, currentWeightKg: 60.125, goalWeightKg: 55.5, goal: "MAINTENANCE", activityLevel: "LIGHT", experience: "BEGINNER", workoutDaysPerWeek: 0, unitSystem: "METRIC", timezone: "UTC" };
const REQUIRED_KEYS = ["birthDate", "name", "timezone", "unitSystem"];
const UNREAD_LABELS = ["Sex", "Height (cm)", "Height (ft)", "Height (in)", /^Current weight/, /^Goal weight/, "Goal", "Activity level", "Training experience", "Workout days / week"];
const CLEARS = ["sex", "height", "current weight", "activity level", "training experience", "workout days / week"];

async function signedIn(ctx, row) {
  const { user, token } = await createSignedInUser(prisma, `pmui${++counter}x${Date.now()}@test.dev`);
  if (row) await prisma.profile.create({ data: { userId: user.id, ...row } });
  await ctx.addCookies([{ name: "fit_session", value: token, url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
  return user;
}
const hydrated = async (page, locator) => {
  await locator.waitFor();
  await page.waitForFunction(() => document.readyState === "complete");
  await page.waitForTimeout(300);
};
/** Records each profile save, and answers it without touching the database. */
async function intercept(page) {
  const sent = [];
  await page.route("**/api/profile", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { profile: null } });
  });
  return sent;
}
const keysOf = (body) => Object.keys(body).sort();
const without = (body, keys = REQUIRED_KEYS) => Object.fromEntries(Object.entries(body).filter(([k]) => !keys.includes(k)));
const withoutTime = ({ updatedAt, ...rest }) => rest;

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
  const assertNotAsked = async (page, where) => {
    for (const label of UNREAD_LABELS) assert.equal(await page.getByLabel(label, { exact: true }).count(), 0, `${where}: ${label} isn't asked for`);
    assert.equal(await page.getByRole("radiogroup", { name: "Sex" }).count(), 0, `${where}: Sex isn't asked for`);
    assert.equal(await page.locator("button[aria-pressed]").count(), 0, `${where}: goal isn't asked for`);
  };

  // ─── Part A: onboarding asks for four things and sends four things ─────────
  {
    const { ctx, page } = await newPage();
    await signedIn(ctx);
    const sent = await intercept(page);
    await page.goto(`${BASE}/onboarding`);
    const units = page.getByRole("radio", { name: "kg / cm" });
    await hydrated(page, units);
    await assertNotAsked(page, "onboarding");
    assert.equal(await page.locator('[role=radio][aria-checked="true"]').count(), 0, "nothing is preselected");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("Please choose your units.").waitFor();
    await page.getByText("Please enter your name.").waitFor();
    await page.getByText("Please enter your date of birth.").waitFor();
    assert.deepEqual(sent, [], "T45: nothing sent while a required field is missing");
    await fillProfile(page, { birthDate: "1990-01-01" });
    await assertNotAsked(page, "onboarding, after choosing units");
    await page.getByRole("button", { name: "Continue" }).click();
    const putting = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/profile"));
    await page.getByRole("button", { name: "Yes, that's right" }).click();
    await putting; // the intercepted save creates no row, so the dashboard isn't reached here
    assert.equal(sent.length, 1, "T45: one save");
    assert.deepEqual(keysOf(sent[0]), REQUIRED_KEYS, "T45: only the four required fields are sent");
    assert.equal(sent[0].name, "Sam");
    assert.equal(sent[0].birthDate, "1990-01-01");
    assert.equal(sent[0].unitSystem, "METRIC");
    assert.ok(sent[0].timezone, "the browser supplies the time zone");
    step("T45: onboarding asks for and sends only the four required fields");
    await ctx.close();
  }

  // ─── Part A: a legacy profile shows stored details, each with a clear ──────
  {
    const { ctx, page } = await newPage();
    const user = await signedIn(ctx, LEGACY);
    const sent = await intercept(page);
    await page.goto(`${BASE}/profile`);
    const save = page.getByRole("button", { name: "Save changes" });
    await hydrated(page, save);
    for (const c of CLEARS) await page.getByRole("button", { name: `Clear ${c}`, exact: true }).waitFor();
    assert.equal(await page.getByLabel("Height (cm)").inputValue(), "170.3", "the stored height shows");
    assert.equal(await page.getByLabel("Workout days / week").inputValue(), "0", "a stored zero shows as 0");
    assert.equal(await page.getByLabel(/^Goal weight/).inputValue(), "55.5");

    const saveAnd = async () => {
      sent.length = 0;
      await save.click();
      await page.getByText("Saved.").waitFor();
      assert.equal(sent.length, 1);
      return sent[0];
    };

    assert.deepEqual(keysOf(await saveAnd()), REQUIRED_KEYS, "saving unchanged rewrites nothing, not even rounded values");
    await page.getByRole("radio", { name: "lb / ft" }).click();
    await page.getByLabel("Height (ft)").waitFor();
    const switched = await saveAnd();
    assert.deepEqual(keysOf(switched), REQUIRED_KEYS, "changing units alone doesn't rewrite a stored number");
    assert.equal(switched.unitSystem, "IMPERIAL");
    await page.getByRole("radio", { name: "kg / cm" }).click();
    await page.getByLabel("Height (cm)").waitFor();
    step("saving without an edit sends no stored detail, even after switching units");

    await page.getByRole("button", { name: "Clear sex", exact: true }).click();
    await page.getByText("Sex will be removed when you save.").waitFor();
    assert.equal(await page.getByRole("radiogroup", { name: "Sex" }).count(), 0, "the field goes while it's being cleared");
    await page.getByRole("button", { name: "Keep sex", exact: true }).click();
    assert.deepEqual(without(await saveAnd()), {}, "an undone clear sends nothing");
    step("a clear can be undone before saving");

    for (const c of ["Clear sex", "Clear height", "Clear workout days / week"]) await page.getByRole("button", { name: c, exact: true }).click();
    assert.deepEqual(without(await saveAnd()), { sex: null, heightCm: null, workoutDaysPerWeek: null }, "a clear is an explicit null, for that field only");
    for (const c of ["Keep sex", "Keep height", "Keep workout days / week"]) await page.getByRole("button", { name: c, exact: true }).click();
    step("clearing sends explicit null, for those fields only");

    await page.getByLabel("Height (cm)").fill("181");
    await page.getByLabel("Training experience").selectOption("ADVANCED");
    assert.deepEqual(without(await saveAnd()), { heightCm: 181, experience: "ADVANCED" }, "an edit sends only what changed");
    step("an edit sends only what changed");

    sent.length = 0;
    await page.getByLabel("Height (cm)").fill("");
    await save.click();
    await page.waitForTimeout(500);
    assert.deepEqual(sent, [], "a blanked number is an error, not a silent clear");
    await page.getByText("Please enter a valid height.").waitFor();
    await page.getByRole("button", { name: "Clear height", exact: true }).click();
    assert.deepEqual(without(await saveAnd()).heightCm, null, "the error goes once it's being cleared");
    await page.getByRole("button", { name: "Keep height", exact: true }).click();
    await page.getByLabel("Height (cm)").fill("181");
    step("a blanked number is refused, and only the clear action clears");

    await page.getByLabel(/^Goal weight/).fill("");
    assert.equal(without(await saveAnd(), [...REQUIRED_KEYS, "heightCm", "experience"]).goalWeightKg, null, "a blank goal weight clears it");
    step("the goal weight stays optional");

    const now = await prisma.profile.findUnique({ where: { userId: user.id } });
    assert.equal(now.heightCm, 170.33, "every save above was intercepted, so the row is untouched");
    assert.equal(now.sex, "FEMALE");
    await ctx.close();
  }

  // ─── Part A: imperial display never rewrites the metric value ──────────────
  {
    const { ctx, page } = await newPage();
    await signedIn(ctx, { ...LEGACY, unitSystem: "IMPERIAL" });
    const sent = await intercept(page);
    await page.goto(`${BASE}/profile`);
    const save = page.getByRole("button", { name: "Save changes" });
    await hydrated(page, save);
    await page.getByLabel("Height (ft)").waitFor();
    await save.click();
    await page.getByText("Saved.").waitFor();
    assert.deepEqual(keysOf(sent[0]), REQUIRED_KEYS, "imperial display isn't converted back and saved");
    step("an imperial profile saves without converting stored numbers");
    await ctx.close();
  }

  // ─── Part A: correcting a restricted date sends no stored detail ──────────
  {
    const { ctx, page } = await newPage();
    await signedIn(ctx, { ...LEGACY, birthDate: dbDate(yearsAgo(17)) });
    const sent = await intercept(page);
    await page.goto(`${BASE}/account-restricted`);
    const date = page.getByLabel("Date of birth");
    await hydrated(page, date);
    await date.fill("1990-01-01");
    await page.getByRole("button", { name: "Save changes" }).click();
    const putting = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/profile"));
    await page.getByRole("button", { name: "Yes, that's right" }).click();
    await putting;
    assert.deepEqual(keysOf(sent[0]), REQUIRED_KEYS, "a correction sends only the required fields");
    assert.equal(sent[0].birthDate, "1990-01-01");
    step("correcting a restricted date sends only the required fields");
    await ctx.close();
  }

  // ─── Part B: real saves, which need the migration ─────────────────────────
  if (partB) {
    const { ctx, page } = await newPage();
    const user = await signedIn(ctx);
    await page.goto(`${BASE}/onboarding`);
    await hydrated(page, page.getByRole("radio", { name: "kg / cm" }));
    await fillProfile(page, { birthDate: "1990-01-01" });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Yes, that's right" }).click();
    await page.waitForURL("**/dashboard");
    const row = await prisma.profile.findUnique({ where: { userId: user.id } });
    for (const f of ["sex", "heightCm", "currentWeightKg", "goalWeightKg", "goal", "activityLevel", "experience", "workoutDaysPerWeek"]) assert.equal(row[f], null, `T45: ${f} stored as null`);
    step("T45: onboarding completes with four fields, and stores nulls");

    await page.goto(`${BASE}/profile`);
    const save = page.getByRole("button", { name: "Save changes" });
    await hydrated(page, save);
    assert.equal(await page.getByRole("heading", { name: "Other details on your profile" }).count(), 0, "nothing asks for unset details");
    assert.equal(await page.getByRole("button", { name: /^Clear / }).count(), 0, "nothing to clear");
    await page.getByLabel("Name").fill("Sam Two");
    await save.click();
    await page.getByText("Saved.").waitFor();
    const saved = await prisma.profile.findUnique({ where: { userId: user.id } });
    assert.equal(saved.name, "Sam Two");
    for (const f of ["sex", "heightCm", "currentWeightKg", "goalWeightKg", "goal", "activityLevel", "experience", "workoutDaysPerWeek"]) assert.equal(saved[f], null, `T45: a null row re-saved stays null: ${f}`);
    step("T45: a null profile shows no prompts, and re-saving keeps it null");
    await ctx.close();

    const legacy = await newPage();
    const legacyUser = await signedIn(legacy.ctx, LEGACY);
    await legacy.page.goto(`${BASE}/profile`);
    const legacySave = legacy.page.getByRole("button", { name: "Save changes" });
    await hydrated(legacy.page, legacySave);
    for (const c of CLEARS) await legacy.page.getByRole("button", { name: `Clear ${c}`, exact: true }).click();
    await legacySave.click();
    await legacy.page.getByText("Saved.").waitFor();
    await legacy.page.reload();
    await hydrated(legacy.page, legacySave);
    assert.equal(await legacy.page.getByRole("heading", { name: "Other details on your profile" }).count(), 0, "they stay cleared");
    const cleared = await prisma.profile.findUnique({ where: { userId: legacyUser.id } });
    for (const f of ["sex", "heightCm", "currentWeightKg", "goal", "activityLevel", "experience", "workoutDaysPerWeek"]) assert.equal(cleared[f], null, `T45: ${f} cleared`);
    assert.equal(cleared.goalWeightKg, 55.5, "the goal weight has its own control");
    assert.equal(cleared.name, "Row", "the profile stays");
    step("T45: stored details clear for real, and stay cleared");
    await legacy.ctx.close();

    const restricted = await newPage();
    const restrictedUser = await signedIn(restricted.ctx, { ...LEGACY, birthDate: dbDate(yearsAgo(17)) });
    const before = withoutTime(await prisma.profile.findUnique({ where: { userId: restrictedUser.id } }));
    await restricted.page.goto(`${BASE}/account-restricted`);
    const date = restricted.page.getByLabel("Date of birth");
    await hydrated(restricted.page, date);
    await date.fill("1990-01-01");
    await restricted.page.getByRole("button", { name: "Save changes" }).click();
    await restricted.page.getByRole("button", { name: "Yes, that's right" }).click();
    await restricted.page.waitForURL("**/dashboard");
    const browserZone = await restricted.page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.deepEqual(withoutTime(await prisma.profile.findUnique({ where: { userId: restrictedUser.id } })), { ...before, birthDate: dbDate("1990-01-01"), timezone: browserZone }, "only the date and the browser's time zone change");
    step("a restricted account corrects its date for real, and keeps its details");
    await restricted.ctx.close();
  }

  assert.deepEqual(errors, [], "no page errors");
  await browser.close();
}

(async () => {
  await target.verifyServer();
  const migrated = await profileMigrationApplied(prisma);
  for (const name of BROWSERS) await inBrowser(name, migrated);
  await prisma.$disconnect();
  if (!migrated) {
    console.log("PART A PASSED. BLOCKED: part B needs the Profile migration on this test database, which needs the owner's approval.");
    process.exit(3);
  }
  console.log("ALL PROFILE MINIMIZATION CHECKS PASSED");
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
