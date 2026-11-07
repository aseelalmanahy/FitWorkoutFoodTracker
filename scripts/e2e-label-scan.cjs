// End-to-end test of label scanning in real browsers, through the real server and SDK, with no
// paid requests: the app must run with ANTHROPIC_BASE_URL pointing at scripts/stub-label-provider.cjs
// and any non-real key. Usage: BASE_URL=... DATABASE_URL=<local test database> LABEL_STUB_URL=... SHOTS_DIR=... node scripts/e2e-label-scan.cjs
// With EXPECT_UNCONFIGURED=1, checks only that a server with no provider settings reports that clearly.
"use strict";
const assert = require("node:assert/strict");
const playwright = require("playwright");
const sharp = require("sharp");

const { completeOnboarding } = require("./lib/e2e-onboarding.cjs");
const { signUpWithApi, signUpInBrowser } = require("./lib/signup.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget({ labelStub: true });
const BASE = target.baseUrl;
const STUB = target.stubUrl;
const SHOTS = (process.env.SHOTS_DIR || require("node:os").tmpdir()) + "/";
const BROWSERS = (process.env.BROWSERS || "chromium,firefox,webkit").split(",");
const step = (s) => console.log("  ✓", s);

const quadrants = (w, h) => {
  const px = Buffer.alloc(w * h * 3);
  const colours = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(colours[(y < h / 2 ? 0 : 2) + (x < w / 2 ? 0 : 1)], (y * w + x) * 3);
  return sharp(px, { raw: { width: w, height: h, channels: 3 } });
};
/** Corners of an image as decoded here, independently of the browser. */
async function corners(bytes) {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const name = (x, y) => {
    const i = (y * info.width + x) * 3;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]].map((v) => v > 128);
    return r && g && b ? "white" : r ? "red" : g ? "green" : b ? "blue" : "other";
  };
  const m = 10;
  return { width: info.width, height: info.height, tl: name(m, m), tr: name(info.width - m, m), bl: name(m, info.height - m), br: name(info.width - m, info.height - m) };
}

async function unconfigured() {
  const browser = await playwright.chromium.launch(target.launchOptions("chromium"));
  const ctx = await target.guardContext(await browser.newContext());
  const page = await ctx.newPage();
  await signUp(page);
  await page.goto(`${BASE}/nutrition/scan`);
  await page.locator("#label-photo").setInputFiles({ name: "a.jpg", mimeType: "image/jpeg", buffer: await quadrants(600, 400).jpeg().toBuffer() });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Use this" }).click();
  await page.getByText("Label scanning isn't set up on this server.").waitFor();
  await page.goto(`${BASE}/nutrition/add`);
  await page.getByLabel("Search foods").waitFor();
  assert.equal(await page.getByRole("link", { name: "Scan a nutrition label" }).count(), 0, "no link to a feature that's off");
  await browser.close();
  console.log("ALL UNCONFIGURED CHECKS PASSED");
}

const PASSWORD = "correct horse battery";

