// The app as the 10 QA fixture accounts see it, through real logins and pages. Run on demand, after
// scripts/qa-fixtures.cjs --create, through the guarded runner:
//   node --env-file=.env.test scripts/run-guarded-suites.cjs qa-fixtures-e2e
// One browser at a time. A failed check is recorded and the run carries on, and it fails at the end. Nothing is corrected.
// It adds login sessions to these accounts, which cleanup removes, and changes nothing else. Prints no password or token.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");
const { PrismaClient } = require("@prisma/client");
const { FIXTURE_ACCOUNTS, FIXTURE_EMAILS, localToday } = require("./lib/qa-fixture-data.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const ORIGIN = new URL(BASE).origin;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } }, errorFormat: "minimal" });
const BUDGET_MS = 3000; // a judgement for a usable page on this machine
const CREDENTIALS = path.join(__dirname, "..", "qa-test-accounts.local.md");

const failures = [], timings = [];
let passed = 0, secrets = [];
const scrub = (text) => { let out = String(text); for (const s of secrets) out = out.split(s).join("<redacted>"); return out; };

async function check(user, route, name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push({ browser: check.browser, user: user?.n ?? "-", route, check: name, message: scrub(e.message).split("\n")[0].slice(0, 200) });
  }
}

function readAccounts() {
  const match = /```json\n([\s\S]*?)\n```/.exec(fs.readFileSync(CREDENTIALS, "utf8").replace(/\r\n/g, "\n"));
  assert.ok(match, "the credentials file has its account list");
  const list = JSON.parse(match[1]);
  assert.deepEqual(list.map((a) => a.email), [...FIXTURE_EMAILS]);
  secrets = list.map((a) => a.password);
  return list.map((c) => ({ ...FIXTURE_ACCOUNTS.find((a) => a.n === c.n), password: c.password }));
}

