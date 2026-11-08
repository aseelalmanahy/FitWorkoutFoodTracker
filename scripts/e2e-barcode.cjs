// Phase 2 in real browsers, on the production build, against the local food stand-in. Barcode images are drawn here
// by zxing-wasm's own encoder (real EAN-13 symbols). Chromium gets two fake cameras playing a video of one; Firefox and
// WebKit, which have no fake camera, decode a photo with the WebAssembly fallback. Every request the page makes is
// recorded, to prove no frame or photo is uploaded: only the digits go to /api/foods/barcode/.
//   BASE_URL=… DATABASE_URL=<designated test database> node scripts/e2e-barcode.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const playwright = require("playwright");
const sharp = require("sharp");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
const step = (s) => console.log(`✓ ${s}`);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "fit-barcode-"));
const COLA = "5000112637922"; // in the stand-in: Cola Zero
const GENERATED = "7700000000019"; // the stand-in answers 77… codes with a generated product
const UNKNOWN = "4006381333931"; // a valid EAN-13 the stand-in doesn't have
const BAD_CHECK = "3017624010966"; // the stand-in's "Nutella", whose check digit is wrong: refused before any lookup

async function barcodePng(code) {
  const { writeBarcode, prepareZXingModule } = await import("zxing-wasm/writer");
  prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync(require.resolve("zxing-wasm/writer/zxing_writer.wasm")) }, fireImmediately: true });
  const out = await writeBarcode(code, { format: "EAN13", scale: 4 });
  assert.ok(out.image, `encoded ${code}`);
  const symbol = await sharp(Buffer.from(await out.image.arrayBuffer())).resize({ width: 420 }).png().toBuffer();
  return sharp({ create: { width: 640, height: 480, channels: 3, background: "#ffffff" } }).composite([{ input: symbol, gravity: "center" }]).png().toBuffer();
}

