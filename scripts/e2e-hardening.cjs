// End-to-end test of Phase 3.6 in real browsers: food matching, provenance, duplicate submissions and
// saving, through the real server and SDK, with no paid requests. The app runs with ANTHROPIC_BASE_URL
// pointing at scripts/stub-label-provider.cjs, both model settings set to stub names, and food searches
// pointing at scripts/stub-food-apis.cjs.
// Usage: BASE_URL=... DATABASE_URL=<local test database> LABEL_STUB_URL=... SHOTS_DIR=... node scripts/e2e-hardening.cjs
"use strict";
const assert = require("node:assert/strict");
const playwright = require("playwright");
const sharp = require("sharp");
const { fixtures } = require("./lib/pdf-fixtures.cjs");

const { completeOnboarding } = require("./lib/e2e-onboarding.cjs");
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

async function signUp(page) {
  const email = `hard${Date.now()}${Math.floor(Math.random() * 1e6)}@test.dev`;
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
  await completeOnboarding(page);
}

async function photo() {
  const width = 900, height = 600;
  const px = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) px.set(y < height / 2 ? [200, 120, 60] : [240, 240, 230], (y * width + x) * 3);
  return sharp(px, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

async function runBrowser(name, buffer) {
  console.log(`--- ${name}`);
  const browser = await playwright[name].launch(target.launchOptions(name));
  const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 390, height: 844 } }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => {
    if (name === "webkit" && /[?&]_rsc=\S* due to access control checks/.test(e.message)) return;
    errors.push(e.message);
  });
  await signUp(page);
  await stub.reset();

  const json = (path) => page.evaluate((p) => fetch(p).then((r) => r.json()), path);
  const foods = async () => (await json("/api/foods")).foods;
  const diary = async () => (await json("/api/nutrition/day")).meals.flatMap((m) => m.entries);
  const postFood = (body) => page.evaluate((b) => fetch("/api/foods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json()), body);
  const results = () => page.getByTestId("food-result");
  const dialog = () => page.getByRole("dialog");
  const hydrated = (locator) => locator.elementHandle().then((el) => page.waitForFunction((e) => Object.keys(e).some((key) => key.startsWith("__reactProps")), el));
  const search = async (q) => {
    const box = page.getByLabel("Search foods");
    await box.waitFor();
    await hydrated(box);
    const answered = page.waitForResponse((r) => r.url().includes("/api/foods/search") && new URL(r.url()).searchParams.get("q") === q);
    await box.fill(q);
    await answered;
    await page.getByText("Searching…").waitFor({ state: "hidden" });
  };
  const openAdd = (meal = "LUNCH") => page.goto(`${BASE}/nutrition/add?meal=${meal}`);
  const pickResult = async (text) => { await results().filter({ hasText: text }).first().click(); await dialog().waitFor(); };
  const quantity = () => dialog().getByRole("textbox").first();
  const addButton = () => dialog().getByRole("button", { name: /^Add to / });
  const closeButton = () => dialog().getByRole("button", { name: "Close" });
  /** Two clicks in one task, before any re-render can disable the button. */
  const clickTwiceAtOnce = (locator) => locator.evaluate((el) => { el.click(); el.click(); });
  // The server refuses a second upload from one user, so only the browser's own requests show the client guard working.
  const browserPosts = (path) => { const seen = []; page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === path) seen.push(r.url()); }); return seen; };

  /** Holds matching writes until released, and records what was sent. */
  const hold = async (pattern, method = "POST") => {
    const seen = [];
    let release = () => {};
    const released = new Promise((resolve) => { release = resolve; });
    const handler = async (route) => {
      if (route.request().method() !== method) return route.continue();
      seen.push(route.request().headers()["idempotency-key"] ?? null);
      await released;
      await route.continue();
    };
    await page.route(pattern, handler);
    return { seen, release, done: () => page.unroute(pattern, handler) };
  };
  /** The server does the work, then the answer is lost: what a dropped connection looks like. */
  const loseFirstAnswer = async (pattern) => {
    const keys = [];
    let lost = false;
    const handler = async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      keys.push(route.request().headers()["idempotency-key"]);
      if (lost) return route.continue();
      lost = true;
      await route.fetch();
      await route.abort("connectionreset");
    };
    await page.route(pattern, handler);
    return { keys, done: () => page.unroute(pattern, handler) };
  };
  const failFirstRequest = async (pattern) => {
    let failed = false;
    const handler = async (route) => {
      if (route.request().method() !== "POST" || failed) return route.continue();
      failed = true;
      await route.abort("connectionrefused");
    };
    await page.route(pattern, handler);
    return { done: () => page.unroute(pattern, handler) };
  };
  const ENTRIES = "**/api/nutrition/entries", FOODS = "**/api/foods";

  // ─── Matching ────────────────────────────────────────────────────────────

  // 1. Similar names stay separate records, with their sources visible, and nothing is chosen.
  const twin = { basisUnit: "G", servingLabel: "1 pot", servingAmount: 100, perServing: { kcal: 100, protein: 9, carbs: 5, fat: 4 } };
  await page.goto(`${BASE}/nutrition`);
  await postFood({ ...twin, name: "Yogurt, Greek, homemade", brand: "Kitchen" });
  await postFood({ ...twin, name: "Yogurt, Greek, homemade", brand: "Kitchen", perServing: { ...twin.perServing, kcal: 180 } });
  await openAdd();
  await search("greek yogurt");
  await results().nth(5).waitFor();
  assert.equal(await results().count(), 6, "2 custom, 2 USDA and 2 Open Food Facts");
  const sources = await page.getByTestId("food-source").evaluateAll((els) => els.map((el) => el.dataset.source));
  assert.deepEqual(sources, ["CUSTOM", "CUSTOM", "USDA", "USDA", "OPEN_FOOD_FACTS", "OPEN_FOOD_FACTS"]);
  const badges = await page.getByTestId("food-source").allInnerTexts();
  assert.deepEqual(badges, ["My food", "My food", "USDA · SR Legacy", "USDA · Foundation", "Open Food Facts", "Open Food Facts"]);
  const rows = await results().allInnerTexts();
  assert.equal(rows.filter((r) => /Yogurt, Greek, homemade/.test(r)).length, 2, "two foods with one name aren't merged");
  // Two records with one name have no set order between them, only their own values.
  assert.deepEqual(rows.slice(0, 2).map((r) => r.match(/(\d+) kcal/)[1]).sort(), ["100", "180"], "each keeps its own values");
  assert.equal(rows.filter((r) => /Hillside/.test(r)).length, 2, "brand is shown");
  const honey = rows.find((r) => /Greek Yogurt Honey/.test(r));
  assert.match(honey, /Incomplete/);
  assert.match(honey, /Missing: fat\. Not counted as 0\./);
  assert.match(honey, /F —/, "a missing value isn't shown as a number");
  assert.equal(await dialog().count(), 0, "nothing is chosen");
  await page.screenshot({ path: `${SHOTS}hardening-${name}-matching.png`, fullPage: true });
  step("similar names stay separate, with source, brand and missing values shown, and nothing chosen");

  // 2. A lone result is still not chosen.
  await search("sirloin");
  await results().filter({ hasText: "sirloin" }).waitFor();
  assert.equal(await results().count(), 1);
  await page.waitForTimeout(500);
  assert.equal(await dialog().count(), 0, "a single result isn't chosen automatically");
  assert.deepEqual(await diary(), []);
  step("a single result isn't chosen automatically");

  // 3. An incomplete record says what's missing, logs nulls rather than zeros, and the diary says so.
  await search("white rice");
  await pickResult("no energy reported");
  assert.match(await page.getByTestId("food-provenance").innerText(), /USDA FoodData Central record.*Missing: calories, carbs, fat\. Not counted as 0\./);
  await quantity().fill("2");
  await addButton().click();
  await dialog().waitFor({ state: "hidden" });
  const [incomplete] = await diary();
  assert.equal(incomplete.foodSource, "USDA");
  assert.equal(incomplete.nutrients.kcal, null, "missing stays null");
  assert.equal(incomplete.nutrients.fat, null);
  await page.goto(`${BASE}/nutrition`);
  assert.match(await page.getByTestId("entry-missing").first().innerText(), /Missing: calories, carbs, fat/);
  await page.getByRole("button", { name: /no energy reported/ }).click();
  assert.equal(await page.getByTestId("entry-provenance").getAttribute("data-source"), "USDA");
  await closeButton().click();
  step("an incomplete record says what's missing, logs nulls, and the diary shows source and gaps");

  // ─── Logging ─────────────────────────────────────────────────────────────

  let entries = (await diary()).length;

  // 4. Two clicks at once, with the sheet and its fields locked until the answer.
  await openAdd();
  await search("banana");
  await pickResult("Bananas, raw");
  await quantity().fill("2");
  let held = await hold(ENTRIES);
  await clickTwiceAtOnce(addButton());
  await page.waitForTimeout(400);
  assert.equal(held.seen.length, 1, "two clicks at once send one request");
  assert.equal(await quantity().isDisabled(), true, "the amount can't change during a save");
  assert.equal(await dialog().getByRole("combobox").first().isDisabled(), true);
  assert.equal(await closeButton().isDisabled(), true);
  await page.keyboard.press("Escape");
  await page.mouse.click(195, 10); // the backdrop
  await page.waitForTimeout(100);
  assert.equal(await dialog().count(), 1, "Escape and the backdrop can't abandon a save");
  held.release();
  await dialog().waitFor({ state: "hidden" });
  await held.done();
  entries++;
  assert.equal((await diary()).length, entries, "one entry");
  step("two clicks at once log once, and the sheet stays locked until the answer");

  // 5. A lost answer: the retry uses the same key, and logs nothing more.
  await pickResult("Bananas, raw");
  await quantity().fill("3");
  let lost = await loseFirstAnswer(ENTRIES);
  await addButton().click();
  await dialog().getByText("We can't tell whether this was saved").waitFor();
  assert.equal(await quantity().inputValue(), "3", "what was typed stays");
  assert.equal((await diary()).length, entries + 1, "the server did save it");
  await addButton().click();
  await dialog().waitFor({ state: "hidden" });
  await lost.done();
  entries++;
  assert.equal(lost.keys.length, 2);
  assert.equal(lost.keys[0], lost.keys[1], "a retry sends the same key");
  assert.equal((await diary()).length, entries, "the retry added nothing");
  step("a retry after a lost answer logs nothing more");

  // 6. Logging the same food again on purpose makes a second entry.
  await pickResult("Bananas, raw");
  await quantity().fill("3");
  const repeat = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/nutrition/entries")) repeat.push(r.headers()["idempotency-key"]); });
  await addButton().click();
  await dialog().waitFor({ state: "hidden" });
  entries++;
  assert.equal((await diary()).length, entries, "a deliberate repeat is a new entry");
  assert.notEqual(repeat[0], lost.keys[0], "a new opening of the sheet is a new key");
  step("logging the same food again on purpose makes a second entry");

  // 7. Changing the amount after a lost answer can't quietly make a second entry.
  await pickResult("Bananas, raw");
  await quantity().fill("4");
  lost = await loseFirstAnswer(ENTRIES);
  await addButton().click();
  await dialog().getByText("We can't tell whether this was saved").waitFor();
  await quantity().fill("5");
  await addButton().click();
  await dialog().getByText("already saved this with different values").waitFor();
  await lost.done();
  entries++;
  const banana = (await diary()).filter((e) => /Bananas/.test(e.foodName)).map((e) => e.quantity);
  assert.equal((await diary()).length, entries, "only the first attempt saved");
  assert.equal(banana.includes(5), false);
  await closeButton().click();
  step("a changed amount after a lost answer is refused, not saved as a second entry");

  // 8. A request that never arrived can simply be retried.
  await pickResult("Bananas, raw");
  await quantity().fill("6");
  const failed = await failFirstRequest(ENTRIES);
  await addButton().click();
  await dialog().getByText("We can't tell whether this was saved").waitFor();
  assert.equal((await diary()).length, entries, "nothing arrived");
  await addButton().click();
  await dialog().waitFor({ state: "hidden" });
  await failed.done();
  entries++;
  assert.equal((await diary()).length, entries);
  step("a request that never arrived can be retried, and saves once");

  // A request that outlasts the client's deadline: the sheet unlocks, and the retry keeps its key.
  await page.goto(`${BASE}/nutrition/add?meal=LUNCH`);
  await search("banana");
  await pickResult("Bananas, raw");
  await quantity().fill("7");
  const slowKeys = [];
  let finishSlow = () => {};
  const slowDone = new Promise((resolve) => { finishSlow = resolve; });
  const slow = async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    slowKeys.push(route.request().headers()["idempotency-key"]);
    if (slowKeys.length > 1) return route.continue();
    await route.fetch(); // the server finishes, and the answer never comes
    await slowDone;
    await route.abort().catch(() => {});
  };
  await page.route(ENTRIES, slow);
  await addButton().click();
  await page.waitForTimeout(200);
  assert.equal(await closeButton().isDisabled(), true, "locked while waiting");
  await dialog().getByText("We can't tell whether this was saved").waitFor({ timeout: 40_000 });
  assert.equal(await closeButton().isEnabled(), true, "the deadline unlocks the sheet");
  assert.equal(await quantity().inputValue(), "7");
  assert.equal((await diary()).length, entries + 1, "the server did save it");
  await addButton().click();
  await dialog().waitFor({ state: "hidden" });
  finishSlow();
  await page.unroute(ENTRIES, slow);
  entries++;
  assert.equal(slowKeys.length, 2);
  assert.equal(slowKeys[0], slowKeys[1], "a retry after a timeout sends the same key");
  assert.equal((await diary()).length, entries, "the retry added nothing");
  step("a request past the deadline unlocks the sheet, and its retry keeps the key and saves nothing more");

  // 9. A diary edit is locked while it saves.
  await page.goto(`${BASE}/nutrition`);
  await page.getByRole("button", { name: /Bananas, raw/ }).first().click();
  await dialog().waitFor();
  await page.getByTestId("entry-provenance").waitFor();
  held = await hold("**/api/nutrition/entries/*", "PATCH");
  await clickTwiceAtOnce(dialog().getByRole("button", { name: "Save changes" }));
  await page.waitForTimeout(300);
  assert.equal(held.seen.length, 1, "two clicks at once send one edit");
  assert.equal(await quantity().isDisabled(), true);
  assert.equal(await closeButton().isDisabled(), true);
  held.release();
  await dialog().waitFor({ state: "hidden" });
  await held.done();
  step("a diary edit is locked while it saves, and is sent once");

  // ─── Custom foods ────────────────────────────────────────────────────────

  const custom = async () => {
    await openAdd();
    const box = page.getByLabel("Search foods");
    await box.waitFor();
    await hydrated(box);
    await page.getByRole("button", { name: "+ Custom food" }).click();
    await dialog().waitFor();
    await dialog().getByLabel("Name", { exact: true }).fill("Trail mix");
    await dialog().getByLabel("Size (g)").fill("40");
    await dialog().getByLabel("kcal").fill("200");
    await dialog().getByLabel("Prot g").fill("5");
    await dialog().getByLabel("Carb g").fill("20");
    await dialog().getByLabel("Fat g").fill("12");
  };
  const saveCustom = () => dialog().getByRole("button", { name: "Save and continue" });
  const opened = () => dialog().getByRole("heading", { name: "Trail mix" }).waitFor();
  let foodCount = (await foods()).length;

  // 10. An ambiguous number isn't guessed.
  await custom();
  await dialog().getByLabel("kcal").fill("1,200");
  const before = (await foods()).length;
  await saveCustom().click();
  await dialog().getByText("Enter serving size, calories, protein, carbs and fat").waitFor();
  assert.equal((await foods()).length, before, '"1,200" is refused, not saved as 1.2');
  step('"1,200" is refused in a custom food, not read as 1.2');

  // 11. Two clicks at once, fields locked, one food.
  await dialog().getByLabel("kcal").fill("200");
  held = await hold(FOODS);
  await clickTwiceAtOnce(saveCustom());
  await page.waitForTimeout(300);
  assert.equal(held.seen.length, 1, "two clicks at once send one request");
  assert.equal(await dialog().getByLabel("Name", { exact: true }).isDisabled(), true);
  assert.equal(await closeButton().isDisabled(), true);
  held.release();
  await opened();
  await held.done();
  foodCount++;
  assert.equal((await foods()).length, foodCount);
  assert.equal(await page.getByTestId("food-provenance").innerText().then((t) => /label|scan/i.test(t)), false, "never claims to be from a label");
  await closeButton().click();
  step("a custom food is saved once, with its fields locked, and doesn't claim a label");

  // 12. A lost answer, then a retry.
  await custom();
  lost = await loseFirstAnswer(FOODS);
  await saveCustom().click();
  await dialog().getByText("We can't tell whether this was saved").waitFor();
  assert.equal(await dialog().getByLabel("Name", { exact: true }).inputValue(), "Trail mix", "what was typed stays");
  await saveCustom().click();
  await opened();
  await lost.done();
  foodCount++;
  assert.equal(lost.keys[0], lost.keys[1]);
  assert.equal((await foods()).length, foodCount, "the retry created nothing more");
  await closeButton().click();
  step("a retry after a lost answer creates one custom food");

  // ─── Label review ────────────────────────────────────────────────────────

  const input = (id) => page.getByTestId(`input-${id}`);
  const file = { name: "label.jpg", mimeType: "image/jpeg", buffer };
  const scan = async () => {
    await stub.scenario("good");
    await page.goto(`${BASE}/nutrition/scan`);
    await page.locator("#label-photo").waitFor();
    await page.locator("#label-photo").setInputFiles(file);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByTestId("prepared-image").waitFor();
  };
  const entriesBeforeLabels = (await diary()).length;

  // 13. Two clicks at once on a paid action send one request.
  await stub.reset();
  await scan();
  const scanPosts = browserPosts("/api/nutrition/label-scans");
  await clickTwiceAtOnce(page.getByRole("button", { name: "Use this" }));
  await page.getByTestId("scan-result").waitFor();
  assert.equal(scanPosts.length, 1, "two clicks at once send one upload");
  assert.equal((await stub.requests()).length, 1, "one scan, one provider request");
  step("two clicks at once on a scan send one provider request");

  // 14. Nothing can change during a save, and what's saved is what was previewed.
  await input("protein").fill("4.5");
  const preview = await Promise.all(["kcal", "protein", "carbs", "fat"].map((key) => page.getByTestId(`preview-per100-${key}`).innerText()));
  await page.getByTestId("confirm-values").check();
  held = await hold(FOODS);
  await clickTwiceAtOnce(page.getByTestId("save-food"));
  await page.getByTestId("saving-note").waitFor();
  await page.waitForTimeout(300);
  assert.equal(held.seen.length, 1, "two clicks at once send one request");
  for (const id of ["name", "protein", "serving-amount", "serving-unit"]) assert.equal(await input(id).isDisabled(), true, `${id} is locked`);
  assert.equal(await page.getByTestId("confirm-values").isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Scan another label" }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Zoom to full size" }).isEnabled(), true, "the image can still be checked");
  assert.equal(await input("protein").inputValue(), "4.5");
  held.release();
  await page.getByTestId("saved-food").waitFor();
  await held.done();
  foodCount++;
  const saved = await Promise.all(["kcal", "protein", "carbs", "fat"].map((key) => page.getByTestId(`saved-per100-${key}`).innerText()));
  assert.deepEqual(saved, preview, "what was saved is what was previewed");
  assert.equal((await foods()).length, foodCount);
  assert.match(await page.getByTestId("saved-provenance").innerText(), /not independent verification/);
  step("a label form is locked during its save, and what's saved matches the preview");

  // 15. A failure keeps every correction, and a lost answer can't make a second food.
  await scan();
  await page.getByRole("button", { name: "Use this" }).click();
  await page.getByTestId("scan-result").waitFor();
  await input("name").fill("Corrected Oats");
  await input("protein").fill("4.5");
  await page.getByTestId("confirm-values").check();
  lost = await loseFirstAnswer(FOODS);
  await page.getByTestId("save-food").click();
  await page.getByText("We can't tell whether this was saved").waitFor();
  assert.equal(await input("name").inputValue(), "Corrected Oats");
  assert.equal(await input("protein").inputValue(), "4.5");
  assert.equal(await page.getByTestId("confirm-values").isChecked(), true);
  assert.equal(await input("protein").isEnabled(), true, "the form is usable again");
  await page.getByTestId("save-food").click();
  await page.getByTestId("saved-food").waitFor();
  await lost.done();
  foodCount++;
  assert.equal(lost.keys[0], lost.keys[1]);
  assert.equal((await foods()).length, foodCount, "the retry created nothing more");
  assert.equal((await foods()).filter((f) => f.name === "Corrected Oats").length, 1);
  assert.equal((await diary()).length, entriesBeforeLabels, "saving a label logs nothing");
  step("a failed save keeps corrections, and a retry after a lost answer saves once");

  // 16. A PDF label: the same rules, and leaving mid-save is blocked.
  await stub.reset();
  await page.goto(`${BASE}/nutrition/scan`);
  await page.locator("#label-photo").waitFor();
  await page.locator("#label-photo").setInputFiles({ name: "oats.pdf", mimeType: "application/pdf", buffer: fixtures.usLabel() });
  await page.getByTestId("pdf-pages").waitFor();
  await page.getByTestId("pdf-page-1").click();
  await page.getByTestId("pdf-page-image").waitFor();
  await page.getByTestId("use-section-0").click();
  await page.getByTestId("scan-result").waitFor();
  await input("name").fill("PDF Oats");
  await page.getByTestId("confirm-values").check();
  const anotherPage = page.getByRole("button", { name: "Choose another page" });
  assert.equal(await anotherPage.isEnabled(), true);
  held = await hold(FOODS);
  await page.getByTestId("save-food").click();
  await page.getByTestId("saving-note").waitFor();
  assert.equal(await anotherPage.isDisabled(), true, "a save can't be abandoned");
  assert.equal(await input("name").isDisabled(), true);
  held.release();
  await page.getByTestId("saved-food").waitFor();
  await held.done();
  foodCount++;
  assert.equal(await anotherPage.isEnabled(), true);
  assert.equal((await foods()).length, foodCount);
  assert.equal((await stub.requests()).length, 0, "a text PDF uses no AI");
  step("a PDF label is locked during its save, and can't be left mid-save");

  // ─── Meal photos ─────────────────────────────────────────────────────────

  // 17. An AI suggestion stays a suggestion, even after a record is found.
  await stub.reset();
  await stub.scenario("mealGood");
  await page.goto(`${BASE}/nutrition/meal`);
  await page.locator("#meal-photo").waitFor();
  await page.locator("#meal-photo").setInputFiles(file);
  const mealPosts = browserPosts("/api/nutrition/meal-identifications");
  await clickTwiceAtOnce(page.getByTestId("meal-identify"));
  await page.getByTestId("meal-review").waitFor();
  assert.equal(mealPosts.length, 1, "two clicks at once send one upload");
  assert.equal((await stub.requests()).length, 1, "one photo, one provider request");
  const rice = page.getByTestId("meal-item").nth(1);
  await rice.getByTestId("meal-accept").click();
  await rice.getByTestId("meal-find").click();
  await page.getByTestId("meal-type").selectOption("DINNER");
  assert.match(await page.getByTestId("meal-search-note").innerText(), /Nothing is chosen for you/);
  await page.getByTestId("food-result").filter({ hasText: "Premium White Rice" }).waitFor();
  assert.ok(await results().count() >= 2, "a generic and a branded record are both offered");
  assert.equal(await dialog().count(), 0, '"white rice" doesn\'t become a brand');
  const logged = (await diary()).length;
  await pickResult("Premium White Rice");
  assert.equal(await quantity().inputValue(), "", "the amount is the person's own");
  assert.equal(await addButton().isDisabled(), true);
  await quantity().fill("2");
  await addButton().click();
  await dialog().waitFor({ state: "hidden" });
  const record = rice.getByTestId("meal-logged-record");
  await record.waitFor();
  const told = await record.innerText();
  assert.match(told, /Added to Dinner/);
  assert.match(told, /You chose Premium White Rice \(Goldgrain\)\. Open Food Facts\./);
  assert.match(told, /You accepted the AI's suggestion, white rice\./);
  assert.match(told, /Finding a record doesn't confirm that the AI was right/);
  assert.doesNotMatch(told, /\bverified\b/i);
  const after = await diary();
  assert.equal(after.length, logged + 1);
  const entry = after.find((e) => e.foodName === "Premium White Rice");
  assert.equal(entry.foodSource, "OPEN_FOOD_FACTS");
  assert.equal(entry.mealType, "DINNER");
  assert.equal(entry.amount, 90, "the record's serving and the typed amount");
  assert.equal(entry.nutrients.kcal, 319.5, "from the chosen record: 355 per 100 g");
  await page.screenshot({ path: `${SHOTS}hardening-${name}-meal.png`, fullPage: true });
  step("a suggestion stays a suggestion: the person chooses the record, and nutrition comes only from it");

  // ─── Keyboard ────────────────────────────────────────────────────────────

  const focusInDialog = () => page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false);
  const focusedTestId = () => page.evaluate(() => document.activeElement?.dataset?.testid ?? null);
  /** Tabs around, and reports anything outside the sheet that received focus. */
  const tabEscapes = async (presses = 40) => {
    const outside = [];
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press("Tab");
      const where = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) return null;
        return document.querySelector('[role="dialog"]')?.contains(el) ? null : el.dataset.testid || el.getAttribute("aria-label") || el.tagName;
      });
      if (where) outside.push(where);
    }
    return outside;
  };

  // 18. While a meal entry saves, nothing behind the sheet can change the review.
  const chicken = page.getByTestId("meal-item").nth(0);
  await chicken.getByTestId("meal-accept").click();
  await chicken.getByTestId("meal-find").click();
  await results().filter({ hasText: "Chicken" }).waitFor();
  await page.setViewportSize({ width: 1280, height: 900 });
  await pickResult("Chicken");
  const box = await dialog().boundingBox();
  assert.ok(box.y >= 0 && box.y + box.height <= 900, "on a wide screen the sheet is on screen, whatever the page's layout");
  await page.setViewportSize({ width: 390, height: 844 });
  await quantity().fill("1");
  held = await hold(ENTRIES);
  await addButton().click();
  await page.waitForTimeout(150);
  let reachedName = false;
  for (let i = 0; i < 40 && !reachedName; i++) {
    await page.keyboard.press("Tab");
    reachedName = (await focusedTestId()) === "meal-name";
  }
  if (reachedName) await page.keyboard.type("x"); // what someone at a keyboard could do, if they could get there
  held.release();
  await dialog().waitFor({ state: "hidden" });
  await held.done();
  assert.equal(await chicken.getAttribute("data-status"), "logged", "a saved entry is shown as logged");
  assert.equal(reachedName, false, "the page behind a sheet can't be reached by keyboard");
  assert.equal(await page.getByTestId("meal-name").nth(1).evaluate((el) => { el.focus(); return document.activeElement === el; }), false, "nor by moving focus to it");
  step("while an entry saves, the keyboard can't reach the review behind it, and a save always shows as logged");

  // 19. A sheet takes focus, keeps it, gives it back, and never traps anyone.
  await page.goto(`${BASE}/nutrition`);
  await page.getByRole("link", { name: "Add food to Lunch" }).click();
  await page.waitForURL("**/nutrition/add**");
  await search("banana");
  const trigger = results().filter({ hasText: "Bananas, raw" }).first();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await dialog().waitFor();
  assert.equal(await focusInDialog(), true, "focus moves into the sheet");
  assert.deepEqual(await tabEscapes(), [], "Tab stays in the sheet");
  await page.keyboard.press("Escape");
  await dialog().waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => document.querySelectorAll("[inert]").length), 0, "the page is usable again");
  assert.equal(await trigger.evaluate((el) => el === document.activeElement), true, "focus returns to what opened it");

  // Locked only while saving: a failed save hands back focus, and Escape works again.
  await trigger.focus();
  await page.keyboard.press("Enter");
  await dialog().waitFor();
  await quantity().fill("1");
  const refused = await failFirstRequest(ENTRIES);
  await addButton().focus();
  await page.keyboard.press("Enter");
  await dialog().getByText("We can't tell whether this was saved").waitFor();
  await refused.done();
  assert.equal(await focusInDialog(), true, "focus isn't lost when the save ends");
  await page.keyboard.press("Escape");
  await dialog().waitFor({ state: "hidden" });
  step("a sheet takes focus, keeps it, returns it, and isn't a trap once a save ends");

  // 20. Leaving by browser navigation leaves nothing behind.
  await trigger.click();
  await dialog().waitFor();
  await page.goBack();
  await page.waitForURL((url) => !url.pathname.includes("/add"));
  await page.getByRole("link", { name: "Add food to Lunch" }).waitFor();
  assert.equal(await dialog().count(), 0);
  assert.equal(await page.evaluate(() => document.querySelectorAll("[inert]").length), 0, "nothing stays inert after navigating away");
  await page.getByRole("link", { name: "Add food to Lunch" }).focus();
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), "A", "the next page takes focus");
  step("navigating away from an open sheet leaves the next page fully usable");

  // ─── Numbers in the rest of the app ──────────────────────────────────────

  // 21. "1,200" fails with a clear answer everywhere it can be typed.
  const { exercises: library } = await json("/api/exercises");
  const workoutId = await page.evaluate(async (exerciseId) => {
    const post = (path, body) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    const { session } = await post("/api/sessions", { name: "Number test" });
    await post(`/api/sessions/${session.id}/exercises`, { exerciseId });
    return session.id;
  }, library[0].id);
  const sets = async () => (await json(`/api/sessions/${workoutId}`)).session.exercises[0].sets;
  await page.goto(`${BASE}/workouts/session/${workoutId}`);
  const weight = page.getByLabel("Weight", { exact: true });
  await weight.waitFor();
  await hydrated(weight);
  await weight.fill("1,250");
  await page.getByLabel("Reps", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Log set" }).click();
  await page.getByTestId("set-input-error").waitFor();
  assert.deepEqual(await sets(), [], "an unclear weight logs nothing");
  await weight.fill("62,5");
  await page.getByRole("button", { name: "Log set" }).click();
  await page.getByLabel("Set 1 weight").waitFor();
  assert.equal(await page.getByTestId("set-input-error").count(), 0);
  assert.equal((await sets())[0].weightKg, 62.5, "a decimal comma still works");
  const logged1 = page.getByLabel("Set 1 weight");
  await logged1.fill("1,250");
  await page.getByLabel("Set 1 reps").focus();
  await page.waitForTimeout(150);
  assert.equal(await logged1.inputValue(), "62.5", "an unclear edit shows the saved value again");
  assert.equal((await sets())[0].weightKg, 62.5);
  await logged1.fill("70");
  await page.getByLabel("Set 1 reps").focus();
  await page.waitForFunction(() => document.querySelector('[aria-label="Set 1 weight"]')?.value === "70");
  await page.waitForTimeout(200);
  assert.equal((await sets())[0].weightKg, 70, "an ordinary edit still saves");

  await page.goto(`${BASE}/profile`);
  const goal = page.getByLabel(/^Goal weight/);
  await goal.waitFor();
  await hydrated(goal);
  await goal.fill("1,200");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Please enter a valid goal weight.").waitFor();
  await goal.fill("75,5");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Please enter a valid goal weight."));
  await page.waitForTimeout(400);
  assert.equal((await json("/api/profile")).profile.goalWeightKg, 75.5, "the goal weight saved with its decimal comma");

  await page.goto(`${BASE}/nutrition/targets`);
  const calories = page.getByLabel("Calories (kcal/day)");
  await calories.waitFor();
  await hydrated(calories);
  const targetBefore = (await json("/api/nutrition/targets")).current;
  await page.getByLabel("Protein (g)").fill("100");
  await page.getByLabel("Fat (g)").fill("50");
  await calories.fill("1,200");
  await page.getByRole("button", { name: /^Save/ }).click();
  await page.getByText("Enter each target as a plain number").waitFor();
  assert.deepEqual((await json("/api/nutrition/targets")).current, targetBefore, "nothing was saved");
  step('"1,200" gets a clear answer in workouts, profile and targets, and decimal commas still work');

  assert.deepEqual(errors, [], "no page errors");
  await browser.close();
}

(async () => {
  await target.verifyServer();
  const buffer = await photo();
  for (const name of BROWSERS) await runBrowser(name, buffer);
  console.log("ALL HARDENING CHECKS PASSED");
})().catch((err) => { console.error(err); process.exit(1); });
