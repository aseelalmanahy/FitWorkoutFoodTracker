// Phase 4.0.3 in real browsers: the Content Security Policy must break nothing, and block what it should.
// Sign-up is closed on this server, so accounts are created directly in the test database.
//   BASE_URL=... DATABASE_URL=<local test database> node scripts/e2e-production-security.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const playwright = require("playwright");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser, addSession } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const BROWSERS = ["chromium", "firefox", "webkit"];
// QA-03: Firefox reports NS_BINDING_ABORTED when this navigation replaces one the app itself started (the refresh
// after saving). It's retried once, after the page settles; the page must still load, and every check after it runs.
const goto = async (page, url) => {
  try { return await page.goto(url); } catch (e) {
    if (!/NS_BINDING_ABORTED/.test(String(e?.message))) throw e;
    await page.waitForLoadState("load").catch(() => {});
    return page.goto(url);
  }
};
const PASSWORD = "correct horse battery staple";
const PAGES = ["/dashboard", "/workouts", "/workouts/plans/new", "/workouts/schedule", "/workouts/history", "/progress", "/nutrition", "/nutrition/add", "/nutrition/meal", "/nutrition/history", "/nutrition/targets", "/profile", "/account"];
let counter = 0;

async function inBrowser(name) {
  const browser = await playwright[name].launch(target.launchOptions(name));
  const violations = [], errors = [];
  const step = (s) => console.log(`✓ [${name}] ${s}`);
  const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true }));
  const email = `secui${++counter}x${Date.now()}@test.dev`;
  const { user } = await createSignedInUser(prisma, email, { password: PASSWORD });
  await prisma.profile.create({ data: { userId: user.id, name: "Row", birthDate: new Date("1990-01-01T00:00:00Z"), unitSystem: "METRIC", timezone: "UTC", sex: "FEMALE", heightCm: 170, currentWeightKg: 60 } });
  await prisma.user.update({ where: { id: user.id }, data: { sessions: { deleteMany: {} } } });
  await ctx.addInitScript(() => {
    window.__violations = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__violations.push(`${e.violatedDirective} ${e.blockedURI} from ${e.sourceFile}:${e.lineNumber}:${e.columnNumber}`));
  });
  const page = await ctx.newPage();
  // Zod tries eval once in a try/catch, to see if it can compile validators, and carries on without it.
  // The policy blocks that, as it should, so it isn't a fault. The test below shows eval stays blocked.
  const zodProbe = (text) => /\beval\b/i.test(text);
  page.on("console", (m) => { if (/Content.Security.Policy|Refused to/i.test(m.text()) && !zodProbe(m.text())) violations.push(m.text()); });
  page.on("pageerror", (e) => {
    if (name === "webkit" && /[?&]_rsc=\S* due to access control checks/.test(e.message)) return;
    errors.push(e.message);
  });
  const collect = async () => { for (const v of await page.evaluate(() => window.__violations.splice(0))) if (!zodProbe(v)) violations.push(v); };

  // Logging in for real: the form has to hydrate under the policy, and the session cookie has to be accepted.
  await goto(page, `${BASE}/login`);
  await page.getByLabel("Email").waitFor();
  await page.waitForFunction(() => document.readyState === "complete");
  await page.waitForTimeout(300);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  const [login] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/auth/login")), page.getByRole("button", { name: /log in/i }).click()]);
  assert.equal(login.status(), 200, "the form hydrated, and the login was accepted");
  const cookie = (await ctx.cookies(BASE)).find((c) => c.name === "fit_session");
  assert.equal(cookie?.httpOnly, true, "the session cookie is HttpOnly");
  if (name !== "webkit") {
    assert.equal(cookie.sameSite, "Lax", "the session cookie is SameSite=Lax");
    await page.waitForURL("**/dashboard");
  } else {
    // This WebKit build won't send a Secure cookie over plain http://localhost, so it needs HTTPS to stay logged in.
    // That's for real devices, T-15. Everything after this tests the policy, with a session set directly.
    await ctx.clearCookies();
    await ctx.addCookies([{ name: "fit_session", value: await addSession(prisma, user.id), url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
    await goto(page, `${BASE}/dashboard`);
  }
  await collect();
  step("login works under the policy");

  for (const path of PAGES) {
    await goto(page, `${BASE}${path}`);
    await page.waitForFunction(() => document.readyState === "complete");
    await page.waitForTimeout(150);
    await collect();
    assert.deepEqual(violations, [], `no violation on ${path}`);
  }
  step(`${PAGES.length} pages load with no violation`);

  const theme = await page.evaluate(async () => {
    localStorage.setItem("theme", "dark");
    return true;
  });
  assert.ok(theme);
  await goto(page, `${BASE}/profile`);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark", "the theme script ran");
  step("the nonce lets the theme script run");

  await page.getByRole("radio", { name: /kg \/ cm/ }).waitFor();
  await goto(page, `${BASE}/nutrition/targets`);
  await page.getByLabel("Calories (kcal/day)").waitFor();
  await page.waitForFunction(() => document.readyState === "complete");
  await page.waitForTimeout(300);
  await page.getByLabel("Calories (kcal/day)").fill("2000");
  await page.getByRole("button", { name: "Save targets" }).click();
  await page.getByText("Saved. New targets apply from today.").waitFor();
  await collect();
  step("client navigation and saving work");

  await goto(page, `${BASE}/account`);
  const open = page.getByRole("button", { name: "Download my data" });
  await open.waitFor();
  await page.waitForFunction(() => document.readyState === "complete");
  await page.waitForTimeout(300);
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Download your data" });
  await dialog.getByLabel("Password").fill(PASSWORD);
  const [file] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Download", exact: true }).click()]);
  assert.equal(JSON.parse(fs.readFileSync(await file.path(), "utf8")).account.email, email);
  await collect();
  assert.deepEqual(violations, [], "the download needs nothing the policy blocks");
  step("the export downloads, through a blob URL");

  // What the policy is for. These run from the page's own context, as injected content would.
  const blocked = await page.evaluate(async () => {
    window.__injected = false;
    const inline = document.createElement("script");
    inline.textContent = "window.__injected = true";
    document.head.append(inline);
    // In a timer, as code evaluated directly by the test tool is exempt from this rule in Chromium.
    const evaluated = await new Promise((resolve) => setTimeout(() => {
      try { new Function("return 1")(); resolve(true); } catch { resolve(false); }
    }));
    await new Promise((r) => setTimeout(r, 200));
    return { injected: window.__injected, evaluated, reported: window.__violations.some((v) => v.includes("script-src")) };
  });
  assert.equal(blocked.injected, false, "an injected inline script doesn't run");
  assert.equal(blocked.evaluated, false, "eval doesn't run");
  assert.equal(blocked.reported, true, "the browser reported it");
  const remote = await page.evaluate(() => fetch("https://example.invalid/steal", { mode: "no-cors" }).then(() => "sent", () => "blocked"));
  assert.equal(remote, "blocked", "data can't be sent to another site");
  await collect();
  violations.length = 0;
  step("an injected script, eval and a request to another site are all blocked");

  const account = page.getByRole("button", { name: "Delete my account" });
  await account.click();
  const del = page.getByRole("dialog", { name: "Delete your account?" });
  await del.getByLabel("Password").fill(PASSWORD);
  await del.getByLabel("Type DELETE to confirm").fill("DELETE");
  await del.getByRole("button", { name: "Permanently delete my account" }).click();
  await page.waitForURL("**/account-deleted");
  assert.equal(await prisma.user.count({ where: { id: user.id } }), 0);
  await collect();
  assert.deepEqual(violations, [], "deletion needs nothing the policy blocks");
  step("account deletion works");

  assert.deepEqual(errors, [], "no page errors");
  await browser.close();
}

(async () => {
  await target.verifyServer();
  for (const name of BROWSERS) await inBrowser(name);
  await prisma.$disconnect();
  console.log("ALL PRODUCTION SECURITY CHECKS PASSED");
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
