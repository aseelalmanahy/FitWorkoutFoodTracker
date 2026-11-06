// Phase 4.0.1b against real columns. Refuses to run until the NutritionTarget migration is applied to
// the designated test database, which needs the owner's approval, so an unapplied migration is reported
// as BLOCKED and never counted as a pass.
//   BASE_URL=http://localhost:3000 DATABASE_URL=<local test database> node --test scripts/nutrition-targets.test.cjs
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser, targetMigrationApplied } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const ORIGIN = new URL(BASE).origin;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
let counter = 0;

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dbDate = (iso) => new Date(`${iso}T00:00:00Z`);
const profile = { name: "T", birthDate: "1990-01-01", sex: "MALE", heightCm: 180, currentWeightKg: 80, goalWeightKg: null, goal: "MAINTENANCE", activityLevel: "MODERATE", experience: "BEGINNER", workoutDaysPerWeek: 3, unitSystem: "METRIC", timezone: "UTC" };

function client(token) {
  const cookie = token ? `fit_session=${token}` : "";
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, body: json };
  };
  return { call, get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), put: (p, b) => call("PUT", p, b), page: (p) => fetch(BASE + p, { headers: { Cookie: cookie }, redirect: "manual" }) };
}
async function newUser(label) {
  const { user, token } = await createSignedInUser(prisma, `nt${label}${++counter}x${run}@test.dev`);
  const c = client(token);
  assert.equal((await c.put("/api/profile", profile)).status, 200);
  return { c, user };
}
const rowsOf = (userId) => prisma.nutritionTarget.findMany({ where: { userId }, orderBy: { effectiveFrom: "asc" } });
const makeRow = (userId, date, over = {}) => prisma.nutritionTarget.create({ data: { userId, effectiveFrom: dbDate(date), kcal: 2000, proteinG: 150, carbsG: 215, fatG: 60, source: "MANUAL", ...over } });

before(async () => {
  await target.verifyServer(); // first: hooks don't wait for each other
  if (!(await targetMigrationApplied(prisma))) throw new Error("BLOCKED: the NutritionTarget migration isn't applied to this test database. Applying it needs the owner's approval.");
});
after(() => prisma.$disconnect());

test("T38: the database refuses every invalid shape, and accepts every valid one", async () => {
  const { user } = await newUser("t38");
  const invalid = [
    ["macro on a stopped row", { kcal: null, proteinG: 10, carbsG: null, fatG: null }],
    ["fat on a stopped row", { kcal: null, proteinG: null, carbsG: null, fatG: 10 }],
    ["automatic stopped row", { kcal: null, proteinG: null, carbsG: null, fatG: null, source: "SUGGESTED" }],
    ["carbs without protein", { proteinG: null, carbsG: 100, fatG: 50 }],
    ["carbs without fat", { proteinG: 50, carbsG: 100, fatG: null }],
  ];
  let day = -100;
  for (const [name, values] of invalid) await assert.rejects(makeRow(user.id, addDays(today(), day++), values), /NutritionTarget_(stop_shape|carbs_derived)|check constraint/i, name);
  assert.equal((await rowsOf(user.id)).length, 0, "nothing was stored");
  const valid = [
    { kcal: null, proteinG: null, carbsG: null, fatG: null },
    { proteinG: null, carbsG: null, fatG: null },
    { proteinG: 100, carbsG: null, fatG: null },
    { proteinG: null, carbsG: null, fatG: 50 },
    { proteinG: 0, carbsG: 500, fatG: 0 },
    { source: "SUGGESTED" },
  ];
  for (const values of valid) await makeRow(user.id, addDays(today(), day++), values);
  assert.equal((await rowsOf(user.id)).length, valid.length);
});

