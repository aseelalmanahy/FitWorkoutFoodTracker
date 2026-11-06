// End-to-end test of reading PDFs in real browsers, through the real server, with no paid requests:
// the app must run with ANTHROPIC_BASE_URL pointing at scripts/stub-label-provider.cjs and a non-real key.
// Usage: BASE_URL=... DATABASE_URL=<local test database> LABEL_STUB_URL=... SHOTS_DIR=... node scripts/e2e-label-pdf.cjs
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");
const sharp = require("sharp");
const { fixtures } = require("./lib/pdf-fixtures.cjs");

const target = require("./lib/test-target-guard.cjs").requireSafeTarget({ labelStub: true });
const BASE = target.baseUrl;
const STUB = target.stubUrl;
const SHOTS = (process.env.SHOTS_DIR || require("node:os").tmpdir()) + "/";
const BROWSERS = (process.env.BROWSERS || "chromium,firefox,webkit").split(",");
const step = (s) => console.log("  ✓", s);
const stub = {
  scenario: (name) => fetch(`${STUB}/__scenario`, { method: "POST", body: JSON.stringify({ name }) }),
  reset: () => fetch(`${STUB}/__reset`, { method: "POST" }),
  requests: () => fetch(`${STUB}/__requests`).then((r) => r.json()),
};
const pdfFile = (name, buffer) => ({ name, mimeType: "application/pdf", buffer });

