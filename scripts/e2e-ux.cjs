// UI-02 to UI-08 in real browsers, on the production build, with disposable users only: choosing the active program
// with its preview (UI-06), the weekly schedule editor (UI-03/04), management and deletion dialogs (UI-05), the
// expandable Progress history (UI-02), and the Nutrition calendar and date range (UI-07/08). Chromium runs everything;
// Firefox and WebKit run the schedule editor and activation.
//   BASE_URL=… DATABASE_URL=<designated test database> node scripts/e2e-ux.cjs
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
const LONG = "Mobility and recovery flow with a deliberately long name that has to wrap neatly on a phone";
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

async function signedIn(browser, label, viewport = { width: 1280, height: 900 }) {
  const { user, token } = await createSignedInUser(prisma, `uxe2e${label}x${run}@test.dev`);
  await prisma.profile.create({ data: { userId: user.id, name: "Tester", birthDate: new Date("1990-01-01T00:00:00Z"), timezone: "UTC", unitSystem: "METRIC" } });
  const program = await prisma.workoutProgram.create({ data: { userId: user.id, name: "Push Pull Legs", origin: "manual" } });
  const plan = (name, i, exercise) => prisma.workoutTemplate.create({ data: { userId: user.id, name, programId: program.id, programPosition: i, exercises: { create: [{ exerciseId: lib[exercise].id, position: 0, targetSets: 3, targetRepsMin: 8, targetRepsMax: 10 }] } } });
  const push = await plan("Push", 0, "Barbell Bench Press");
  const pull = await plan("Pull", 1, "Machine Chest Press");
  const legs = await plan("Legs", 2, "Back Squat");
  const solo = await prisma.workoutTemplate.create({ data: { userId: user.id, name: LONG, exercises: { create: [{ exerciseId: lib["Dumbbell Bench Press"].id, position: 0, targetSets: 2, targetRepsMin: 10, targetRepsMax: 12 }] } } });
  await prisma.scheduleSlot.create({ data: { userId: user.id, weekday: 6, templateId: solo.id } });
  for (const [ago, kg] of [[10, 60], [3, 62.5]]) {
    await prisma.workoutSession.create({ data: { userId: user.id, templateId: push.id, name: "Push", status: "COMPLETED", startedAt: daysAgo(ago), endedAt: daysAgo(ago), exercises: { create: [{ exerciseId: lib["Barbell Bench Press"].id, position: 0, sets: { create: [{ setNumber: 1, reps: 8, weightKg: kg }, { setNumber: 2, reps: 8, weightKg: kg }] } }] } } });
  }
  const ctx = await target.guardContext(await browser.newContext({ viewport }));
  await ctx.addCookies([{ name: "fit_session", value: token, url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { user, program, push, pull, legs, solo, page, errors };
}
const slots = async (userId) => (await prisma.scheduleSlot.findMany({ where: { userId }, orderBy: [{ weekday: "asc" }, { position: "asc" }], include: { template: true } })).map((s) => `${s.weekday}:${s.template.name.slice(0, 8)}`);

/** UI-06: no program is active until one is chosen with its preview; the schedule then comes from it. */
async function activate(t, engine) {
  const { page, user } = t;
  await page.goto(`${BASE}/workouts`);
  await page.getByTestId("choose-active").waitFor();
  assert.match(await page.getByTestId("week-program").innerText(), /No active program chosen/);
  assert.equal(await prisma.profile.findUnique({ where: { userId: user.id } }).then((p) => p.activeProgramId), null, "nothing was chosen for the person");
  await page.getByTestId("program").getByTestId("set-active").click();
  await page.waitForURL(/\/activate$/);
  const pressed = await page.getByTestId("activate-day").evaluateAll((els) => els.map((e) => [...e.querySelectorAll("[aria-pressed=true]")].map((b) => b.textContent)));
  assert.deepEqual(pressed, [["Mon"], ["Wed"], ["Fri"]], "a spread is suggested");
  assert.match(await page.getByTestId("activate-removed").innerText(), /Removed from the schedule \(1\)[\s\S]*Sunday: Mobility and recovery/, "the assignment that would go is shown");
  await page.getByTestId("activate-day").nth(2).getByRole("button", { name: /^Friday/ }).click();
  await page.getByTestId("activate-day").nth(2).getByRole("button", { name: /^Saturday/ }).click();
  assert.match(await page.getByTestId("activate-added").innerText(), /Saturday: Legs/);
  assert.deepEqual(await slots(user.id), ["6:Mobility"], "nothing changes before confirming");
  await page.getByTestId("activate-confirm").click();
  await page.waitForURL(/\/workouts$/);
  await page.getByTestId("active-program").waitFor();
  assert.match(await page.getByTestId("week-program").innerText(), /From your active program, Push Pull Legs/);
  assert.deepEqual(await slots(user.id), ["0:Push", "2:Pull", "5:Legs"]);
  assert.ok(await prisma.workoutTemplate.findUnique({ where: { id: t.solo.id } }), "the plan taken off the schedule is kept");
  step(`${engine}: UI-06 the active program is chosen with a preview of exactly what changes; the schedule then comes from it`);
}

/** UI-03/04: the schedule as a draft, with clear, labelled actions and nothing chosen for the person. */
async function scheduleEditor(t, engine) {
  const { page, user } = t;
  await page.goto(`${BASE}/workouts/schedule`);
  assert.match(await page.getByTestId("schedule-scope").innerText(), /active program, Push Pull Legs/);
  const monday = page.getByTestId("schedule-day").nth(0);
  assert.match(await monday.getByTestId("schedule-slot").innerText(), /Push[\s\S]*Push Pull Legs · 1 exercise/);
  assert.match(await page.getByTestId("schedule-day").nth(1).innerText(), /Rest day/);

  await page.getByRole("button", { name: "Add a workout to Tuesday" }).click();
  const chooser = page.getByTestId("schedule-chooser");
  assert.equal(await chooser.getByRole("button", { name: "Choose" }).isDisabled(), true, "nothing is preselected");
  assert.equal(await chooser.getByTestId("chooser-option").count(), 3, "only the active program's workouts");
  await page.keyboard.press("Escape");
  await chooser.waitFor({ state: "hidden" });
  assert.equal(await page.getByTestId("schedule-state").innerText(), "No changes");

  await page.getByRole("button", { name: "Add a workout to Tuesday" }).click();
  await chooser.getByRole("radio", { name: /Pull/ }).check();
  await chooser.getByRole("button", { name: "Choose" }).click();
  assert.equal(await page.getByTestId("schedule-state").innerText(), "Unsaved changes");
  await page.getByRole("button", { name: "Discard changes" }).click();
  assert.match(await page.getByTestId("schedule-day").nth(1).innerText(), /Rest day/, "discard goes back to the saved week");

  await page.getByRole("button", { name: "Add a workout to Tuesday" }).click();
  await chooser.getByRole("radio", { name: /Pull/ }).check();
  await chooser.getByRole("button", { name: "Choose" }).click();
  await page.getByRole("button", { name: "Move Push from Monday to another day" }).click();
  await page.getByTestId("schedule-move").getByRole("button", { name: "Thursday" }).click();
  await page.getByRole("button", { name: /Change the workout on Wednesday/ }).click();
  await chooser.getByRole("radio", { name: /Legs/ }).check();
  await chooser.getByRole("button", { name: "Choose" }).click();
  await page.getByRole("button", { name: "Remove Legs from Saturday" }).click();
  assert.equal(await page.getByRole("button", { name: "Add another workout to Thursday" }).count(), 1, "a second workout is a deliberate choice");
  assert.deepEqual(await slots(user.id), ["0:Push", "2:Pull", "5:Legs"], "nothing is saved yet");
  await page.getByRole("button", { name: "Save schedule" }).click();
  await page.waitForURL(/\/workouts$/);
  assert.deepEqual(await slots(user.id), ["1:Pull", "2:Legs", "3:Push"]);
  step(`${engine}: UI-03 add with nothing preselected, Escape, discard, change, move, remove and save; only saved on Save`);
}

/** UI-04 on a phone: long names wrap, actions are labelled and nothing spills sideways. */
async function phoneLayout(browser) {
  const t = await signedIn(browser, "phone", { width: 375, height: 800 });
  await t.page.goto(`${BASE}/workouts/schedule`);
  await t.page.getByTestId("schedule-slot").first().waitFor();
  const overflow = await t.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `no sideways scrolling (${overflow}px)`);
  const name = t.page.getByTestId("schedule-slot-name").first();
  assert.match(await name.innerText(), /Mobility and recovery/);
  const fits = await t.page.getByTestId("schedule-slot").first().evaluate((el) => [...el.querySelectorAll("button")].every((b) => b.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1 && b.offsetWidth >= 44));
  assert.ok(fits, "Change, Move and Remove are full-size and inside the row");
  for (const label of ["Change", "Move", "Remove"]) assert.equal(await t.page.getByTestId("schedule-slot").first().getByRole("button", { name: new RegExp(`^${label}`) }).count(), 1);
  step("UI-04 at 375 px: the long name wraps, the actions are labelled, full-size and inside the row, no sideways scrolling");
}

/** UI-05: every program and plan has visible actions; deleting explains, can be cancelled, and keeps history. */
async function manage(t) {
  const { page, user } = t;
  await page.goto(`${BASE}/workouts`);
  const soloCard = page.getByTestId("plan").filter({ hasText: "Mobility and recovery" });
  for (const n of ["Start", "Edit"]) assert.equal(await soloCard.getByRole("button", { name: n }).or(soloCard.getByRole("link", { name: new RegExp(`^${n}`) })).count() >= 1, true, n);
  await soloCard.getByTestId("plan-delete").click();
  const dialog = page.locator("dialog[open][data-testid=plan-delete-dialog]");
  assert.match(await dialog.innerText(), /isn't on your weekly schedule[\s\S]*No workouts have been logged/);
  await dialog.getByTestId("confirm-cancel").click();
  assert.ok(await prisma.workoutTemplate.findUnique({ where: { id: t.solo.id } }), "cancel deletes nothing");

  const pushRow = page.getByTestId("active-program").getByTestId("program-day").filter({ hasText: "Push" });
  await pushRow.getByTestId("plan-delete").click();
  assert.match(await dialog.innerText(), /on your weekly schedule on Thu[\s\S]*Your 2 logged workouts from it stay/);
  await dialog.getByTestId("confirm-cancel").click();

  await page.getByTestId("active-program").getByTestId("program-delete").click();
  const pd = page.locator("dialog[open][data-testid=program-delete-dialog]");
  assert.match(await pd.innerText(), /3 workout plans stay[\s\S]*your active program/);
  const before = await slots(user.id);
  await pd.getByTestId("confirm-ok").click();
  await page.getByTestId("programs-empty").waitFor();
  assert.equal(await prisma.workoutProgram.count({ where: { userId: user.id } }), 0);
  assert.equal(await prisma.workoutTemplate.count({ where: { userId: user.id } }), 4, "every plan is kept");
  assert.deepEqual(await slots(user.id), before, "the schedule is kept");
  assert.equal((await prisma.profile.findUnique({ where: { userId: user.id } })).activeProgramId, null);
  assert.equal(await prisma.workoutSession.count({ where: { userId: user.id, status: "COMPLETED" } }), 2, "history is kept");
  step("UI-05 Start, Edit and Delete on every plan; deletion explains its effect, can be cancelled, and keeps plans, schedule and history");
}

/** UI-02: program, month, workout date, then an exercise's details as they stood on that date. */
async function progress(t) {
  const { page } = t;
  await page.goto(`${BASE}/progress`);
  const program = page.getByTestId("progress-program").filter({ hasText: "Push Pull Legs" });
  await program.waitFor();
  const latest = program.getByTestId("progress-workout").first();
  if (!(await latest.getByTestId("progress-exercise").first().isVisible())) await latest.locator("summary").first().click();
  const ex = latest.getByTestId("progress-exercise").first();
  assert.match(await ex.innerText(), /Barbell Bench Press[\s\S]*Improved/);
  await ex.locator("summary").first().click();
  const details = ex.getByTestId("progress-exercise-details");
  await details.waitFor();
  assert.match(await details.innerText(), /62\.5 kg/);
  assert.match(await ex.getByTestId("progress-exercise-previous").innerText(), /60 kg/);
  assert.ok(await ex.getByTestId("progress-exercise-history").locator("li").count() >= 2);
  assert.match(await ex.getByTestId("progress-exercise-chart").getAttribute("href"), /^\/progress\//);
  step("UI-02 Training programs: a workout date opens to its exercises; an exercise opens to its sets, the previous comparable workout, history and chart link");
}

/** UI-07/08: the Nutrition day calendar and the History date range. */
async function nutrition(t) {
  const { page } = t;
  const yesterday = iso(daysAgo(1));
  await page.goto(`${BASE}/nutrition`);
  await page.getByTestId("nutrition-date-picker").click();
  await page.getByTestId("nutrition-date-input").fill(yesterday);
  await page.getByTestId("nutrition-date-go").click();
  await page.waitForURL(new RegExp(`date=${yesterday}`));
  await page.getByTestId("nutrition-today").click();
  await page.waitForURL(/\/nutrition$/);
  step("UI-07 the date opens a calendar; a chosen day loads; Jump to today returns");

  await page.goto(`${BASE}/nutrition/history`);
  await page.getByTestId("history-range-picker").click();
  await page.getByTestId("history-range-from").fill(iso(daysAgo(5)));
  await page.getByTestId("history-range-to").fill(iso(daysAgo(15)));
  assert.match(await page.getByTestId("history-range-error").innerText(), /start date is after the end/);
  assert.equal(await page.getByTestId("history-range-apply").isDisabled(), true);
  await page.getByTestId("history-range-from").fill(iso(daysAgo(15)));
  await page.getByTestId("history-range-to").fill(iso(daysAgo(5)));
  await page.getByTestId("history-range-apply").click();
  await page.waitForURL(/from=.*&to=/);
  const body = await page.locator("main").innerText();
  assert.match(body, /AVERAGES FOR THIS PERIOD|Averages for this period/i);
  assert.match(body, /Nothing logged in this period/);
  assert.match(body, /8-week trend · /i);
  await page.goto(`${BASE}/nutrition/history?from=2026-10-20&to=2026-10-01`);
  assert.match(await page.getByTestId("history-range-error").innerText(), /after the end date[\s\S]*Showing this week/);
  await page.getByRole("link", { name: "Previous week" }).click();
  await page.getByTestId("history-this-week").click();
  await page.waitForURL(/\/nutrition\/history$/);
  step("UI-08 a custom range is chosen and validated, with its own averages and an empty-period message; a reversed address is refused; back to this week");
}

(async () => {
  await target.verifyServer();
  for (const name of ["Barbell Bench Press", "Dumbbell Bench Press", "Machine Chest Press", "Back Squat"]) {
    lib[name] = await prisma.exercise.findFirst({ where: { userId: null, name } });
    assert.ok(lib[name], name);
  }
  for (const engine of ["chromium", "firefox", "webkit"]) {
    const browser = await playwright[engine].launch(target.launchOptions(engine));
    try {
      const t = await signedIn(browser, engine);
      await activate(t, engine);
      await scheduleEditor(t, engine);
      if (engine === "chromium") {
        await progress(t);
        await manage(t);
        await nutrition(t);
        await phoneLayout(browser);
      }
      assert.deepEqual(t.errors, [], `${engine}: no page errors`);
    } finally { await browser.close(); }
  }
  console.log("ALL UX CHECKS PASSED");
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