test("T41: each combination is stored as given, and null is never 0", async () => {
  const cases = [
    [{ kcal: 2000, proteinG: null, fatG: null }, [null, null, null]],
    [{ kcal: 2000, proteinG: 150, fatG: null }, [150, null, null]],
    [{ kcal: 2000, proteinG: null, fatG: 60 }, [null, null, 60]],
    [{ kcal: 2000, proteinG: 150, fatG: 60 }, [150, 215, 60]],
    [{ kcal: 2000, proteinG: 0, fatG: 0 }, [0, 500, 0]],
    [{ kcal: 2000, proteinG: 0, fatG: null }, [0, null, null]],
  ];
  for (const [body, expected] of cases) {
    const { c, user } = await newUser("t41");
    assert.equal((await c.put("/api/nutrition/targets", body)).status, 200, JSON.stringify(body));
    const [row] = await rowsOf(user.id);
    assert.deepEqual([row.proteinG, row.carbsG, row.fatG], expected, JSON.stringify(body));
    const day = (await c.get(`/api/nutrition/day?date=${today()}`)).body;
    assert.equal(day.macros.protein === null, expected[0] === null);
    assert.equal(day.macros.carbs === null, expected[1] === null);
    assert.equal(day.macros.fat === null, expected[2] === null);
    assert.equal(day.calories.remaining, 2000);
  }
});

test("T39: stopping keeps earlier rows and food, and past days keep their comparison", async () => {
  const { c, user } = await newUser("t39");
  await makeRow(user.id, addDays(today(), -10), { kcal: 2500, proteinG: 150, carbsG: 288, fatG: 69 });
  await makeRow(user.id, addDays(today(), -5), { kcal: 1110, proteinG: 80, carbsG: 100, fatG: 20, source: "SUGGESTED" });
  const food = await c.post("/api/foods", { name: `Bar ${run}`, basisUnit: "G", servingLabel: "1 bar", servingAmount: 100, perServing: { kcal: 400, protein: 20, carbs: 40, fat: 15 } });
  assert.equal(food.status, 200);
  const log = (date) => c.post("/api/nutrition/entries", { date, mealType: "LUNCH", foodId: food.body.food.id, servingId: food.body.food.servings[0].id, quantity: 1 });
  for (const d of [addDays(today(), -7), addDays(today(), -2), today()]) assert.equal((await log(d)).status, 200);
  const rowsBefore = await rowsOf(user.id);
  const entriesBefore = await prisma.foodEntry.findMany({ where: { userId: user.id }, orderBy: { date: "asc" } });

  const stop = await c.post("/api/nutrition/targets/stop");
  assert.equal(stop.status, 200);
  assert.equal(stop.body.stopped, true);

  const after = await rowsOf(user.id);
  assert.deepEqual(after.slice(0, 2), rowsBefore, "earlier rows unchanged in every column");
  assert.deepEqual([after[2].kcal, after[2].proteinG, after[2].carbsG, after[2].fatG, after[2].source], [null, null, null, null, "MANUAL"]);
  assert.deepEqual(await prisma.foodEntry.findMany({ where: { userId: user.id }, orderBy: { date: "asc" } }), entriesBefore, "food log unchanged");

  const day = (d) => c.get(`/api/nutrition/day?date=${d}`);
  assert.equal((await day(addDays(today(), -7))).body.target.kcal, 2500);
  assert.equal((await day(addDays(today(), -2))).body.target.kcal, 1110);
  const now = (await day(today())).body;
  assert.deepEqual([now.target, now.calories, now.macros], [null, null, null]);
  assert.equal(now.totals.kcal, 400, "the entry still counts");

  const h = (await c.get(`/api/nutrition/history?end=${today()}&days=14`)).body;
  assert.equal(h.days.find((d) => d.date === today()).target, null);
  assert.equal(h.summary.avgTargetKcal, 1805, "only days with a target count");

  const g = (await c.get("/api/nutrition/targets")).body;
  assert.equal(g.current, null);
  assert.equal(g.history.length, 3);
  assert.equal(g.history[2].kcal, null, "the stop is visible in history");
});