async function signUp(page) {
  const email = `pdf${Date.now()}${Math.floor(Math.random() * 1e6)}@test.dev`;
  if (page.context().browser().browserType().name() === "webkit") {
    // WebKit refuses Secure cookies over http://localhost, which isn't a problem over HTTPS in production.
    const reg = await fetch(`${BASE}/api/auth/register`, { method: "POST", headers: { Origin: BASE, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "correct horse battery" }) });
    assert.equal(reg.ok, true);
    const [name, value] = reg.headers.getSetCookie().find((c) => c.startsWith("fit_session=")).split(";")[0].split("=");
    await page.context().addCookies([{ name, value, url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
    await page.goto(`${BASE}/onboarding`);
  } else {
    await page.goto(`${BASE}/register`);
    await page.fill("input[name=email]", email);
    await page.fill("input[name=password]", "correct horse battery");
    await page.click("button[type=submit]");
    await page.waitForURL("**/onboarding");
  }
  await page.getByRole("radio", { name: "kg / cm" }).click();
  await page.getByLabel("Name").fill("Sam");
  await page.getByLabel("Date of birth").fill("1990-01-01");
  await page.getByLabel("Height (cm)").fill("180");
  await page.getByLabel("Current weight (kg)").fill("80");
  await page.getByRole("button", { name: "Maintenance" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL("**/dashboard");
}

async function corners(bytes) {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const name = (x, y) => {
    const i = (y * info.width + x) * 3;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]].map((v) => v > 128);
    return r && g && b ? "white" : r ? "red" : g ? "green" : b ? "blue" : "other";
  };
  const m = 20;
  return { width: info.width, height: info.height, tl: name(m, m), tr: name(info.width - m, m), bl: name(m, info.height - m), br: name(info.width - m, info.height - m) };
}

async function runBrowser(name, jpeg) {
  console.log(`--- ${name}`);
  const browser = await playwright[name].launch(target.launchOptions(name));
  const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 390, height: 844 } }));
  const page = await ctx.newPage();
  const errors = [], requests = [], dialogs = [], consoleText = [];
  page.on("console", (m) => consoleText.push(m.text()));
  page.on("pageerror", (e) => {
    if (name === "webkit" && /\?_rsc=\S* due to access control checks/.test(e.message)) return;
    errors.push(e.message);
  });
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
  page.on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
  // Playwright can't see a blob's bytes in a request, so they're recorded in the page as they're sent.
  await page.addInitScript(() => {
    const original = window.fetch;
    window.__sent = [];
    window.fetch = function (input, init) {
      const body = init && init.body;
      const entry = { url: String(input && input.url ? input.url : input), head: null };
      if (body instanceof Blob) {
        entry.size = body.size;
        window.__sent.push(entry);
        return body.slice(0, 5).text().then((head) => { entry.head = head; return original.call(window, input, init); });
      }
      if (init && init.method && init.method !== "GET") {
        entry.head = String(body ?? "").slice(0, 5);
        window.__sent.push(entry);
      }
      return original.call(window, input, init);
    };
  });
  // Uploads are counted across page loads, when they're attempted rather than when they arrive.
  const scanRequests = () => requests.filter((r) => r.method === "POST" && new URL(r.url).pathname === "/api/nutrition/label-scans").length;
  const sentOnThisPage = () => page.evaluate(() => window.__sent);
  const assertNoPdfSent = async () => {
    for (const entry of await sentOnThisPage()) assert.notEqual(entry.head, "%PDF-", `a PDF was sent to ${entry.url}`);
  };
  await signUp(page);
  await stub.reset();

  const open = async (file) => {
    await page.goto(`${BASE}/nutrition/scan`);
    await page.locator("#label-photo").waitFor();
    await page.locator("#label-photo").setInputFiles(file);
  };
  const openPages = async (file) => { await open(file); await page.getByTestId("pdf-pages").waitFor(); };
  const choosePage = async (n) => { await page.getByTestId(`pdf-page-${n}`).click(); await page.getByTestId("pdf-page-image").waitFor(); };
  const input = (id) => page.getByTestId(`input-${id}`);
  const useSection = async (i = 0) => { await page.getByTestId(`use-section-${i}`).click(); await page.getByTestId("scan-result").waitFor(); };
  const blockers = () => page.getByTestId("save-blockers").innerText();
  const foods = () => page.evaluate(() => fetch("/api/foods").then((r) => r.json()).then((b) => b.foods));
  const diary = () => page.evaluate(() => fetch("/api/nutrition/day").then((r) => r.json()).then((d) => d.meals.flatMap((m) => m.entries).length));
  const refuses = async (file, message) => { await open(file); await page.getByText(message).waitFor(); assert.equal(await page.getByTestId("pdf-pages").count(), 0); };
  let saved = 0;

  // 1. A text PDF goes straight to the Phase 3.3 review, with no AI, and saves after confirming.
  await openPages(pdfFile("oats.pdf", fixtures.usLabel()));
  assert.equal(await page.getByTestId("pdf-page-1").getAttribute("data-kind"), "labels");
  await page.waitForTimeout(500);
  assert.equal(await page.getByTestId("pdf-page-image").count(), 0, "no page is drawn until chosen");
  await assertNoPdfSent();
  await choosePage(1);
  await useSection();
  assert.match(await page.getByTestId("pdf-source").innerText(), /From page 1 of 1 of oats\.pdf/);
  assert.match(await page.getByTestId("scan-result").innerText(), /Unverified/);
  assert.equal(await input("kcal").inputValue(), "120");
  assert.equal(await input("fat").inputValue(), "2.5");
  assert.equal(await input("fiber").inputValue(), "3");
  assert.equal(await input("serving-amount").inputValue(), "30");
  assert.equal(await input("name").inputValue(), "", "a product name isn't guessed");
  assert.ok(await page.getByTestId("review-image").evaluate(async (img) => { await img.decode(); return img.naturalWidth > 500; }), "the page stays beside the values");
  await page.waitForTimeout(300);
  assert.equal(scanRequests(), 0, "reading text sends nothing to be scanned");
  assert.equal((await stub.requests()).length, 0, "reading text uses no AI");
  await assertNoPdfSent();
  assert.equal(await page.getByTestId("save-food").isDisabled(), true);
  assert.match(await blockers(), /Enter the product name/);
  await input("name").fill("Rolled Oats");
  await input("protein").fill("4.5");
  assert.equal(await page.getByTestId("origin-protein").getAttribute("data-origin"), "corrected");
  await page.getByTestId("confirm-values").check();
  await page.getByTestId("save-food").click();
  await page.getByTestId("saved-food").waitFor();
  saved++;
  assert.equal(await page.getByTestId("saved-per100-kcal").innerText(), "400 kcal");
  assert.equal(await page.getByTestId("saved-per100-protein").innerText(), "15 g");
  assert.equal((await foods()).length, saved);
  assert.equal(await diary(), 0, "saving logs nothing");
  await page.screenshot({ path: `${SHOTS}pdf-${name}-saved.png`, fullPage: true });
  step("text PDF: read with no AI, shown beside the page, corrected, confirmed and saved, with nothing logged");

  // 2. Separate columns stay separate.
  await openPages(pdfFile("eu.pdf", fixtures.euLabel()));
  await choosePage(1);
  await useSection();
  assert.equal(await input("kcal").inputValue(), "400");
  await page.getByRole("radio", { name: /Per serving/ }).check();
  assert.equal(await input("kcal").inputValue(), "120");
  await page.getByRole("radio", { name: /Per 100 g/ }).check();
  assert.match(await page.getByTestId("other-columns").innerText(), /502 kJ \/ 120 kcal/);
  step("EU label: per-100 g and per-serving columns stay separate");

  // 3. Only the relevant page is used, and labels are never combined.
  await openPages(pdfFile("catalogue.pdf", fixtures.multiPage()));
  assert.deepEqual(await Promise.all([1, 2, 3, 4, 5].map((n) => page.getByTestId(`pdf-page-${n}`).getAttribute("data-kind"))), ["text", "text", "labels", "labels", "text"]);
  await choosePage(1);
  assert.equal(await page.getByTestId("use-section-0").count(), 0, "marketing text offers nothing to read");
  await choosePage(4);
  await page.screenshot({ path: `${SHOTS}pdf-${name}-pages.png`, fullPage: true });
  await useSection();
  assert.equal(await input("kcal").inputValue(), "150");
  assert.match(await page.getByTestId("pdf-source").innerText(), /From page 4 of 5/);
  await page.getByRole("button", { name: "Choose another page" }).click();
  await choosePage(3);
  await useSection();
  assert.equal(await input("kcal").inputValue(), "120");
  assert.match(await page.getByTestId("pdf-source").innerText(), /From page 3 of 5/);
  step("several pages: each is chosen and read alone, and the page number stays visible");

  await openPages(pdfFile("two.pdf", fixtures.twoLabelsOnePage()));
  await choosePage(1);
  await page.getByTestId("use-section-1").waitFor();
  await useSection(1);
  assert.equal(await input("kcal").inputValue(), "150");
  assert.equal(await input("fat").inputValue(), "1");
  assert.equal(await input("fiber").inputValue(), "", "not borrowed from the other label, which has 3 g");
  assert.equal(await page.getByTestId("origin-fiber").getAttribute("data-origin"), "missing");
  step("two labels on a page: each is its own choice, and values are never borrowed");

  await openPages(pdfFile("side.pdf", fixtures.sideBySide()));
  assert.equal(await page.getByTestId("pdf-page-1").getAttribute("data-kind"), "ambiguous");
  await choosePage(1);
  assert.equal(await page.getByTestId("use-section-0").count(), 0, "labels side by side aren't read from text");
  await page.getByTestId("use-page-image").click();
  await page.getByTestId("crop-area").waitFor();
  step("labels side by side: text isn't trusted, and the person crops the page instead");

  // 4. A scanned page becomes an image, and takes the same path as a photo.
  await stub.reset();
  await openPages(pdfFile("scan.pdf", fixtures.scanned(jpeg, 800, 1000)));
  assert.equal(await page.getByTestId("pdf-page-1").getAttribute("data-kind"), "scanned");
  await choosePage(1);
  await page.getByTestId("use-page-image").click();
  await page.getByTestId("crop-area").waitFor();
  assert.match(await page.getByTestId("pdf-source").innerText(), /From page 1 of 1/);
  assert.equal((await stub.requests()).length, 0, "nothing is sent until asked");
  const scansBefore = scanRequests();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("prepared-image").waitFor();
  await page.getByRole("button", { name: "Use this" }).click();
  await page.getByTestId("scan-result").waitFor();
  let sent = await stub.requests();
  assert.equal(sent.length, 1, "exactly one paid request, with no retry");
  assert.equal(scanRequests(), scansBefore + 1, "exactly one upload");
  const uploads = (await sentOnThisPage()).filter((e) => /label-scans/.test(e.url));
  assert.equal(uploads.length, 1);
  assert.ok(uploads[0].size < 7 * 1024 * 1024, "the upload is the image, within the image limit");
  await assertNoPdfSent();
  const source = sent[0].body.messages[0].content[0].source;
  const image = Buffer.from(source.data, "base64");
  assert.notEqual(image.subarray(0, 5).toString("latin1"), "%PDF-", "the provider never gets a PDF");
  assert.match(source.media_type, /^image\/(png|jpeg)$/);
  const seen = await corners(image);
  assert.deepEqual([seen.tl, seen.tr, seen.bl, seen.br], ["red", "green", "blue", "white"]);
  assert.ok(Math.max(seen.width, seen.height) <= 2576);
  assert.match(await page.getByTestId("scan-result").innerText(), /Unverified/);
  assert.equal(await input("name").inputValue(), "Rolled Oats");
  step(`scanned page: rendered and sent as a ${seen.width} x ${seen.height} image, once, through the photo path`);

  // 5. Choosing part of a page sends only that part.
  await stub.reset();
  await openPages(pdfFile("scan.pdf", fixtures.scanned(jpeg, 800, 1000)));
  await choosePage(1);
  await page.getByTestId("use-page-image").click();
  const area = page.getByTestId("crop-area");
  await area.waitFor();
  await area.scrollIntoViewIfNeeded();
  const box = await area.boundingBox();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.95, box.y + box.height * 0.95, { steps: 4 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("prepared-image").waitFor();
  await page.getByRole("button", { name: "Use this" }).click();
  await page.getByTestId("scan-result").waitFor();
  sent = await stub.requests();
  const cropped = await corners(Buffer.from(sent[0].body.messages[0].content[0].source.data, "base64"));
  assert.deepEqual([cropped.tl, cropped.tr, cropped.bl, cropped.br], ["white", "white", "white", "white"], "only the chosen area of the page");
  step("crop of a PDF page: only the chosen area reaches the provider");

  // 6. Missing values, zero, conflicts and household servings use the same review.
  await openPages(pdfFile("missing.pdf", fixtures.missingFields()));
  await choosePage(1);
  await useSection();
  assert.equal(await input("fat").inputValue(), "");
  assert.equal(await page.getByTestId("origin-fat").getAttribute("data-origin"), "missing");
  assert.match(await blockers(), /Fat isn't on the label/);
  assert.match(await blockers(), /Carbohydrate isn't on the label/);
  await input("name").fill("Sparse");
  await input("fat").fill("0");
  await input("carbs").fill("0");
  assert.equal(await page.getByTestId("origin-fat").getAttribute("data-origin"), "entered");
  await page.getByTestId("confirm-values").check();
  if (await page.getByTestId("confirm-warnings").count()) await page.getByTestId("confirm-warnings").check();
  await page.getByTestId("save-food").click();
  await page.getByTestId("saved-food").waitFor();
  saved++;
  assert.equal(await page.getByTestId("saved-per100-fat").innerText(), "0 g");
  step("missing nutrients stay empty and block saving, and a typed 0 is the person's own");

  await openPages(pdfFile("conflict.pdf", fixtures.contradictory()));
  await choosePage(1);
  await useSection();
  await page.getByRole("radio", { name: /Per serving/ }).check();
  assert.match(await page.getByTestId("scan-flags").innerText(), /per-100 column suggests/);
  await input("name").fill("Conflict");
  await page.getByTestId("confirm-values").check();
  assert.equal(await page.getByTestId("save-food").isDisabled(), true, "conflicts aren't accepted automatically");
  await input("protein").fill("4");
  assert.equal(await page.getByTestId("scan-flags").count(), 0, "a correction clears it");
  step("contradictory columns need attention, and a correction clears them");

  await openPages(pdfFile("cup.pdf", fixtures.householdServing()));
  await choosePage(1);
  await useSection();
  assert.equal(await input("serving-amount").inputValue(), "");
  assert.match(await blockers(), /"1 cup"/);
  step("a household serving still needs its weight confirmed");

  // 7. Text in a PDF can't do anything.
  await openPages(pdfFile("injection.pdf", fixtures.injection()));
  await choosePage(1);
  await useSection();
  assert.equal(await input("kcal").inputValue(), "120", "instructions change nothing");
  assert.doesNotMatch(await page.getByTestId("scan-result").innerText(), /Ignore|SYSTEM/);
  await page.getByRole("button", { name: "Choose another page" }).click();
  assert.equal(await page.getByTestId("pdf-pages").locator("img[src=x], script").count(), 0, "text is shown as text");
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  step("prompt-injection text and markup in a PDF are inert");

  // 8. Scripts, actions, links and attachments do nothing, even when the page is drawn.
  const before = requests.length;
  await openPages(pdfFile("active.pdf", fixtures.active()));
  await choosePage(1);
  await page.waitForTimeout(300);
  assert.deepEqual(dialogs, [], "no document script ran");
  const during = requests.slice(before);
  assert.deepEqual(during.filter((r) => /evil\.example/.test(r.url)), [], "nothing was fetched from the document");
  assert.equal(await page.locator('a[href*="evil"]').count(), 0, "no link was made active");
  await page.getByTestId("pdf-page-image").click();
  await page.waitForTimeout(100);
  assert.equal(new URL(page.url()).pathname, "/nutrition/scan");
  await openPages(pdfFile("remote.pdf", fixtures.remoteReferences()));
  await choosePage(1);
  assert.deepEqual(requests.slice(before).filter((r) => !r.url.startsWith(BASE) && !r.url.startsWith("blob:") && !r.url.startsWith("data:")), [], "every request stayed on this site");
  step("scripts, actions, links, attachments and remote references did nothing");

  // 9. Refusals.
  const encrypted = /encrypted or password-protected/;
  for (const [label, file, message] of [
    ["encrypted", pdfFile("locked.pdf", fixtures.encryptedPassword()), encrypted],
    ["encrypted with an empty password", pdfFile("locked.pdf", fixtures.encryptedEmptyPassword()), encrypted],
    ["corrupted", pdfFile("bad.pdf", fixtures.corrupted()), /damaged and couldn't be read/],
    ["truncated", pdfFile("cut.pdf", fixtures.truncated()), /damaged and couldn't be read/],
    ["a fake signature", pdfFile("fake.pdf", fixtures.fakeSignature()), /damaged and couldn't be read/],
    ["no pages", pdfFile("none.pdf", fixtures.noPages()), /has no pages/],
    ["too many pages", pdfFile("long.pdf", fixtures.manyPages()), /too many pages/],
    ["oversized", pdfFile("huge.pdf", fixtures.oversized()), /too large/],
    ["too much text", pdfFile("wordy.pdf", fixtures.tooMuchTextOnPage()), /too much text/],
    ["HTML named .pdf", pdfFile("page.pdf", fixtures.htmlNamedPdf()), /couldn't be opened as an image/],
  ]) await refuses(file, message).catch((e) => { throw new Error(`${label}: ${e.message}`); });
  step("encrypted, corrupted, truncated, fake, empty, too long, oversized and wordy PDFs are refused with a reason");

  // 10. A bomb can't harm the app, and the next file still works.
  const bombStarted = Date.now();
  await open(pdfFile("bomb.pdf", fixtures.bomb(Number(process.env.BOMB_MB) || 200)));
  // Not getByRole("alert"), which also matches Next's own hidden route announcer.
  const refusal = page.locator('p[role="alert"]');
  await Promise.race([page.getByTestId("pdf-pages").waitFor({ timeout: 60_000 }), refusal.waitFor({ timeout: 60_000 })]);
  const bombOutcome = (await refusal.count()) ? await refusal.innerText() : `read as a page: ${await page.getByTestId("pdf-page-1").getAttribute("data-kind")}`;
  console.log(`  bomb outcome: ${bombOutcome} after ${Date.now() - bombStarted} ms`);
  assert.ok(Date.now() - bombStarted < 45_000, "it's answered within the deadlines");
  if (await page.getByTestId("pdf-page-1").count()) {
    const drawing = Date.now();
    await page.getByTestId("pdf-page-1").click();
    await Promise.race([page.getByTestId("pdf-page-image").waitFor({ timeout: 45_000 }), refusal.waitFor({ timeout: 45_000 })]);
    console.log(`  bomb page drawn: ${(await refusal.count()) ? await refusal.innerText() : "shown as an empty page"} after ${Date.now() - drawing} ms`);
  }
  await openPages(pdfFile("after.pdf", fixtures.usLabel()));
  step("a decompression bomb is contained, and the next file works");

  // 11. One worker, ended when finished with.
  await openPages(pdfFile("one.pdf", fixtures.usLabel()));
  const pdfWorkers = () => page.workers().filter((w) => /pdf\.worker/.test(w.url())).length;
  assert.ok(pdfWorkers() <= 1, "one document, one worker");
  await page.getByRole("button", { name: "Choose another file" }).click();
  await page.locator("#label-photo").waitFor();
  await page.waitForTimeout(300);
  assert.equal(pdfWorkers(), 0, "the worker ends with the document");
  step("one worker at a time, ended when the document is closed");

  // 12. Nothing was uploaded or kept.
  // Only the two scans asked for above were uploaded in this whole run.
  assert.equal(scanRequests(), 2, "uploads happened only when asked for");
  const unexpected = requests.filter((r) => r.method !== "GET" && r.method !== "HEAD" && !["/api/foods", "/api/nutrition/label-scans", "/api/auth/register", "/api/profile"].includes(new URL(r.url).pathname));
  assert.deepEqual(unexpected.map((r) => new URL(r.url).pathname).filter((u) => !u.startsWith("/onboarding") && !u.startsWith("/register")), [], "nothing else received anything");
  assert.deepEqual(requests.filter((r) => r.method === "POST" && /entries/.test(r.url)), [], "nothing tried to log a food");
  const stored = await page.evaluate(async () => ({
    local: Object.keys(localStorage).length,
    session: Object.keys(sessionStorage).length,
    idb: indexedDB.databases ? (await indexedDB.databases()).length : 0,
    caches: "caches" in window ? (await caches.keys()).length : 0,
  }));
  assert.deepEqual(stored, { local: 0, session: 0, idb: 0, caches: 0 }, "nothing is kept in the browser");
  assert.equal((await foods()).length, saved, "only confirmed saves created foods");
  assert.equal(await diary(), 0);
  step(`no request held a PDF, nothing was kept in the browser, ${saved} confirmed foods, 0 diary entries`);

  const leaked = consoleText.filter((text) => /Rolled Oats|Corn Flakes|Ignore previous|SYSTEM:|Nutrition (Facts|information)/i.test(text));
  assert.deepEqual(leaked, [], "PDF contents don't reach the console");
  step("no PDF contents appear in the browser console");

  assert.deepEqual(errors, [], "no page errors");
  await browser.close();
}

/** With no provider configured, text PDFs still work, and a scanned page says plainly that it can't be read. */
async function unconfigured(jpeg) {
  const browser = await playwright.chromium.launch(target.launchOptions("chromium"));
  const page = await (await target.guardContext(await browser.newContext({ viewport: { width: 390, height: 844 } }))).newPage();
  await signUp(page);
  const open = async (file) => {
    await page.goto(`${BASE}/nutrition/scan`);
    await page.locator("#label-photo").waitFor();
    await page.locator("#label-photo").setInputFiles(file);
    await page.getByTestId("pdf-pages").waitFor();
  };
  await open(pdfFile("oats.pdf", fixtures.usLabel()));
  await page.getByTestId("pdf-page-1").click();
  await page.getByTestId("use-section-0").click();
  await page.getByTestId("scan-result").waitFor();
  assert.equal(await page.getByTestId("input-kcal").inputValue(), "120");
  await page.getByTestId("input-name").fill("Rolled Oats");
  await page.getByTestId("confirm-values").check();
  await page.getByTestId("save-food").click();
  await page.getByTestId("saved-food").waitFor();
  step("no provider configured: a text PDF is read, corrected and saved");

  await open(pdfFile("scan.pdf", fixtures.scanned(jpeg, 800, 1000)));
  await page.getByTestId("pdf-page-1").click();
  await page.getByTestId("use-page-image").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Use this" }).click();
  await page.getByText("Label scanning isn't set up on this server.").waitFor();
  assert.equal(await page.getByTestId("scan-result").count(), 0, "nothing was invented for the page");
  step("no provider configured: a scanned page can't be read, says so, and nothing is invented");
  await browser.close();
  console.log("ALL UNCONFIGURED PDF CHECKS PASSED");
}

(async () => {
  await target.verifyServer();
  if (process.env.EXPECT_UNCONFIGURED) {
    const px = Buffer.alloc(800 * 1000 * 3, 200);
    return unconfigured(await sharp(px, { raw: { width: 800, height: 1000, channels: 3 } }).jpeg().toBuffer());
  }
  assert.ok(STUB, "LABEL_STUB_URL is required");
  assert.equal((await fetch(`${STUB}/__health`).then((r) => r.json())).ok, true);

  // The image decoders are bundled, and load from this site.
  const media = path.join(__dirname, "..", ".next", "static", "media");
  for (const decoder of ["jbig2", "openjpeg", "qcms_bg"]) {
    const file = fs.readdirSync(media).find((f) => f.startsWith(decoder) && f.endsWith(".wasm"));
    assert.ok(file, `${decoder} is bundled`);
    const response = await fetch(`${BASE}/_next/static/media/${file}`);
    assert.equal(response.status, 200);
    assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString("latin1"), "\0asm");
  }
  step("image decoders for JBIG2, JPEG 2000 and colour profiles are served by this site");

  const width = 800, height = 1000;
  const px = Buffer.alloc(width * height * 3);
  const colours = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) px.set(colours[(y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1)], (y * width + x) * 3);
  const jpeg = await sharp(px, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  for (const name of BROWSERS) await runBrowser(name, jpeg);
  console.log("ALL LABEL PDF CHECKS PASSED");
})().catch((e) => { console.error(e); process.exit(1); });
