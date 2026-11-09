// Phase 4.0.6 in real browsers, one at a time: a set whose response is lost, and days whose foods report nothing.
const assert = require("node:assert/strict");
const path = require("node:path");
const playwright = require("playwright");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const SHOTS_DIR = process.env.SHOTS_DIR;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
const created = [];
const today = new Date().toISOString().slice(0, 10);

async function signedIn(browser, label) {
  const { user, token } = await createSignedInUser(prisma, `ready${label}x${run}@test.dev`);
  created.push(user.id);
  await prisma.profile.create({ data: { userId: user.id, name: "Ready", birthDate: new Date("1990-01-01T00:00:00Z"), timezone: "UTC", unitSystem: "METRIC" } });
  const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "UTC" }));
  await require("./lib/logger-view.cjs").preferFullWorkout(ctx);
  await ctx.addCookies([{ name: "fit_session", value: token, url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
  return { user, ctx, page: await ctx.newPage() };
}
const settled = (page) => page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

async function inBrowser(name) {
  const step = (s) => console.log(`✓ [${name}] ${s}`);
  const browser = await playwright[name].launch(target.launchOptions(name));

  // ─── A lost response ───────────────────────────────────────────────────────
  {
    const { user, ctx, page } = await signedIn(browser, `set${name}`);
    const exercise = await prisma.exercise.create({ data: { userId: user.id, name: `Row ${run}`, primaryMuscle: "BACK", equipment: "CABLE" } });
    const session = await prisma.workoutSession.create({ data: { userId: user.id, name: "Session", exercises: { create: { exerciseId: exercise.id, position: 0 } } }, include: { exercises: true } });
    const seId = session.exercises[0].id;
    const rows = () => prisma.setEntry.findMany({ where: { sessionExerciseId: seId } });
    const shown = () => page.getByRole("button", { name: /^Delete set / }).count();
    await page.goto(`${BASE}/workouts/session/${session.id}`);
    await settled(page);

    // What the network does to the next attempts. "lose" saves it and loses the answer, and "slow" delays the answer.
    let posts = [], gets = 0, loseNextPost = false, breakNextGet = false, slowMs = 0;
    await page.route(`**/exercises/${seId}/sets`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      posts.push(route.request().headers()["idempotency-key"]);
      if (loseNextPost) {
        loseNextPost = false;
        await route.fetch();
        return route.abort("connectionreset");
      }
      if (slowMs) await new Promise((r) => setTimeout(r, slowMs));
      return route.continue();
    });
    await page.route(`**/api/sessions/${session.id}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      gets++;
      if (breakNextGet) { breakNextGet = false; return route.abort("connectionreset"); }
      return route.continue();
    });
    const logButton = page.getByRole("button", { name: "Log set" });
    const reps = page.getByLabel("Reps", { exact: true });
    await page.getByLabel("Weight", { exact: true }).fill("60");
    /** Finished once the button is back. It's the page's own state that's then checked. */
    const finished = async () => {
      await page.waitForTimeout(50);
      for (let i = 0; i < 100 && !((await logButton.count()) && (await logButton.isEnabled())); i++) await page.waitForTimeout(100);
    };

    // The answer is lost, and the connection is back by the time it re-reads the workout.
    await reps.fill("8");
    loseNextPost = true;
    await logButton.click();
    await finished();
    assert.equal((await rows()).length, 1, "the server saved it");
    assert.equal(gets, 1, "the page re-read the workout");
    assert.equal(await shown(), 1, "and shows the saved set");
    assert.equal(await reps.inputValue(), "", "and treats it as saved");
    assert.equal(await page.getByText("We can't tell whether this was saved").count(), 0, "with nothing to explain");
    assert.equal(posts.length, 1, "with no second attempt needed");
    step("a lost response finds the saved set, without asking anyone to retry");

    // The answer is lost, and the re-read fails too: the person has to try again.
    posts = [];
    await reps.fill("7");
    loseNextPost = true;
    breakNextGet = true;
    await logButton.click();
    await finished();
    assert.equal(await page.getByText("We can't tell whether this was saved").count(), 1, "a lost response says so");
    assert.equal((await rows()).length, 2, "the server did save it");
    assert.equal(await shown(), 1, "the page can't know that yet");
    assert.equal(await reps.inputValue(), "7", "what was typed is still there");
    step("with no connection, it says so, and keeps what was typed");

    await logButton.click();
    await finished();
    assert.equal(posts.length, 2);
    assert.ok(posts[0], "a key was sent");
    assert.equal(posts[1], posts[0], "the retry uses the same key");
    assert.equal((await rows()).length, 2, "trying again didn't log it twice");
    assert.equal(await shown(), 2, "the screen shows each set once");
    assert.equal(await reps.inputValue(), "", "the retry was treated as saved");
    assert.equal(await page.getByText("We can't tell whether this was saved").count(), 0);
    step("trying again doesn't log the set twice");

    posts = [];
    await reps.fill("6");
    await logButton.click();
    await finished();
    assert.deepEqual((await rows()).map((r) => r.reps).sort(), [6, 7, 8]);
    assert.equal(await shown(), 3);
    assert.equal(posts.length, 1);
    assert.notEqual(posts[0], undefined);
    step("the next set logs as a new one");

    // Changed values after a lost answer: the server refuses, and the page shows what was saved.
    posts = [];
    await reps.fill("5");
    loseNextPost = true;
    breakNextGet = true;
    await logButton.click();
    await finished();
    assert.equal(await shown(), 3);
    await reps.fill("4");
    await logButton.click();
    await finished();
    assert.equal(await page.getByText("An earlier attempt already saved this with different values").count(), 1, "the conflict is explained");
    assert.equal(await shown(), 4, "and the saved set is on the screen to check");
    assert.deepEqual((await rows()).map((r) => r.reps).sort(), [5, 6, 7, 8], "the changed values weren't saved");
    assert.equal(posts[1], posts[0]);
    await logButton.click();
    await finished();
    assert.deepEqual((await rows()).map((r) => r.reps).sort(), [4, 5, 6, 7, 8], "the next save is a new set");
    step("changed values after a lost answer are refused, and what was saved is shown");

    // Enter pressed twice on a slow connection.
    posts = [];
    slowMs = 400;
    await reps.fill("3");
    await reps.press("Enter");
    await reps.press("Enter");
    await finished();
    slowMs = 0;
    assert.equal(posts.length, 1, "one request");
    assert.equal(await shown(), 6, "one more on the screen");
    assert.equal((await rows()).length, 6);
    step("pressing Enter twice logs one set");
    await ctx.close();
  }

  // ─── Finishing a workout, then repeating it, in each browser (T-27) ───────
  {
    const { user, ctx, page } = await signedIn(browser, `finish${name}`);
    const exercise = await prisma.exercise.create({ data: { userId: user.id, name: `Press ${run}`, primaryMuscle: "CHEST", equipment: "BARBELL" } });
    const session = await prisma.workoutSession.create({ data: { userId: user.id, name: "Finish me", exercises: { create: { exerciseId: exercise.id, position: 0, sets: { create: { setNumber: 1, reps: 5, weightKg: 60 } } } } }, include: { exercises: true } });
    const setCount = () => prisma.setEntry.count({ where: { sessionExerciseId: session.exercises[0].id } });
    const recent = [], errors = [];
    const note = (line) => { recent.push(line); if (recent.length > 20) recent.shift(); };
    page.on("dialog", (d) => d.accept());
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("response", (r) => { const u = new URL(r.url()); if (!u.pathname.startsWith("/_next/static")) note(`${r.status()} ${r.request().method()} ${u.pathname}${u.searchParams.has("_rsc") ? " [rsc]" : ""}`); });
    page.on("requestfailed", (r) => note(`failed ${new URL(r.url()).pathname} ${r.failure()?.errorText ?? ""}`));
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) note(`at ${new URL(f.url()).pathname}`); });
    try {
      await page.goto(`${BASE}/workouts/session/${session.id}`);
      await settled(page);

      // A set still saving holds the finish back, so it can't be lost behind a page change.
      let release = () => {};
      const held = new Promise((resolve) => { release = resolve; });
      await page.route(`**/exercises/${session.exercises[0].id}/sets`, async (route) => { await held; await route.continue(); });
      await page.getByLabel("Weight", { exact: true }).fill("62");
      await page.getByLabel("Reps", { exact: true }).fill("4");
      await page.getByRole("button", { name: "Log set" }).click();
      await page.getByRole("button", { name: "Finish" }).click();
      assert.ok(await page.getByText("A set is still saving.").waitFor({ timeout: 5_000 }).then(() => true, () => false), "finishing says a set is still saving");
      assert.equal((await prisma.workoutSession.findUnique({ where: { id: session.id } })).status, "IN_PROGRESS", "and doesn't finish");
      release();
      for (let i = 0; i < 80 && (await setCount()) < 2; i++) await page.waitForTimeout(100);
      assert.equal(await setCount(), 2, "the held set is saved");
      await settled(page);
      await page.unroute(`**/exercises/${session.exercises[0].id}/sets`);

      await page.getByRole("button", { name: "Finish" }).click();
      await page.waitForURL(`**/workouts/history/${session.id}**`);
      const repeat = page.getByRole("button", { name: "Repeat this workout" });
      assert.ok(await repeat.waitFor({ timeout: 15_000 }).then(() => true, () => false), "the finished page offers to repeat the workout");
      assert.equal(await page.getByRole("heading", { name: "Finish me" }).count(), 1, "and shows the finished workout");
      assert.equal(await page.getByText(exercise.name).count(), 1, "with its exercise");
      assert.equal((await prisma.workoutSession.findUnique({ where: { id: session.id } })).status, "COMPLETED");
      await repeat.click();
      await page.waitForURL((url) => url.pathname.startsWith("/workouts/session/") && !url.pathname.endsWith(session.id));
      const sessions = await prisma.workoutSession.findMany({ where: { userId: user.id }, orderBy: { startedAt: "asc" }, include: { exercises: { include: { sets: true } } } });
      assert.equal(sessions.length, 2, "repeating makes one new workout");
      const repeated = sessions.find((s) => s.id !== session.id);
      assert.equal(repeated.status, "IN_PROGRESS");
      assert.ok(page.url().endsWith(repeated.id), "and opens it");
      assert.deepEqual(repeated.exercises.map((x) => [x.exerciseId, x.sets.length]), [[exercise.id, 0]], "with the same exercise, and no sets yet");
      assert.equal(await setCount(), 2, "and the finished workout keeps its sets");
      assert.deepEqual(errors.filter((m) => !/_rsc.*access control checks/.test(m)), [], "no browser error");
    } catch (err) {
      console.error(`WHEN IT FAILED [${name}]: at`, new URL(page.url()).pathname, "| headings:", JSON.stringify(await page.getByRole("heading").allInnerTexts().catch(() => [])));
      console.error(`WHEN IT FAILED [${name}]: browser errors:`, JSON.stringify(errors), "| last activity:", JSON.stringify(recent));
      if (SHOTS_DIR) await page.screenshot({ path: path.join(SHOTS_DIR, `finish-failure-${name}.png`), fullPage: true }).catch(() => {});
      throw err;
    }
    step("finishing reaches the finished page, and repeating makes a new workout");
    await ctx.close();
  }

  // ─── Foods that report nothing ─────────────────────────────────────────────
  {
    const { user, ctx, page } = await signedIn(browser, `null${name}`);
    await prisma.nutritionTarget.create({ data: { userId: user.id, effectiveFrom: new Date(`${today}T00:00:00Z`), source: "MANUAL", kcal: 2000, proteinG: 150, carbsG: 215, fatG: 60 } });
    const food = await prisma.food.create({ data: { source: "CUSTOM", sourceId: `null-${user.id}`, userId: user.id, name: "Reports nothing" } });
    await page.goto(`${BASE}/nutrition`);
    const added = await page.evaluate(async (foodId) => (await fetch("/api/nutrition/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: new Date().toISOString().slice(0, 10), mealType: "LUNCH", foodId, servingId: null, quantity: 100 }) })).status, food.id);
    assert.equal(added, 200);
    await page.reload();
    await settled(page);
    assert.equal(await page.getByText(/^0 kcal/).count(), 0, "unknown calories aren't shown as 0");
    assert.equal(await page.locator("p").filter({ hasText: /^0$/ }).count(), 0, "in the ring or the summary either");
    assert.match(await page.locator("div").filter({ has: page.getByText("Remaining", { exact: true }) }).last().innerText(), /Remaining\s+— kcal$/, "what's left is unknown too");
    assert.equal(await page.getByText("kcal left", { exact: true }).count(), 1, "and it isn't called partial");
    assert.equal(await page.getByText("— kcal *").count(), 1, "they're shown as a dash, marked as incomplete");
    assert.equal(await page.getByText(/^0 \/ 150 g/).count(), 0, "unknown protein isn't shown as 0");
    assert.equal(await page.getByText(/^— \/ 150 g/).count(), 1, "it's shown as a dash");
    assert.equal(await page.getByRole("progressbar", { name: "Protein" }).count(), 0, "with no bar to fill");
    assert.equal(await page.getByText("A dash means none of them do.").count(), 1);
    step("a day whose foods report nothing shows a dash, and no 0");

    await page.goto(`${BASE}/nutrition/history`);
    await settled(page);
    assert.equal(await page.getByText("P — · C — · F — g").count(), 1, "the day's macros are dashes");
    assert.equal(await page.getByText("Protein below target").count(), 0, "unknown isn't below target");
    assert.equal(await page.getByText("Protein on target").count(), 0, "or on it");
    step("history doesn't count it as below target");

    // One food reports, and the other doesn't.
    await page.goto(`${BASE}/nutrition`);
    const some = await prisma.food.create({ data: { source: "CUSTOM", sourceId: `some-${user.id}`, userId: user.id, name: "Reports some", kcalPer100: "100", proteinPer100: "30" } });
    const addedSome = await page.evaluate(async (foodId) => (await fetch("/api/nutrition/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: new Date().toISOString().slice(0, 10), mealType: "DINNER", foodId, servingId: null, quantity: 100 }) })).status, some.id);
    assert.equal(addedSome, 200);
    await page.reload();
    await settled(page);
    assert.equal(await page.getByText("100 kcal *").count(), 1, "the total is marked as partial");
    assert.equal(await page.getByText("1,900 kcal *").count(), 1, "and so is what's left");
    assert.equal(await page.getByText("kcal left *", { exact: true }).count(), 1, "in the ring too");
    await page.goto(`${BASE}/nutrition/history`);
    await settled(page);
    assert.equal(await page.getByText("Protein below target").count(), 0, "a partial total can't show a miss");
    assert.equal(await page.getByText(/· incomplete$/).count(), 1, "and it says it's incomplete");
    step("a partly reported day is marked, and isn't called below target");
    await ctx.close();
  }
  await browser.close();
}

async function cleanUp() {
  await prisma.foodEntry.deleteMany({ where: { userId: { in: created } } });
  await prisma.food.deleteMany({ where: { userId: { in: created } } });
  await prisma.nutritionTarget.deleteMany({ where: { userId: { in: created } } });
  await prisma.workoutSession.deleteMany({ where: { userId: { in: created } } });
  await prisma.exercise.deleteMany({ where: { userId: { in: created } } });
  await prisma.session.deleteMany({ where: { userId: { in: created } } });
  await prisma.profile.deleteMany({ where: { userId: { in: created } } });
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
}

(async () => {
  await target.verifyServer();
  for (const name of ["chromium", "firefox", "webkit"]) await inBrowser(name);
  await cleanUp();
  console.log("ALL READINESS CHECKS PASSED");
})().catch(async (e) => { console.error(e); await cleanUp().catch(() => {}); process.exit(1); });
