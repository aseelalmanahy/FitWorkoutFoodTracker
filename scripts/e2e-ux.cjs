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
  assert.equal(await page.getByTestId("activate-help").innerText(), "Select one or more days. Select a day again to remove it.");
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
  const chooser = page.locator("dialog[open][data-testid=schedule-chooser]");
  await chooser.waitFor();
  const checked = () => chooser.locator("input[type=radio]:checked").count();
  assert.equal(await chooser.getByRole("button", { name: "Choose" }).isDisabled(), true, "nothing is preselected");
  assert.equal(await chooser.getByTestId("chooser-option").count(), 3, "only the active program's workouts");
  // UI-03 owner report: showModal() had focused the first workout's radio, and one key press chose it.
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), "H2", "the title has focus, not a workout");
  for (const key of ["Space", "ArrowDown"]) await page.keyboard.press(key);
  assert.equal(await checked(), 0, "a stray key press chooses nothing");
  assert.equal(await chooser.getByRole("button", { name: "Choose" }).isDisabled(), true);
  await chooser.getByRole("radio", { name: /Legs/ }).check();
  assert.equal(await chooser.getByRole("button", { name: "Choose" }).isDisabled(), false, "Choose is enabled once a workout is picked");
  await chooser.getByRole("button", { name: "Cancel" }).click();
  await chooser.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Add a workout to Tuesday" }).click();
  await chooser.waitFor();
  assert.equal(await checked(), 0, "reopening starts with nothing selected again");
  assert.equal(await chooser.getByRole("button", { name: "Choose" }).isDisabled(), true);
  await page.keyboard.press("Escape");
  await chooser.waitFor({ state: "hidden" });
  assert.equal(await page.getByTestId("schedule-state").innerText(), "No changes");

  await page.getByRole("button", { name: /Change the workout on Wednesday/ }).click();
  await chooser.waitFor();
  assert.equal(await chooser.getByRole("radio", { name: /Pull/ }).isChecked(), true, "Change keeps the current workout selected");
  assert.equal(await checked(), 1);
  assert.equal(await chooser.getByRole("button", { name: "Choose" }).isDisabled(), true, "nothing to choose until it's a different workout");
  await page.keyboard.press("Space");
  assert.equal(await chooser.getByRole("radio", { name: /Pull/ }).isChecked(), true);
  await page.keyboard.press("Escape");
  await chooser.waitFor({ state: "hidden" });

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

/**
 * UI-05 (owner report) and UI-09, on a separate disposable user: removing a workout from a program asks first, and
 * Cancel changes nothing; Confirm keeps the plan, its exercises, its schedule assignment and its history. The
 * management rows at 320, 375 and 390 px and on a desktop: the name has room, the actions are on their own row at
 * touch size, the reorder controls are labelled, and nothing spills sideways.
 */
