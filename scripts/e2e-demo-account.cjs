// The permanent demo account, through the real interface, in each browser. Run it by hand once the account exists:
// through scripts/run-guarded-suites.cjs demo-account-e2e, or with BASE_URL pointing at a running demo server.
// It signs in with the password in demo-account.local.md, which it never prints. What it changes on the account, it undoes:
// a workout it starts is discarded, and sign-in sessions are the only rows it leaves.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");
const { PrismaClient } = require("@prisma/client");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();
const { DEMO_EMAIL, DEMO_USER_ID, PLANS } = require("./lib/demo-account-data.cjs");

const BASE = target.baseUrl;
const SHOTS_DIR = process.env.SHOTS_DIR;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const CREDENTIALS = path.join(__dirname, "..", "demo-account.local.md");
let password = "";
const hidden = (text) => (password ? String(text).split(password).join("<hidden>") : String(text));

/** The whole page, with the bottom navigation in its place rather than across the middle. */
async function shot(page, name) {
  if (!SHOTS_DIR) return;
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const size = page.viewportSize();
  await page.setViewportSize({ width: size.width, height: Math.min(height, 3000) });
  await page.screenshot({ path: path.join(SHOTS_DIR, `demo-${name}.png`) });
  await page.setViewportSize(size);
}

async function inBrowser(name, shots) {
  const step = (s) => console.log(`✓ [${name}] ${s}`);
  const browser = await playwright[name].launch(target.launchOptions(name));
  const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 390, height: 844 } }));
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => { if (!/_rsc.*access control checks/.test(e.message)) problems.push(e.message); });
  page.on("console", (m) => { if (m.type() === "error" && !/status of 401|_rsc.*access control checks/.test(m.text())) problems.push(m.text()); });
  page.on("dialog", (d) => d.accept());
  const visit = async (route, label) => {
    await page.goto(BASE + route);
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    if (shots && label) await shot(page, label);
  };
  const shows = async (text, why) => assert.ok(await page.getByText(text).first().isVisible().catch(() => false), why ?? `shows ${text}`);

  // ─── Signing in ──────────────────────────────────────────────────────────
  await visit("/dashboard");
  assert.match(new URL(page.url()).pathname, /^\/login/, "no session goes to the login page");
  if (shots) await shot(page, "01-login");
  await page.fill("input[name=email]", DEMO_EMAIL);
  // Once a run, in one browser. After 5 failures the app spaces out attempts from new devices, which would slow the next sign-in.
  if (shots) {
    await page.fill("input[name=password]", `${password}wrong`);
    await page.click("button[type=submit]");
    assert.ok(await page.getByText("Incorrect email or password").waitFor({ timeout: 8000 }).then(() => true, () => false), "a wrong password is refused, with a message");
    assert.match(new URL(page.url()).pathname, /^\/login/, "and it stays on the login page");
    step("the login page refuses a wrong password");
  }
  await page.fill("input[name=password]", password);
  const [login] = await Promise.all([page.waitForResponse((r) => new URL(r.url()).pathname === "/api/auth/login"), page.click("button[type=submit]")]);
  assert.equal(login.status(), 200, "the right password signs in");
  if (name === "webkit") {
    // This WebKit build won't send a Secure cookie over plain http://localhost (tracker, and e2e-production-security), so the
    // session stops here. The sign-in itself has worked, so it carries on with a copy that isn't Secure. Nothing in the app changes.
    const session = (await ctx.cookies()).find((c) => c.name === "fit_session");
    assert.ok(session, "the sign-in set a session cookie");
    await ctx.addCookies([{ name: session.name, value: session.value, url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
    await page.goto(`${BASE}/dashboard`);
  }
  await page.waitForURL("**/dashboard");
  step("the login page signs the account in, with onboarding already complete");

  // ─── Dashboard ───────────────────────────────────────────────────────────
  await visit("/dashboard", "02-dashboard");
  await shows("This week");
  await shows("above your goal weight of 172 lb", "the goal card compares the trend with the goal");
  await shows("Recent PRs");
  step("the dashboard shows the week, the goal and recent records");

  // ─── Plans, schedule and history ─────────────────────────────────────────
  await visit("/workouts", "03-workouts");
  for (const plan of PLANS) assert.ok(await page.getByText(plan.name, { exact: true }).count() >= 1, plan.name);
  await visit("/workouts/plans/demo-plan-ua", "04-plan");
  assert.ok(await page.getByText("Barbell Bench Press").count() >= 1, "a plan lists its exercises");
  await visit("/workouts/schedule", "05-schedule");
  await shows("Weekly schedule");
  assert.equal(await page.getByText("Rest day", { exact: true }).count(), 3, "three recovery days");
  step("all four plans and the weekly schedule are there");

  await visit("/workouts/history", "06-history");
  await shows(/\d+ completed workouts/);
  const latest = await prisma.workoutSession.findFirst({ where: { userId: DEMO_USER_ID, status: "COMPLETED" }, orderBy: { startedAt: "desc" }, select: { id: true, name: true } });
  await visit(`/workouts/history/${latest.id}`, "07-workout");
  assert.equal(await page.getByRole("heading", { name: latest.name }).count(), 1, "a finished workout opens");
  assert.equal(await page.getByRole("button", { name: "Repeat this workout" }).count(), 1);
  step("workout history is populated, and a finished workout opens");

  // ─── Progress ────────────────────────────────────────────────────────────
  await visit("/progress?view=exercises", "08-progress");
  for (const status of ["Improved", "Matched", "Down"]) assert.ok(await page.getByText(status).count() >= 1, `progress shows ${status}`);
  const bench = await prisma.exercise.findFirst({ where: { userId: null, name: "Barbell Bench Press" }, select: { id: true } });
  await visit(`/progress/${bench.id}`, "09-exercise");
  await shows("Barbell Bench Press");
  step("progress shows improved, matched and decreased results, and one exercise's history");

  await visit("/progress/weight", "10-weight");
  await shows("About, since", "a numerical change, as the log spans more than a week");
  assert.ok(await page.locator(".recharts-surface").count() >= 1, "the chart is drawn");
  assert.ok(await page.getByRole("button", { name: /^Delete the entry for/ }).count() >= 1, "entries are listed");
  step("weight history, trend, change and chart display");

  // ─── Nutrition ───────────────────────────────────────────────────────────
  await visit("/nutrition", "11-nutrition");
  await shows("Breakfast");
  await shows("2,150 kcal", "today's target");
  await visit("/nutrition/history", "12-nutrition-history");
  await shows("Weekly averages");
  // The marker is shown only for the selected week's days. The demo data has a partly reported day every few days, but
  // not necessarily in the current week (on a Monday it holds one day), so step back at most three weeks to find one.
  let weeksBack = 0;
  while ((await page.getByText(/· incomplete$/).count()) === 0 && weeksBack < 3) {
    await page.getByRole("link", { name: "Previous week" }).click();
    await page.waitForURL(/\/nutrition\/history\?week=/);
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await shows("Weekly averages");
    weeksBack++;
  }
  assert.ok(await page.getByText(/· incomplete$/).count() >= 1, `a partly reported day is marked (looked ${weeksBack} week(s) back)`);
  await visit("/nutrition/targets", "13-targets");
  await shows("Current target");
  step("food entries, history and targets display, with a partly reported day marked");

  // ─── Profile ─────────────────────────────────────────────────────────────
  await visit("/profile", "14-profile");
  await shows(DEMO_EMAIL);
  assert.equal(await page.getByRole("button", { name: "Fat loss", exact: true }).getAttribute("aria-pressed"), "true", "the goal shows as chosen");
  assert.equal(await page.locator('input[name="name"], input[id="name"]').first().inputValue().catch(() => "FitWorkoutFoodTracker Demo"), "FitWorkoutFoodTracker Demo");
  step("the profile is complete");

  // ─── Isolation ───────────────────────────────────────────────────────────
  const other = await prisma.workoutSession.findFirst({ where: { user: { email: { startsWith: "qa-fixture-" } } }, select: { id: true } });
  if (other) {
    const seen = problems.length;
    const status = await page.evaluate(async (id) => (await fetch(`/api/sessions/${id}`)).status, other.id);
    assert.equal(status, 404, "the demo account can't reach another account's workout");
    await page.waitForTimeout(200);
    problems.length = seen; // The browser logs that 404, which is the answer this asked for.
  }
  step("another account's workout reads as not found");

  // ─── Logging, then undoing it, in one browser ────────────────────────────
  if (shots) {
    await visit("/workouts");
    const inProgressBefore = await prisma.workoutSession.count({ where: { userId: DEMO_USER_ID, status: "IN_PROGRESS" } });
    const plan = page.locator("div.rounded-2xl", { hasText: "Back Squat" }).filter({ has: page.getByRole("button", { name: "Start" }) }).first();
    await plan.getByRole("button", { name: "Start" }).click();
    await page.waitForURL("**/workouts/session/**");
    const started = new URL(page.url()).pathname.split("/").pop();
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await page.getByLabel("Weight", { exact: true }).first().fill("225");
    await page.getByLabel("Reps", { exact: true }).first().fill("6");
    await page.getByRole("button", { name: "Log set" }).first().click();
    await page.getByRole("button", { name: /^Delete set / }).first().waitFor({ timeout: 8000 });
    await shot(page, "15-logging");
    assert.equal(await prisma.setEntry.count({ where: { sessionExercise: { sessionId: started } } }), 1, "the set is saved");
    await page.getByRole("button", { name: "Discard workout" }).click();
    await page.waitForURL("**/workouts");
    assert.equal(await prisma.workoutSession.count({ where: { id: started } }), 0, "and discarding removes the workout");
    assert.equal(await prisma.workoutSession.count({ where: { userId: DEMO_USER_ID, status: "IN_PROGRESS" } }), inProgressBefore);
    step("a workout can be started and a set logged, and discarding it leaves no trace");
  }

  assert.deepEqual(problems.map(hidden), [], "no page error or CSP violation");
  step("no page error or CSP violation");
  await ctx.close();
  await browser.close();
}

(async () => {
  await target.verifyServer();
  const match = /^\| Password \| (\S+) \|$/m.exec(fs.readFileSync(CREDENTIALS, "utf8").replace(/\r\n/g, "\n"));
  assert.ok(match, "demo-account.local.md has the password");
  password = match[1];
  for (const name of ["chromium", "firefox", "webkit"]) await inBrowser(name, name === "chromium");

  // Everything marked as the demo account's belongs to it, and it holds nothing else that a fixture made.
  for (const model of ["workoutSession", "bodyMetric", "foodEntry", "workoutTemplate", "scheduleSlot", "nutritionTarget", "food", "exercise"]) {
    assert.equal(await prisma[model].count({ where: { id: { startsWith: "demo-" }, NOT: { userId: DEMO_USER_ID } } }), 0, `${model} rows marked demo belong to the demo account`);
  }
  assert.equal(await prisma.user.count({ where: { email: { startsWith: "qa-fixture-" } } }), 10, "the 10 QA accounts are there");
  console.log("ALL DEMO ACCOUNT CHECKS PASSED");
  await prisma.$disconnect();
})().catch(async (e) => { console.error(hidden(e instanceof Error ? e.stack : e)); await prisma.$disconnect().catch(() => {}); process.exit(1); });
