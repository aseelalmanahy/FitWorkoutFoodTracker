// End-to-end test of meal-photo identification in real browsers, through the real server and SDK,
// with no paid requests: the app runs with ANTHROPIC_BASE_URL pointing at scripts/stub-label-provider.cjs
// and food searches pointing at scripts/stub-food-apis.cjs.
// Usage: BASE_URL=... LABEL_STUB_URL=... SHOTS_DIR=... node scripts/e2e-meal.cjs
// With EXPECT_UNCONFIGURED=1, checks only that a server with no meal model reports that clearly.
"use strict";
const assert = require("node:assert/strict");
const playwright = require("playwright");
const sharp = require("sharp");

const BASE = process.env.BASE_URL;
const STUB = process.env.LABEL_STUB_URL;
const SHOTS = (process.env.SHOTS_DIR || require("node:os").tmpdir()) + "/";
const BROWSERS = (process.env.BROWSERS || "chromium,firefox,webkit").split(",");
const step = (s) => console.log("  ✓", s);
const stub = {
  scenario: (name) => fetch(`${STUB}/__scenario`, { method: "POST", body: JSON.stringify({ name }) }),
  reset: () => fetch(`${STUB}/__reset`, { method: "POST" }),
  requests: () => fetch(`${STUB}/__requests`).then((r) => r.json()),
};

async function signUp(page) {
  const email = `meal${Date.now()}${Math.floor(Math.random() * 1e6)}@test.dev`;
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

async function photo() {
  const width = 900, height = 600;
  const px = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) px.set(y < height / 2 ? [200, 120, 60] : [240, 240, 230], (y * width + x) * 3);
  return sharp(px, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "GPS-SECRET" } } }).toBuffer();
}

async function unconfigured(buffer) {
  const browser = await playwright.chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await signUp(page);
  await page.goto(`${BASE}/nutrition/meal`);
  await page.locator("#meal-photo").setInputFiles({ name: "meal.jpg", mimeType: "image/jpeg", buffer });
  await page.getByTestId("meal-identify").click();
  await page.getByText("Meal identification isn't set up on this server.").waitFor();
  assert.equal(await page.getByTestId("meal-review").count(), 0);
  await page.goto(`${BASE}/nutrition/add`);
  await page.getByLabel("Search foods").waitFor();
  assert.equal(await page.getByRole("link", { name: "Identify foods in a photo" }).count(), 0, "no link to a feature that's off");
  await browser.close();
  console.log("ALL UNCONFIGURED MEAL CHECKS PASSED");
}