async function programPage(browser) {
  const t = await signedIn(browser, "progpage");
  const { page, user, program, push } = t;
  await prisma.scheduleSlot.create({ data: { userId: user.id, weekday: 0, templateId: push.id } });
  const snapshot = async () => ({
    plan: await prisma.workoutTemplate.findUnique({ where: { id: push.id }, select: { name: true, programId: true, _count: { select: { exercises: true } } } }),
    slots: await slots(user.id),
    sessions: await prisma.workoutSession.count({ where: { userId: user.id, templateId: push.id, status: "COMPLETED" } }),
    sets: await prisma.setEntry.count({ where: { sessionExercise: { session: { userId: user.id } } } }),
  });
  const before = await snapshot();
  assert.equal(before.plan.programId, program.id);
  const writes = [];
  page.on("request", (r) => { if (r.method() !== "GET") writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });

  for (const [width, height] of [[320, 760], [375, 800], [390, 844], [1280, 900]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${BASE}/workouts/programs/${program.id}`);
    const row = page.getByTestId("program-page-day").first();
    await row.waitFor();
    const m = await row.evaluate((el) => {
      const r = (x) => x.getBoundingClientRect();
      const name = el.querySelector("[data-testid=program-day-name]");
      const actions = el.querySelector("[data-testid=program-day-actions]");
      const controls = [...actions.querySelectorAll("button, a")];
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        rowWidth: r(el).width, nameWidth: r(name).width, nameBottom: r(name).bottom, actionsTop: r(actions).top,
        small: controls.filter((c) => r(c).height < 44 || r(c).width < 44).map((c) => c.textContent),
        outside: controls.filter((c) => r(c).right > r(el).right + 1).length,
      };
    });
    assert.ok(m.overflow <= 0, `${width}px: no sideways scrolling (${m.overflow}px)`);
    assert.deepEqual(m.small, [], `${width}px: every control is at least 44 px`);
    assert.equal(m.outside, 0, `${width}px: the actions stay inside the row`);
    if (width < 1024) {
      assert.ok(m.nameWidth >= m.rowWidth * 0.6, `${width}px: the name has room (${Math.round(m.nameWidth)} of ${Math.round(m.rowWidth)} px)`);
      assert.ok(m.actionsTop >= m.nameBottom, `${width}px: the actions are on their own row`);
    }
    assert.equal(await row.getByRole("group", { name: "Reorder Push" }).count(), 1);
    for (const n of ["Move Push up", "Move Push down", "Remove Push from the program"]) assert.equal(await row.getByRole("button", { name: n }).count(), 1, n);
    assert.equal(await row.getByRole("link", { name: "Edit Push" }).count(), 1);
  }
  step("UI-09 Program management at 320, 375, 390 px and desktop: the name has room, actions on their own row at 44 px or more, reorder labelled, no sideways scrolling");

  await page.getByRole("button", { name: "Remove Push from the program" }).click();
  const dialog = page.locator("dialog[open][data-testid=program-remove-dialog]");
  await dialog.waitFor();
  const text = await dialog.innerText();
  assert.match(text, /Remove Push from Push Pull Legs\?/);
  assert.match(text, /workout plan and its 1 exercise stay[\s\S]*completed workout, its exercise history and your progress stay[\s\S]*weekly schedule \(Mon\) stays/);
  assert.deepEqual(writes, [], "nothing is sent before confirming");
  await dialog.getByTestId("confirm-cancel").click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(await snapshot(), before, "Cancel changes nothing");
  assert.equal(await page.getByTestId("program-page-day").count(), 3);

  await page.getByRole("button", { name: "Remove Push from the program" }).click();
  await dialog.getByTestId("confirm-ok").click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByText("“Push” was removed from the program").waitFor();
  const after = await snapshot();
  assert.equal(after.plan.programId, null, "only the program link is cleared");
  assert.deepEqual({ ...after, plan: { ...after.plan, programId: program.id } }, before, "the plan, its exercises, its schedule assignment, its sessions and sets are all kept");
  assert.equal(await page.getByTestId("program-page-day").count(), 2);
  assert.deepEqual(writes, [`PATCH /api/programs/${program.id}`], "one change, after confirming");
  assert.deepEqual(t.errors, []);
  step("UI-05 Remove from program: a confirmation that names what's kept; Cancel changes nothing; Confirm keeps the plan, exercises, schedule and history");
}

const today = () => (new Date().getUTCDay() + 6) % 7; // the fixtures' time zone is UTC; 0 = Monday
// Sent from inside the guarded page, so it goes through the same guarded browser context as every click.
const post = async (page, path, body) => {
  if (!page.url().startsWith(BASE)) await page.goto(`${BASE}/dashboard`);
  const r = await page.evaluate(async ([p, b]) => { const res = await fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return { status: res.status, text: await res.text() }; }, [path, body]);
  return { status: () => r.status, text: async () => r.text, json: async () => JSON.parse(r.text) };
};

/**
 * UI-06B, UI-05B and UI-05C on a disposable user with an active program and a workout scheduled outside it: the
 * exception is shown the same way on Workouts, Today, the weekly schedule and the program; it's resolved by adding the
 * plan (at a chosen place, nothing copied) or by removing it from the schedule; removing a scheduled day from the
 * active program asks whether it leaves the schedule too. Cancel changes nothing.
 */
async function programsRound3(browser) {
  const t = await signedIn(browser, "round3");
  const { page, user, program, push, pull, legs, solo } = t;
  await prisma.profile.update({ where: { userId: user.id }, data: { activeProgramId: program.id } });
  for (const [weekday, templateId] of [[0, push.id], [2, pull.id], [4, legs.id]]) await prisma.scheduleSlot.create({ data: { userId: user.id, weekday, templateId } });
  if (today() !== 6) await prisma.scheduleSlot.create({ data: { userId: user.id, weekday: today(), templateId: solo.id, position: 5 } });
  const state = async () => ({
    plans: await prisma.workoutTemplate.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { name: true, programId: true, programPosition: true, _count: { select: { exercises: true } } } }),
    slots: await slots(user.id),
    sessions: await prisma.workoutSession.count({ where: { userId: user.id } }),
    sets: await prisma.setEntry.count({ where: { sessionExercise: { session: { userId: user.id } } } }),
  });

  await page.goto(`${BASE}/workouts`);
  assert.match(await page.getByTestId("week-program").innerText(), /active program, Push Pull Legs, with \d exceptions? outside it/);
  assert.match(await page.getByTestId("schedule-exceptions").innerText(), /1 exception on your schedule isn't in Push Pull Legs: Mobility and recovery/);
  assert.ok(await page.getByTestId("week-outside").count() >= 1);
  await page.goto(`${BASE}/dashboard`);
  if ((await page.getByText("Today’s workout").count()) > 0) assert.match(await page.getByTestId("today-exception").innerText(), /Exception\s+Mobility and recovery[\s\S]*isn't in your active program, Push Pull Legs/);
  await page.goto(`${BASE}/workouts/schedule`);
  assert.match(await page.getByTestId("schedule-exception").first().innerText(), /Exception not in your active program\. Keep it, remove it from this day, or add it to Push Pull Legs/);
  step("UI-06B the exception is named the same way on Workouts, Today and the weekly schedule, with how to resolve it");

  await page.goto(`${BASE}/workouts/programs/${program.id}`);
  const exc = page.getByTestId("program-exception");
  assert.equal(await exc.count(), 1);
  const before = await state();
  await exc.getByRole("button", { name: /Add Mobility and recovery .* to this program/ }).click();
  const add = page.locator("dialog[open][data-testid=program-add-dialog]");
  await add.waitFor();
  assert.equal(await add.getByTestId("add-option").count(), 1, "only individual plans are offered");
  assert.equal(await add.getByRole("radio", { name: /Mobility and recovery/ }).isChecked(), true, "the one chosen from the exception");
  await add.getByTestId("add-position").selectOption({ label: "Day 2, before Pull" });
  assert.match(await add.getByTestId("add-schedule-effect").innerText(), /stays on your weekly schedule \(.*Sun.*\), unchanged\. As part of your active program it's no longer an exception/);
  await add.getByTestId("confirm-cancel").click();
  await add.waitFor({ state: "hidden" });
  assert.deepEqual(await state(), before, "Cancel changes nothing");
  await page.getByTestId("program-add").click();
  await add.waitFor();
  assert.equal(await add.locator("input[type=radio]:checked").count(), 0, "opened from the button, nothing is chosen");
  assert.equal(await add.getByTestId("confirm-ok").isDisabled(), true);
  await add.getByRole("radio", { name: /Mobility and recovery/ }).check();
  await add.getByTestId("add-position").selectOption({ label: "Day 2, before Pull" });
  await add.getByTestId("confirm-ok").click();
  await page.getByTestId("program-note").filter({ hasText: "was added to the program as day 2" }).waitFor();
  const afterAdd = await state();
  assert.deepEqual(afterAdd.plans.map((p) => [p.name.slice(0, 8), p.programPosition]), [["Legs", 3], ["Mobility", 1], ["Pull", 2], ["Push", 0]]);
  assert.deepEqual([afterAdd.slots, afterAdd.sessions, afterAdd.sets, afterAdd.plans.length], [before.slots, before.sessions, before.sets, 4], "nothing scheduled, copied or deleted");
  assert.equal(await page.getByTestId("program-exceptions").count(), 0, "no exception left");
  step("UI-05B Add existing workout: from the exception or the button, at a chosen place, its schedule explained; Cancel changes nothing; nothing copied");

  const removeDialog = page.locator("dialog[open][data-testid=program-remove-dialog]");
  const openRemove = async (name) => { await page.getByRole("button", { name: `Remove ${name} from the program` }).click(); await removeDialog.waitFor(); };
  await openRemove("Pull");
  assert.match(await removeDialog.innerText(), /on your weekly schedule \(Wed\)\. What should happen there\?/);
  assert.equal(await removeDialog.locator("input[type=radio]:checked").count(), 0, "neither option is chosen for the person");
  assert.equal(await removeDialog.getByTestId("confirm-ok").isDisabled(), true);
  await removeDialog.getByTestId("remove-keep").check();
  await removeDialog.getByTestId("confirm-cancel").click();
  assert.deepEqual(await state(), afterAdd, "Cancel after choosing still changes nothing");
  await openRemove("Pull");
  assert.equal(await removeDialog.locator("input[type=radio]:checked").count(), 0, "reopened afresh");
  await removeDialog.getByTestId("remove-keep").check();
  await removeDialog.getByTestId("confirm-ok").click();
  await page.getByTestId("program-note").filter({ hasText: "still scheduled on Wed as an exception" }).waitFor();
  let now = await state();
  assert.deepEqual(now.slots, afterAdd.slots, "B: the schedule is kept");
  assert.equal(now.plans.find((p) => p.name === "Pull").programId, null);
  assert.match(await page.getByTestId("program-exception").innerText(), /Pull[\s\S]*Wed · individual plan/, "and it's now an exception");

  await page.getByRole("button", { name: "Add Pull to this program" }).click();
  await page.locator("dialog[open][data-testid=program-add-dialog]").getByTestId("confirm-ok").click();
  await page.getByTestId("program-note").filter({ hasText: "“Pull” was added" }).waitFor();
  await openRemove("Pull");
  await removeDialog.getByTestId("remove-remove").check();
  await removeDialog.getByTestId("confirm-ok").click();
  await page.getByTestId("program-note").filter({ hasText: "removed from the program and from your weekly schedule" }).waitFor();
  now = await state();
  assert.ok(!now.slots.some((s) => s.endsWith(":Pull")), "A: off the schedule");
  assert.deepEqual([now.plans.find((p) => p.name === "Pull")._count.exercises, now.sessions, now.sets, now.plans.length], [1, before.sessions, before.sets, 4], "the plan, its exercises and all history stay");
  assert.deepEqual(t.errors, []);
  step("UI-05C Remove from the active program asks: off the schedule too, or kept as an exception; nothing is chosen for the person; both keep the plan and history");
}

/**
 * UI-10 and GYM-01: the One exercise view (the default until a view is chosen) and Full workout, with partly logged
 * sets, typed values, a swap and the rest timer carried across every switch; switching back after a swap.
 */
async function focusMode(browser, engine) {
  const t = await signedIn(browser, `focus${engine}`, { width: 390, height: 844 });
  const { page, user } = t;
  const plan = await prisma.workoutTemplate.create({ data: { userId: user.id, name: "Three moves", exercises: { create: ["Barbell Bench Press", "Back Squat", "Machine Chest Press"].map((n, i) => ({ exerciseId: lib[n].id, position: i, targetSets: 2, targetRepsMin: 8, targetRepsMax: 10 })) } } });
  const started = await post(page, "/api/sessions", { templateId: plan.id });
  assert.equal(started.status(), 200, await started.text());
  const sid = (await started.json()).session.id;
  await page.goto(`${BASE}/workouts/session/${sid}`);
  const visible = page.locator("[data-testid=logger-exercise]:not([hidden])");
  await page.getByTestId("focus-nav").waitFor();
  assert.equal(await page.getByTestId("view-focus").getAttribute("aria-pressed"), "true", "One exercise is the default");
  assert.equal(await visible.count(), 1);
  assert.equal(await page.getByTestId("focus-position").innerText(), "Exercise 1 of 3");
  const cardOf = (name) => page.getByTestId("exercise-card").filter({ has: page.getByRole("heading", { name, exact: true }) });

  const bench = cardOf("Barbell Bench Press");
  await bench.getByLabel("Weight", { exact: true }).fill("60");
  await bench.getByLabel("Reps", { exact: true }).fill("8");
  await bench.getByLabel("Log set", { exact: true }).click();
  await page.getByText(/^Rest \d:\d\d$/).waitFor();
  await bench.getByLabel("Weight", { exact: true }).fill("62.5"); // typed, not logged
  assert.match(await page.getByTestId("focus-progress").innerText(), /1 working set logged of 6 planned/);
  await page.getByRole("button", { name: "Next exercise: Back Squat" }).click();
  assert.equal(await page.getByTestId("focus-position").innerText(), "Exercise 2 of 3");
  await cardOf("Back Squat").getByLabel("Reps", { exact: true }).fill("9");
  await page.getByTestId("view-full").click();
  assert.equal(await visible.count(), 3, "Full workout shows every exercise");
  assert.equal(await bench.getByLabel("Weight", { exact: true }).inputValue(), "62.5", "typed values survive the switch");
  assert.equal(await cardOf("Back Squat").getByLabel("Reps", { exact: true }).inputValue(), "9");
  assert.ok(await page.getByText(/^Rest \d:\d\d$/).isVisible(), "the rest timer keeps running");
  await page.getByTestId("view-focus").click();
  assert.equal(await page.getByTestId("focus-position").innerText(), "Exercise 2 of 3", "back where it was");
  await page.getByTestId("focus-jump").selectOption({ index: 2 });
  assert.equal(await page.getByTestId("focus-position").innerText(), "Exercise 3 of 3");

  // GYM-01 in the One exercise view: swap, then switch back while nothing is logged on the replacement.
  await cardOf("Machine Chest Press").getByTestId("swap-exercise").click();
  await page.getByTestId("swap-sheet").waitFor();
  await page.getByTestId("swap-option").filter({ hasText: "Dumbbell Bench Press" }).first().click();
  await page.getByTestId("swap-confirm").click();
  await page.getByTestId("focus-position").filter({ hasText: "Exercise 4 of 4" }).waitFor();
  assert.ok(await cardOf("Dumbbell Bench Press").isVisible(), "the replacement is shown");
  await cardOf("Dumbbell Bench Press").getByTestId("swap-back").click();
  await page.getByTestId("focus-position").filter({ hasText: "Exercise 3 of 3" }).waitFor();
  assert.ok(await cardOf("Machine Chest Press").isVisible());
  assert.equal(await cardOf("Machine Chest Press").getByTestId("swap-exercise").count(), 1, "the original can be logged, or swapped, again");
  const rows = await prisma.sessionExercise.findMany({ where: { sessionId: sid }, orderBy: { position: "asc" }, include: { exercise: true, sets: true } });
  assert.deepEqual(rows.map((r) => [r.exercise.name, r.sets.length]), [["Barbell Bench Press", 1], ["Back Squat", 0], ["Machine Chest Press", 0]]);
  assert.equal((await prisma.templateExercise.count({ where: { templateId: plan.id } })), 3, "the plan is untouched");

  await page.reload();
  await page.getByTestId("focus-nav").waitFor();
  assert.equal(await page.getByTestId("view-focus").getAttribute("aria-pressed"), "true", "the chosen view is remembered");
  await page.getByTestId("view-full").click();
  await page.reload();
  await page.locator("[data-testid=view-full][aria-pressed=true]").waitFor();
  assert.equal(await page.getByTestId("focus-nav").count(), 0);
  assert.deepEqual(t.errors, []);
  step(`${engine}: UI-10 One exercise by default, Full workout on request; switching keeps typed values, logged sets and the rest timer; GYM-01 switch back after a swap`);
}

/** UI-12: ounces for a food measured by weight, with the total before logging; ml-only foods aren't offered ounces. */
async function ounces(t) {
  const { page, user } = t;
  const made = await post(page, "/api/foods", { name: "Chicken test fillet", basisUnit: "G", servingLabel: "1 fillet", servingAmount: 150, perServing: { kcal: 247.5, protein: 46.5, carbs: 0, fat: 5.4, fiber: null } });
  assert.equal(made.status(), 200, await made.text());
  const juice = await post(page, "/api/foods", { name: "Juice test carton", basisUnit: "ML", servingLabel: "1 glass", servingAmount: 250, perServing: { kcal: 110, protein: 1, carbs: 26, fat: 0, fiber: null } });
  assert.equal(juice.status(), 200, await juice.text());
  await page.goto(`${BASE}/nutrition/add?meal=SNACK`);
  await page.getByLabel("Search foods").fill("Juice test carton");
  await page.getByTestId("food-result").filter({ hasText: "Juice test carton" }).first().click();
  await page.getByRole("dialog").waitFor();
  let units = await page.getByTestId("portion-unit").locator("option").allInnerTexts();
  assert.ok(units.length > 0, `a unit choice is shown: ${await page.getByRole("dialog").innerText()}`);
  assert.ok(!units.some((u) => /oz/.test(u)), `no ounces for a food measured in ml: ${units}`);
  await page.keyboard.press("Escape");
  await page.getByLabel("Search foods").fill("Chicken test fillet");
  await page.getByTestId("food-result").filter({ hasText: "Chicken test fillet" }).first().click();
  await page.getByRole("dialog").filter({ hasText: "Chicken test fillet" }).waitFor();
  units = await page.getByTestId("portion-unit").locator("option").allInnerTexts();
  assert.ok(units.includes("ounces (oz)") && units.includes("grams (g)"), String(units));
  await page.getByTestId("portion-unit").selectOption({ label: "ounces (oz)" });
  await page.getByTestId("portion-quantity").fill("4");
  assert.equal(await page.getByTestId("portion-total").innerText(), "This entry · 4 oz = 113.4 g (1 oz = 28.35 g)");
  assert.match(await page.getByRole("dialog").innerText(), /187\s*kcal/i);
  await page.getByRole("dialog").getByRole("button", { name: /^Add to/ }).click();
  await page.getByText(/^Added/).first().waitFor();
  const e = await prisma.foodEntry.findFirst({ where: { userId: user.id, foodName: "Chicken test fillet" } });
  assert.deepEqual([e.servingLabel, Number(e.servingAmount), Number(e.quantity), Number(e.kcal), Number(e.protein)], ["oz", 28.35, 4, 187.11, 35.15]);
  const food = await prisma.food.findFirst({ where: { userId: user.id, name: "Chicken test fillet" }, include: { servings: true } });
  assert.deepEqual([Number(food.kcalPer100), food.servings.map((s) => s.label).sort()], [165, ["1 fillet (150 g)", "100 g"].sort()], "the food's own data isn't changed");
  step("UI-12 ounces for a food measured by weight, total shown before logging, stored as 4 × 28.35 g; none for a food measured in ml; the food unchanged");
}

/** UI-11 and UI-09: Feedback in the main navigation, and the program page and navigation at phone widths. */
async function navigation(browser) {
  const t = await signedIn(browser, "nav", { width: 320, height: 700 });
  const { page, program } = t;
  await page.goto(`${BASE}/workouts`);
  const bottom = page.getByRole("navigation", { name: "Main" }).filter({ has: page.getByRole("link", { name: "Feedback" }) }).last();
  for (const w of [320, 375, 390]) {
    await page.setViewportSize({ width: w, height: 760 });
    const clipped = await page.evaluate(() => [...document.querySelectorAll("nav[aria-label=Main] a")].filter((a) => a.offsetParent && a.scrollWidth > a.clientWidth + 1).map((a) => a.textContent));
    assert.deepEqual(clipped, [], `${w}px: every navigation label fits`);
  }
  await bottom.getByRole("link", { name: "Feedback" }).click();
  await page.waitForURL(/\/feedback\?from=\/workouts$/);
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await page.waitForURL(/\/workouts$/);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Feedback" }).click();
  await page.waitForURL(/\/feedback\?from=\/workouts$/);
  step("UI-11 Feedback in the side bar and the bottom bar, labels fitting at 320 to 390 px, and Back returns to the page it came from");

  await prisma.workoutProgram.update({ where: { id: program.id }, data: { name: "My current training program for the autumn block" } });
  for (const w of [320, 375]) {
    await page.setViewportSize({ width: w, height: 700 });
    await page.goto(`${BASE}/workouts/programs/${program.id}`);
    const title = await page.getByTestId("page-title").evaluate((h) => ({ cut: h.scrollWidth > h.clientWidth + 1 || getComputedStyle(h).textOverflow === "ellipsis", text: h.textContent }));
    assert.deepEqual(title, { cut: false, text: "My current training program for the autumn block" }, `${w}px: the program's title wraps, uncut`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const covered = await page.evaluate(() => {
      const nav = [...document.querySelectorAll("nav[aria-label=Main]")].find((n) => n.getBoundingClientRect().height > 0 && n.getBoundingClientRect().top > 0);
      const last = [...document.querySelectorAll("main a, main button")].filter((e) => e.offsetParent).at(-1);
      return nav && last && last.getBoundingClientRect().bottom > nav.getBoundingClientRect().top ? `${last.outerHTML.slice(0, 160)} bottom ${last.getBoundingClientRect().bottom}, bar top ${nav.getBoundingClientRect().top}, scrollY ${scrollY}, height ${document.body.scrollHeight}` : false;
    });
    assert.equal(covered, false, `${w}px: the bottom bar doesn't cover the last control`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `${w}px: no sideways scrolling`);
  }
  assert.deepEqual(t.errors, []);
  step("UI-09 a long program title wraps at 320 and 375 px; the bottom bar covers nothing; no sideways scrolling");
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
        await programPage(browser);
        await programsRound3(browser);
        await ounces(t);
        await navigation(browser);
      }
      await focusMode(browser, engine);
      assert.deepEqual(t.errors, [], `${engine}: no page errors`);
    } finally { await browser.close(); }
  }
  console.log("ALL UX CHECKS PASSED");
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
