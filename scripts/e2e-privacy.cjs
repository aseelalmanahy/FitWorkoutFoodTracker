// The public pages and the acceptance box, in each browser, one at a time. Through the guarded runner.
// Stored acceptance is checked by privacy-consent. This covers what a person sees and can reach by keyboard.
//
// Whatever happens, this removes what it made: the tokens and accounts at the exact addresses this run used, and nothing
// else. That's checked, by forcing each failure, in e2e-privacy-cleanup.test.cjs, which is what the E2E_PRIVACY_ settings are for.
// A process killed outright can't clean up after itself, so the run has its own deadline, shorter than the runner's. Closing
// the browsers and cleaning up each have a limit too, so that neither can use up the time before the runner's.
const assert = require("node:assert/strict");
const { inspect } = require("node:util");
const { randomBytes, createHash } = require("node:crypto");
const playwright = require("playwright");
const { PrismaClient } = require("@prisma/client");
const { NOTICE_VERSION } = require("./lib/signup.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = process.env.E2E_PRIVACY_RUN ?? String(Date.now());
if (!/^\d+$/.test(run)) throw new Error("E2E_PRIVACY_RUN must be digits, as it becomes part of an address");
const PASSWORD = "correct horse battery staple";
const BROWSERS = (process.env.E2E_PRIVACY_BROWSERS ?? "chromium,firefox,webkit").split(",");
const FAIL_AT = process.env.E2E_PRIVACY_FAIL_AT ?? "";
const ALL_BROWSERS = 3;
const DEADLINE_MS = 540_000; // The runner ends this at 590 seconds.
const CLOSE_LIMIT_MS = FAIL_AT === "close-hangs" ? 500 : 15_000;
const CLEANUP_LIMIT_MS = 30_000;
const SETTLE_MS = 1_000;
const created = [];
const browsers = [];
let stopping = false;
let expire = () => {};
let timer = null;
const deadlineIn = (ms) => { clearTimeout(timer); timer = setTimeout(() => expire(new Error(`ran past its deadline of ${ms} ms`)), ms); };

/** Only for the cleanup test. Reports what exists at that point, so the test knows there was something to remove. */
async function injected(point) {
  if (FAIL_AT !== point && FAIL_AT !== `hang-${point}` && !(FAIL_AT === "close-hangs" && point === "after-account")) return;
  const [tokens, users] = await Promise.all([prisma.accountToken.count({ where: { email: { in: created } } }), prisma.user.count({ where: { email: { in: created } } })]);
  console.log(`injected at ${point}: tokens=${tokens} users=${users}`);
  if (FAIL_AT === point || (FAIL_AT === "close-hangs" && point === "after-account")) throw new Error(`injected failure at ${point}`);
  deadlineIn(500);
  await new Promise(() => {});
}

/**
 * By exact address, and refuses to say it's done if anything is left. A failed run may have work still arriving at the
 * database, which ending the browsers doesn't stop, so that goes through a second time after a pause.
 */
async function removeThisRun(failed) {
  if (FAIL_AT === "cleanup") throw new Error("injected failure in cleanup");
  if (!created.length) return;
  const mine = { email: { in: created } };
  const remove = async () => {
    await prisma.accountToken.deleteMany({ where: mine });
    await prisma.user.deleteMany({ where: mine });
  };
  await remove();
  if (failed) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    await remove();
  }
  const left = (await prisma.accountToken.count({ where: mine })) + (await prisma.user.count({ where: mine }));
  if (left) throw new Error(`${left} row(s) from this run were still there after cleanup`);
}

/** A failure can quote the page's address, and a token in it is a credential. */
const printable = (e) => inspect(e).replace(/#token=[A-Za-z0-9_-]+/g, "#token=<hidden>");

async function mint(address) {
  if (stopping) throw new Error("the run has ended");
  const token = randomBytes(32).toString("base64url");
  created.push(address);
  await prisma.accountToken.create({ data: { id: createHash("sha256").update(token).digest("hex"), purpose: "SIGNUP", email: address, expiresAt: new Date(Date.now() + 3_600_000) } });
  return token;
}

async function inBrowser(name) {
  const step = (s) => console.log(`✓ [${name}] ${s}`);
  const browser = await playwright[name].launch(target.launchOptions(name));
  browsers.push(browser);
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
  if (FAIL_AT === "quoting-token") throw new Error(`navigating to ${BASE}/register/complete#token=${token}`);
  if (FAIL_AT === "late-row") {
    // Stands in for a sign-up still being written when the run gave up.
    setTimeout(() => prisma.accountToken.create({ data: { id: createHash("sha256").update(`${token}late`).digest("hex"), purpose: "SIGNUP", email: address, expiresAt: new Date(Date.now() + 3_600_000) } }), 300);
    throw new Error("injected failure before a late row");
  }
  await page.goto(`${BASE}/register/complete#token=${token}`);
  const box = page.locator("input[name=accept]");
  await box.waitFor();
  assert.equal(await box.isChecked(), false, "the box starts unticked");
  await page.waitForFunction(() => location.hash === "");
  step("the box starts unticked");
  await injected("after-token");

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
  await injected("after-account");

  await settled();
  assert.deepEqual(problems, [], "no page error or CSP violation");
  step("no page error or CSP violation");
  await ctx.close();
  await browser.close();
}

async function checks() {
  for (const name of BROWSERS) await inBrowser(name);
}

(async () => {
  await target.verifyServer(); // Nothing has been made yet, so a refusal here has nothing to clean up.
  let failed = false;
  const fail = (label, e) => { failed = true; console.error(label, printable(e)); };
  // Ctrl-C, or a polite request to stop, goes through the same cleanup. Windows can't deliver SIGTERM, and a forced kill can't be caught.
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => expire(new Error(`interrupted by ${signal}`)));
  try {
    await Promise.race([checks(), new Promise((_, reject) => { expire = reject; deadlineIn(DEADLINE_MS); })]);
  } catch (e) { fail("FAILED:", e); }
  clearTimeout(timer);
  stopping = true;
  // Closing a browser that's stuck mustn't stop the cleanup. If cleanup is what's stuck, this says so rather than hanging.
  const stuck = setTimeout(() => { console.error("CLEANUP FAILED: it didn't finish in time, so rows may remain"); process.exit(1); }, CLOSE_LIMIT_MS + CLEANUP_LIMIT_MS);
  const closing = FAIL_AT === "close-hangs" ? new Promise(() => {}) : Promise.allSettled(browsers.map((b) => b.close()));
  await Promise.race([closing, new Promise((resolve) => setTimeout(resolve, CLOSE_LIMIT_MS))]);
  console.log(`browsers left open: ${browsers.filter((b) => b.isConnected()).length}`);
  try { await removeThisRun(failed); } catch (e) { fail("CLEANUP FAILED:", e); }
  clearTimeout(stuck);
  await prisma.$disconnect().catch((e) => fail("DISCONNECT FAILED:", e));
  if (failed) process.exit(1);
  // A setting left over from the cleanup test can't pass for a full run.
  console.log(BROWSERS.length === ALL_BROWSERS ? "ALL PRIVACY CHECKS PASSED" : `PRIVACY CHECKS PASSED IN ONLY ${BROWSERS.join(", ")}, WHICH ISN'T A FULL RUN`);
  process.exit(0); // A check still waiting on a browser that's gone has nothing left to do.
})().catch(async (e) => { console.error(printable(e)); await prisma.$disconnect().catch(() => {}); process.exit(1); });
