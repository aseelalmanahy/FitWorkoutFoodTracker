// Multi-gym and exercise swaps in real browsers, on the production build: managing gyms, choosing one before and
// during a workout, swapping an exercise partway with its logged sets kept, a machine's own history, and the history
// filter. Chromium runs the whole flow; Firefox and WebKit run the swap, including the optional plan update.
//   BASE_URL=… DATABASE_URL=<designated test database> node scripts/e2e-gyms.cjs
const assert = require("node:assert/strict");
const playwright = require("playwright");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
const step = (s) => console.log(`✓ ${s}`);
const lib = {};

async function signedIn(browser, label) {
  const { user, token } = await createSignedInUser(prisma, `gyme2e${label}x${run}@test.dev`);
  await prisma.profile.create({ data: { userId: user.id, name: "Traveller", birthDate: new Date("1990-01-01T00:00:00Z"), timezone: "UTC", unitSystem: "METRIC" } });
  const plan = await prisma.workoutTemplate.create({ data: { userId: user.id, name: "Push day", exercises: { create: [
    { exerciseId: lib["Barbell Bench Press"].id, position: 0, targetSets: 3, targetRepsMin: 8, targetRepsMax: 10, targetWeightKg: 60 },
    { exerciseId: lib["Back Squat"].id, position: 1, targetSets: 3, targetRepsMin: 5, targetRepsMax: 5 },
  ] } } });
  const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 1200, height: 900 } }));
  await ctx.addCookies([{ name: "fit_session", value: token, url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  return { user, plan, page };
}
const card = (page, name) => page.getByTestId("exercise-card").filter({ has: page.getByRole("heading", { name, exact: true }) }).first();
async function logSet(page, name, weight, reps) {
  const c = card(page, name);
  const before = await prisma.setEntry.count();
  await c.getByLabel("Weight", { exact: true }).fill(String(weight));
  await c.getByLabel("Reps", { exact: true }).fill(String(reps));
  await c.getByRole("button", { name: "Log set" }).click();
  for (let i = 0; i < 100 && (await prisma.setEntry.count()) === before; i++) await new Promise((r) => setTimeout(r, 100));
}
async function finish(page) {
  await page.getByRole("button", { name: "Finish" }).click();
  await page.waitForURL(/\/workouts\/history\/[^/?]+\?done=1/, { timeout: 15000 });
}
async function swap(page, from, to, { machine, updatePlan = false } = {}) {
  await card(page, from).getByTestId("swap-exercise").click();
  await page.getByTestId("swap-sheet").waitFor();
  const options = page.getByTestId("swap-option");
  const offered = Object.fromEntries(await options.evaluateAll((els) => els.map((e) => [e.querySelector("span").textContent, e.dataset.available])));
  await options.filter({ hasText: to }).first().click();
  if (machine) await page.getByTestId("swap-machine").selectOption({ label: machine });
  if (updatePlan) await page.getByTestId("swap-update-plan").check();
  await page.getByTestId("swap-confirm").click();
  await card(page, to).waitFor();
  return offered;
}

async function wholeFlow(browser) {
  const { user, plan, page } = await signedIn(browser, "full");

  // Gyms: add two, refuse a duplicate, rename one, say what one has and name a machine there.
  await page.goto(`${BASE}/workouts/gyms`);
  for (const name of ["City Gym", "Home"]) {
    await page.getByTestId("gym-name").fill(name);
    await page.getByTestId("gym-add").click();
    await page.getByTestId("gym-title").filter({ hasText: name }).waitFor();
  }
  await page.getByTestId("gym-name").fill("city gym");
  await page.getByTestId("gym-add").click();
  await page.getByText("You already have a gym with that name.").waitFor();
  // By position: renaming replaces the title the card would be found by. Gyms are listed by name, so Home is second.
  const home = page.getByTestId("gym-card").nth(1);
  assert.equal(await home.getByTestId("gym-title").innerText(), "Home");
  await home.getByTestId("gym-rename").click();
  await home.getByTestId("gym-rename-input").fill("Garage");
  await home.getByTestId("gym-rename-save").click();
  await page.getByTestId("gym-title").filter({ hasText: "Garage" }).waitFor();
  const city = page.getByTestId("gym-card").filter({ has: page.getByTestId("gym-title").filter({ hasText: "City Gym" }) });
  for (const k of ["BARBELL", "MACHINE"]) {
    await city.getByTestId(`gym-kind-${k}`).check();
    await page.waitForFunction((k) => [...document.querySelectorAll(`[data-testid=gym-kind-${k}]`)].some((e) => e.checked && !e.disabled), k);
  }
  await city.getByTestId("machine-name").fill("Hammer press");
  await city.getByTestId("machine-add").click();
  await city.getByTestId("gym-machine").filter({ hasText: "Hammer press" }).waitFor();
  const gyms = await prisma.gymLocation.findMany({ where: { userId: user.id }, include: { equipment: true }, orderBy: { name: "asc" } });
  assert.deepEqual(gyms.map((g) => g.name), ["City Gym", "Garage"]);
  const cityRow = gyms[0];
  assert.deepEqual(cityRow.equipment.map((e) => [e.kind, e.name]).sort(), [["BARBELL", null], ["MACHINE", "Hammer press"], ["MACHINE", null]].sort());
  step("gyms: two added, a duplicate refused (any case), one renamed, kinds of equipment and a named machine saved");

  // Choose the gym before starting, then start the plan.
  await page.goto(`${BASE}/workouts`);
  await page.getByTestId("start-gym").selectOption({ label: "City Gym" });
  await page.getByRole("button", { name: "Start" }).first().click();
  await page.waitForURL(/\/workouts\/session\//);
  const sessionId = page.url().split("/").pop();
  assert.equal((await prisma.workoutSession.findUnique({ where: { id: sessionId } })).gymLocationId, cityRow.id);
  assert.equal(await page.getByTestId("session-gym").inputValue(), cityRow.id);
  step("the gym chosen before starting is the workout's gym");

  // Two sets of the planned bench, then swap it for a machine press on the named machine.
  await logSet(page, "Barbell Bench Press", 60, 8);
  await logSet(page, "Barbell Bench Press", 60, 7);
  const setsBefore = await prisma.setEntry.findMany({ where: { sessionExercise: { sessionId, exerciseId: lib["Barbell Bench Press"].id } }, orderBy: { setNumber: "asc" } });
  assert.equal(setsBefore.length, 2);
  const offered = await swap(page, "Barbell Bench Press", "Machine Chest Press", { machine: "Hammer press" });
  assert.equal(offered["Machine Chest Press"], "true", "City Gym has machines");
  assert.equal(offered["Dumbbell Bench Press"], "false", "no dumbbells listed at City Gym");
  assert.equal(offered["Cable Fly"], undefined, "a different movement for the same muscle isn't offered");
  const bench = card(page, "Barbell Bench Press");
  await bench.getByTestId("swapped-out").filter({ hasText: "its sets are kept" }).waitFor();
  assert.equal(await bench.getByTestId("swap-exercise").count(), 0, "a swapped-out exercise isn't swapped again");
  const press = card(page, "Machine Chest Press");
  assert.match(await press.getByTestId("swapped-in").innerText(), /Swapped in for Barbell Bench Press/);
  assert.match(await press.getByTestId("exercise-machine").innerText(), /On Hammer press/);
  // WT-04: the replacement keeps the plan's sets and reps, never the bench's 60 kg, on screen and after a reload.
  const targetText = async () => (await card(page, "Machine Chest Press").innerText()).match(/Target [^\n·]*/)?.[0] ?? "";
  assert.match(await targetText(), /Target 3 × 8–10/);
  assert.doesNotMatch(await targetText(), /@/, "no weight carried over from the bench");
  await page.reload();
  await card(page, "Machine Chest Press").waitFor();
  assert.match(await targetText(), /Target 3 × 8–10/);
  assert.doesNotMatch(await targetText(), /@/, "no weight carried over after a reload either");
  assert.match(await card(page, "Barbell Bench Press").innerText(), /Target 3 × 8–10 @ 60 kg/, "the planned exercise keeps its own weight");
  step("WT-04: a swapped-in exercise shows the plan's sets and reps, without the replaced exercise's weight");
  await logSet(page, "Machine Chest Press", 50, 10);
  await finish(page);
  const rows = await prisma.sessionExercise.findMany({ where: { sessionId }, orderBy: { position: "asc" }, include: { sets: { orderBy: { setNumber: "asc" } } } });
  assert.deepEqual(rows.map((r) => r.exerciseId), [lib["Barbell Bench Press"].id, lib["Machine Chest Press"].id], "the unperformed squat dropped; both pressed exercises kept");
  assert.deepEqual(rows[0].sets, setsBefore, "the bench sets are exactly as logged");
  assert.equal(rows[1].substitutesId, rows[0].id);
  assert.equal(rows[1].gymEquipmentId, cityRow.equipment.find((e) => e.name === "Hammer press").id);
  const planAfter = await prisma.templateExercise.findMany({ where: { templateId: plan.id }, orderBy: { position: "asc" } });
  assert.deepEqual(planAfter.map((e) => e.exerciseId), [lib["Barbell Bench Press"].id, lib["Back Squat"].id], "the plan is unchanged");
  step("swapped partway: the bench's two sets kept, the replacement on the named machine, the plan unchanged");

  // The finished workout says where, what was swapped, and which machine its comparison uses.
  assert.match(await page.getByTestId("history-gym").innerText(), /At City Gym/);
  assert.match(await page.getByTestId("history-swapped-in").innerText(), /Swapped in for Barbell Bench Press/);
  assert.match(await page.getByTestId("history-swapped-out").innerText(), /these sets are kept/);
  assert.match(await page.getByTestId("history-machine").innerText(), /On Hammer press/);
  await page.goto(`${BASE}/workouts/history`);
  const filter = page.getByTestId("history-gym-filter");
  await filter.getByRole("link", { name: "City Gym" }).click();
  await page.waitForURL(/gym=/);
  assert.match(await page.locator("h1").first().innerText(), /History/);
  assert.match(await page.locator("body").innerText(), /1 completed workout at City Gym/);
  await page.getByTestId("history-gym-filter").getByRole("link", { name: "Garage" }).click();
  await page.getByText("No workouts at Garage yet").waitFor();
  step("history: the gym, the swap and the machine shown; filtered by gym");

  // The machine press's own history, apart from the shared one.
  await page.goto(`${BASE}/progress/${lib["Machine Chest Press"].id}`);
  await page.getByTestId("progress-contexts").waitFor();
  assert.match(await page.getByTestId("progress-context-note").innerText(), /Sets with no specific machine/);
  await page.getByTestId("progress-machine").filter({ hasText: "Hammer press" }).click();
  await page.waitForURL(/machine=/);
  await page.getByTestId("progress-context-note").filter({ hasText: "Only sets on Hammer press at City Gym" }).waitFor();
  assert.match(await page.locator("body").innerText(), /1 session logged on Hammer press/);
  step("progress: the machine's history is separate from the shared one");

  // UI-02: Training programs is the default view. This plan isn't in a program, so its workout is under "Not in a
  // program", with the swapped-in exercise on its machine, linking to that machine's history.
  await page.goto(`${BASE}/progress`);
  assert.deepEqual(await page.getByTestId("progress-tab").allInnerTexts(), ["Training programs", "Exercise progress", "Body weight"]);
  assert.equal(await page.locator("[data-testid=progress-tab][aria-current=page]").innerText(), "Training programs");
  assert.deepEqual(await page.getByTestId("progress-program-name").allInnerTexts(), ["Not in a program"]);
  await page.getByTestId("progress-no-programs").waitFor();
  const pressInProgram = page.getByTestId("progress-exercise").filter({ hasText: "Machine Chest Press" });
  assert.match(await pressInProgram.innerText(), /Hammer press[\s\S]*1 set · top 50 kg × 10[\s\S]*Baseline/);
  assert.match(await pressInProgram.getByRole("link").getAttribute("href"), /\?machine=/);
  assert.equal(await page.getByTestId("progress-tab").filter({ hasText: "Body weight" }).getAttribute("href"), "/progress/weight");
  step("UI-02: Training programs by default, the workout under Not in a program, its machine exercise linked");

  // WT-03: the Progress list counts sessions on a named machine, and opens that machine's history.
  await page.goto(`${BASE}/progress?view=exercises`);
  assert.equal(await page.locator("[data-testid=progress-tab][aria-current=page]").innerText(), "Exercise progress");
  const pressRow = page.getByRole("link").filter({ hasText: "Machine Chest Press" }).first();
  assert.match(await pressRow.innerText(), /1 session\b/, "a machine-only exercise isn't shown as 0 sessions");
  assert.match(await pressRow.getAttribute("href"), /\?machine=/, "it links to the machine's own history");
  assert.match(await page.getByRole("link").filter({ hasText: "Barbell Bench Press" }).first().innerText(), /1 session\b/);
  await pressRow.click();
  await page.getByTestId("progress-context-note").filter({ hasText: "Only sets on Hammer press at City Gym" }).waitFor();
  step("WT-03: the Progress list counts machine sessions and opens the machine's history");

  // Change the gym during a workout.
  await page.goto(`${BASE}/workouts`);
  await page.getByRole("button", { name: "Start an empty workout" }).click();
  await page.waitForURL(/\/workouts\/session\//);
  const second = page.url().split("/").pop();
  assert.equal(await page.getByTestId("session-gym").inputValue(), cityRow.id, "the remembered gym for the next workout");
  await page.getByTestId("session-gym").selectOption({ label: "Garage" });
  const garage = gyms[1];
  for (let i = 0; i < 50 && (await prisma.workoutSession.findUnique({ where: { id: second } })).gymLocationId !== garage.id; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal((await prisma.workoutSession.findUnique({ where: { id: second } })).gymLocationId, garage.id);
  step("the gym changed during a workout");
}

/**
 * WT-01 and WT-09, during a workout (whose clock re-renders the page every second): the search keeps what's typed,
 * an exercise can be added, a custom exercise can be created only with a muscle and equipment chosen, the logged
 * sets are untouched, and closing and reopening the picker starts it clean.
 */
async function pickerDuringWorkout(page, engine) {
  const sessionId = page.url().split("/").pop();
  const setsBefore = await prisma.setEntry.findMany({ where: { sessionExercise: { sessionId } }, orderBy: { id: "asc" } });
  const search = page.getByPlaceholder("Search exercises");
  await page.getByRole("button", { name: "Add exercise" }).click();
  await search.fill("Plank");
  await page.waitForTimeout(2500); // more than two ticks of the workout clock
  assert.equal(await search.inputValue(), "Plank", `${engine}: the search survives the workout's re-renders`);
  await page.getByRole("dialog").getByRole("button", { name: /^Plank/ }).click();
  await card(page, "Plank").waitFor();

  await page.getByRole("button", { name: "Add exercise" }).click();
  await search.fill("Goblet Squat");
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Create “Goblet Squat”" }).click();
  const muscle = page.getByLabel("Main muscle");
  const equipment = page.getByLabel("Equipment", { exact: true });
  assert.equal(await muscle.inputValue(), "", "no muscle is preselected");
  assert.equal(await equipment.inputValue(), "", "no equipment is preselected");
  assert.equal(await page.getByTestId("new-exercise-create").isDisabled(), true, "it can't be created without both");
  await muscle.selectOption({ label: "Quads" });
  assert.equal(await page.getByTestId("new-exercise-create").isDisabled(), true, "the equipment is still needed");
  await equipment.selectOption({ label: "Dumbbell" });
  await page.waitForTimeout(1200);
  assert.equal(await search.inputValue(), "Goblet Squat", "the name is still there after the clock ticked");
  await page.getByTestId("new-exercise-create").click();
  await card(page, "Goblet Squat").waitFor();
  const { userId } = await prisma.workoutSession.findUnique({ where: { id: sessionId } });
  const created = await prisma.exercise.findFirst({ where: { name: "Goblet Squat", userId } });
  assert.equal(created.primaryMuscle, "QUADS");
  assert.equal(created.equipment, "DUMBBELL");

  await page.getByRole("button", { name: "Add exercise" }).click();
  await search.fill("Leftover");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Add exercise" }).click();
  assert.equal(await search.inputValue(), "", "reopening starts with an empty search");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  const setsAfter = await prisma.setEntry.findMany({ where: { sessionExercise: { sessionId } }, orderBy: { id: "asc" } });
  assert.deepEqual(setsAfter, setsBefore, "the logged sets are untouched");
  step(`${engine}: WT-01/WT-09 mid-workout search kept, exercise added, custom exercise created as Quads · Dumbbell, sets intact`);
}

async function swapWithPlanUpdate(browser, engine) {
  const { plan, page } = await signedIn(browser, `plan${engine}`);
  await page.goto(`${BASE}/workouts`);
  await page.getByRole("button", { name: "Start" }).first().click();
  await page.waitForURL(/\/workouts\/session\//);
  assert.equal(await page.getByTestId("session-gym").count(), 0, "no gyms: no gym chooser in the workout");
  await logSet(page, "Barbell Bench Press", 60, 8);
  await pickerDuringWorkout(page, engine);
  const offered = await swap(page, "Barbell Bench Press", "Dumbbell Bench Press", { updatePlan: true });
  assert.equal(offered["Dumbbell Bench Press"], "true", "no gym chosen: availability isn't claimed");
  await logSet(page, "Dumbbell Bench Press", 24, 10);
  await finish(page);
  const t = await prisma.templateExercise.findMany({ where: { templateId: plan.id }, orderBy: { position: "asc" } });
  assert.deepEqual(t.map((e) => e.exerciseId), [lib["Dumbbell Bench Press"].id, lib["Back Squat"].id], "the plan updated, as asked");
  step(`${engine}: a swap with "also change my plan" updates that plan entry only`);
}

(async () => {
  await target.verifyServer();
  for (const name of ["Barbell Bench Press", "Dumbbell Bench Press", "Machine Chest Press", "Back Squat"]) {
    lib[name] = await prisma.exercise.findFirst({ where: { userId: null, name } });
    assert.ok(lib[name], name);
  }
  const chromium = await playwright.chromium.launch(target.launchOptions("chromium"));
  try { await wholeFlow(chromium); await swapWithPlanUpdate(chromium, "chromium"); } finally { await chromium.close(); }
  for (const engine of ["firefox", "webkit"]) {
    const browser = await playwright[engine].launch(target.launchOptions(engine));
    try { await swapWithPlanUpdate(browser, engine); } finally { await browser.close(); }
  }
  console.log("ALL GYM CHECKS PASSED");
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
