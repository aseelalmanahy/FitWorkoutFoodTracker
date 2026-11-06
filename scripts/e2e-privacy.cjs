// The public pages and the acceptance box, in each browser, one at a time. Through the guarded runner.
// Stored acceptance is checked by privacy-consent. This covers what a person sees and can reach by keyboard.
const assert = require("node:assert/strict");
const { randomBytes, createHash } = require("node:crypto");
const playwright = require("playwright");
const { PrismaClient } = require("@prisma/client");
const { NOTICE_VERSION } = require("./lib/signup.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
const PASSWORD = "correct horse battery staple";
const BROWSERS = ["chromium", "firefox", "webkit"];
const created = [];

async function mint(address) {
  const token = randomBytes(32).toString("base64url");
  created.push(address);
  await prisma.accountToken.create({ data: { id: createHash("sha256").update(token).digest("hex"), purpose: "SIGNUP", email: address, expiresAt: new Date(Date.now() + 3_600_000) } });
  return token;
}

async function inBrowser(name) {
  const step = (s) => console.log(`✓ [${name}] ${s}`);
  const browser = await playwright[name].launch(target.launchOptions(name));
  const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 390, height: 844 } }));
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => { if (!/_rsc.*access control checks/.test(e.message)) problems.push(e.message); });
  page.on("console", (m) => { if (m.type() === "error" && !/status of 40[09]/.test(m.text())) problems.push(m.text()); });
  const settled = () => page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

  for (const [route, heading] of [["/privacy", "Privacy notice"], ["/terms", "Terms"]]) {
    await page.goto(`${BASE}${route}`);
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    await settled();
    assert.equal(await page.getByRole("note").filter({ hasText: "Draft." }).count(), 1, `${route} shows the draft banner`);
    assert.equal(await page.getByText(`Version ${NOTICE_VERSION}`).count(), 1, `${route} shows its version`);
  }
  step("both pages are public, with the draft banner and version");

  await page.goto(`${BASE}/register`);
  await page.getByRole("link", { name: "Privacy notice" }).waitFor();
  await page.getByRole("link", { name: "Terms" }).waitFor();
  await page.getByText("Your address is used to send the sign-up link").waitFor();
  await settled();
  await page.goto(`${BASE}/login`);
  await page.getByRole("link", { name: "Privacy notice" }).waitFor();
  await settled();
  step("sign-up and login link to them");

  const address = `privacy${name}${run}@test.dev`;
  const token = await mint(address);
  await page.goto(`${BASE}/register/complete#token=${token}`);
  const box = page.locator("input[name=accept]");
  await box.waitFor();
  assert.equal(await box.isChecked(), false, "the box starts unticked");
  await page.waitForFunction(() => location.hash === "");
  step("the box starts unticked");

  await page.locator("input[name=password]").fill(PASSWORD);
  let posted = 0;
  const count = (r) => { if (r.url().endsWith("/api/auth/register/complete")) posted++; };
  page.on("request", count);
  await page.locator("button[type=submit]").click();
  await page.waitForTimeout(500);
  assert.equal(posted, 0, "nothing was sent unticked");
  assert.equal(await page.getByText("Tick the box to continue.").count(), 1, "and the form says why");
  assert.equal(await prisma.user.count({ where: { email: address } }), 0);
  step("unticked, the form says so, and sends nothing");

  // Reaching the box and its links by keyboard alone.
  await page.locator("input[name=password]").focus();
  const reached = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    reached.push(await page.evaluate(() => document.activeElement?.getAttribute("name") ?? document.activeElement?.textContent?.trim() ?? ""));
  }
  if (name !== "webkit") {
    // WebKit's default skips links on Tab, as a browser setting, so it's checked by the box only.
    assert.ok(reached.includes("Privacy notice") && reached.includes("Terms"), `links reached by Tab: ${reached.join(", ")}`);
  }
  await box.focus();
  await page.keyboard.press("Space");
  assert.equal(await box.isChecked(), true, "ticked with the keyboard");
  step("the box and its links can be used by keyboard");

  const [response] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/auth/register/complete")), page.locator("button[type=submit]").click()]);
  assert.equal(response.status(), 200);
  page.off("request", count);
  await page.waitForURL("**/login?created=1");
  const user = await prisma.user.findUnique({ where: { email: address } });
  assert.equal(user.termsVersion, NOTICE_VERSION);
  assert.ok(user.termsAcceptedAt);
  step("ticked, it creates the account with acceptance recorded");

  await settled();
  assert.deepEqual(problems, [], "no page error or CSP violation");
  step("no page error or CSP violation");
  await ctx.close();
  await browser.close();
}

(async () => {
  await target.verifyServer();
  for (const name of BROWSERS) await inBrowser(name);
  const ids = (await prisma.user.findMany({ where: { email: { in: created } }, select: { id: true } })).map((u) => u.id);
  await prisma.accountToken.deleteMany({ where: { email: { in: created } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  console.log("ALL PRIVACY CHECKS PASSED");
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