/** What's really stored, so the pages are compared with the data and not with what the fixture meant to write. */
async function factsFor(a) {
  const completed = await prisma.workoutSession.count({ where: { userId: a.userId, status: "COMPLETED" } });
  const inProgress = await prisma.workoutSession.findFirst({ where: { userId: a.userId, status: "IN_PROGRESS" }, select: { id: true } });
  const latest = await prisma.workoutSession.findFirst({ where: { userId: a.userId, status: "COMPLETED" }, orderBy: { startedAt: "desc" }, select: { id: true, name: true } });
  const templates = await prisma.workoutTemplate.findMany({ where: { userId: a.userId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const slots = await prisma.scheduleSlot.count({ where: { userId: a.userId } });
  const grouped = await prisma.sessionExercise.groupBy({ by: ["exerciseId"], where: { session: { userId: a.userId, status: "COMPLETED" } }, _count: { _all: true } });
  grouped.sort((x, y) => y._count._all - x._count._all || (x.exerciseId < y.exerciseId ? -1 : 1));
  const topId = grouped[0]?.exerciseId;
  const top = topId ? await prisma.exercise.findUnique({ where: { id: topId }, select: { id: true, name: true } }) : null;
  const topSessions = topId ? (await prisma.sessionExercise.findMany({ where: { exerciseId: topId, session: { userId: a.userId, status: "COMPLETED" } }, distinct: ["sessionId"], select: { sessionId: true } })).length : 0;
  const entries = await prisma.foodEntry.count({ where: { userId: a.userId } });
  const today = localToday(new Date(), a.timeZone);
  const entriesToday = await prisma.foodEntry.count({ where: { userId: a.userId, date: new Date(`${today}T00:00:00Z`) } });
  const targets = await prisma.nutritionTarget.findMany({ where: { userId: a.userId }, orderBy: { effectiveFrom: "asc" } });
  const anyEntry = await prisma.foodEntry.findFirst({ where: { userId: a.userId }, select: { id: true } });
  const custom = await prisma.exercise.findFirst({ where: { userId: a.userId }, select: { id: true, name: true } });
  return { completed, inProgress, latest, templates, slots, exercises: grouped.length, top, topSessions, entries, entriesToday, targets, anyEntry, custom };
}

async function newUserPage(browser, a) {
  const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: a.timeZone }));
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => { if (!/_rsc.*access control checks/.test(e.message)) problems.push(`pageerror: ${e.message}`); });
  page.on("console", (m) => { if (m.type() === "error" && !/status of 404|_rsc.*access control checks/.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
  return { ctx, page, problems };
}

async function login(page, ctx, a) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").waitFor();
  await page.waitForFunction(() => document.readyState === "complete");
  await page.waitForTimeout(300);
  await page.locator("input[name=email]").fill(a.email);
  await page.locator("input[name=password]").fill(a.password);
  const [response] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/auth/login")), page.locator("button[type=submit]").click()]);
  assert.equal(response.status(), 200, "the login was accepted");
  const cookie = (await ctx.cookies(BASE)).find((c) => c.name === "fit_session");
  assert.ok(cookie, "a session cookie was set");
  assert.equal(cookie.httpOnly, true);
  if (check.browser === "webkit") {
    // This WebKit build won't send a Secure cookie over plain http://localhost, so the same real session is kept without that flag.
    await ctx.clearCookies();
    await ctx.addCookies([{ name: cookie.name, value: cookie.value, url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
  } else {
    await page.waitForURL("**/dashboard");
  }
  return cookie;
}

/** Goes to a page, and checks it rendered with no error. Returns how long it took. */
async function visit(page, a, route, problems) {
  problems.length = 0;
  const started = Date.now();
  const res = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  const ms = Date.now() - started;
  await page.waitForLoadState("load");
  await page.waitForTimeout(150);
  assert.ok(res.status() < 400, `HTTP ${res.status()}`);
  assert.equal(await page.getByText("Application error").count(), 0, "an application error is showing");
  assert.deepEqual([...problems], [], "page errors");
  return ms;
}
const see = (page, text) => page.getByText(text, { exact: false }).first().waitFor({ timeout: 6000 });
const absent = async (page, text) => assert.equal(await page.getByText(text, { exact: false }).count(), 0, `"${text}" is showing`);

async function timed(page, a, route, problems) {
  const ms = await visit(page, a, route, problems);
  timings.push({ user: a.n, route, ms });
  if (ms > BUDGET_MS) throw new Error(`took ${ms} ms, over the ${BUDGET_MS} ms budget`);
}

async function fullChecks(page, a, f, problems) {
  await check(a, "/dashboard", "shows the person's first name", async () => {
    await visit(page, a, "/dashboard", problems);
    await see(page, a.name.split(" ")[0]);
  });
  await check(a, "/dashboard", "schedule state", async () => {
    if (!f.slots) await see(page, "No schedule set");
  });

  await check(a, "/profile", "shows email and stored values, with nothing invented", async () => {
    await visit(page, a, "/profile", problems);
    await see(page, a.email);
    assert.equal(await page.getByLabel("Name").inputValue(), a.name);
    assert.equal(await page.getByLabel("Date of birth").inputValue(), a.profile.birthDate);
    assert.equal(await page.getByRole("radio", { name: a.units === "METRIC" ? "kg / cm" : "lb / ft" }).getAttribute("aria-checked"), "true");
    if (a.n === 1) await absent(page, "Height (cm)"); // nothing stored, so the row stays closed or empty
  });

  await check(a, "/workouts", "plans or the empty state", async () => {
    await visit(page, a, "/workouts", problems);
    if (!f.templates.length) await see(page, "No workout plans yet");
    for (const t of f.templates) await see(page, t.name);
  });

  await check(a, "/workouts/schedule", "schedule or the empty state", async () => {
    await visit(page, a, "/workouts/schedule", problems);
    await see(page, "Weekly schedule");
    if (!f.templates.length) await see(page, "Create a plan first");
    else await see(page, f.templates[0].name);
  });

  await check(a, "/workouts/history", "total and first page match the data", async () => {
    await timed(page, a, "/workouts/history", problems);
    if (!f.completed) return see(page, "No workouts yet");
    await see(page, `${f.completed} completed workout`);
    const rows = await page.locator('a[href^="/workouts/history/"]').count();
    assert.equal(rows, Math.min(25, f.completed), "rows on page 1");
  });
  if (f.completed > 25) {
    const lastPage = Math.ceil(f.completed / 25);
    await check(a, "/workouts/history?page=last", "the last page holds the remainder, with no Older link", async () => {
      await visit(page, a, `/workouts/history?page=${lastPage}`, problems);
      const rows = await page.locator('a[href^="/workouts/history/"]').count();
      assert.equal(rows, f.completed - (lastPage - 1) * 25, "rows on the last page");
      assert.equal(await page.getByRole("link", { name: "Older" }).count(), 0);
      assert.equal(await page.getByRole("link", { name: "Newer" }).count(), 1);
    });
    await check(a, "/workouts/history?page=beyond", "a page past the end offers a way back", async () => {
      await visit(page, a, `/workouts/history?page=${lastPage + 5}`, problems);
      assert.ok(await page.getByRole("link", { name: "Newer" }).count() > 0 || await page.locator('a[href^="/workouts/history/"]').count() > 0, "shows neither rows nor a way back");
    });
  }

  if (f.latest) {
    await check(a, "/workouts/history/[id]", "a workout's details", async () => {
      await visit(page, a, `/workouts/history/${f.latest.id}`, problems);
      await see(page, f.latest.name);
      await see(page, "Repeat this workout");
    });
  }

  await check(a, "/progress", "exercises or the empty state", async () => {
    await timed(page, a, "/progress", problems);
    if (!f.completed) return see(page, "No progress data yet");
    assert.equal(await page.locator('a[href^="/progress/"]').count(), f.exercises, "one row per exercise performed");
  });
  if (f.top) {
    await check(a, "/progress/[id]", "an exercise's details match the data", async () => {
      await timed(page, a, `/progress/${f.top.id}`, problems);
      await page.getByRole("heading", { name: f.top.name }).first().waitFor({ timeout: 6000 });
      await see(page, `${f.topSessions} session${f.topSessions === 1 ? "" : "s"} logged`);
      if (f.topSessions < 2) await see(page, "Log at least two sessions to see a trend.");
      else await see(page, "Personal records");
    });
  }
  if (f.inProgress) {
    await check(a, "/workouts/session/[id]", "the workout in progress opens", async () => {
      await visit(page, a, `/workouts/session/${f.inProgress.id}`, problems);
      await page.getByRole("button", { name: /Finish/ }).first().waitFor({ timeout: 6000 });
    });
  }

  await check(a, "/nutrition", "today's log or its empty state", async () => {
    await visit(page, a, "/nutrition", problems);
    if (!f.entriesToday) await see(page, "Nothing logged");
  });
  await check(a, "/nutrition/history", "history or its empty state", async () => {
    await timed(page, a, "/nutrition/history", problems);
    if (!f.entries) {
      await see(page, "Nothing logged this week.");
      await see(page, "Log food for a few weeks to see your intake trend.");
    }
  });
  await check(a, "/nutrition/history?week=past", "an earlier week can be opened", async () => {
    await visit(page, a, "/nutrition/history", problems);
    await page.getByRole("link", { name: "Previous week" }).click();
    await page.waitForURL("**/nutrition/history?week=*");
    await page.waitForTimeout(200);
    assert.deepEqual([...problems], [], "page errors");
  });
  await check(a, "/nutrition/targets", "the current target, or none", async () => {
    await visit(page, a, "/nutrition/targets", problems);
    await see(page, "Daily calories and macronutrients");
    const current = f.targets.at(-1);
    if (!f.targets.length) await see(page, "No target");
    else if (current.kcal === null) await see(page, "No target in use.");
    else await see(page, String(current.kcal));
    if (f.targets.length > 1) await see(page, "Target history");
    if (f.targets.some((t) => t.kcal === null) && f.targets.length > 1) await see(page, "Stopped");
    if (f.targets.some((t) => t.kcal !== null && t.proteinG === null)) await see(page, "Not set");
  });
}

/** With B's session: nothing of A's opens, changes, or shows. */
async function isolationChecks(browser, A, fa, B, fb, cookie, page, problems) {
  const send = async (method, url) => {
    const res = await fetch(BASE + url, { method, headers: { Cookie: `${cookie.name}=${cookie.value}`, Origin: ORIGIN } });
    await res.text();
    return res.status;
  };
  const label = `#${B.n} reading #${A.n}`;
  for (const [route, id] of [["/workouts/history", fa.latest?.id], ["/workouts/plans", fa.templates[0]?.id], ["/workouts/session", fa.inProgress?.id]]) {
    if (!id) continue;
    await check(B, `${route}/[A]`, `${label}: the page isn't available`, async () => {
      const res = await page.goto(`${BASE}${route}/${id}`, { waitUntil: "load" });
      assert.equal(res.status(), 404);
      await absent(page, A.email);
    });
  }
  const before = { sessions: await prisma.workoutSession.count({ where: { userId: A.userId } }), templates: await prisma.workoutTemplate.count({ where: { userId: A.userId } }), entries: await prisma.foodEntry.count({ where: { userId: A.userId } }) };
  for (const [method, url] of [
    fa.latest && ["GET", `/api/sessions/${fa.latest.id}`], fa.latest && ["DELETE", `/api/sessions/${fa.latest.id}`],
    fa.templates[0] && ["GET", `/api/templates/${fa.templates[0].id}`], fa.templates[0] && ["DELETE", `/api/templates/${fa.templates[0].id}`],
    fa.anyEntry && ["DELETE", `/api/nutrition/entries/${fa.anyEntry.id}`],
    fa.custom && ["GET", `/api/exercises/${fa.custom.id}/history`], fa.custom && ["GET", `/api/exercises/${fa.custom.id}/previous`],
  ].filter(Boolean)) {
    await check(B, url.replace(/qafx[^/]+/, "[A]"), `${label}: ${method} is refused`, async () => assert.equal(await send(method, url), 404));
  }
  await check(B, "database", `${label}: A's rows are unchanged`, async () => {
    assert.deepEqual({ sessions: await prisma.workoutSession.count({ where: { userId: A.userId } }), templates: await prisma.workoutTemplate.count({ where: { userId: A.userId } }), entries: await prisma.foodEntry.count({ where: { userId: A.userId } }) }, before);
  });
  for (const route of ["/dashboard", "/workouts", "/workouts/history", "/progress", "/nutrition/history", "/nutrition/targets", "/profile"]) {
    await check(B, route, `${label}: nothing of A's is on this page`, async () => {
      await page.goto(`${BASE}${route}`, { waitUntil: "load" });
      await absent(page, A.email);
      await absent(page, A.name);
      for (const t of fa.templates) await absent(page, t.name);
      if (fa.custom) await absent(page, fa.custom.name);
    });
  }
  // Refused requests also show as 404s in the page's console, which is expected here.
  problems.length = 0;
}

(async () => {
  await target.verifyServer();
  const accounts = readAccounts();
  const facts = new Map();
  for (const a of accounts) facts.set(a.n, await factsFor(a));
  for (const a of accounts) {
    const dbUser = await prisma.user.findUnique({ where: { email: a.email }, select: { id: true } });
    assert.equal(dbUser?.id, a.userId, "the account is the fixture's");
  }

  // ─── Chromium: every account, in depth ────────────────────────────────────
  check.browser = "chromium";
  let browser = await playwright.chromium.launch(target.launchOptions("chromium"));
  const cookies = new Map();
  for (const a of accounts) {
    const { ctx, page, problems } = await newUserPage(browser, a);
    let loggedIn = false;
    await check(a, "/login", "logs in through the real form", async () => { cookies.set(a.n, await login(page, ctx, a)); loggedIn = true; });
    if (loggedIn) await fullChecks(page, a, facts.get(a.n), problems);
    await ctx.close();
    console.log(`checked account ${a.n}`);
  }

  await check.call(null, null, "/dashboard", "signed out, a page goes to login", async () => {
    const { ctx, page } = await newUserPage(browser, accounts[0]);
    await page.goto(`${BASE}/dashboard`);
    assert.match(page.url(), /\/login$/);
    await ctx.close();
  });
  await check(accounts[0], "/login", "a wrong password is refused", async () => {
    const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email: accounts[0].email, password: "not this account's password" }) });
    assert.equal(res.status, 401);
    assert.equal(res.headers.getSetCookie().some((c) => c.startsWith("fit_session=")), false);
  });

  // ─── Isolation, in both directions and between very different accounts ────
  for (const [an, bn] of [[10, 2], [3, 8], [8, 3], [4, 9]]) {
    const A = accounts.find((a) => a.n === an), B = accounts.find((a) => a.n === bn);
    if (!cookies.has(bn)) continue;
    const { ctx, page, problems } = await newUserPage(browser, B);
    await check(B, "/login", "logs in again for the isolation checks", async () => { cookies.set(bn, await login(page, ctx, B)); });
    await isolationChecks(browser, A, facts.get(an), B, facts.get(bn), cookies.get(bn), page, problems);
    await ctx.close();
  }

  // ─── The eligibility gate stays closed to a fixture ───────────────────────
  if (cookies.has(1)) {
    await check(accounts[0], "/api/profile", "an under-18 date of birth is refused, and nothing changes", async () => {
      const d = new Date();
      d.setUTCFullYear(d.getUTCFullYear() - 17);
      const before = await prisma.profile.findUnique({ where: { userId: accounts[0].userId } });
      const c = cookies.get(1);
      const res = await fetch(`${BASE}/api/profile`, { method: "PUT", headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: `${c.name}=${c.value}` }, body: JSON.stringify({ name: accounts[0].name, birthDate: d.toISOString().slice(0, 10), unitSystem: "METRIC", timezone: "UTC" }) });
      assert.equal(res.status, 422);
      assert.deepEqual(await prisma.profile.findUnique({ where: { userId: accounts[0].userId } }), before);
    });
  }
  await browser.close();

  // ─── Firefox and WebKit: an empty account and the largest, headings only ──
  for (const name of ["firefox", "webkit"]) {
    check.browser = name;
    browser = await playwright[name].launch(target.launchOptions(name));
    for (const a of [accounts[0], accounts[9]]) {
      const { ctx, page, problems } = await newUserPage(browser, a);
      let loggedIn = false;
      await check(a, "/login", "logs in through the real form", async () => { await login(page, ctx, a); loggedIn = true; });
      if (loggedIn) {
        for (const [route, text] of [["/dashboard", a.name.split(" ")[0]], ["/profile", a.email], ["/workouts/history", "completed workout"], ["/progress", "Progress"], ["/nutrition/history", "Weekly averages"], ["/nutrition/targets", "Targets"]]) {
          await check(a, route, "renders with no error", async () => { await visit(page, a, route, problems); await see(page, text); });
        }
      }
      await ctx.close();
    }
    await browser.close();
    console.log(`checked ${name}`);
  }

  console.log(`Timings: ${timings.map((t) => `#${t.user} ${t.route} ${t.ms} ms`).join("; ")}`);
  console.log(`Checks passed: ${passed}. Failed: ${failures.length}.`);
  for (const f of failures) console.log(`FAIL [${f.browser}] #${f.user} ${f.route}: ${f.check}: ${f.message}`);
  await prisma.$disconnect();
  if (failures.length) process.exit(1);
  console.log("ALL QA FIXTURE CHECKS PASSED");
})().catch(async (e) => { console.error(scrub(e.message).split("\n")[0].slice(0, 300)); await prisma.$disconnect().catch(() => {}); process.exit(1); });
