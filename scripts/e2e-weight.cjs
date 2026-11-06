// The weight log and goal card in a real browser, one browser at a time. Needs MIG-04 on fitdb_test.
const assert = require("node:assert/strict");
const playwright = require("playwright");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
const created = [];

async function user(browser, label, profile) {
  const { user: u, token } = await createSignedInUser(prisma, `weighte2e${label}x${run}@test.dev`);
  created.push(u.id);
  await prisma.profile.create({ data: { userId: u.id, name: "Weight Tester", birthDate: new Date("1990-01-01T00:00:00Z"), timezone: "UTC", unitSystem: "METRIC", ...profile } });
  const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "UTC" }));
  await ctx.addCookies([{ name: "fit_session", value: token, url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => { if (!/_rsc.*access control checks/.test(e.message)) problems.push(e.message); });
  page.on("console", (m) => { if (m.type() === "error" && !/status of 40[04]|_rsc.*access control checks/.test(m.text())) problems.push(m.text()); });
  return { u, ctx, page, problems };
}
const settled = (page) => page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
const count = (page, text) => page.getByText(text, { exact: false }).count();

async function inBrowser(name) {
  const step = (s) => console.log(`✓ [${name}] ${s}`);
  const browser = await playwright[name].launch(target.launchOptions(name));

  const empty = await user(browser, `empty${name}`, {});
  await empty.page.goto(`${BASE}/dashboard`);
  await settled(empty.page);
  assert.equal(await count(empty.page, "Choosing a goal is optional"), 1, "no goal asks for one");
  await empty.page.goto(`${BASE}/progress/weight`);
  await settled(empty.page);
  assert.equal(await count(empty.page, "No weight logged yet"), 1, "the empty state");
  step("no goal and no entries each have their own empty state");

  const { page, problems, u, ctx } = await user(browser, `loss${name}`, { goal: "FAT_LOSS", goalWeightKg: 70 });
  await page.goto(`${BASE}/progress/weight`);
  await settled(page);
  await page.getByLabel("Weight (kg)").fill("80");
  await page.getByRole("button", { name: "Save weight" }).click();
  await page.getByRole("button", { name: /^Delete the entry for/ }).waitFor({ timeout: 8000 });
  assert.equal(await prisma.bodyMetric.count({ where: { userId: u.id } }), 1);
  assert.equal(await page.getByText("Trend 80 kg").count(), 0, "one entry isn't called a trend");
  step("an entry can be logged, and one entry isn't called a trend");

  assert.equal(await count(page, "You logged 80 kg on this date. Saving replaces it."), 1, "replacing is stated before it happens");
  await page.getByLabel("Weight (kg)").fill("81");
  await page.getByRole("button", { name: "Replace entry" }).click();
  await page.getByText("You logged 81 kg on this date.").waitFor({ timeout: 8000 });
  assert.equal((await prisma.bodyMetric.findMany({ where: { userId: u.id } })).map((r) => r.value).join(), "81");
  step("logging a date again says it replaces, and does");

  await page.getByLabel("Weight (kg)").fill("20");
  await page.getByRole("button", { name: "Replace entry" }).click();
  await page.getByText("Enter a weight between 30 and 300 kg.").waitFor({ timeout: 8000 });
  assert.equal(await prisma.bodyMetric.count({ where: { userId: u.id } }), 1, "and an out-of-range one isn't");
  step("an out-of-range weight is refused");

  await page.goto(`${BASE}/dashboard`);
  await settled(page);
  assert.equal(await count(page, "above your goal weight of 70 kg"), 1, "the card compares the trend with the goal");
  step("the dashboard card shows the trend against the goal, in plain words");

  await page.goto(`${BASE}/progress/weight`);
  await settled(page);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /^Delete the entry for/ }).click();
  await page.getByText("No weight logged yet").waitFor({ timeout: 8000 });
  assert.equal(await prisma.bodyMetric.count({ where: { userId: u.id } }), 0);
  step("an entry can be deleted");

  await page.goto(`${BASE}/profile`);
  await settled(page);
  const fatLoss = page.getByRole("button", { name: "Fat loss", exact: true });
  const strength = page.getByRole("button", { name: "Strength", exact: true });
  const saveProfile = page.getByRole("button", { name: "Save changes" });
  assert.equal(await fatLoss.getAttribute("aria-pressed"), "true", "a goal shows as chosen");
  await strength.click();
  await saveProfile.click();
  await page.getByText("Saved.").waitFor({ timeout: 8000 });
  assert.equal((await prisma.profile.findUnique({ where: { userId: u.id } })).goal, "STRENGTH", "a goal can be changed");
  await strength.click();
  await saveProfile.click();
  for (let i = 0; i < 40 && (await prisma.profile.findUnique({ where: { userId: u.id } })).goal !== null; i++) await page.waitForTimeout(100);
  await page.reload();
  await settled(page);
  assert.equal(await strength.getAttribute("aria-pressed"), "false", "and cleared");
  assert.equal((await prisma.profile.findUnique({ where: { userId: u.id } })).goal, null);
  step("the goal can be seen, changed and cleared on the profile");

  const imperial = await user(browser, `lb${name}`, { unitSystem: "IMPERIAL", goal: "MAINTENANCE" });
  await prisma.bodyMetric.createMany({ data: [{ userId: imperial.u.id, kind: "WEIGHT", date: new Date("2026-01-01T00:00:00Z"), value: 80 }, { userId: imperial.u.id, kind: "WEIGHT", date: new Date("2026-01-15T00:00:00Z"), value: 80 }] });
  await imperial.page.goto(`${BASE}/progress/weight`);
  await settled(imperial.page);
  assert.ok(await imperial.page.getByText("176.4 lb").count() > 0, "pounds, in pounds");
  assert.equal(await imperial.page.getByText(/\d kg/).count(), 0);
  step("imperial accounts read pounds");

  assert.deepEqual([...problems, ...empty.problems, ...imperial.problems], [], "no page error or CSP violation");
  step("no page error or CSP violation");
  await ctx.close(); await empty.ctx.close(); await imperial.ctx.close();
  await browser.close();
}

async function cleanUp() {
  await prisma.bodyMetric.deleteMany({ where: { userId: { in: created } } });
  await prisma.session.deleteMany({ where: { userId: { in: created } } });
  await prisma.profile.deleteMany({ where: { userId: { in: created } } });
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
}

(async () => {
  await target.verifyServer();
  for (const name of ["chromium", "firefox", "webkit"]) await inBrowser(name);
  await cleanUp();
  console.log("ALL WEIGHT CHECKS PASSED");
})().catch(async (e) => { console.error(e); await cleanUp().catch(() => {}); process.exit(1); });
