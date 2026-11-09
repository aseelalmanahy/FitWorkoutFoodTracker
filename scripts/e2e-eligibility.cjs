// Phase 4.0.1 Stage A in real browsers: sign-up text, explicit choices, date confirmation, refusal,
// correction, restricted accounts, no-target screens, legacy labels and neutral over-target display.
//   BASE_URL=http://localhost:3000 DATABASE_URL=<local test database> node scripts/e2e-eligibility.cjs
const assert = require("node:assert/strict");
const playwright = require("playwright");
const { PrismaClient } = require("@prisma/client");
const { completeOnboarding, fillProfile } = require("./lib/e2e-onboarding.cjs");
const { createSignedInUser } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const SHOTS = (process.env.SHOTS_DIR || require("node:os").tmpdir()) + "/";
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const BROWSERS = ["chromium", "firefox", "webkit"];

const yearsAgo = (years) => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear() - years, n.getUTCMonth(), n.getUTCDate())).toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);
const dbDate = (iso) => new Date(`${iso}T00:00:00Z`);
let counter = 0;

/** Created directly, as three browsers would pass sign-up's limit, and the real flow is covered by every other E2E script and by account-tokens. The cookie is non-Secure, as WebKit refuses Secure cookies over http://localhost. */
async function signUp(ctx, label) {
  const { user, token } = await createSignedInUser(prisma, `elig${label}${++counter}x${Date.now()}@test.dev`);
  await ctx.addCookies([{ name: "fit_session", value: token, url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
  return user;
}
const hydrated = async (page, locator) => {
  await locator.waitFor();
  await page.waitForFunction(() => document.readyState === "complete");
  await page.waitForTimeout(300);
};
const focusedText = (page) => page.evaluate(() => document.activeElement?.textContent ?? "");
const focusedId = async (page, id) => {
    await page.waitForFunction((want) => document.activeElement?.id === want, id, { timeout: 5000 }).catch(() => {});
    return page.evaluate(() => document.activeElement?.id ?? "");
  };

async function inBrowser(name) {
  const browser = await playwright[name].launch(target.launchOptions(name));
  const newPage = async () => {
    const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 390, height: 844 } }));
    const page = await ctx.newPage();
    page.on("pageerror", (e) => {
      if (name === "webkit" && /[?&]_rsc=\S* due to access control checks/.test(e.message)) return;
      errors.push(`${name}: ${e.message}`);
    });
    const puts = [];
    page.on("request", (r) => { if (r.method() === "PUT") puts.push(new URL(r.url()).pathname); });
    return { ctx, page, puts };
  };
  const errors = [];
  const step = (s) => console.log(`✓ [${name}] ${s}`);

  // ─── Sign-up text ─────────────────────────────────────────────────────────
  {
    const { page } = await newPage();
    await page.goto(`${BASE}/register`);
    await page.getByText("For adults 18 and over.").waitFor();
    assert.equal(await page.locator("input[name=email]").count(), 1, "sign-up asks for an email");
    assert.equal(await page.locator("input[name=password]").count(), 0, "and no password, as that is set from the emailed link");
    await page.goto(`${BASE}/login`);
    assert.equal(await page.getByText("For adults 18 and over.").count(), 0);
    step("sign-up states the requirement");
  }

  // ─── Onboarding: T20, T21, T23, T35, T22, correction ──────────────────────
  {
    const { ctx, page, puts } = await newPage();
    const user = await signUp(ctx, "new");
    await page.goto(`${BASE}/onboarding`);
    const units = page.getByRole("radio", { name: "kg / cm" });
    await hydrated(page, units);
    assert.equal(await page.locator('[role=radio][aria-checked="true"]').count(), 0, "nothing is preselected");
    assert.doesNotMatch(await page.locator("main").innerText(), /BMR|TDEE|Suggested|estimate/i, "no estimate");

    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("Please choose your units.").waitFor();
    await page.getByText("Please enter your date of birth.").waitFor();
    assert.equal(await focusedId(page, "profile-units"), "profile-units", "T20: focus on the first invalid field");
    assert.deepEqual(puts, [], "T20: nothing sent");
    step("nothing preselected, units first, errors focus the first invalid field");

    const refusedDate = yearsAgo(17);
    await fillProfile(page, { birthDate: refusedDate });
    await page.getByRole("button", { name: "Continue" }).click();
    const status = page.getByRole("status");
    await status.or(page.getByRole("heading", { name: /can't set up an account/ })).waitFor();
    assert.deepEqual(puts, [], "T35: nothing sent before confirming");
    assert.match(await status.innerText(), /You entered \d{1,2} [A-Z][a-z]+ \d{4}\. Is this right\?/, "T35: date in words");
    await page.getByRole("button", { name: "Change date" }).click();
    await page.waitForFunction(() => document.activeElement?.id === "profile-birthDate");
    assert.deepEqual(puts, [], "T35: declining sends nothing");
    step("the date is read back in words, and declining sends nothing");

    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Yes, that's right" }).click();
    const heading = page.getByRole("heading", { name: "We can't set up an account with that date of birth." });
    await heading.waitFor();
    await page.waitForFunction(() => document.activeElement?.tagName === "H2");
    assert.match(await focusedText(page), /can't set up an account/, "T22: focus on the heading");
    assert.equal(page.url().includes(refusedDate), false, "T22: date not in the URL");
    const body = await page.locator("main").innerText();
    assert.doesNotMatch(body.replace(/\d{1,2} [A-Z][a-z]+ \d{4}/, ""), /\b(18|13)\b/, "T6: no threshold");
    assert.equal(await page.getByRole("button", { name: "Log out" }).first().isVisible(), true, "T22: Log out present");
    assert.equal(await page.getByRole("button", { name: "Log out" }).count(), 1, "WT-08: one Log out, not two");
    assert.equal(await prisma.profile.count({ where: { userId: user.id } }), 0, "nothing saved");
    step("refusal: neutral, focused, nothing saved");

    await page.goto(`${BASE}/dashboard`);
    await page.waitForURL("**/onboarding");
    step("a refused session can't reach the app");

    await fillProfile(page, { birthDate: refusedDate });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Yes, that's right" }).click();
    await heading.waitFor();
    await page.getByRole("button", { name: "Check the date" }).click();
    await page.waitForFunction(() => document.activeElement?.id === "profile-birthDate");
    assert.equal(await page.getByLabel("Name").inputValue(), "Sam", "the rest of the form is kept");
    await page.getByLabel("Date of birth").fill("1990-01-01");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Yes, that's right" }).click();
    await page.waitForURL("**/dashboard");
    step("an adult who mistyped can correct the date");

    // ─── Profile edit: T5's interface ───────────────────────────────────────
    await page.goto(`${BASE}/profile`);
    const date = page.getByLabel("Date of birth");
    await hydrated(page, date);
    await date.fill(yearsAgo(17));
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByRole("button", { name: "Yes, that's right" }).click();
    await page.getByText("This date of birth can't be used.").waitFor();
    assert.equal(await focusedId(page, "profile-birthDate"), "profile-birthDate");
    assert.equal(await date.getAttribute("aria-invalid"), "true");
    assert.ok(await date.getAttribute("aria-describedby"));
    assert.equal((await prisma.profile.findUnique({ where: { userId: user.id } })).birthDate.toISOString().slice(0, 10), "1990-01-01", "saved date unchanged");
    await page.goto(`${BASE}/dashboard`);
    assert.match(page.url(), /\/dashboard$/, "access continues");
    step("a refused profile edit changes nothing, and access continues");

    // An edit that keeps the date isn't asked to confirm it.
    await page.goto(`${BASE}/profile`);
    await hydrated(page, date);
    await page.getByLabel("Name").fill("Sam Again");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByText("Saved.").waitFor();
    assert.equal(await page.getByRole("button", { name: "Yes, that's right" }).count(), 0);
    assert.equal((await prisma.nutritionTarget.count({ where: { userId: user.id } })), 0, "a profile edit writes no target");
    step("an unchanged date isn't asked about");

    // ─── No target: T18, T19 ────────────────────────────────────────────────
    await page.goto(`${BASE}/nutrition/targets`);
    const calories = page.getByLabel("Calories (kcal/day)");
    await hydrated(page, calories);
    for (const l of ["Calories (kcal/day)", "Protein (g)", "Fat (g)"]) assert.equal(await page.getByLabel(l).inputValue(), "", `T18: ${l} blank`);
    await page.getByText("No target yet.").waitFor();
    const targetsText = await page.locator("main").innerText();
    assert.doesNotMatch(targetsText, /BMR|TDEE|Suggest|1\.6 g\/kg/i, "no suggestion");
    await page.getByText("Targets are optional, and you can track food without one.").waitFor();

    puts.length = 0;
    // Calories stay blank: they're the one required value. 4.0.1b lets macros be blank.
    await page.getByRole("button", { name: "Save targets" }).click();
    await page.getByText(/Enter each target as a plain number|Saved\. New targets/).waitFor();
    assert.deepEqual(puts, [], "T30: blank sends nothing");
    assert.equal(await page.getByText("Enter each target as a plain number").count(), 1, "T30: blank gets the plain-number error");
    await page.getByLabel("Protein (g)").fill("100");
    await page.getByLabel("Fat (g)").fill("50");
    await calories.fill("700");
    await page.getByRole("button", { name: "Save targets" }).click();
    await page.getByText("This is the range the app accepts, not a recommendation.").waitFor();
    assert.deepEqual(puts, [], "below the range sends nothing");
    assert.doesNotMatch(await page.locator("main").innerText(), /\bsafe\b/i, "800 is never called safe");
    step("target editor starts blank, and refuses blank and out-of-range with neutral text");

    await page.goto(`${BASE}/nutrition`);
    await page.getByRole("link", { name: "Add a target" }).waitFor();
    await page.getByText("Consumed").first().waitFor();
    assert.equal(await page.getByRole("progressbar").count(), 0, "T19: no progress bar");
    assert.equal(await page.getByText("kcal left").count(), 0);
    // The app uses the date in the profile's time zone, which came from this browser, not the UTC date.
    const localToday = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).format(new Date()));
    const yesterday = addDaysUtc(localToday, -1);
    await page.goto(`${BASE}/nutrition?date=${yesterday}`);
    await page.getByText("Consumed").first().waitFor();
    assert.equal(await page.getByRole("link", { name: "Add a target" }).count(), 0, "no link on a past date");
    await page.goto(`${BASE}/nutrition/history`);
    await page.getByText("Days logged").first().waitFor().catch(() => {});
    assert.equal(await page.getByText("Dashed line").count(), 0, "no target caption");
    assert.equal(await prisma.nutritionTarget.count({ where: { userId: user.id } }), 0, "T8: pages wrote nothing");
    step("no-target screens work and write nothing");

    // ─── Manual target, over target, T37 ────────────────────────────────────
    await page.goto(`${BASE}/nutrition/targets`);
    await hydrated(page, calories);
    await calories.fill("800");
    await page.getByLabel("Protein (g)").fill("60");
    await page.getByLabel("Fat (g)").fill("20");
    await page.getByRole("button", { name: "Save targets" }).click();
    await page.getByText("Saved. New targets apply from today.").waitFor();
    assert.equal(await page.getByText("Earlier days keep their previous targets").count(), 0, "there are none");
    await page.getByText(/Set by you/).waitFor();
    await page.reload();
    await hydrated(page, calories);
    assert.equal(await calories.inputValue(), "800", "the person's own numbers come back");
    await page.evaluate(async (d) => {
      const food = await (await fetch("/api/foods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `Big bar ${Math.random()}`, basisUnit: "G", servingLabel: "1 bar", servingAmount: 200, perServing: { kcal: 900, protein: 80, carbs: 80, fat: 30 } }) })).json();
      await fetch("/api/nutrition/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: d, mealType: "LUNCH", foodId: food.food.id, servingId: food.food.servings[0].id, quantity: 1 }) });
    }, await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).format(new Date())));
    await page.goto(`${BASE}/nutrition`);
    await page.getByText("kcal over").waitFor();
    await page.getByText(/g over target/).first().waitFor();
    const main = page.locator("main");
    assert.equal(await main.locator(".text-down, .bg-down").count(), 0, "T37: no down colour");
    assert.notEqual(await main.locator("svg circle").nth(1).getAttribute("stroke"), "var(--down)", "T37: neutral ring");
    assert.equal(await page.getByRole("progressbar").count(), 3, "bars return with a target");
    await page.screenshot({ path: `${SHOTS}elig-over-${name}.png`, fullPage: true });
    await page.goto(`${BASE}/nutrition/history`);
    await page.getByText("Dashed line").waitFor();
    assert.equal(await page.locator("main").locator(".text-down, .bg-down").count(), 0, "T37: history is neutral too");
    step("manual target saved, labelled and prefilled, and over target is neutral");

    // Protein target of 0 isn't "on target".
    await prisma.nutritionTarget.updateMany({ where: { userId: user.id }, data: { proteinG: 0 } });
    await page.reload();
    await page.getByText("Dashed line").waitFor();
    assert.equal(await page.getByText("Protein on target").count(), 0, "defect 24");
    step("a protein target of 0 isn't reported as on target");

    // ─── T23: logout from onboarding ────────────────────────────────────────
    const fresh = await newPage();
    await signUp(fresh.ctx, "out");
    await fresh.page.goto(`${BASE}/onboarding`);
    await hydrated(fresh.page, fresh.page.getByRole("button", { name: "Log out" }));
    await fresh.page.getByRole("button", { name: "Log out" }).click();
    await fresh.page.waitForURL("**/login");
    await fresh.page.goto(`${BASE}/dashboard`);
    await fresh.page.waitForURL("**/login");
    step("T23: onboarding can be left, and the session is gone");
  }

  // ─── T25, T32: legacy rows ────────────────────────────────────────────────
  {
    const { ctx, page } = await newPage();
    const user = await signUp(ctx, "legacy");
    await page.goto(`${BASE}/onboarding`);
    await completeOnboarding(page);
    const row = await prisma.nutritionTarget.create({ data: { userId: user.id, effectiveFrom: dbDate(addDaysUtc(today(), -2)), kcal: 1110, proteinG: 80, carbsG: 100, fatG: 20, source: "SUGGESTED" } });
    await page.goto(`${BASE}/nutrition/targets`);
    const calories = page.getByLabel("Calories (kcal/day)");
    await hydrated(page, calories);
    const text = await page.locator("main").innerText();
    assert.doesNotMatch(text, /Set by you/, "T25: a legacy row is never labelled as the person's own");
    assert.match(text, /Set automatically earlier/, "T25: a legacy row is labelled truthfully");
    for (const l of ["Calories (kcal/day)", "Protein (g)", "Fat (g)"]) assert.equal(await page.getByLabel(l).inputValue(), "", `T32: ${l} blank`);
    await page.goto(`${BASE}/nutrition`);
    await page.getByText("Set automatically earlier").waitFor();
    assert.deepEqual(await prisma.nutritionTarget.findUnique({ where: { id: row.id } }), row, "T32: viewing changes nothing");
    step("legacy rows are labelled truthfully, and the editor starts blank");
  }

  // ─── T34: restricted account ──────────────────────────────────────────────
  {
    const { ctx, page } = await newPage();
    const user = await signUp(ctx, "restricted");
    await prisma.profile.create({ data: { userId: user.id, name: "Row", birthDate: dbDate(yearsAgo(17)), sex: "FEMALE", heightCm: 170, currentWeightKg: 60, goal: "MAINTENANCE", activityLevel: "LIGHT", experience: "BEGINNER", workoutDaysPerWeek: 2, unitSystem: "METRIC", timezone: "UTC" } });
    for (const p of ["/dashboard", "/workouts", "/nutrition", "/profile", "/progress"]) {
      await page.goto(`${BASE}${p}`);
      await page.waitForURL("**/account-restricted");
      await page.getByRole("button", { name: "Save changes" }).waitFor();
      assert.equal(await page.locator("button[aria-pressed]").count(), 0, "a restricted account isn't offered goals");
      assert.equal(await page.getByLabel(/^Goal weight/).count(), 0, "or a goal weight");
    }
    await page.getByRole("heading", { name: "Your account is restricted" }).waitFor();
    await page.getByRole("button", { name: "Log out" }).waitFor();
    assert.equal(await page.getByRole("navigation").count(), 0, "no way into the app from here");
    assert.equal(await prisma.user.count({ where: { id: user.id } }), 1, "the account isn't deleted");
    const date = page.getByLabel("Date of birth");
    await hydrated(page, date);
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByText("This date of birth can't be used.").waitFor();
    assert.match(page.url(), /account-restricted$/, "still restricted");
    await date.fill("1990-01-01");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByRole("button", { name: "Yes, that's right" }).click();
    await page.waitForURL("**/dashboard");
    step("restricted: one place, no loop, correctable, not deleted");
  }

  assert.deepEqual(errors, [], "no page errors");
  await browser.close();
}
const addDaysUtc = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

(async () => {
  await target.verifyServer();
  for (const name of BROWSERS) await inBrowser(name);
  await prisma.$disconnect();
  console.log("ALL ELIGIBILITY CHECKS PASSED");
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