test("T40: stopping with no target, and twice in a row, adds no row", async () => {
  const none = await newUser("t40a");
  assert.deepEqual((await none.c.post("/api/nutrition/targets/stop")).body, { stopped: false });
  assert.equal((await rowsOf(none.user.id)).length, 0);
  const { c, user } = await newUser("t40b");
  await makeRow(user.id, addDays(today(), -5));
  assert.equal((await c.post("/api/nutrition/targets/stop")).body.stopped, true);
  const after = await rowsOf(user.id);
  assert.deepEqual((await c.post("/api/nutrition/targets/stop")).body, { stopped: false });
  assert.deepEqual(await rowsOf(user.id), after);
});

test("T42: a stop holds past a row dated tomorrow", async () => {
  const { c, user } = await newUser("t42");
  await makeRow(user.id, addDays(today(), -5), { kcal: 2200, proteinG: 100, carbsG: 325, fatG: 60 });
  await makeRow(user.id, addDays(today(), 1), { kcal: 2500, proteinG: 100, carbsG: 400, fatG: 60 });
  assert.equal((await c.post("/api/nutrition/targets/stop")).body.stopped, true);
  const day = (d) => c.get(`/api/nutrition/day?date=${d}`);
  assert.equal((await day(addDays(today(), 1))).body.target, null, "tomorrow has no target");
  assert.equal((await day(addDays(today(), -1))).body.target.kcal, 2200, "the past keeps its target");
});

test("isolation: one person's stop and targets don't reach another's", async () => {
  const a = await newUser("isoa"), b = await newUser("isob");
  await makeRow(a.user.id, addDays(today(), -5));
  await makeRow(b.user.id, addDays(today(), -5), { kcal: 3000, proteinG: 200, carbsG: 415, fatG: 90 });
  const before = await rowsOf(b.user.id);
  assert.equal((await a.c.post("/api/nutrition/targets/stop")).body.stopped, true);
  assert.deepEqual(await rowsOf(b.user.id), before);
  assert.equal((await b.c.get(`/api/nutrition/day?date=${today()}`)).body.target.kcal, 3000);
});

test("T43: every screen and API loads with each row shape, and never shows a null as 0", async () => {
  const shapes = [
    { proteinG: null, carbsG: null, fatG: null },
    { proteinG: 100, carbsG: null, fatG: null },
    { proteinG: null, carbsG: null, fatG: 50 },
    { kcal: null, proteinG: null, carbsG: null, fatG: null },
    { proteinG: 0, carbsG: 500, fatG: 0 },
  ];
  for (const shape of shapes) {
    const { c, user } = await newUser("t43");
    await makeRow(user.id, addDays(today(), -30));
    await makeRow(user.id, addDays(today(), -1), shape);
    for (const p of ["/api/nutrition/targets", `/api/nutrition/day?date=${today()}`, `/api/nutrition/history?end=${today()}&days=56`]) assert.equal((await c.get(p)).status, 200, `${p} ${JSON.stringify(shape)}`);
    for (const p of ["/nutrition", "/nutrition/targets", "/nutrition/history"]) {
      const res = await c.page(p);
      assert.equal(res.status, 200, `${p} ${JSON.stringify(shape)}`);
      const html = await res.text();
      assert.doesNotMatch(html, /NaN|undefined kcal|null kcal/, `${p} ${JSON.stringify(shape)}`);
      if (p === "/nutrition/targets" && shape.kcal !== null && shape.carbsG === null) assert.match(html, /Not set/, JSON.stringify(shape));
      if (p === "/nutrition/targets" && shape.carbsG === null) assert.doesNotMatch(html, /C 0 g/, JSON.stringify(shape));
    }
  }
});

test("a legacy automatic row reads as before", async () => {
  const { c, user } = await newUser("legacy");
  await makeRow(user.id, addDays(today(), -2), { kcal: 1110, proteinG: 80, carbsG: 100, fatG: 20, source: "SUGGESTED" });
  const g = (await c.get("/api/nutrition/targets")).body;
  assert.deepEqual([g.current.kcal, g.current.proteinG, g.current.source], [1110, 80, "SUGGESTED"]);
});
