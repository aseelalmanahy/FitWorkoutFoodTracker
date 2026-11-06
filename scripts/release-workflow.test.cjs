// Phase 2 release verification: the complete nutrition workflow, through the real
// API and database, with hand-computed expected values (arithmetic in comments).
// Generic food data comes from scripts/stub-food-apis.cjs (USDA "banana"), so this
// suite is NOT a live-provider test. All other foods are custom foods with exact values.
//   BASE_URL=http://localhost:3000 DATABASE_URL=<local test database> node --test scripts/release-workflow.test.cjs
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const ORIGIN = new URL(BASE).origin;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

function client() {
  let cookie = "";
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method, body: body !== undefined ? JSON.stringify(body) : undefined,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
    });
    const set = res.headers.get("set-cookie");
    if (set && set.startsWith("fit_session=")) cookie = set.split(";")[0];
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, body: json };
  };
  return { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), put: (p, b) => call("PUT", p, b), patch: (p, b) => call("PATCH", p, b), del: (p) => call("DELETE", p) };
}
const profile = (over = {}) => ({ name: "R", birthDate: "1990-01-01", sex: "MALE", heightCm: 180, currentWeightKg: 80, goalWeightKg: null, goal: "MAINTENANCE",
  activityLevel: "MODERATE", experience: "BEGINNER", workoutDaysPerWeek: 3, unitSystem: "METRIC", timezone: "UTC", calorieTargetOverride: null, ...over });

const A = client(), X = client(), S = client();
const food = {};
let suggestedKcal;
const entries = {};
const D0 = today(), D1 = addDays(D0, -1), D2 = addDays(D0, -2);

before(async () => {
  await target.verifyServer(); // first: hooks don't wait for each other
  for (const [c, n] of [[A, "a"], [X, "x"], [S, "s"]]) {
    assert.equal((await c.post("/api/auth/register", { email: `rel${n}${run}@test.dev`, password: "long password 123" })).status, 200);
    assert.equal((await c.put("/api/profile", profile())).status, 200);
  }
});
after(() => prisma.$disconnect());

const custom = async (name, servingAmount, perServing) => {
  const r = await A.post("/api/foods", { name: `${name} ${run}`, basisUnit: "G", servingLabel: "1 serving", servingAmount, perServing });
  assert.equal(r.status, 200, `create ${name}`);
  return r.body.food;
};
const log = async (c, date, mealType, f, servingId, quantity) => {
  const r = await c.post("/api/nutrition/entries", { date, mealType, foodId: f.id, servingId, quantity });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.entry;
};

test("1–2. search finds generic and custom foods; detail exposes servings", async () => {
  food.oats = await custom("Oats", 40, { kcal: 150, protein: 5, carbs: 27, fat: 3 });    // per 100 g: 375 / 12.5 / 67.5 / 7.5
  food.egg = await custom("Egg", 50, { kcal: 70, protein: 6, carbs: 0.5, fat: 5 });      // per 100 g: 140 / 12 / 1 / 10
  food.chicken = await custom("Chicken", 100, { kcal: 165, protein: 31, carbs: 0, fat: 3.6 });
  food.rice = await custom("Rice", 100, { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 });
  assert.deepEqual(food.oats.per100, { kcal: 375, protein: 12.5, carbs: 67.5, fat: 7.5, fiber: null });
  const s = await A.get(`/api/foods/search?q=${encodeURIComponent("Oats " + run)}&sources=CUSTOM`);
  assert.equal(s.body.results.CUSTOM[0].foodId, food.oats.id);
  const g = await A.get("/api/foods/search?q=banana&sources=USDA");
  assert.equal(g.body.results.USDA[0].sourceId, "173944");
  food.banana = (await A.post("/api/foods/resolve", { source: "USDA", sourceId: "173944" })).body.food;
  const medium = food.banana.servings.find((x) => x.amount === 118);
  assert.ok(medium, "household serving available");
  food.bananaMedium = medium;
  assert.equal((await A.get(`/api/foods/${food.oats.id}`)).body.food.servings[0].label, "1 serving (40 g)");
});

test("3, 5, 14. log all four meals, several foods in one meal, scaled by serving", async () => {
  const seeded = (await A.get("/api/nutrition/targets")).body.current; // seeds today's suggested target
  assert.equal(seeded.source, "SUGGESTED");
  suggestedKcal = seeded.kcal;
  assert.ok(suggestedKcal >= 1500, "suggestion respects the male intake floor");
  const sv = (f) => f.servings.find((x) => x.isDefault).id;
  entries.oats = await log(A, D0, "BREAKFAST", food.oats, sv(food.oats), 2);       // 80 g → 300 kcal, P10 C54 F6
  entries.egg = await log(A, D0, "BREAKFAST", food.egg, sv(food.egg), 2);          // 100 g → 140, P12 C1 F10
  entries.chickenLunch = await log(A, D0, "LUNCH", food.chicken, null, 150);       // 150 g → 247.5, P46.5 C0 F5.4
  entries.rice = await log(A, D0, "LUNCH", food.rice, sv(food.rice), 1.5);         // 150 g → 195, P4.05 C42 F0.45
  entries.dinner = await log(A, D0, "DINNER", food.chicken, sv(food.chicken), 1);  // 165, P31 C0 F3.6
  entries.banana = await log(A, D0, "SNACK", food.banana, food.bananaMedium.id, 1); // 118 g × 89/100 = 105.02, P1.29 C26.95 F0.39
  assert.deepEqual(entries.oats.nutrients, { kcal: 300, protein: 10, carbs: 54, fat: 6, fiber: null });
  assert.deepEqual(entries.rice.nutrients, { kcal: 195, protein: 4.05, carbs: 42, fat: 0.45, fiber: null });
  assert.deepEqual(entries.banana.nutrients, { kcal: 105.02, protein: 1.29, carbs: 26.95, fat: 0.39, fiber: 3.07 });
});