async function runBrowser(name, buffer) {
  console.log(`--- ${name}`);
  const browser = await playwright[name].launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [], requests = [], dialogs = [];
  page.on("pageerror", (e) => {
    if (name === "webkit" && /\?_rsc=\S* due to access control checks/.test(e.message)) return;
    errors.push(e.message);
  });
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
  page.on("request", (r) => requests.push({ url: r.url(), method: r.method(), body: r.method() === "POST" ? r.postData() : null }));
  await signUp(page);
  await stub.reset();

  const file = { name: "meal.jpg", mimeType: "image/jpeg", buffer };
  const writes = (path) => requests.filter((r) => r.method !== "GET" && new URL(r.url).pathname.startsWith(path));
  const scanRequests = () => writes("/api/nutrition/meal-identifications").length;
  const foods = () => page.evaluate(() => fetch("/api/foods").then((r) => r.json()).then((b) => b.foods));
  const mealOf = () => page.evaluate(() => fetch("/api/nutrition/day").then((r) => r.json()).then((d) => d.meals.flatMap((m) => m.entries.map(() => m.mealType))));
  const diary = () => page.evaluate(() => fetch("/api/nutrition/day").then((r) => r.json()).then((d) => d.meals.flatMap((m) => m.entries)));
  const open = async () => {
    await page.goto(`${BASE}/nutrition/meal`);
    await page.locator("#meal-photo").waitFor();
    await page.locator("#meal-photo").setInputFiles(file);
    await page.getByTestId("meal-identify").waitFor();
  };
  const identify = async (scenario) => {
    await stub.scenario(scenario);
    await open();
    await page.getByTestId("meal-identify").click();
  };
  const reviewed = async (scenario) => { await identify(scenario); await page.getByTestId("meal-review").waitFor(); };
  const items = () => page.getByTestId("meal-item");
  const item = (i) => items().nth(i);

  // 0. A photo chosen before the page is interactive isn't lost. Scripts are held back until after it's chosen.
  let releaseScripts = () => {};
  const scriptsHeld = new Promise((resolve) => { releaseScripts = resolve; });
  await page.route("**/_next/static/chunks/**", async (route) => { await scriptsHeld; await route.continue(); });
  const loading = page.goto(`${BASE}/nutrition/meal`, { waitUntil: "commit" });
  await page.locator("#meal-photo").waitFor();
  await page.locator("#meal-photo").setInputFiles(file);
  releaseScripts();
  await loading;
  await page.getByTestId("meal-identify").waitFor();
  await page.unroute("**/_next/static/chunks/**");
  assert.equal(scanRequests(), 0);
  step("a photo chosen before the page is interactive isn't lost");

  // 1. Choosing a photo sends nothing.
  await stub.scenario("mealGood");
  await open();
  await page.waitForTimeout(300);
  assert.equal(scanRequests(), 0, "choosing a photo sends nothing");
  assert.equal((await stub.requests()).length, 0);
  assert.equal(await page.getByTestId("meal-preview").evaluate((img) => img.complete && img.naturalWidth > 0), true);
  await page.getByTestId("meal-identify").click();
  await page.getByTestId("meal-review").waitFor();
  assert.equal(scanRequests(), 1);
  const sent = await stub.requests();
  assert.equal(sent.length, 1, "exactly one request, with no retry");
  step("a photo is sent only on request, exactly once");

  // 2. Only the clean image, and nothing about the person, reaches the provider.
  const source = sent[0].body.messages[0].content[0].source;
  const image = Buffer.from(source.data, "base64");
  assert.equal(image.includes("GPS-SECRET"), false, "no metadata");
  const meta = await sharp(image).metadata();
  assert.equal(meta.exif, undefined);
  assert.deepEqual([meta.width, meta.height], [600, 900], "turned upright first");
  assert.equal(sent[0].headers.cookie, undefined);
  const wire = JSON.stringify(sent[0]);
  for (const c of await ctx.cookies()) assert.equal(wire.includes(c.value), false, `cookie ${c.name}`);
  assert.equal(/@test\.dev/.test(wire), false, "no email");
  assert.equal(sent[0].body.tools, undefined, "no tools offered");
  step("only the clean, upright image reached the provider, with no cookies or details");

  // 3. Suggestions are separate, tentative, and hold no amounts.
  assert.equal(await items().count(), 4);
  const review = page.getByTestId("meal-review");
  const text = await review.innerText();
  assert.match(text, /Unverified/);
  assert.match(text, /Likely chicken breast\./);
  assert.match(text, /Possibly green vegetable, possibly broccoli\./);
  assert.match(text, /This food couldn't be identified\./);
  assert.match(text, /What the AI could see: Sliced pale meat/);
  assert.equal(await item(0).getByTestId("meal-status").innerText(), "Not reviewed");
  for (let i = 0; i < 4; i++) {
    const itemText = await item(i).innerText();
    assert.doesNotMatch(itemText.replace(/grill marks/, ""), /\d|kcal|calorie|gram\b/i, "no amount in a suggestion");
  }
  assert.equal(await page.getByTestId("meal-food-search").count(), 0, "no search until asked");
  assert.deepEqual(requests.filter((r) => /\/api\/foods\/search/.test(r.url)).map((r) => r.url), [], "no search request went out");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await item(0).getByTestId("meal-find").count(), 0, "can't search before accepting");
  assert.equal(await item(3).getByTestId("meal-accept").isDisabled(), true, "an unnamed food can't be accepted");
  assert.deepEqual(await foods(), []);
  assert.deepEqual(await diary(), []);
  assert.equal(writes("/api/nutrition/entries").length, 0);
  await page.screenshot({ path: `${SHOTS}meal-${name}-review.png`, fullPage: true });
  step("separate tentative suggestions, no amounts, nothing searched, saved or logged");

  // 4. The image stays beside the suggestions.
  assert.ok(await page.getByTestId("review-image").evaluate((img) => img.naturalWidth > 0));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const imageBox = await page.getByTestId("review-image").boundingBox();
  const formBox = await item(0).boundingBox();
  assert.ok(imageBox.x + imageBox.width <= formBox.x + 1, "the image is beside the suggestions");
  await page.screenshot({ path: `${SHOTS}meal-${name}-wide.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  step("the image stays beside the suggestions");

  // 5. Correcting, removing, adding, and marking unknown.
  await item(2).getByTestId("meal-remove").click();
  assert.equal(await items().count(), 3, "a false suggestion can be removed");
  await item(1).getByTestId("meal-name").fill("rice");
  assert.match(await item(1).getByTestId("meal-status").innerText(), /Not reviewed, corrected/);
  await item(1).getByTestId("meal-accept").click();
  assert.match(await item(1).getByTestId("meal-status").innerText(), /Accepted by you, corrected/);
  await item(1).getByTestId("meal-name").fill("rice!");
  assert.match(await item(1).getByTestId("meal-status").innerText(), /Not reviewed/, "changing a name needs accepting again");
  assert.equal(await item(1).getByTestId("meal-find").count(), 0);
  await item(1).getByTestId("meal-name").fill("rice");
  await item(1).getByTestId("meal-accept").click();
  await item(0).getByTestId("meal-unknown").click();
  assert.equal(await item(0).getByTestId("meal-name").inputValue(), "");
  assert.equal(await item(0).getAttribute("data-status"), "unknown");
  await item(0).getByTestId("meal-name").fill("chicken");
  await item(0).getByTestId("meal-accept").click();
  await page.getByTestId("meal-add").click();
  assert.equal(await items().count(), 4, "a missed food can be added");
  assert.match(await item(3).innerText(), /Added by you/);
  await item(3).getByTestId("meal-name").fill("banana");
  await item(3).getByTestId("meal-accept").click();
  step("names can be corrected, foods removed, added and marked unknown, and every change needs accepting");

  // 6. The meal has no default, the search doesn't choose, and a quantity must be typed.
  assert.equal(writes("/api/nutrition/entries").length, 0);
  await item(0).getByTestId("meal-find").click();
  const search = page.getByTestId("meal-food-search");
  await search.waitFor();
  const mealChoice = page.getByTestId("meal-type");
  assert.equal(await mealChoice.inputValue(), "", "no meal is chosen for the person");
  assert.equal(await search.getByLabel("Search foods").count(), 0, "no search until a meal is chosen");
  await page.waitForTimeout(450);
  assert.deepEqual(requests.filter((r) => /\/api\/foods\/search/.test(r.url)).map((r) => r.url), [], "no search request until a meal is chosen");
  await mealChoice.selectOption("DINNER");
  await search.getByLabel("Search foods").waitFor();
  assert.equal(await search.getByLabel("Search foods").inputValue(), "chicken", "the accepted name is the query");
  const result = search.getByRole("button", { name: /Chicken, broilers/ }).first();
  await result.waitFor();
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole("dialog").count(), 0, "no food is chosen automatically");
  assert.equal(writes("/api/foods/resolve").length, 0);
  await result.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel("Meal").inputValue(), "DINNER", "the chosen meal is visible before logging");
  assert.match(await dialog.getByRole("button", { name: /^Add to/ }).innerText(), /Add to Dinner/);
  await dialog.getByLabel("Meal").selectOption("LUNCH");
  assert.match(await dialog.getByRole("button", { name: /^Add to/ }).innerText(), /Add to Lunch/, "it can be changed");
  await dialog.getByLabel("Meal").selectOption("DINNER");
  const quantity = dialog.getByLabel(/Servings|Amount/);
  assert.equal(await quantity.inputValue(), "", "no quantity is filled in");
  const add = dialog.getByRole("button", { name: /^Add to/ });
  assert.equal(await add.isDisabled(), true, "it can't be logged without a quantity");
  assert.match(await dialog.innerText(), /Enter a quantity greater than 0/);
  for (const bad of ["0", "abc", "-5"]) {
    await quantity.fill(bad);
    assert.equal(await add.isDisabled(), true, `"${bad}" isn't a quantity`);
  }
  assert.equal(writes("/api/nutrition/entries").length, 0);
  assert.deepEqual(await diary(), []);
  await dialog.getByLabel("Serving size").selectOption({ label: "grams (g)" });
  await dialog.getByLabel(/Amount/).fill("150");
  assert.match(await dialog.innerText(), /This entry · 150 g/);
  assert.equal(await add.isEnabled(), true, "a typed quantity enables logging");
  await page.screenshot({ path: `${SHOTS}meal-${name}-quantity.png`, fullPage: true });
  await add.click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(await item(0).getAttribute("data-status"), "logged");
  assert.match(await item(0).innerText(), /Added to Dinner/);
  assert.deepEqual(await mealOf(), ["DINNER"]);
  step("the meal has no default and can be changed, the search chooses nothing, and an empty, zero or invalid quantity can't be logged");

  // 7. The entry comes only from the chosen record and the typed amount, through the existing endpoint.
  const entries = await diary();
  assert.equal(entries.length, 1, "one entry, only after confirming");
  const posted = JSON.parse(writes("/api/nutrition/entries")[0].body);
  assert.deepEqual(Object.keys(posted).sort(), ["date", "foodId", "mealType", "quantity", "servingId"], "the entry holds only its usual fields");
  assert.equal(posted.quantity, 150);
  assert.equal(posted.servingId, null);
  assert.equal(posted.mealType, "DINNER");
  const record = await page.evaluate((id) => fetch(`/api/foods/${id}`).then((r) => r.json()), posted.foodId);
  assert.ok(Math.abs(entries[0].nutrients.kcal - (record.food.per100.kcal * 150) / 100) < 0.01, "calories are the record's, at the typed amount");
  assert.ok(Math.abs(entries[0].nutrients.protein - (record.food.per100.protein * 150) / 100) < 0.01);
  assert.equal(writes("/api/foods").filter((r) => new URL(r.url).pathname === "/api/foods").length, 0, "no food was created");
  assert.deepEqual(await foods(), []);
  assert.equal(await item(1).getAttribute("data-status"), "accepted", "the others are untouched");
  assert.equal(scanRequests(), 1, "reviewing and logging didn't send the photo again");
  step("the entry's nutrition is the chosen record at the typed amount, with no food created");

  // 8. A food with no match isn't given a guessed profile.
  await item(3).getByTestId("meal-name").fill("xylophone stew");
  await item(3).getByTestId("meal-accept").click();
  await item(3).getByTestId("meal-find").click();
  await search.waitFor();
  await search.getByText(/Try a simpler term|No foods|create a custom food/i).first().waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal((await diary()).length, 1);
  step("no matching food means no food: nothing is guessed");

  // 8b. The next food starts from the person's last choice, shown and changeable, never a built-in default.
  await item(3).getByTestId("meal-name").fill("banana");
  await item(3).getByTestId("meal-accept").click();
  await item(3).getByTestId("meal-find").click();
  assert.equal(await mealChoice.inputValue(), "DINNER");
  await mealChoice.selectOption("SNACK");
  await search.getByRole("button", { name: /Bananas, raw/ }).first().click();
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel("Meal").inputValue(), "SNACK");
  assert.equal(await dialog.getByLabel(/Servings|Amount/).inputValue(), "", "each food's amount is typed again");
  await dialog.getByLabel(/Servings|Amount/).fill("1");
  await dialog.getByRole("button", { name: "Add to Snack" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.match(await item(3).innerText(), /Added to Snack/);
  assert.deepEqual((await mealOf()).sort(), ["DINNER", "SNACK"]);
  step("each food gets its own deliberate meal and amount");

  // 9. Amounts and nutrition from the provider never reach the page.
  for (const scenario of ["mealCalories", "mealCaloriesTop", "mealQuantityText", "mealNutritionText", "mealSpelledAmount", "mealUnicodeAmount", "mealForeignAmount"]) {
    await identify(scenario);
    await page.getByText(/foods in this photo couldn't be identified/).waitFor();
    assert.equal(await page.getByTestId("meal-review").count(), 0, scenario);
    assert.doesNotMatch(await page.locator("main").innerText(), /300|150 g|calories|almonds|１５０/i, scenario);
  }
  step("a response with calories, grams, or amounts in its text is rejected whole");

  // 10. Other outcomes.
  await reviewed("mealMixed");
  assert.equal(await items().count(), 1, "a mixed dish is one item");
  assert.match(await item(0).innerText(), /Possible ingredients: carrot, potato/);
  await reviewed("mealUnknown");
  await page.getByTestId("meal-none").waitFor();
  await page.getByTestId("meal-add").click();
  assert.equal(await items().count(), 1);
  await identify("mealNotFood");
  await page.getByText(/doesn't look like a photo of food/).waitFor();
  step("mixed dishes, nothing identified, and non-food photos are handled");

  // A fresh account, as the steps above use up most of one user's upload allowance.
  await ctx.clearCookies();
  await signUp(page);

  // 10b. A number that's part of a food's own name is fine, and goes no further than the search box.
  await reviewed("mealNumberedName");
  assert.equal(await items().count(), 3);
  assert.equal(await item(0).getByTestId("meal-name").inputValue(), "7 Up");
  await item(0).getByTestId("meal-accept").click();
  await item(0).getByTestId("meal-find").click();
  await page.getByTestId("meal-type").selectOption("LUNCH");
  assert.equal(await page.getByTestId("meal-food-search").getByLabel("Search foods").inputValue(), "7 Up");
  await page.waitForTimeout(450);
  assert.equal(await page.getByRole("dialog").count(), 0, "the number selects nothing");
  assert.deepEqual(await diary(), []);
  step("a number in a food's own name stays a name");

  // 11. Text from a provider is inert.
  await reviewed("mealInjection");
  assert.match(await item(0).innerText(), /Possibly <img src=x/);
  assert.equal(await page.getByTestId("meal-review").locator("img, script").count(), 0, "shown as text");
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  assert.deepEqual(dialogs, []);
  assert.deepEqual(await diary(), [], "instructions to log do nothing");
  assert.deepEqual(await foods(), []);
  step("markup and instructions are shown as plain text, and do nothing");

  // 12. Failures are generic, and leave the photo to try again.
  for (const [scenario, pattern] of [["outage", /temporarily unavailable/], ["badKey", /temporarily unavailable/], ["refusal", /couldn't be identified/], ["invalid", /couldn't be identified/]]) {
    await identify(scenario);
    await page.getByText(pattern).waitFor();
    assert.equal(await page.getByText(/stub-provider/).count(), 0, "no provider text is shown");
    assert.equal(await page.getByTestId("meal-identify").isEnabled(), true);
  }
  step("outage, bad key, refusal and invalid output give clear generic messages");

  // 13. Files that aren't photos.
  for (const bad of [{ name: "a.svg", mimeType: "image/svg+xml", buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"/>`) }, { name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n") }, { name: "notes.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not an image") }]) {
    await page.goto(`${BASE}/nutrition/meal`);
    await page.locator("#meal-photo").setInputFiles(bad);
    await page.getByText("This file couldn't be opened as an image.").waitFor();
  }
  step("SVG, PDF and other files are refused");

  // 14. Normal logging is unchanged, and the link exists.
  await page.goto(`${BASE}/nutrition/add`);
  await page.getByRole("link", { name: "Identify foods in a photo" }).waitFor();
  // Text typed before React takes over this input is cleared, so wait for that. WebKit often takes longer.
  const searchBox = await page.getByLabel("Search foods").elementHandle();
  await page.waitForFunction((el) => Object.keys(el).some((key) => key.startsWith("__reactProps")), searchBox);
  await page.getByLabel("Search foods").fill("banana");
  await page.getByRole("button", { name: /Bananas, raw/ }).first().click();
  const normal = page.getByRole("dialog");
  await normal.waitFor();
  assert.equal(await normal.getByLabel(/Servings|Amount/).inputValue(), "1", "normal logging keeps its usual default");
  assert.equal(await normal.getByLabel("Meal").inputValue(), "BREAKFAST", "normal logging keeps its usual meal");
  step("the normal add-food flow is unchanged, and links to this feature");

  assert.deepEqual(errors, [], "no page errors");
  await browser.close();
}

(async () => {
  const buffer = await photo();
  if (process.env.EXPECT_UNCONFIGURED) return unconfigured(buffer);
  assert.ok(STUB, "LABEL_STUB_URL is required");
  assert.equal((await fetch(`${STUB}/__health`).then((r) => r.json())).ok, true);
  const anon = await fetch(`${BASE}/api/nutrition/meal-identifications`, { method: "POST", headers: { Origin: BASE, "Content-Type": "image/jpeg" }, body: buffer });
  assert.equal(anon.status, 401);
  const crossOrigin = await fetch(`${BASE}/api/nutrition/meal-identifications`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "image/jpeg" }, body: buffer });
  assert.equal(crossOrigin.status, 403);
  step("no session: 401. Cross-origin: 403");
  for (const name of BROWSERS) await runBrowser(name, buffer);
  console.log("ALL MEAL CHECKS PASSED");
})().catch((e) => { console.error(e); process.exit(1); });
