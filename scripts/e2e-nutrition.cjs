// End-to-end UI test of Phase 2 nutrition flows. Requires a running app (BASE_URL)
// whose FDC_BASE_URL/OFF_BASE_URL point at scripts/stub-food-apis.cjs (or the real APIs).
// Usage: BASE_URL=http://localhost:3000 DATABASE_URL=<local test database> SHOTS_DIR=/tmp node scripts/e2e-nutrition.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();
const BASE = target.baseUrl;
const SHOTS = (process.env.SHOTS_DIR || require("os").tmpdir()) + "/";

(async () => {
  await target.verifyServer();
  const browser = await chromium.launch();
  const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", timezoneId: "UTC" }));
  const page = await ctx.newPage();
  globalThis.page = page;
  globalThis.errors = [];
  const errors = globalThis.errors;
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push("console: " + m.text()));
  page.on("dialog", (d) => d.accept());
  const step = (s) => console.log("✓", s);

  await page.goto(BASE + "/register");
  await page.fill("input[name=email]", `nut${Date.now()}@test.dev`);
  await page.fill("input[name=password]", "correct horse battery");
  await page.click("button[type=submit]");
  await page.waitForURL("**/onboarding");
  await page.getByRole("radio", { name: "kg / cm" }).click();
  await page.getByLabel("Name").fill("Sam");
  await page.getByLabel("Date of birth").fill("1990-01-01");
  await page.getByLabel("Height (cm)").fill("180");
  await page.getByLabel("Current weight (kg)").fill("80");
  await page.getByRole("button", { name: "Maintenance" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL("**/dashboard");
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
  await page.getByText("USDA FoodData Central: The food database returned an error (500).").waitFor();
  await page.screenshot({ path: SHOTS + "n03-search-error.png", fullPage: true });
  step("incomplete-nutrient badge and per-source error message shown");

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
