// End-to-end UI test of Phase 2 nutrition flows. Requires a running app (BASE_URL)
// whose FDC_BASE_URL/OFF_BASE_URL point at scripts/stub-food-apis.cjs (or the real APIs).
// Usage: BASE_URL=http://localhost:3000 DATABASE_URL=<local test database> SHOTS_DIR=/tmp node scripts/e2e-nutrition.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { completeOnboarding } = require("./lib/e2e-onboarding.cjs");
const { signUpInBrowser } = require("./lib/signup.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();
const BASE = target.baseUrl;
const SHOTS = (process.env.SHOTS_DIR || require("os").tmpdir()) + "/";

(async () => {
  await target.verifyServer();
  const browser = await chromium.launch(target.launchOptions("chromium"));
  const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", timezoneId: "UTC" }));
  const page = await ctx.newPage();
  globalThis.page = page;
  globalThis.errors = [];
  const errors = globalThis.errors;
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push("console: " + m.text()));
  page.on("dialog", (d) => d.accept());
  const step = (s) => console.log("✓", s);

  await signUpInBrowser(page, BASE, `nut${Date.now()}@test.dev`, "correct horse battery");
  await completeOnboarding(page);
  step("registered + onboarded");

  // 1. Targets
  await page.goto(BASE + "/nutrition/targets");
  await page.getByLabel("Calories (kcal/day)").fill("2300");
  await page.getByLabel("Protein (g)").fill("160");
  await page.getByLabel("Fat (g)").fill("70");
  assert.match(await page.locator("text=Carbohydrate (calculated)").locator("..").innerText(), /257 g/);
  await page.getByRole("button", { name: "Save targets" }).click();
  await page.getByText("Saved. New targets apply from today").waitFor();
  await page.screenshot({ path: SHOTS + "n01-targets.png", fullPage: true });
  step("manual targets saved (carbs derived 257 g)");

  // 2–5. Search, select, add to meal, adjust serving
  await page.goto(BASE + "/nutrition");
  await page.getByRole("link", { name: "Add food to Breakfast" }).click();
  await page.waitForURL("**/nutrition/add**");
  await page.getByLabel("Search foods").fill("banana");
  await page.getByRole("button", { name: /Bananas, raw/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Serving size").selectOption({ label: "100 g" });
  await dialog.getByLabel("Servings").fill("1.5");
  assert.match(await dialog.innerText(), /133.5|134/); // 89 kcal/100 g × 150 g
  await page.screenshot({ path: SHOTS + "n02-add-sheet.png", fullPage: true });
  await dialog.getByRole("button", { name: "Add to Breakfast" }).click();
  await page.getByText("Added 1 item").waitFor();
  step("searched USDA, added 1.5 × 100 g banana");

  // multiple foods: packaged product + raw grams
  await page.getByLabel("Search foods").fill("nutella");
  await page.getByRole("button", { name: /Nutella/ }).click();
  await dialog.getByLabel("Meal").selectOption("SNACK");
  await dialog.getByRole("button", { name: "Add to Snacks" }).click(); // 1 serving = 15 g = 80.85 kcal
  await page.getByText("Added 2 items").waitFor();
  await page.getByLabel("Search foods").fill("chicken breast");
  await page.getByRole("button", { name: /Chicken, broilers/ }).click();
  await dialog.getByLabel("Serving size").selectOption({ label: "grams (g)" });
  await dialog.getByLabel("Amount (g)").fill("200");
  await dialog.getByLabel("Meal").selectOption("LUNCH");
  await dialog.getByRole("button", { name: "Add to Lunch" }).click(); // 330 kcal, 62.04 P
  await page.getByText("Added 3 items").waitFor();
  step("added packaged (OFF) + 200 g chicken by grams");

  // An OFF search hit without preview nutrients stays selectable and loads the full product.
  await page.getByLabel("Search foods").fill("preview granola");
  const previewHit = page.getByRole("button", { name: /Preview granola/ });
  await previewHit.getByText("Tap for details").waitFor();
  await previewHit.click();
  await dialog.getByText("Open Food Facts · 8800000000011").waitFor();
  await dialog.getByRole("button", { name: /^Add to / }).waitFor();
  assert.match(await dialog.innerText(), /180/); // 1 serving = 40 g of 450 kcal/100 g, from the product API
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  // If the full product has no nutrition data either, nothing can be logged.
  await page.getByLabel("Search foods").fill("preview empty");
  await page.getByRole("button", { name: /Preview empty snack/ }).click();
  await page.getByText("Preview empty snack has no nutrition data to log.").waitFor();
  assert.equal(await dialog.count(), 0, "no add sheet for a product without nutrition data");
  step("OFF hits without preview nutrients open the full product; no fabricated values");

  // missing nutrition values + source error handling
  await page.getByLabel("Search foods").fill("rice");
  await page.getByText("Incomplete").first().waitFor();
  await page.getByLabel("Search foods").fill("error");
  await page.getByText("USDA foods (USDA FoodData Central) couldn't be searched: The food database returned an error (500).").waitFor();
  assert.equal(await page.getByTestId("food-empty").getAttribute("data-kind"), "partly", "a failed source isn't 'no results'");
  await page.screenshot({ path: SHOTS + "n03-search-error.png", fullPage: true });
  step("incomplete-nutrient badge and per-source error message shown");

  // UX-01: source filters work on the current query, say what each means, and explain an empty view.
  const filter = (v) => page.locator(`[data-testid="food-filter"][data-filter="${v}"]`);
  const help = page.getByTestId("food-source-help");
  await page.getByLabel("Search foods").fill("");
  assert.match(await help.innerText(), /Type at least 2 characters to search/, "no query: the filters aren't presented as searching");
  await filter("USDA").click();
  assert.equal(await filter("USDA").getAttribute("aria-pressed"), "true");
  assert.match(await help.innerText(), /USDA foods: Foods supplied by USDA FoodData Central\./);
  await page.getByText("Recent").waitFor(); // recent foods stay available
  await page.getByLabel("Search foods").fill("chicken breast");
  await page.getByRole("button", { name: /Chicken, broilers/ }).waitFor();
  assert.match(await page.getByTestId("food-test-data").innerText(), /small local test sample, not the full catalogs/);
  await filter("OPEN_FOOD_FACTS").focus();
  await page.keyboard.press("Enter"); // keyboard works
  assert.equal(await filter("OPEN_FOOD_FACTS").getAttribute("aria-pressed"), "true");
  assert.equal(await filter("USDA").getAttribute("aria-pressed"), "false");
  await page.getByText('No packaged-food results for "chicken breast"').waitFor();
  // Only Open Food Facts and My foods were searched, so USDA's earlier match isn't counted here.
  assert.match(await page.getByTestId("food-empty").innerText(), /USDA foods wasn.t searched/);
  assert.equal((await filter("USDA").innerText()).trim(), "USDA foods", "no count on a source that wasn't searched");
  assert.equal(await page.getByTestId("food-result").count(), 0);
  await page.getByRole("button", { name: "Show all sources" }).click();
  assert.equal(await filter("ALL").getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: /Chicken, broilers/ }).waitFor();
  step("filters: idle hint, keyboard, empty view naming the source, Show all sources");

  // UX-01: an earlier, slower answer never replaces a later query's results.
  let releaseSlow = () => {};
  const slowGate = new Promise((r) => { releaseSlow = r; });
  const slow = async (route) => { if (new URL(route.request().url()).searchParams.get("q") === "banana") await slowGate; await route.continue(); };
  await page.route("**/api/foods/search**", slow);
  const bananaAsked = page.waitForRequest((r) => new URL(r.url()).searchParams.get("q") === "banana");
  await page.getByLabel("Search foods").fill("banana");
  await bananaAsked;
  await page.getByLabel("Search foods").fill("greek yogurt");
  await page.getByRole("button", { name: /Yogurt, Greek, plain, nonfat/ }).waitFor();
  const bananaAnswered = page.waitForResponse((r) => new URL(r.url()).searchParams.get("q") === "banana");
  releaseSlow();
  await bananaAnswered;
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole("button", { name: /Bananas, raw/ }).count(), 0, "the stale banana answer isn't shown");
  assert.ok(await page.getByRole("button", { name: /Yogurt, Greek, plain, nonfat/ }).isVisible());
  await page.unroute("**/api/foods/search**", slow);
  // While a new query is pending, the previous query's results can't be chosen.
  let releaseRice = () => {};
  const riceGate = new Promise((r) => { releaseRice = r; });
  const holdRice = async (route) => { if (new URL(route.request().url()).searchParams.get("q") === "rice") await riceGate; await route.continue(); };
  await page.route("**/api/foods/search**", holdRice);
  await page.getByLabel("Search foods").fill("rice");
  await page.getByTestId("food-searching").waitFor();
  assert.equal(await page.getByTestId("food-result").count(), 0, "no greek yogurt results while rice is pending");
  releaseRice();
  await page.getByText("Premium White Rice").waitFor();
  await page.unroute("**/api/foods/search**", holdRice);
  // A whole-request failure is shown for its query only, and clears with the query.
  const fail = (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Something went wrong." }) });
  await page.route("**/api/foods/search**", fail);
  await page.getByLabel("Search foods").fill("apple");
  await page.getByTestId("food-search-failed").waitFor();
  assert.equal(await page.getByTestId("food-result").count(), 0);
  await page.unroute("**/api/foods/search**", fail);
  await page.getByLabel("Search foods").fill("");
  assert.equal(await page.getByTestId("food-search-failed").count(), 0, "clearing the query clears the failure");
  step("stale answers dropped, pending results unselectable, failures scoped to their query");

  // custom food
  await page.getByLabel("Search foods").fill("protein bar");
  await page.getByRole("button", { name: "+ Custom food" }).click();
  await dialog.getByLabel("Name", { exact: true }).fill("Protein bar");
  await dialog.getByLabel("Size (g)").fill("60");
  await dialog.getByLabel("kcal").fill("220");
  await dialog.getByLabel("Prot g").fill("20");
  await dialog.getByLabel("Carb g").fill("22");
  await dialog.getByLabel("Fat g").fill("7");
  await dialog.getByRole("button", { name: "Save and continue" }).click();
  await dialog.getByLabel("Meal").selectOption("SNACK");
  await dialog.getByRole("button", { name: "Add to Snacks" }).click();
  await page.getByText("Added 4 items").waitFor();
  step("custom food created and logged");

  // UX-01: a custom food is found by the words of its serving label too, as "large egg" finds "Whole egg" served "1 large".
  await page.getByLabel("Search foods").fill("serving protein");
  await filter("CUSTOM").click();
  await page.getByTestId("food-result").filter({ hasText: "Protein bar" }).waitFor(); // name "Protein bar", serving "1 serving"
  // Under My foods, no provider is asked: the request names My foods only.
  const customOnly = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/foods/search" && new URL(r.url()).searchParams.get("q") === "large protein");
  await page.getByLabel("Search foods").fill("large protein");
  assert.equal(new URL((await customOnly).url()).searchParams.get("sources"), "CUSTOM");
  await page.getByText('None of your foods match "large protein"').waitFor();
  await filter("ALL").click();
  step("custom food matched by its serving label, and only when every word matches");

  // 6. Daily totals: 133.5 + 80.85 + 330 + 220 = 764.35 kcal; protein 1.64+0.95+62.04+20 = 84.63
  await page.getByRole("link", { name: "Done" }).click();
  await page.waitForURL(/\/nutrition$/);
  const body = await page.locator("main").innerText();
  assert.match(body, /764 kcal/);
  assert.match(body, /84\.6/);
  await page.screenshot({ path: SHOTS + "n04-dashboard.png", fullPage: true });
  step("dashboard totals 764 kcal / 84.6 g protein");

  // 7. Edit and delete
  await page.getByRole("button", { name: /Chicken, broilers/ }).click();
  await dialog.getByLabel("Amount (g)").fill("100");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await page.waitForFunction(() => document.querySelector("main").innerText.includes("599 kcal"));
  step("edited chicken to 100 g → 599 kcal");
  await page.getByRole("button", { name: /Nutella/ }).click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await page.waitForFunction(() => { const t = document.querySelector("main")?.innerText ?? ""; return !t.includes("Nutella") && t.includes("519 kcal"); });
  step("deleted Nutella → 518.5 kcal shown as 519");

  // over-target display
  await page.goto(BASE + "/nutrition/targets");
  await page.getByLabel("Calories (kcal/day)").fill("800");
  await page.getByLabel("Protein (g)").fill("60");
  await page.getByLabel("Fat (g)").fill("20");
  await page.getByRole("button", { name: "Save targets" }).click();
  await page.getByText("Saved.").waitFor();
  // log 2 more protein bars from Recent (440 kcal) → 958.5 kcal vs 800 target
  await page.goto(BASE + "/nutrition/add?meal=SNACK");
  await page.getByRole("button", { name: /Protein bar/ }).first().click();
  await dialog.getByLabel("Servings").fill("2");
  await dialog.getByRole("button", { name: "Add to Snacks" }).click();
  await page.getByText("Added 1 item").waitFor();
  await page.goto(BASE + "/nutrition");
  const ob = await page.locator("main").innerText();
  assert.doesNotMatch(ob, /-\d+ kcal left/);
  assert.match(ob, /kcal over/);
  assert.match(ob, /0 \(159 over\)/);
  await page.screenshot({ path: SHOTS + "n05-over.png", fullPage: true });
  step("over-target shown as 'over', no negative remaining");

  // 8. Previous days
  await page.getByRole("link", { name: "Previous day" }).click();
  await page.waitForURL(/date=/);
  assert.match(await page.locator("main").innerText(), /Yesterday/);
  assert.match(await page.locator("main").innerText(), /Nothing logged/);
  step("navigated to previous day");

  // 9. Weekly averages
  await page.goto(BASE + "/nutrition/history");
  const hb = await page.locator("main").innerText();
  assert.match(hb, /Avg calories/);
  assert.match(hb, /959 kcal/);
  assert.match(hb, /1 \/ \d days?/);
  await page.screenshot({ path: SHOTS + "n06-history.png", fullPage: true });
  await page.getByRole("link", { name: "Previous week" }).click();
  await page.getByText("Nothing logged this week.").waitFor();
  step("history weekly averages + week navigation");

  // light mode render
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(BASE + "/nutrition");
  await page.screenshot({ path: SHOTS + "n07-dashboard-light.png", fullPage: true });

  // Phase 1 regression: workouts page still renders
  await page.goto(BASE + "/workouts");
  await page.getByText("My plans").waitFor();
  step("Phase 1 workouts page still renders");

  assert.deepEqual(errors, [], "browser errors: " + errors.join("\n"));
  console.log("ALL UI CHECKS PASSED");
  await browser.close();
})().catch(async (e) => {
  await globalThis.page?.screenshot({ path: SHOTS + "n-failure.png", fullPage: true }).catch(() => {}); console.error("FAILED:", e.message.split("\n")[0]); console.error("browser errors:", (globalThis.errors||[]).join("\n")); process.exit(1); });