async function signUp(page) {
  const email = `scan${Date.now()}${Math.floor(Math.random() * 1e6)}@test.dev`;
  if (page.context().browser().browserType().name() === "webkit") {
    // WebKit refuses Secure cookies over http://localhost, which isn't a problem over HTTPS in
    // production. The session is created directly, and only this test's cookie is made non-Secure.
    const { name, value } = await signUpWithApi(BASE, email, PASSWORD);
    await page.context().addCookies([{ name, value, url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
    await page.goto(`${BASE}/onboarding`);
  } else {
    await signUpInBrowser(page, BASE, email, PASSWORD);
  }
  await completeOnboarding(page);
}

const stub = {
  scenario: (name) => fetch(`${STUB}/__scenario`, { method: "POST", body: JSON.stringify({ name }) }),
  reset: () => fetch(`${STUB}/__reset`, { method: "POST" }),
  requests: () => fetch(`${STUB}/__requests`).then((r) => r.json()),
};

// RC-04: each browser run is traced (DOM snapshots, network, console), and the trace is kept only if the run fails.
let current = null;
async function runBrowser(name, files) {
  console.log(`--- ${name}`);
  const browser = await playwright[name].launch(target.launchOptions(name));
  const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 390, height: 844 } }));
  await ctx.tracing.start({ screenshots: true, snapshots: true });
  const page = await ctx.newPage();
  const consoleLines = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consoleLines.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  current = { name, ctx, consoleLines };
  const errors = [];
  page.on("pageerror", (e) => {
    // WebKit reports Next's background page prefetches this way when navigating away interrupts them.
    if (name === "webkit" && /\?_rsc=\S* due to access control checks/.test(e.message)) return;
    errors.push(e.message);
  });
  page.on("dialog", (d) => { errors.push(`dialog: ${d.message()}`); d.dismiss(); });
  await signUp(page);
  await stub.reset();

  // RC-04: if the scan page doesn't show its file input, the failure says what was shown instead.
  const scanPage = async () => {
    const response = await page.goto(`${BASE}/nutrition/scan`);
    try {
      await page.locator("#label-photo").waitFor();
    } catch (e) {
      const shot = `${SHOTS}label-${name}-scan-page-missing-input.png`;
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
      throw new Error(`${name}: the scan page showed no file input. HTTP ${response?.status()}, at ${page.url()}, inputs ${await page.locator("input").count()}, text: "${text}", screenshot ${shot}. ${e.message.split("\n")[0]}`);
    }
  };
  const pick = (file) => page.locator("#label-photo").setInputFiles(file);
  const toReview = async () => { await page.getByRole("button", { name: "Continue" }).click(); await page.getByTestId("prepared-image").waitFor(); };
  const preview = () => page.getByTestId("prepared-image").evaluate(async (img) => {
    await img.decode();
    return { natural: [img.naturalWidth, img.naturalHeight], shown: img.clientWidth };
  });
  const lastSent = async () => {
    const all = await stub.requests();
    const r = all[all.length - 1];
    return { count: all.length, request: r, image: Buffer.from(r.body.messages[0].content[0].source.data, "base64") };
  };
  const useThis = () => page.getByRole("button", { name: "Use this" }).click();

  // 1. An ordinary photo goes up unchanged, and the server turns it upright and cleans it.
  await scanPage();
  await pick(files.smallRotated);
  await toReview();
  assert.match(await page.getByTestId("prepared-description").innerText(), /Your original photo, unchanged \(900 x 1,200\)/);
  const small = await preview();
  assert.deepEqual(small.natural, [900, 1200]);
  assert.equal(small.shown, 900, "shown at full resolution");
  await useThis();
  await page.getByTestId("scan-result").waitFor();
  const body = await page.getByTestId("scan-result").innerText();
  assert.match(body, /Unverified/);
  assert.match(body, /Rolled Oats/);
  assert.match(body, /120 kcal/);
  assert.match(body, /Per 100 g/);
  assert.match(body, /Not on label/, "a missing nutrient says so, never 0");
  assert.match(body, /Nothing has been saved/);
  let sent = await lastSent();
  assert.deepEqual(await corners(sent.image), { width: 900, height: 1200, tl: "blue", tr: "red", bl: "white", br: "green" });
  assert.equal(sent.image.includes("GPS-SECRET"), false, "no metadata reaches the provider");
  assert.equal((await sharp(sent.image).metadata()).exif, undefined);
  await page.screenshot({ path: `${SHOTS}label-${name}-result.png`, fullPage: true });
  step("rotated photo: uploaded unchanged; provider got it upright with metadata removed; unverified result shown");

  // 2. What the provider receives holds no user data or session.
  const headers = sent.request.headers;
  assert.equal(headers.cookie, undefined);
  assert.equal(headers["x-forwarded-for"], undefined);
  assert.ok(headers.authorization, "the app's key was sent to the stub");
  const cookies = await ctx.cookies();
  const wire = JSON.stringify(sent.request);
  for (const c of cookies) assert.equal(wire.includes(c.value), false, `cookie ${c.name} must not be sent`);
  assert.equal(/@test\.dev/.test(wire), false, "no email");
  assert.equal(sent.request.body.metadata, undefined);
  step("provider request holds no cookies, session or user details");

  // 3. Nothing was created.
  const foods = await page.evaluate(() => fetch("/api/foods").then((r) => r.json()));
  assert.deepEqual(foods.foods, []);
  step("no food was created");

  // 4. A 48 MP rotated photo is scaled in the browser, staying upright, and says so.
  await scanPage();
  await pick(files.large);
  await toReview();
  assert.match(await page.getByTestId("prepared-description").innerText(), /Scaled from 6,000 x 8,000 to 1,932 x 2,576/);
  await page.getByTestId("crop-advice").waitFor();
  const large = await preview();
  assert.deepEqual(large.natural, [1932, 2576]);
  assert.equal(large.shown, 1932, "shown at full resolution, not fitted to the phone");
  await useThis();
  await page.getByTestId("scan-result").waitFor();
  sent = await lastSent();
  assert.deepEqual(await corners(sent.image), { width: 1932, height: 2576, tl: "blue", tr: "red", bl: "white", br: "green" });
  step("48 MP photo: scaled to 1,932 x 2,576, upright, shown at full size, within server limits");

  // 5. Cropping keeps original pixels, in upright coordinates.
  await scanPage();
  await pick(files.large);
  const area = page.getByTestId("crop-area");
  await area.waitFor();
  await area.scrollIntoViewIfNeeded();
  const box = await area.boundingBox();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, { steps: 4 });
  await page.mouse.up();
  await page.getByTestId("crop-box").waitFor();
  await toReview();
  const description = await page.getByTestId("prepared-description").innerText();
  assert.match(description, /^Cropped to /, description);
  await useThis();
  await page.getByTestId("scan-result").waitFor();
  sent = await lastSent();
  const cropped = await corners(sent.image);
  assert.ok(Math.abs(cropped.width - 1500) < 40 && Math.abs(cropped.height - 2000) < 40, `crop keeps original pixels: ${cropped.width}x${cropped.height}`);
  for (const c of [cropped.tl, cropped.tr, cropped.bl, cropped.br]) assert.equal(c, "green", "the bottom-right of the upright photo");
  step(`crop of the upright photo: ${cropped.width} x ${cropped.height} from original pixels, correct region`);

  // 6. PNG and WebP.
  for (const [kind, file] of [["PNG", files.png], ["WebP", files.webp]]) {
    await scanPage();
    await pick(file);
    await toReview();
    await useThis();
    await page.getByTestId("scan-result").waitFor();
    sent = await lastSent();
    assert.equal(sent.request.body.messages[0].content[0].source.media_type, `image/${kind.toLowerCase()}`);
  }
  step("PNG and WebP work");

  // 7. HEIC, and files that aren't accepted, get an explicit answer.
  await scanPage();
  await pick(files.heic);
  await page.getByText("This browser can't open HEIC photos.").waitFor();
  for (const file of [files.svg, files.gif, files.notImage]) {
    await scanPage();
    await pick(file);
    await page.getByText("This file couldn't be opened as an image.").waitFor({ timeout: 10_000 }).catch(async (e) => {
      console.log(`  ${name}: no refusal for ${file.name}. Files chosen: ${await page.locator("#label-photo").evaluate((i) => i.files.length).catch(() => "none")}. Page says: ${(await page.locator("main").innerText()).slice(0, 200).replace(/\s+/g, " ")}`);
      throw e;
    });
  }
  step("HEIC this browser can't decode: explicit help. SVG, GIF and other files: refused");

  // 8. A crop too small to read is refused, not enlarged.
  await scanPage();
  await pick(files.smallUpright);
  const tiny = page.getByTestId("crop-area");
  await tiny.waitFor();
  const t = await tiny.boundingBox();
  await page.mouse.move(t.x + 10, t.y + 10);
  await page.mouse.down();
  await page.mouse.move(t.x + 60, t.y + 60, { steps: 3 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("The selected area is too small to read.").waitFor();
  step("crop too small to read: refused");

  // 9. Text on a label is inert.
  await stub.scenario("injection");
  await scanPage();
  await pick(files.smallUpright);
  await toReview();
  await useThis();
  await page.getByTestId("scan-result").waitFor();
  assert.match(await page.getByTestId("scan-result").innerText(), /Ignore previous instructions/);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__injected), undefined, "label text must not run");
  assert.equal(await page.getByTestId("scan-result").locator("img, script").count(), 0);
  step("markup and instructions printed on a label are shown as plain text");

  // 10. Discrepancies are flagged, and values aren't changed.
  await stub.scenario("flagged");
  await page.getByRole("button", { name: "Scan another label" }).click();
  await pick(files.smallUpright);
  await toReview();
  await useThis();
  await page.getByTestId("scan-flags").waitFor();
  assert.match(await page.getByTestId("scan-flags").innerText(), /read as 180/);
  step("wrong number flagged against the printed text");

  // 11. Failures are generic.
  for (const [scenario, pattern] of [
    ["notLabel", /doesn't look like a nutrition label/],
    ["invalid", /couldn't be read reliably/],
    ["refusal", /couldn't be read reliably/],
    ["outage", /temporarily unavailable/],
    ["badKey", /temporarily unavailable/],
  ]) {
    await stub.scenario(scenario);
    await scanPage();
    await pick(files.smallUpright);
    await toReview();
    await useThis();
    await page.getByText(pattern).waitFor();
    assert.equal(await page.getByText(/stub-provider/).count(), 0, "no provider text is shown");
    assert.equal(await page.getByRole("button", { name: "Use this" }).isEnabled(), true, "the user can try again");
  }
  step("non-label, invalid output, refusal, outage and bad key: clear generic messages, no provider details");

  // A fresh account, as the steps above use up most of one user's upload allowance.
  await ctx.clearCookies();
  await signUp(page);
  await reviewFlows({ name, page, scanPage, pick, toReview, useThis, files });

  assert.deepEqual(errors, [], "no page errors");
  await ctx.tracing.stop();
  current = null;
  await browser.close();
}

/** Review, correction and confirmation, after a scan. */
async function reviewFlows({ name, page, scanPage, pick, toReview, useThis, files }) {
  // Any attempt to log counts, whatever date it's for. Checking one day's diary alone could miss it.
  const entryWrites = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/nutrition/entries")) entryWrites.push(request.url());
  });
  const foods = () => page.evaluate(() => fetch("/api/foods").then((r) => r.json()).then((b) => b.foods));
  const input = (id) => page.getByTestId(`input-${id}`);
  const origin = (id) => page.getByTestId(`origin-${id}`).getAttribute("data-origin");
  const blockers = () => page.getByTestId("save-blockers").innerText();
  const saveButton = () => page.getByTestId("save-food");
  const scanWith = async (scenario, file = files.smallUpright) => {
    await stub.scenario(scenario);
    await scanPage();
    await pick(file);
    await toReview();
    await useThis();
    await page.getByTestId("scan-result").waitFor();
  };
  const confirmAndSave = async () => {
    await page.getByTestId("confirm-values").check();
    if (await page.getByTestId("confirm-warnings").count()) await page.getByTestId("confirm-warnings").check();
    await saveButton().click();
    await page.getByTestId("saved-food").waitFor();
  };
  const savedPer100 = (key) => page.getByTestId(`saved-per100-${key}`).innerText();
  let expectedFoods = (await foods()).length;
  assert.equal(expectedFoods, 0, "scanning created no foods");

  // 12. Values are distinguished, and nothing is saved without confirming. Nothing is uploaded again.
  await scanWith("good", files.large);
  assert.equal(await input("name").inputValue(), "Rolled Oats");
  assert.equal(await input("kcal").inputValue(), "120");
  assert.equal(await origin("kcal"), "ai");
  assert.equal(await origin("fiber"), "missing");
  assert.equal(await input("fiber").inputValue(), "", "a missing nutrient stays empty");
  assert.equal(await input("servings-per-container").inputValue(), "16");
  await input("servings-per-container").fill("18");
  assert.equal(await origin("servings-per-container"), "corrected");
  assert.equal(await origin("serving"), "ai");
  await input("serving-unit").selectOption("ML");
  assert.equal(await origin("serving"), "corrected", "changing only the unit is a correction");
  await input("serving-unit").selectOption("G");
  assert.equal(await origin("serving"), "ai");
  const image = await page.getByTestId("review-image").evaluate(async (img) => { await img.decode(); return img.naturalWidth; });
  assert.ok(image > 0, "the image stays available");
  await page.getByRole("button", { name: "Show original photo" }).click();
  assert.equal(await page.getByTestId("review-image").evaluate(async (img) => { await img.decode(); return img.naturalWidth; }), 6000, "the original photo is available");
  await page.getByRole("button", { name: "Show scanned image" }).click();
  const uploads = (await stub.requests()).length;
  assert.equal(await saveButton().isDisabled(), true, "nothing is confirmed automatically");
  await input("protein").fill("4.5");
  assert.equal(await origin("protein"), "corrected");
  assert.equal(await page.getByTestId("preview-per100-protein").innerText(), "15 g");
  await page.getByTestId("confirm-values").check();
  assert.equal(await saveButton().isEnabled(), true);
  await input("protein").fill("4.6");
  assert.equal(await page.getByTestId("confirm-values").isChecked(), false, "changing a value needs confirming again");
  assert.equal(await saveButton().isDisabled(), true);
  await input("protein").fill("4.5");
  await page.getByTestId("confirm-values").check();
  await saveButton().dblclick();
  await page.getByTestId("saved-food").waitFor();
  expectedFoods++;
  assert.equal((await foods()).length, expectedFoods, "a double click creates one food");
  assert.equal(await savedPer100("protein"), "15 g");
  assert.equal(await savedPer100("kcal"), "400 kcal");
  assert.equal(await savedPer100("fiber"), "Not reported", "missing fiber isn't saved as 0");
  assert.match(await page.getByTestId("saved-food").innerText(), /hasn't been added to your diary/);
  assert.equal((await stub.requests()).length, uploads, "reviewing and saving didn't upload the image again");
  await page.screenshot({ path: `${SHOTS}label-${name}-saved.png`, fullPage: true });
  step("values are marked by origin, need confirming, save once, and don't upload again");

  // 13. Nothing was logged, and the food is in the normal workflow.
  const diaryCount = () => page.evaluate(() => fetch("/api/nutrition/day").then((r) => r.json()).then((d) => d.meals.flatMap((m) => m.entries).length));
  assert.equal(await diaryCount(), 0, "saving a food logs nothing");
  assert.deepEqual(entryWrites, [], "saving a food never tries to log it");
  await page.getByRole("link", { name: "Add to diary" }).click();
  await page.waitForURL("**/nutrition/add**");
  await page.getByLabel("Search foods").fill("Rolled");
  await page.getByRole("button", { name: /Rolled Oats/ }).first().waitFor();
  await page.getByRole("link", { name: "Scan a nutrition label" }).waitFor();
  step("food appears in the food workflow, with no diary entry");

  // 14. Required values can't be skipped, and an explicit 0 is allowed.
  await scanWith("missingFat");
  assert.equal(await origin("fat"), "missing");
  assert.equal(await input("fat").inputValue(), "");
  assert.match(await blockers(), /Fat isn't on the label/);
  assert.equal(await page.getByTestId("save-preview").count(), 0);
  assert.equal(await saveButton().isDisabled(), true);
  await input("fat").fill("abc");
  assert.match(await blockers(), /Enter a number/);
  await input("fat").fill("0");
  assert.equal(await origin("fat"), "entered");
  await confirmAndSave();
  expectedFoods++;
  assert.equal(await savedPer100("fat"), "0 g");
  step("a missing nutrient blocks saving and says why; a typed 0 is kept as the person's own");

  // 15. Unreadable values.
  await scanWith("unreadable");
  assert.equal(await origin("protein"), "unreadable");
  assert.match(await page.getByTestId("scan-result").innerText(), /Glare over this row/);
  assert.match(await blockers(), /Protein couldn't be read/);
  await input("protein").fill("4");
  assert.equal(await origin("protein"), "entered");
  step("an unreadable value stays empty, with its reason, until the person supplies it");

  // 16. A household serving needs a confirmed amount.
  await scanWith("household");
  assert.equal(await input("serving-label").inputValue(), "1 cup");
  assert.equal(await input("serving-amount").inputValue(), "");
  assert.match(await blockers(), /"1 cup"/);
  await input("serving-amount").fill("240");
  assert.match(await blockers(), /grams or millilitres/);
  await input("serving-unit").selectOption("ML");
  await confirmAndSave();
  expectedFoods++;
  assert.equal(await savedPer100("kcal"), "50 kcal");
  assert.match(await page.getByTestId("saved-food").innerText(), /Per 100 ml/);
  step("a 1 cup serving can't be saved until its volume is confirmed");

  // 17. Per-100 labels, and an explicit 100 g serving.
  await scanWith("per100Only");
  assert.match(await blockers(), /isn't on the label, so it won't be guessed/);
  await page.getByRole("button", { name: "Use 100 g as the serving" }).click();
  assert.equal(await input("serving-amount").inputValue(), "100");
  await confirmAndSave();
  expectedFoods++;
  assert.equal(await savedPer100("protein"), "13.3 g");
  step("a per-100 g label is preserved, with the serving chosen explicitly");

  // 18. Grams and millilitres are never mixed.
  await scanWith("mlServingGramColumn");
  await page.getByRole("radio", { name: /Per 100 g/ }).check();
  assert.match(await blockers(), /per 100 g, but the serving is in ml/);
  assert.equal(await saveButton().isDisabled(), true);
  assert.equal(await page.getByTestId("save-preview").count(), 0);
  step("a per-100 g column can't be applied to a serving in ml");

  // 19. Kilojoules aren't treated as calories.
  await scanWith("kilojoules");
  assert.equal(await input("kcal").inputValue(), "");
  assert.match(await page.getByTestId("scan-result").innerText(), /502 kJ/);
  assert.match(await blockers(), /Calories needs a value in kcal/);
  await input("kcal").fill("120");
  assert.equal(await origin("kcal"), "entered");
  step("kJ isn't converted: calories stay empty until entered");

  // 20. Conflicting columns need acknowledging, and a correction clears them.
  await scanWith("contradictory");
  assert.ok((await page.getByTestId("flag-protein").count()) > 0, "the flagged field is marked");
  assert.match(await page.getByTestId("scan-flags").innerText(), /per-100 column suggests/);
  await page.getByTestId("confirm-values").check();
  assert.equal(await saveButton().isDisabled(), true, "conflicts aren't accepted automatically");
  await page.getByTestId("confirm-warnings").check();
  assert.equal(await saveButton().isEnabled(), true);
  await input("protein").fill("4");
  await input("kcal").fill("120");
  assert.equal(await page.getByTestId("scan-flags").count(), 0, "correcting the values clears the conflict");
  assert.equal(await page.getByTestId("confirm-warnings").count(), 0);
  step("conflicting columns need acknowledging, and a correction clears them");

  // 21. Scanning again is explicit.
  const beforeRescan = (await stub.requests()).length;
  await input("protein").fill("7");
  await page.getByRole("button", { name: "Scan this image again" }).click();
  assert.equal((await stub.requests()).length, beforeRescan, "going back uploads nothing");
  await stub.scenario("good");
  await useThis();
  await page.getByTestId("scan-result").waitFor();
  assert.equal((await stub.requests()).length, beforeRescan + 1, "the upload happens only on request");
  assert.equal(await input("protein").inputValue(), "4", "a new scan starts from the new reading");
  step("the image is sent again only when the person asks");

  // 22. Text printed on a label stays inert, through to the saved food.
  await scanWith("injection");
  const attack = await input("name").inputValue();
  assert.match(attack, /Ignore previous instructions/);
  await confirmAndSave();
  expectedFoods++;
  assert.equal(await page.getByTestId("saved-name").innerText(), attack);
  assert.equal(await page.getByTestId("saved-food").locator("img, script").count(), 0);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  step("instructions and markup from a label are saved and shown as plain text");

  // 23. The server still enforces the contract if the page is bypassed.
  const bypass = await page.evaluate(async () => {
    const send = (perServing, extra = {}) => fetch("/api/foods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Bypass", basisUnit: "G", servingLabel: "1 serving", servingAmount: 30, perServing, ...extra }) }).then((r) => r.status);
    return {
      nullKcal: await send({ kcal: null, protein: 1, carbs: 1, fat: 1 }),
      noFat: await send({ kcal: 10, protein: 1, carbs: 1 }),
      impossible: await send({ kcal: 9000, protein: 1, carbs: 1, fat: 1 }),
      noServing: await send({ kcal: 10, protein: 1, carbs: 1, fat: 1 }, { servingAmount: null }),
    };
  });
  assert.deepEqual(bypass, { nullKcal: 400, noFat: 400, impossible: 400, noServing: 400 });
  step("the server refuses missing or impossible values even if the page is bypassed");

  // 24. The image stays beside the values on a wide screen, and in view on a phone.
  await scanWith("good");
  const narrow = await page.getByTestId("review-image").boundingBox();
  assert.ok(narrow.height > 0);
  await page.getByTestId("input-fiber").scrollIntoViewIfNeeded();
  const scrolled = await page.getByTestId("review-image").boundingBox();
  assert.ok(scrolled.y + scrolled.height > 0, "still in view while correcting on a phone");
  await page.screenshot({ path: `${SHOTS}label-${name}-review-phone.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const imageBox = await page.getByTestId("review-image").boundingBox();
  const formBox = await page.getByTestId("input-name").boundingBox();
  assert.ok(imageBox.x + imageBox.width <= formBox.x + 1, "the image is beside the values");
  await page.screenshot({ path: `${SHOTS}label-${name}-review-wide.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  step("the image stays beside the values on a wide screen, and in view on a phone");

  assert.equal((await foods()).length, expectedFoods, "only confirmed saves created foods");
  assert.equal(await diaryCount(), 0, "no diary entries were created");
  assert.deepEqual(entryWrites, [], "nothing tried to log a food");
  step(`${expectedFoods} confirmed foods, and 0 diary entries`);
}

(async () => {
  await target.verifyServer();
  if (process.env.EXPECT_UNCONFIGURED) return unconfigured();
  assert.ok(STUB, "LABEL_STUB_URL is required");
  // Never run against the real provider: the stub must be the thing answering.
  assert.equal((await fetch(`${STUB}/__health`).then((r) => r.json())).ok, true);

  const anon = await fetch(`${BASE}/api/nutrition/label-scans`, { method: "POST", headers: { Origin: BASE, "Content-Type": "image/jpeg" }, body: Buffer.from("x") });
  assert.equal(anon.status, 401);
  const crossOrigin = await fetch(`${BASE}/api/nutrition/label-scans`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "image/jpeg" }, body: Buffer.from("x") });
  assert.equal(crossOrigin.status, 403);
  await stub.reset();
  assert.equal((await stub.requests()).length, 0);
  step("no session: 401. Cross-origin: 403");

  const jpeg = (name, buffer) => ({ name, mimeType: "image/jpeg", buffer });
  const files = {
    smallRotated: jpeg("small.jpg", await quadrants(1200, 900).jpeg({ quality: 92 }).withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "GPS-SECRET" } } }).toBuffer()),
    smallUpright: jpeg("upright.jpg", await quadrants(1200, 900).jpeg({ quality: 92 }).toBuffer()),
    large: jpeg("large.jpg", await quadrants(8000, 6000).jpeg({ quality: 80 }).withMetadata({ orientation: 6 }).toBuffer()),
    png: { name: "a.png", mimeType: "image/png", buffer: await quadrants(800, 600).png().toBuffer() },
    webp: { name: "a.webp", mimeType: "image/webp", buffer: await quadrants(800, 600).webp().toBuffer() },
    heic: { name: "photo.heic", mimeType: "image/heic", buffer: Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(64)]) },
    svg: { name: "a.svg", mimeType: "image/svg+xml", buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500"/></svg>`) },
    gif: { name: "a.gif", mimeType: "image/gif", buffer: await quadrants(300, 300).gif().toBuffer() },
    notImage: { name: "notes.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not an image at all") },
  };
  for (const name of BROWSERS) await runBrowser(name, files);
  console.log("ALL LABEL SCAN CHECKS PASSED");
})().catch(async (e) => {
  console.error(e);
  if (current) {
    const trace = `${SHOTS}label-${current.name}-failure-trace.zip`;
    await current.ctx.tracing.stop({ path: trace }).then(() => console.error(`Trace of the failed run: ${trace}`), () => {});
    console.error(`Browser console errors and warnings: ${current.consoleLines.length ? current.consoleLines.slice(-20).join(" | ") : "none"}`);
  }
  process.exit(1);
});