/** A Y4M video (what Chromium's fake camera plays) of one still frame, repeated. */
async function y4m(png, file) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const Y = Buffer.alloc(w * h), U = Buffer.alloc((w / 2) * (h / 2)), V = Buffer.alloc((w / 2) * (h / 2));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3, r = data[i], g = data[i + 1], b = data[i + 2];
    Y[y * w + x] = Math.round(0.257 * r + 0.504 * g + 0.098 * b + 16);
    if (y % 2 === 0 && x % 2 === 0) { const j = (y / 2) * (w / 2) + x / 2; U[j] = Math.round(-0.148 * r - 0.291 * g + 0.439 * b + 128); V[j] = Math.round(0.439 * r - 0.368 * g - 0.071 * b + 128); }
  }
  const frames = [];
  for (let n = 0; n < 10; n++) frames.push(Buffer.from("FRAME\n"), Y, U, V);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${w} H${h} F10:1 Ip A1:1 C420jpeg\n`), ...frames]));
}

async function signedIn(browser, label, contextOptions = {}) {
  const { user, token } = await createSignedInUser(prisma, `barcode${label}x${run}@test.dev`);
  await prisma.profile.create({ data: { userId: user.id, name: "Barcode Tester", birthDate: new Date("1990-01-01T00:00:00Z"), timezone: "UTC", unitSystem: "METRIC" } });
  const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 390, height: 844 }, ...contextOptions }));
  await ctx.addCookies([{ name: "fit_session", value: token, url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
  const page = await ctx.newPage();
  const sent = [];
  page.on("request", (r) => sent.push({ method: r.method(), url: r.url(), bytes: r.postDataBuffer()?.length ?? 0, type: r.resourceType() }));
  return { user, ctx, page, sent };
}
const openScanner = async (page) => {
  await page.goto(`${BASE}/nutrition/add`);
  await page.getByTestId("scan-barcode").click();
  await page.getByTestId("barcode-scan").waitFor();
};
const lookups = (sent) => sent.filter((r) => new URL(r.url).pathname.startsWith("/api/foods/barcode/")).map((r) => new URL(r.url).pathname.split("/").pop());
const noUploads = (sent, label) => {
  const posted = sent.filter((r) => r.method !== "GET" && !new URL(r.url).pathname.startsWith("/api/nutrition/entries"));
  assert.deepEqual(posted.map((r) => `${r.method} ${new URL(r.url).pathname}`), [], `${label}: nothing but a confirmed log is sent`);
  assert.ok(sent.every((r) => r.bytes < 2048), `${label}: no request carries an image`);
};

async function chromiumCamera(video) {
  const browser = await playwright.chromium.launch(target.launchOptions("chromium", { fakeCamera: { video, devices: 2 } }));
  try {
    const { user, page, sent } = await signedIn(browser, "cam", { permissions: ["camera"] });
    await openScanner(page);
    await page.getByTestId("barcode-found").waitFor({ timeout: 20000 });
    assert.match(await page.getByTestId("barcode-found").innerText(), /Cola Zero/);
    assert.match(await page.getByTestId("barcode-source").innerText(), /Open Food Facts/i);
    step("chromium: the camera reads a real EAN-13 on the device; the product is shown with its source, for confirmation");
    await page.getByTestId("barcode-confirm").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /^Add to / }).click();
    await dialog.waitFor({ state: "detached", timeout: 15000 });
    const entry = await prisma.foodEntry.findFirst({ where: { userId: user.id }, include: { food: true } });
    assert.ok(entry, "logged after confirming");
    assert.deepEqual([entry.food.source, entry.food.sourceId, entry.food.userId], ["OPEN_FOOD_FACTS", COLA, null], "from the provider's own record, by its code");
    step("chromium: confirmed and logged from the provider's record, with its source and code");
    // The same product scanned again reuses the one shared record.
    await openScanner(page);
    await page.getByTestId("barcode-found").waitFor({ timeout: 20000 });
    assert.equal(await prisma.food.count({ where: { source: "OPEN_FOOD_FACTS", sourceId: COLA } }), 1, "one record, however often it's scanned");
    assert.deepEqual(lookups(sent), [COLA, COLA], "only the digits are looked up");
    noUploads(sent, "chromium camera");
    step("chromium: scanned again, the same record is reused, not duplicated; no frame was uploaded");
  } finally { await browser.close(); }
}

async function chromiumTwoCameras() {
  // Chromium's own fake cameras show a test pattern, with no barcode, so the scanner stays on the camera.
  const browser = await playwright.chromium.launch(target.launchOptions("chromium", { fakeCamera: { devices: 2 } }));
  try {
    const { page, sent } = await signedIn(browser, "twocams", { permissions: ["camera"] });
    await openScanner(page);
    const picker = page.getByTestId("barcode-camera");
    await picker.waitFor({ timeout: 10000 });
    assert.equal(await picker.locator("option").count(), 3, "two cameras to choose from, and the default");
    const second = await picker.locator("option").nth(2).getAttribute("value");
    await picker.selectOption(second);
    await page.waitForFunction(() => { const v = document.querySelector("[data-testid=barcode-video]"); return v && v.readyState >= 2 && !v.paused; }, null, { timeout: 10000 });
    const track = await page.evaluate(() => document.querySelector("[data-testid=barcode-video]").srcObject.getVideoTracks()[0].getSettings().deviceId);
    assert.equal(track, second, "the chosen camera is the one running");
    assert.deepEqual(lookups(sent), [], "nothing is looked up until a code is read");
    await page.getByRole("button", { name: "Close" }).last().click();
    await page.waitForFunction(() => !document.querySelector("[data-testid=barcode-video]"), null, { timeout: 5000 });
    step("chromium: with two cameras, either can be chosen, and the chosen one runs; closing the scanner releases it");
  } finally { await browser.close(); }
}

async function chromiumDenied() {
  const browser = await playwright.chromium.launch(target.launchOptions("chromium", { fakeCamera: { grant: false } }));
  try {
    const { page, sent } = await signedIn(browser, "denied"); // camera permission not granted: the prompt is refused
    await openScanner(page);
    await page.getByText(/Camera access was refused|camera couldn't be started|can't use the camera/).waitFor({ timeout: 10000 });
    assert.equal(await page.getByTestId("barcode-typed").count(), 1, "typed entry is offered instead");
    await page.getByTestId("barcode-typed").fill(UNKNOWN);
    await page.getByTestId("barcode-lookup").click();
    await page.getByTestId("barcode-unknown").waitFor();
    await page.getByTestId("barcode-create").click();
    const dialog = page.getByRole("dialog", { name: "Custom food" });
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel("Barcode").inputValue(), UNKNOWN, "a food of their own, with the barcode filled in and nothing else");
    assert.equal(await dialog.getByLabel("kcal", { exact: true }).inputValue(), "", "no value is guessed");
    assert.equal(await dialog.getByLabel("Name", { exact: true }).inputValue(), "", "not even a name");
    step("chromium: camera refused, typed entry works; an unknown code says so, guesses nothing, and offers a food of their own");
    await dialog.getByRole("button", { name: /close|cancel/i }).first().click().catch(() => page.keyboard.press("Escape"));
    await page.getByTestId("scan-barcode").click();
    await page.getByTestId("barcode-typed").fill(BAD_CHECK);
    await page.getByTestId("barcode-lookup").click();
    await page.getByText("That isn't a valid product barcode").waitFor();
    assert.deepEqual(lookups(sent), [UNKNOWN], "a code with a wrong check digit is never looked up");
    noUploads(sent, "chromium typed");
    step("chromium: a wrong check digit is refused on the device, never looked up");
  } finally { await browser.close(); }
}

async function photo(name, png) {
  const browser = await playwright[name].launch(target.launchOptions(name));
  try {
    const { page, sent } = await signedIn(browser, `photo${name}`);
    await openScanner(page);
    await page.getByTestId("barcode-photo").setInputFiles({ name: "package.png", mimeType: "image/png", buffer: png });
    await page.getByTestId("barcode-found").waitFor({ timeout: 30000 });
    assert.match(await page.getByTestId("barcode-found").innerText(), new RegExp(`Generated ${GENERATED}`));
    const wasm = sent.filter((r) => /zxing_reader.*\.wasm/.test(r.url));
    assert.ok(wasm.length > 0 && wasm.every((r) => new URL(r.url).origin === new URL(BASE).origin), "the decoder's WebAssembly came from this site");
    assert.deepEqual(lookups(sent), [GENERATED]);
    noUploads(sent, `${name} photo`);
    step(`${name}: a photo's barcode is decoded on the device by the WebAssembly fallback from this site; the photo isn't sent`);
  } finally { await browser.close(); }
}

/** Phase 4: a package front with no barcode, as words in large type, a claim and a value. */
async function packageFront() {
  const words = ["HILLSIDE", "Greek Yogurt", "High in Protein", "73 kcal"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700"><rect width="100%" height="100%" fill="#ffffff"/>${words.map((w, i) => `<text x="60" y="${150 + i * 140}" font-family="Arial" font-weight="700" font-size="${i === 1 ? 90 : 60}" fill="#111111">${w}</text>`).join("")}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

async function packagePhoto() {
  const browser = await playwright.chromium.launch(target.launchOptions("chromium"));
  try {
    const { user, page, sent } = await signedIn(browser, "pkg");
    await openScanner(page);
    await page.getByTestId("barcode-photo").setInputFiles({ name: "front.jpg", mimeType: "image/jpeg", buffer: await packageFront() });
    await page.getByTestId("package-words").waitFor({ timeout: 60000 });
    const words = await page.getByTestId("package-word").allInnerTexts();
    assert.ok(words.some((w) => /greek yogurt/i.test(w)), `the name was read: ${words}`);
    assert.ok(words.every((w) => !/kcal|protein|\d/i.test(w)), `no value or claim offered: ${words}`);
    // The words (brand and name, never the claim or the value) are searched once, automatically, with the usual search.
    await page.getByTestId("package-matches").waitFor({ timeout: 30000 });
    const uploads = sent.filter((r) => r.method === "POST");
    assert.deepEqual(uploads.map((r) => new URL(r.url).pathname), ["/api/foods/photo-text"], "the photo went once, to be read for words, and nothing was saved");
    const searches = sent.filter((r) => new URL(r.url).pathname === "/api/foods/search");
    assert.equal(searches.length, 1, "one search for the photo, not one per word");
    const q = new URL(searches[0].url).searchParams.get("q");
    assert.match(q, /greek yogurt/i, `searched for the words read: ${q}`);
    assert.doesNotMatch(q, /kcal|protein|\d/i, "never for a claim or a value");
    assert.match(await page.getByTestId("package-test-notice").innerText(), /Test data: .*local test sample/, "the stand-in providers are said to be test data, not the real catalog");
    const candidates = page.getByTestId("package-candidate");
    const offered = await candidates.allInnerTexts();
    assert.ok(offered.length >= 1 && offered.length <= 5, `a short list: ${offered.length}`);
    assert.match(offered[0], /Greek Yogurt 2% Fat[\s\S]*Hillside[\s\S]*Open Food Facts[\s\S]*73 kcal/, "the closest record first, with its brand, source and the provider's own values");
    assert.equal(await prisma.foodEntry.count({ where: { userId: user.id } }), 0, "nothing logged before the person confirms");
    step("chromium: a package photo with no barcode is read for its words, searched once by brand and name, and the closest provider records offered with their sources, marked as test data here");

    // Confirm one: its record is cached as structured food, then the usual amount sheet logs it.
    await candidates.first().click();
    await page.getByTestId("barcode-found").waitFor({ timeout: 15000 });
    assert.match(await page.getByTestId("found-how").innerText(), /Matched by the words on your photo: check it against the package/);
    assert.match(await page.getByTestId("barcode-source").innerText(), /Open Food Facts/);
    await page.getByTestId("found-back").click();
    await page.getByTestId("package-candidate").first().waitFor();
    await page.getByTestId("package-candidate").first().click();
    await page.getByTestId("barcode-confirm").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("food-provenance").waitFor();
    assert.match(await dialog.innerText(), /Open Food Facts · 8800000000103/);
    await dialog.getByRole("button", { name: /^Add to / }).click();
    await dialog.waitFor({ state: "detached", timeout: 15000 });
    const entry = await prisma.foodEntry.findFirst({ where: { userId: user.id }, include: { food: true } });
    assert.deepEqual([entry.food.source, entry.food.sourceId], ["OPEN_FOOD_FACTS", "8800000000103"], "logged from the provider's record, with its values, never the photo's");
    assert.equal(Number(entry.food.kcalPer100), 73);
    step("chromium: the person confirms a candidate (or goes back to the others); the provider's record is cached and logged with its own values");

    // Changing the words searches again, in the sheet; the full search is still there.
    await openScanner(page);
    await page.getByTestId("barcode-photo").setInputFiles({ name: "front.jpg", mimeType: "image/jpeg", buffer: await packageFront() });
    await page.getByTestId("package-matches").waitFor({ timeout: 60000 });
    await page.getByTestId("package-query").fill("Nothing Like This");
    await page.getByTestId("package-search").click();
    await page.getByTestId("package-no-match").waitFor({ timeout: 15000 });
    await page.getByTestId("package-query").fill("Greek Yogurt");
    await page.getByTestId("package-full-search").click();
    await page.getByTestId("barcode-scan").waitFor({ state: "detached" });
    assert.equal(await page.getByLabel("Search foods").inputValue(), "Greek Yogurt");
    step("chromium: no match says so and offers the fallbacks; the words can be edited and searched again, or opened in the full food search");

    await openScanner(page);
    const blank = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#f4f4f4" } }).jpeg().toBuffer();
    await page.getByTestId("barcode-photo").setInputFiles({ name: "blur.jpg", mimeType: "image/jpeg", buffer: blank });
    await page.getByTestId("package-words").waitFor({ timeout: 60000 });
    assert.match(await page.getByTestId("package-words").innerText(), /No barcode and no clear words/);
    assert.equal(await page.getByTestId("package-search").isDisabled(), true, "nothing to search until the person types");
    assert.equal(await page.getByTestId("package-label-scan").getAttribute("href"), "/nutrition/scan");
    step("chromium: an unreadable photo says so, and offers a name search, the label scan or a food of their own");
  } finally { await browser.close(); }
}

(async () => {
  await target.verifyServer();
  const cola = await barcodePng(COLA);
  const video = path.join(TMP, "cola.y4m");
  await y4m(cola, video);
  await chromiumCamera(video);
  await chromiumTwoCameras();
  await chromiumDenied();
  const generated = await barcodePng(GENERATED);
  for (const name of ["chromium", "firefox", "webkit"]) await photo(name, generated);
  await packagePhoto();
  console.log("ALL BARCODE CHECKS PASSED");
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { fs.rmSync(TMP, { recursive: true, force: true }); await prisma.$disconnect(); });