test("6–7, 10. daily and per-meal totals; remaining for calories and every macro after a manual target", async () => {
  const t = await A.put("/api/nutrition/targets", { kcal: 2000, proteinG: 150, fatG: 60 }); // carbs = ⌊(2000−600−540)/4⌋ = 215
  assert.equal(t.body.target.carbsG, 215);
  const d = (await A.get(`/api/nutrition/day?date=${D0}`)).body;
  const meal = (m) => d.meals.find((x) => x.mealType === m);
  assert.deepEqual([meal("BREAKFAST").entries.length, meal("LUNCH").entries.length, meal("DINNER").entries.length, meal("SNACK").entries.length], [2, 2, 1, 1]);
  assert.equal(meal("BREAKFAST").totals.kcal, 440);   // 300 + 140
  assert.equal(meal("LUNCH").totals.kcal, 442.5);     // 247.5 + 195
  assert.equal(meal("LUNCH").totals.protein, 50.55);  // 46.5 + 4.05
  // Day: kcal 1152.52, P 104.84, C 123.95, F 25.84
  assert.deepEqual([d.totals.kcal, d.totals.protein, d.totals.carbs, d.totals.fat], [1152.52, 104.84, 123.95, 25.84]);
  assert.equal(d.calories.remaining, r2(2000 - 1152.52));
  assert.equal(d.macros.protein.remaining, r2(150 - 104.84));
  assert.equal(d.macros.carbs.remaining, r2(215 - 123.95));
  assert.equal(d.macros.fat.remaining, r2(60 - 25.84));
  for (const k of ["protein", "carbs", "fat"]) assert.equal(d.macros[k].over, 0);
});

test("4. edit (quantity, meal) and delete update totals immediately", async () => {
  const e = await A.patch(`/api/nutrition/entries/${entries.dinner.id}`, { quantity: 2 }); // 330, P62, F7.2
  assert.equal(e.body.entry.nutrients.kcal, 330);
  assert.equal((await A.patch(`/api/nutrition/entries/${entries.banana.id}`, { mealType: "BREAKFAST" })).body.entry.mealType, "BREAKFAST");
  assert.equal((await A.del(`/api/nutrition/entries/${entries.egg.id}`)).status, 200);
  const d = (await A.get(`/api/nutrition/day?date=${D0}`)).body;
  // kcal 1152.52 + 165 − 140 = 1177.52; P 104.84 + 31 − 12 = 123.84; C 123.95 − 1 = 122.95; F 25.84 + 3.6 − 10 = 19.44
  assert.deepEqual([d.totals.kcal, d.totals.protein, d.totals.carbs, d.totals.fat], [1177.52, 123.84, 122.95, 19.44]);
  assert.equal(d.meals.find((m) => m.mealType === "BREAKFAST").totals.kcal, 405.02); // oats 300 + banana 105.02
  assert.equal(d.macros.fat.remaining, r2(60 - 19.44));
});

// Targets are one row per effective date. The manual change in test 6–7 was made on the same
// day as the seeded suggestion, so it replaced that row. The first (and only) target is
// therefore the manual one, and backdated days are covered by it (audit D4 behaviour).
// The "past days keep an earlier target" case is covered by test 11 and by nutrition-api D4.
test("12. backdated entries are covered by the first target (here the manual one set today)", async () => {
  await log(A, D1, "LUNCH", food.oats, food.oats.servings.find((x) => x.isDefault).id, 4); // 160 g → 600, P20
  await log(A, D2, "DINNER", food.chicken, null, 450);                                     // 742.5, P139.5
  const p1 = (await A.get(`/api/nutrition/day?date=${D1}`)).body;
  const p2 = (await A.get(`/api/nutrition/day?date=${D2}`)).body;
  assert.ok(p1.target && p2.target, "backdated days have a target");
  assert.deepEqual([p1.target.kcal, p2.target.kcal, p2.target.source, p2.target.effectiveFrom], [2000, 2000, "MANUAL", D2]);
  assert.equal(p2.calories.remaining, r2(2000 - 742.5));
  assert.equal((await A.get(`/api/nutrition/day?date=${D0}`)).body.target.kcal, 2000);
  assert.equal((await A.get(`/api/nutrition/day?date=${addDays(D2, -1)}`)).body.target, null, "no target before the earliest entry");
});

