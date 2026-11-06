// Phase 4.0.2 in real browsers: downloading and deleting an account, from each place a person can be.
//   BASE_URL=http://localhost:3000 DATABASE_URL=<local test database> node scripts/e2e-account-data.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const playwright = require("playwright");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser } = require("./lib/test-users.cjs");
const { fillProfile } = require("./lib/e2e-onboarding.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const BROWSERS = ["chromium", "firefox", "webkit"];
const PASSWORD = "correct horse battery staple";
let counter = 0;

const dbDate = (iso) => new Date(`${iso}T00:00:00Z`);
const yearsAgo = (n) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - n); return d.toISOString().slice(0, 10); };
const adult = { name: "Row", birthDate: dbDate("1990-01-01"), unitSystem: "METRIC", timezone: "UTC" };

async function signedIn(ctx, profile) {
  const email = `acctui${++counter}x${Date.now()}@test.dev`;
  const { user, token } = await createSignedInUser(prisma, email, { password: PASSWORD });
  if (profile) await prisma.profile.create({ data: { userId: user.id, ...profile } });
  await ctx.addCookies([{ name: "fit_session", value: token, url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
  return { user, email };
}
const hydrated = async (page, locator) => {
  await locator.waitFor();
  await page.waitForFunction(() => document.readyState === "complete");
  await page.waitForTimeout(300);
};
const exists = (id) => prisma.user.count({ where: { id } });

async function inBrowser(name) {
  const browser = await playwright[name].launch(target.launchOptions(name));
  const errors = [];
  const step = (s) => console.log(`✓ [${name}] ${s}`);
  const newPage = async () => {
    const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true }));
    const page = await ctx.newPage();
    page.on("pageerror", (e) => {
      if (name === "webkit" && /[?&]_rsc=\S* due to access control checks/.test(e.message)) return;
      errors.push(`${name}: ${e.message}`);
    });
    const posts = [];
    page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/account/")) posts.push(new URL(r.url()).pathname); });
    return { ctx, page, posts };
  };
  const openExport = async (page) => {
    const open = page.getByRole("button", { name: "Download my data" });
    await hydrated(page, open);
    await open.click();
    return page.getByRole("dialog", { name: "Download your data" });
  };
  const openDelete = async (page) => {
    const open = page.getByRole("button", { name: "Delete my account" });
    await hydrated(page, open);
    await open.click();
    return page.getByRole("dialog", { name: "Delete your account?" });
  };
  const download = async (page, dialog) => {
    await dialog.getByLabel("Password").fill(PASSWORD);
    const [file] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Download", exact: true }).click()]);
    assert.match(file.suggestedFilename(), /^fitworkoutfoodtracker-export-\d{4}-\d{2}-\d{2}\.json$/);
    return JSON.parse(fs.readFileSync(await file.path(), "utf8"));
  };
  const deleteIn = async (page, dialog) => {
    await dialog.getByLabel("Password").fill(PASSWORD);
    await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
    await dialog.getByRole("button", { name: "Permanently delete my account" }).click();
    await page.waitForURL("**/account-deleted");
    await page.getByRole("heading", { name: "Your account has been deleted" }).waitFor();
  };

  // ─── An eligible account: from the profile page ───────────────────────────
  {
    const { ctx, page, posts } = await newPage();
    const { user, email } = await signedIn(ctx, adult);
    await page.goto(`${BASE}/profile`);
    await page.getByRole("link", { name: "Download or delete my data" }).click();
    await page.waitForURL("**/account");

    const exporting = await openExport(page);
    await exporting.getByRole("button", { name: "Download", exact: true }).click();
    await page.waitForTimeout(300);
    assert.deepEqual(posts, [], "nothing is sent without a password");
    await exporting.getByText("Enter your password.").waitFor();
    await exporting.getByLabel("Password").fill("not the password");
    await exporting.getByRole("button", { name: "Download", exact: true }).click();
    await exporting.getByText("That password isn't right.").waitFor();
    assert.equal(page.url().includes("password"), false);
    const doc = await download(page, exporting);
    assert.equal(doc.format, "fitworkoutfoodtracker-export");
    assert.equal(doc.account.email, email);
    assert.equal(doc.profile.sex, null, "a null stays null in the file");
    await page.getByText("Your download has started.").waitFor();
    assert.equal(await page.getByRole("dialog").count(), 0, "the sheet closes");
    step("download: a wrong password is refused, and the right one saves a whole file");

    posts.length = 0;
    const del = await openDelete(page);
    await del.getByText("This is permanent, and can't be undone.").waitFor();
    await del.getByText(/food log, custom foods and nutrition targets/).waitFor();
    const refusedWith = async (message) => {
      await del.getByRole("button", { name: "Permanently delete my account" }).click();
      await page.waitForTimeout(300);
      assert.deepEqual(posts, [], "nothing is sent without both");
      await del.getByText(message).waitFor();
    };
    await refusedWith("Enter your password.");
    await del.getByLabel("Password").fill(PASSWORD);
    await refusedWith("Type DELETE to confirm.");
    await del.getByLabel("Type DELETE to confirm").fill("delete");
    await refusedWith("Type DELETE to confirm.");
    await del.getByRole("button", { name: "Cancel" }).click();
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.deepEqual(posts, [], "cancelling sends nothing");
    assert.equal(await exists(user.id), 1);
    step("delete: a warning, a password and the word are all required, and cancelling sends nothing");

    const again = await openDelete(page);
    assert.equal(await again.getByLabel("Password").inputValue(), "", "the password isn't kept");
    await again.getByLabel("Password").fill("not the password");
    await again.getByLabel("Type DELETE to confirm").fill("DELETE");
    await again.getByRole("button", { name: "Permanently delete my account" }).click();
    await again.getByText("That password isn't right.").waitFor();
    assert.equal(await exists(user.id), 1, "a wrong password deletes nothing");
    await deleteIn(page, again);
    assert.equal(await exists(user.id), 0);
    assert.equal(await page.getByText(email).count(), 0, "the public page names nobody");
    assert.equal((await ctx.cookies(BASE)).some((c) => c.name === "fit_session"), false, "signed out");
    await page.goto(`${BASE}/dashboard`);
    await page.waitForURL("**/login");
    await page.goto(`${BASE}/account`);
    await page.waitForURL("**/login");
    await page.goto(`${BASE}/account-deleted`);
    await page.getByRole("heading", { name: "Your account has been deleted" }).waitFor();
    step("delete: the account goes, the session ends, and the app is closed");
    await ctx.close();
  }

  // ─── A person with no profile, from onboarding ────────────────────────────
  {
    const { ctx, page } = await newPage();
    const { user, email } = await signedIn(ctx);
    await page.goto(`${BASE}/onboarding`);
    await page.getByRole("link", { name: "Download or delete your data" }).click();
    await page.waitForURL("**/account");
    const doc = await download(page, await openExport(page));
    assert.equal(doc.account.email, email);
    assert.equal(doc.profile, null);
    await page.getByRole("link", { name: "Back" }).click();
    await page.waitForURL("**/onboarding");
    step("no profile: can reach the page, and download");

    await hydrated(page, page.getByRole("radio", { name: "kg / cm" }));
    await fillProfile(page, { birthDate: yearsAgo(17) });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Yes, that's right" }).click();
    await page.getByRole("heading", { name: "We can't set up an account with that date of birth." }).waitFor();
    await page.getByRole("link", { name: "Delete this account" }).click();
    await page.waitForURL("**/account");
    await deleteIn(page, await openDelete(page));
    assert.equal(await exists(user.id), 0);
    step("refused at sign-up: can leave from the refusal screen");
    await ctx.close();
  }

  // ─── A restricted account ─────────────────────────────────────────────────
  {
    const { ctx, page } = await newPage();
    const { user } = await signedIn(ctx, { ...adult, birthDate: dbDate(yearsAgo(17)) });
    await page.goto(`${BASE}/dashboard`);
    await page.waitForURL("**/account-restricted");
    await page.getByRole("link", { name: "Download or delete your data" }).click();
    await page.waitForURL("**/account");
    const doc = await download(page, await openExport(page));
    assert.equal(doc.profile.name, "Row");
    await page.goto(`${BASE}/dashboard`);
    await page.waitForURL("**/account-restricted");
    await page.goto(`${BASE}/account`);
    await deleteIn(page, await openDelete(page));
    assert.equal(await exists(user.id), 0);
    step("restricted: can download and leave, and stays restricted elsewhere");
    await ctx.close();
  }

  assert.deepEqual(errors, [], "no page errors");
  await browser.close();
}

(async () => {
  await target.verifyServer();
  for (const name of BROWSERS) await inBrowser(name);
  await prisma.$disconnect();
  console.log("ALL ACCOUNT DATA CHECKS PASSED");
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
