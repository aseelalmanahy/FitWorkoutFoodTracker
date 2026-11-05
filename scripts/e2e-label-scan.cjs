// End-to-end test of label scanning in real browsers, through the real server and SDK, with no
// paid requests: the app must run with ANTHROPIC_BASE_URL pointing at scripts/stub-label-provider.cjs
// and any non-real key. Usage: BASE_URL=... LABEL_STUB_URL=... SHOTS_DIR=... node scripts/e2e-label-scan.cjs
// With EXPECT_UNCONFIGURED=1, checks only that a server with no provider settings reports that clearly.
"use strict";
const assert = require("node:assert/strict");
const playwright = require("playwright");
const sharp = require("sharp");

const BASE = process.env.BASE_URL;
const STUB = process.env.LABEL_STUB_URL;
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
  const browser = await playwright.chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signUp(page);
  await page.goto(`${BASE}/nutrition/scan`);
  await page.locator("#label-photo").setInputFiles({ name: "a.jpg", mimeType: "image/jpeg", buffer: await quadrants(600, 400).jpeg().toBuffer() });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Use this" }).click();
  await page.getByText("Label scanning isn't set up on this server.").waitFor();
  await browser.close();
  console.log("ALL UNCONFIGURED CHECKS PASSED");
}

async function signUp(page) {
  const email = `scan${Date.now()}${Math.floor(Math.random() * 1e6)}@test.dev`;
  if (page.context().browser().browserType().name() === "webkit") {
    // WebKit refuses Secure cookies over http://localhost, which isn't a problem over HTTPS in
    // production. The session is created directly, and only this test's cookie is made non-Secure.
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

const stub = {
  scenario: (name) => fetch(`${STUB}/__scenario`, { method: "POST", body: JSON.stringify({ name }) }),
  reset: () => fetch(`${STUB}/__reset`, { method: "POST" }),
  requests: () => fetch(`${STUB}/__requests`).then((r) => r.json()),
};

async function runBrowser(name, files) {
  console.log(`--- ${name}`);
  const browser = await playwright[name].launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => {
    // WebKit reports Next's background page prefetches this way when navigating away interrupts them.
    if (name === "webkit" && /\?_rsc=\S* due to access control checks/.test(e.message)) return;
    errors.push(e.message);
  });
  page.on("dialog", (d) => { errors.push(`dialog: ${d.message()}`); d.dismiss(); });
  await signUp(page);
  await stub.reset();

  const scanPage = async () => { await page.goto(`${BASE}/nutrition/scan`); await page.locator("#label-photo").waitFor(); };
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

  assert.deepEqual(errors, [], "no page errors");
  const finalFoods = await page.evaluate(() => fetch("/api/foods").then((r) => r.json()));
  assert.deepEqual(finalFoods.foods, []);
  await browser.close();
}

(async () => {
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
})().catch((e) => { console.error(e); process.exit(1); });