test("8–9. history: each day's own totals and target; weekly averages; protein consistency; 8-week window", async () => {
  const h = (await A.get(`/api/nutrition/history?end=${D0}&days=7`)).body;
  assert.equal(h.days.length, 7);
  const day = (d) => h.days.find((x) => x.date === d);
  assert.deepEqual([day(D0).totals.kcal, day(D1).totals.kcal, day(D2).totals.kcal], [1177.52, 600, 742.5]);
  assert.deepEqual([day(D0).target.kcal, day(D1).target.kcal, day(D2).target.kcal], [2000, 2000, 2000]);
  assert.equal(h.summary.daysLogged, 3);
  assert.equal(h.summary.avg.kcal, 840);     // (1177.52 + 600 + 742.5) / 3 = 840.0067 → 840.0
  assert.equal(h.summary.avg.protein, 94.4); // (123.84 + 20 + 139.5) / 3 = 94.45 → 94.4
  assert.equal(h.summary.avgTargetKcal, 2000);
  // Protein ≥ 90 % of the day's target (150 g → 135 g): D0 123.84 no; D1 20 no; D2 139.5 yes
  assert.equal(h.summary.proteinDaysWithTarget, 3);
  assert.equal(h.summary.proteinOnTargetDays, 1);
  const trend = (await A.get(`/api/nutrition/history?end=${D0}&days=56`)).body;
  assert.equal(trend.days.length, 56);
  assert.equal(trend.days[0].date, addDays(D0, -55));
  assert.equal(trend.summary.daysLogged, 3);
});

test("11. suggested targets follow a profile change from today on; past days keep the old suggestion", async () => {
  const s0 = (await S.get("/api/nutrition/targets")).body.current;
  assert.equal(s0.source, "SUGGESTED");
  const past = addDays(D0, -3);
  await log(S, past, "LUNCH", food.banana, null, 100);
  await S.put("/api/profile", profile({ currentWeightKg: 95 }));
  const s1 = (await S.get("/api/nutrition/targets")).body;
  assert.equal(s1.current.source, "SUGGESTED");
  assert.ok(s1.current.kcal > s0.kcal && s1.current.proteinG > s0.proteinG);
  const e = 4 * s1.current.proteinG + 4 * s1.current.carbsG + 9 * s1.current.fatG;
  assert.ok(e <= s1.current.kcal && s1.current.kcal - e < 4, "new suggestion internally consistent");
  assert.equal((await S.get(`/api/nutrition/day?date=${past}`)).body.target.kcal, s0.kcal, "past day keeps the old suggestion");
  // A's manual target is untouched by A's own profile change
  await A.put("/api/profile", profile({ currentWeightKg: 95 }));
  assert.equal((await A.get("/api/nutrition/targets")).body.current.kcal, 2000);
});

test("15. isolation: another user cannot read, move, edit, delete or log against A's data, nor change A's targets", async () => {
  const before = (await A.get(`/api/nutrition/day?date=${D0}`)).body;
  assert.equal((await X.put("/api/nutrition/targets", { kcal: 3000, proteinG: 200, fatG: 90 })).status, 200); // X's own
  assert.equal((await X.patch(`/api/nutrition/entries/${entries.oats.id}`, { date: addDays(D0, -1) })).status, 404);
  assert.equal((await X.patch(`/api/nutrition/entries/${entries.oats.id}`, { quantity: 9 })).status, 404);
  assert.equal((await X.del(`/api/nutrition/entries/${entries.oats.id}`)).status, 404);
  assert.equal((await X.get(`/api/foods/${food.oats.id}`)).status, 404);
  assert.equal((await X.del(`/api/foods/${food.oats.id}`)).status, 404);
  assert.equal((await X.post("/api/nutrition/entries", { date: D0, mealType: "SNACK", foodId: food.oats.id, servingId: null, quantity: 10 })).status, 404);
  assert.equal((await X.get(`/api/foods/search?q=${encodeURIComponent("Oats " + run)}&sources=CUSTOM`)).body.results.CUSTOM.length, 0);
  assert.equal((await X.get(`/api/nutrition/day?date=${D0}`)).body.totals.kcal, 0);
  assert.equal((await X.get(`/api/nutrition/history?end=${D0}&days=7`)).body.summary.daysLogged, 0);
  const after = (await A.get(`/api/nutrition/day?date=${D0}`)).body;
  assert.deepEqual(after.totals, before.totals, "A's day unchanged");
  assert.equal(after.target.kcal, 2000, "A's target unchanged by X");
  const ua = await prisma.user.findUnique({ where: { email: `rela${run}@test.dev` } });
  const row = await prisma.foodEntry.findUnique({ where: { id: entries.oats.id } });
  assert.equal(row.userId, ua.id);
  assert.equal(row.date.toISOString().slice(0, 10), D0, "entry not moved");
});
