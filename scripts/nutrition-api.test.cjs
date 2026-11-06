// Integration tests for the Phase 2 nutrition API against a running server and
// its PostgreSQL database. External food APIs must point at
// scripts/stub-food-apis.cjs (FDC_BASE_URL / OFF_BASE_URL / FDC_API_KEY=stub).
//   BASE_URL=http://localhost:3000 DATABASE_URL=<local test database> node --test scripts/nutrition-api.test.cjs
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();
const { signUpWithApi } = require("./lib/signup.cjs");

const BASE = target.baseUrl;
const ORIGIN = new URL(BASE).origin;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();

function client() {
  let cookie = "";
  const call = async (method, path, body, extraHeaders = {}) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const set = res.headers.get("set-cookie");
    if (set && set.startsWith("fit_session=")) cookie = set.split(";")[0];
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, body: json };
  };
  return { signUp: async (email, password = "long password 123") => { cookie = (await signUpWithApi(BASE, email, password)).cookie; }, cookie: () => cookie, signInWith: (token) => { cookie = `fit_session=${token}`; }, call, get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), put: (p, b) => call("PUT", p, b), patch: (p, b) => call("PATCH", p, b), del: (p) => call("DELETE", p) };
}

const profile = (tz = "UTC") => ({
  name: "Tester", birthDate: "1990-01-01", sex: "MALE", heightCm: 180, currentWeightKg: 80, goalWeightKg: null, goal: "MAINTENANCE",
  activityLevel: "MODERATE", experience: "BEGINNER", workoutDaysPerWeek: 3, unitSystem: "METRIC", timezone: tz, calorieTargetOverride: null,
});
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

const A = client(), B = client(), anon = client();
let userA, banana, banana100, nutella;

before(async () => {
  await target.verifyServer(); // first: hooks don't wait for each other
  for (const [c, email] of [[A, `a${run}@test.dev`], [B, `b${run}@test.dev`]]) {
    await c.signUp(email);
    assert.equal((await c.put("/api/profile", profile())).status, 200);
  }
  userA = await prisma.user.findUnique({ where: { email: `a${run}@test.dev` } });
});
after(() => prisma.$disconnect());

test("authentication is required on every nutrition endpoint", async () => {
  const paths = [
    ["GET", "/api/foods/search?q=banana"], ["POST", "/api/foods/resolve"], ["GET", "/api/foods/recent"], ["POST", "/api/foods"],
    ["GET", "/api/foods/x"], ["GET", "/api/foods/barcode/3017624010966"], ["GET", "/api/nutrition/day"], ["GET", "/api/nutrition/history"],
    ["POST", "/api/nutrition/entries"], ["PATCH", "/api/nutrition/entries/x"], ["DELETE", "/api/nutrition/entries/x"],
    ["GET", "/api/nutrition/targets"], ["PUT", "/api/nutrition/targets"],
  ];
  for (const [m, p] of paths) {
    const r = await anon.call(m, p, m === "GET" || m === "DELETE" ? undefined : {});
    assert.equal(r.status, 401, `${m} ${p} → ${r.status}`);
  }
});

test("cross-origin mutations are rejected", async () => {
  const r = await A.call("POST", "/api/nutrition/entries", {}, { Origin: "https://evil.example" });
  assert.equal(r.status, 403);
});

test("food search merges USDA and Open Food Facts with source identifiers", async () => {
  const r = await A.get("/api/foods/search?q=banana");
  assert.equal(r.status, 200);
  assert.equal(r.body.errors.length, 0);
  const b = r.body.results.USDA[0];
  assert.equal(b.source, "USDA");
  assert.equal(b.sourceId, "173944");
  assert.deepEqual(b.per100, { kcal: 89, protein: 1.09, carbs: 22.84, fat: 0.33, fiber: 2.6 });
  assert.ok(b.servings.length >= 2);
  const n = await A.get("/api/foods/search?q=nutella&sources=OPEN_FOOD_FACTS");
  assert.equal(n.body.results.OPEN_FOOD_FACTS[0].sourceId, "3017624010966");
  assert.equal(n.body.results.USDA.length, 0);
});

test("search validation, empty results and barcode queries", async () => {
  assert.equal((await A.get("/api/foods/search?q=a")).status, 400);
  assert.equal((await A.get("/api/foods/search?q=banana&sources=BOGUS")).status, 400);
  const empty = await A.get("/api/foods/search?q=zzzznothing");
  assert.equal(empty.status, 200);
  assert.equal(empty.body.results.USDA.length + empty.body.results.OPEN_FOOD_FACTS.length, 0);
  const bc = await A.get("/api/foods/search?q=3017624010966");
  assert.equal(bc.body.barcode, true);
  assert.equal(bc.body.results.OPEN_FOOD_FACTS[0].name, "Nutella");
  const miss = await A.get("/api/foods/search?q=00000000000000");
  assert.equal(miss.body.errors.length, 0, "unknown barcode is an empty result, not an error");
});

test("external API failures are isolated per source", async () => {
  const r = await A.get("/api/foods/search?q=error");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.errors.map((e) => [e.source, e.kind]).sort(), [["OPEN_FOOD_FACTS", "http"], ["USDA", "http"]]);
});

test("external API timeouts are reported, not hung", async () => {
  const t0 = Date.now();
  const r = await A.get("/api/foods/search?q=timeout");
  assert.equal(r.status, 200);
  assert.ok(r.body.errors.every((e) => e.kind === "timeout"));
  assert.ok(Date.now() - t0 < 12000);
});

test("missing nutrition values are kept as null (not fabricated)", async () => {
  const r = await A.get("/api/foods/search?q=rice");
  const rice = r.body.results.USDA[0];
  assert.equal(rice.per100.kcal, null);
  assert.equal(rice.per100.protein, 2.7);
  assert.equal(rice.complete, false);
});

test("resolving an external food caches it once (no duplicates)", async () => {
  const r1 = await A.post("/api/foods/resolve", { source: "USDA", sourceId: "173944" });
  const r2 = await B.post("/api/foods/resolve", { source: "USDA", sourceId: "173944" });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.food.id, r2.body.food.id);
  assert.equal(await prisma.food.count({ where: { source: "USDA", sourceId: "173944" } }), 1);
  banana = r1.body.food;
  banana100 = banana.servings.find((s) => s.label === "100 g");
  const n = await A.get("/api/foods/barcode/3017624010966");
  assert.equal(n.status, 200);
  nutella = n.body.food;
  assert.equal((await A.post("/api/foods/resolve", { source: "USDA", sourceId: "../x" })).status, 400);
  assert.equal((await A.post("/api/foods/resolve", { source: "USDA", sourceId: "424242" })).status, 404);
});

test("targets: none is seeded; manual update with derived carbs, consistency check", async () => {
  const g = await A.get("/api/nutrition/targets");
  assert.equal(g.status, 200);
  assert.equal(g.body.current, null, "nothing is written for the person");
  assert.equal((await A.put("/api/nutrition/targets", { kcal: 1000, proteinG: 200, fatG: 50 })).status, 400);
  assert.equal((await A.put("/api/nutrition/targets", { kcal: 100, proteinG: 0, fatG: 0 })).status, 400);
  const p = await A.put("/api/nutrition/targets", { kcal: 2300, proteinG: 160, fatG: 70 });
  assert.equal(p.status, 200);
  assert.deepEqual(p.body.target, { effectiveFrom: today(), kcal: 2300, proteinG: 160, carbsG: 257, fatG: 70, source: "MANUAL" });
});

test("profile changes never overwrite manual targets", async () => {
  await A.put("/api/profile", { ...profile(), currentWeightKg: 95 });
  assert.equal((await A.get("/api/nutrition/targets")).body.current.kcal, 2300);
});

let entryId;
test("adding entries scales by serving size (200 kcal × 1.5 rule)", async () => {
  const r = await A.post("/api/nutrition/entries", { date: today(), mealType: "BREAKFAST", foodId: banana.id, servingId: banana100.id, quantity: 1.5 });
  assert.equal(r.status, 200);
  assert.equal(r.body.entry.amount, 150);
  assert.deepEqual(r.body.entry.nutrients, { kcal: 133.5, protein: 1.64, carbs: 34.26, fat: 0.5, fiber: 3.9 });
  entryId = r.body.entry.id;
  const s = nutella.servings.find((x) => x.isDefault); // 15 g
  const n = await A.post("/api/nutrition/entries", { date: today(), mealType: "SNACK", foodId: nutella.id, servingId: s.id, quantity: 2 });
  assert.deepEqual(n.body.entry.nutrients, { kcal: 161.7, protein: 1.89, carbs: 17.25, fat: 9.27, fiber: null });
  const g = await A.post("/api/nutrition/entries", { date: today(), mealType: "LUNCH", foodId: banana.id, servingId: null, quantity: 37 });
  assert.equal(g.body.entry.servingLabel, "g");
  assert.equal(g.body.entry.nutrients.kcal, 32.93);
});

test("entry validation", async () => {
  const base = { date: today(), mealType: "BREAKFAST", foodId: banana.id, servingId: banana100.id, quantity: 1 };
  assert.equal((await A.post("/api/nutrition/entries", { ...base, quantity: 0 })).status, 400);
  assert.equal((await A.post("/api/nutrition/entries", { ...base, quantity: -1 })).status, 400);
  assert.equal((await A.post("/api/nutrition/entries", { ...base, mealType: "BRUNCH" })).status, 400);
  assert.equal((await A.post("/api/nutrition/entries", { ...base, date: "2026-02-30" })).status, 400);
  assert.equal((await A.post("/api/nutrition/entries", { ...base, date: addDays(today(), 5) })).status, 400);
  assert.equal((await A.post("/api/nutrition/entries", { ...base, servingId: nutella.servings[0].id })).status, 400, "serving of another food");
  assert.equal((await A.post("/api/nutrition/entries", { ...base, foodId: "nope" })).status, 404);
  const bad = await fetch(BASE + "/api/nutrition/entries", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: "{" });
  assert.equal(bad.status, 401); // unauthenticated raw request
});

test("daily totals, macro totals, meal grouping and remaining", async () => {
  const d = await A.get(`/api/nutrition/day?date=${today()}`);
  assert.equal(d.status, 200);
  assert.equal(d.body.totals.kcal, 328.13); // 133.5 + 161.7 + 32.93
  assert.equal(d.body.totals.protein, 3.93); // 1.64 + 1.89 + 0.40
  assert.deepEqual(d.body.totals.incomplete, ["fiber"]);
  assert.deepEqual(d.body.meals.map((m) => [m.mealType, m.entries.length]), [["BREAKFAST", 1], ["LUNCH", 1], ["DINNER", 0], ["SNACK", 1]]);
  assert.equal(d.body.calories.remaining, 1971.87);
  assert.equal(d.body.calories.over, 0);
  assert.equal(d.body.macros.protein.target, 160);
});

test("editing an entry recomputes from its snapshot; meal can change", async () => {
  const r = await A.patch(`/api/nutrition/entries/${entryId}`, { quantity: 2, mealType: "DINNER" });
  assert.equal(r.status, 200);
  assert.equal(r.body.entry.nutrients.kcal, 178);
  assert.equal(r.body.entry.mealType, "DINNER");
  const g = await A.patch(`/api/nutrition/entries/${entryId}`, { servingId: null, quantity: 50 });
  assert.equal(g.body.entry.nutrients.kcal, 44.5);
  assert.equal((await A.patch(`/api/nutrition/entries/${entryId}`, {})).status, 400);
  assert.equal((await A.patch(`/api/nutrition/entries/${entryId}`, { quantity: 0 })).status, 400);
});

test("snapshot keeps history stable when the cached food changes", async () => {
  await prisma.food.update({ where: { id: banana.id }, data: { kcalPer100: 999 } });
  const d = await A.get(`/api/nutrition/day?date=${today()}`);
  const e = d.body.meals.flatMap((m) => m.entries).find((x) => x.id === entryId);
  assert.equal(e.nutrients.kcal, 44.5);
  await prisma.food.update({ where: { id: banana.id }, data: { kcalPer100: 89 } });
});

test("over-target intake is reported as over, never negative remaining", async () => {
  await A.put("/api/nutrition/targets", { kcal: 800, proteinG: 60, fatG: 20 });
  await A.post("/api/nutrition/entries", { date: today(), mealType: "DINNER", foodId: banana.id, servingId: null, quantity: 1000 }); // 890 kcal
  const d = await A.get(`/api/nutrition/day?date=${today()}`);
  assert.ok(d.body.totals.kcal > 800);
  assert.equal(d.body.calories.remaining, 0);
  assert.equal(d.body.calories.over, Math.round((d.body.totals.kcal - 800) * 100) / 100);
  assert.equal(d.body.calories.fraction, 1);
  assert.ok(d.body.calories.ratio > 1);
});

test("user isolation: B cannot read, edit or delete A's entries or custom foods", async () => {
  const c = await A.post("/api/foods", { name: `Secret bar ${run}`, basisUnit: "G", servingLabel: "1 bar", servingAmount: 60, perServing: { kcal: 240, protein: 20, carbs: 24, fat: 8 } });
  assert.equal(c.status, 200);
  assert.equal(c.body.food.per100.kcal, 400);
  assert.equal(c.body.food.servings[0].label, "1 bar (60 g)");
  assert.equal((await B.get(`/api/foods/${c.body.food.id}`)).status, 404);
  assert.equal((await B.del(`/api/foods/${c.body.food.id}`)).status, 404);
  const bs = await B.get(`/api/foods/search?q=Secret bar ${run}&sources=CUSTOM`);
  assert.equal(bs.body.results.CUSTOM.length, 0);
  assert.equal((await B.post("/api/nutrition/entries", { date: today(), mealType: "SNACK", foodId: c.body.food.id, servingId: null, quantity: 10 })).status, 404);
  assert.equal((await B.patch(`/api/nutrition/entries/${entryId}`, { quantity: 9 })).status, 404);
  assert.equal((await B.del(`/api/nutrition/entries/${entryId}`)).status, 404);
  const bd = await B.get(`/api/nutrition/day?date=${today()}`);
  assert.equal(bd.body.totals.kcal, 0);
  const bh = await B.get(`/api/nutrition/history?days=7`);
  assert.equal(bh.body.summary.daysLogged, 0);
  assert.equal((await B.get("/api/nutrition/targets")).body.current, null, "A's target isn't B's");
  assert.equal((await B.get("/api/foods/recent")).body.foods.length, 0);
  // entry still intact for A
  assert.equal((await A.patch(`/api/nutrition/entries/${entryId}`, { quantity: 50 })).status, 200);
});

test("historical reporting keeps each day's own target and totals", async () => {
  // Simulate a user who started 10 days ago: move A's first target back and log a past day.
  await prisma.nutritionTarget.create({ data: { userId: userA.id, effectiveFrom: new Date(addDays(today(), -10) + "T00:00:00Z"), kcal: 2500, proteinG: 150, carbsG: 288, fatG: 69, source: "MANUAL" } });
  const past = addDays(today(), -3);
  await A.post("/api/nutrition/entries", { date: past, mealType: "LUNCH", foodId: banana.id, servingId: null, quantity: 200 }); // 178 kcal, 2.18 P
  const h = await A.get(`/api/nutrition/history?end=${today()}&days=7`);
  assert.equal(h.status, 200);
  const pd = h.body.days.find((d) => d.date === past);
  assert.equal(pd.entries, 1);
  assert.equal(pd.totals.kcal, 178);
  assert.equal(pd.target.kcal, 2500, "past day keeps the target in force then");
  const td = h.body.days.find((d) => d.date === today());
  assert.equal(td.target.kcal, 800, "today uses the current target");
  assert.equal(h.body.summary.daysLogged, 2);
  assert.equal(h.body.summary.avgTargetKcal, 1650);
  const pastDay = await A.get(`/api/nutrition/day?date=${past}`);
  assert.equal(pastDay.body.target.kcal, 2500);
  assert.equal(pastDay.body.totals.kcal, 178);
  assert.equal((await A.get("/api/nutrition/history?days=0")).status, 400);
  assert.equal((await A.get("/api/nutrition/history?end=bad")).status, 400);
});

test("deleting entries updates totals; custom food deletion keeps entry snapshot", async () => {
  assert.equal((await A.del(`/api/nutrition/entries/${entryId}`)).status, 200);
  assert.equal((await A.del(`/api/nutrition/entries/${entryId}`)).status, 404);
  const foods = await A.get("/api/foods");
  const bar = foods.body.foods.find((f) => f.name.startsWith("Secret bar"));
  const e = await A.post("/api/nutrition/entries", { date: today(), mealType: "SNACK", foodId: bar.id, servingId: bar.servings[0].id, quantity: 1 });
  assert.equal(e.body.entry.nutrients.kcal, 240);
  assert.equal((await A.del(`/api/foods/${bar.id}`)).status, 200);
  const d = await A.get(`/api/nutrition/day?date=${today()}`);
  const kept = d.body.meals.flatMap((m) => m.entries).find((x) => x.id === e.body.entry.id);
  assert.equal(kept.foodId, null);
  assert.equal(kept.nutrients.kcal, 240);
  assert.equal((await A.patch(`/api/nutrition/entries/${kept.id}`, { quantity: 2 })).body.entry.nutrients.kcal, 480);
});

test("recent foods list returns only the user's logged foods", async () => {
  const r = await A.get("/api/foods/recent");
  assert.ok(r.body.foods.some((f) => f.id === banana.id));
});

test("recent foods stay distinct and complete when one food is logged many times", async () => {
  const C = client();
  await C.signUp(`c${run}@test.dev`);
  await C.put("/api/profile", profile());
  await C.post("/api/nutrition/entries", { date: today(), mealType: "SNACK", foodId: nutella.id, servingId: null, quantity: 10 });
  for (let i = 0; i < 20; i++) await C.post("/api/nutrition/entries", { date: today(), mealType: "SNACK", foodId: banana.id, servingId: null, quantity: 10 });
  const ids = (await C.get("/api/foods/recent")).body.foods.map((f) => f.id);
  assert.deepEqual(ids, [banana.id, nutella.id], "most recent first, no duplicates, older foods not dropped");
});

test("T9: concurrent first reads all succeed and write nothing", async () => {
  const D = client();
  const email = `d${run}@test.dev`;
  await D.signUp(email);
  await D.put("/api/profile", profile());
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => D.get(i % 2 ? "/api/nutrition/targets" : `/api/nutrition/day?date=${today()}`)));
  assert.deepEqual(rs.map((r) => r.status), Array(8).fill(200));
  const u = await prisma.user.findUnique({ where: { email } });
  assert.equal(await prisma.nutritionTarget.count({ where: { userId: u.id } }), 0);
});

test("cached rows from another endpoint (e.g. a stub) are never served as provider data", async () => {
  // Row claiming to be USDA 171477 but produced by a different endpoint, with wrong data.
  const foreign = await prisma.food.upsert({
    where: { source_sourceId: { source: "USDA", sourceId: "171477" } },
    create: { source: "USDA", sourceId: "171477", name: "FOREIGN COPY", kcalPer100: 1, fetchedAt: new Date(), origin: "other-endpoint.example" },
    update: { name: "FOREIGN COPY", kcalPer100: 1, fetchedAt: new Date(), origin: "other-endpoint.example" },
  });
  // Unknown to the configured provider: must not be served from the foreign cache.
  await prisma.food.upsert({
    where: { source_sourceId: { source: "USDA", sourceId: "424243" } },
    create: { source: "USDA", sourceId: "424243", name: "ORPHAN", kcalPer100: 1, fetchedAt: new Date(), origin: null },
    update: { origin: null, fetchedAt: new Date() },
  });
  assert.equal((await A.get(`/api/foods/${foreign.id}`)).status, 404, "untrusted row not exposed by id");
  const s = await A.get("/api/foods/search?q=chicken&sources=USDA");
  assert.equal(s.body.results.USDA.find((i) => i.sourceId === "171477").foodId, null, "untrusted cache id not attached");
  assert.equal((await A.post("/api/foods/resolve", { source: "USDA", sourceId: "424243" })).status, 404, "legacy/unknown-origin row not used as fallback");
  // Logging by the untrusted id refreshes it from the configured provider first.
  const e = await A.post("/api/nutrition/entries", { date: today(), mealType: "LUNCH", foodId: foreign.id, servingId: null, quantity: 100 });
  assert.equal(e.status, 200);
  assert.equal(e.body.entry.foodName, "Chicken, broilers or fryers, breast, meat only, cooked, roasted");
  assert.equal(e.body.entry.nutrients.kcal, 165);
  const row = await prisma.food.findUnique({ where: { id: foreign.id } });
  assert.equal(row.origin, new URL(process.env.FDC_BASE_URL || "https://api.nal.usda.gov/fdc/v1").host);
  assert.equal(await prisma.food.count({ where: { source: "USDA", sourceId: "171477" } }), 1, "refreshed in place, no duplicate");
});

test("concurrent resolves of the same uncached food create one row (no race errors)", async () => {
  await prisma.food.deleteMany({ where: { source: "OPEN_FOOD_FACTS", sourceId: "5000112637922" } });
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? A : B).post("/api/foods/resolve", { source: "OPEN_FOOD_FACTS", sourceId: "5000112637922" })));
  assert.deepEqual(rs.map((r) => r.status), Array(8).fill(200));
  assert.equal(new Set(rs.map((r) => r.body.food.id)).size, 1);
  assert.equal(await prisma.food.count({ where: { source: "OPEN_FOOD_FACTS", sourceId: "5000112637922" } }), 1);
});

// ─── Phase 2.3 regression tests (audit D1, D2, D4, D5, D6) ─────────────────

test("D1: implausible provider values are stored as missing, not as data, and never cause a 500", async () => {
  const r = await A.get("/api/foods/barcode/1234567890123"); // stub product with 54,000,000 kcal/100 g
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.food.per100, { kcal: null, protein: 6, carbs: 50, fat: 30, fiber: null });
  assert.equal(r.body.food.complete, false);
  const row = await prisma.food.findUnique({ where: { source_sourceId: { source: "OPEN_FOOD_FACTS", sourceId: "1234567890123" } } });
  assert.equal(row.kcalPer100, null);
  const s = await A.get("/api/foods/search?q=1234567890123");
  assert.equal(s.body.results.OPEN_FOOD_FACTS[0].per100.kcal, null);
  const e = await A.post("/api/nutrition/entries", { date: today(), mealType: "SNACK", foodId: r.body.food.id, servingId: null, quantity: 40 });
  assert.equal(e.status, 200);
  assert.equal(e.body.entry.nutrients.kcal, null);
  assert.equal(e.body.entry.nutrients.protein, 2.4);
  const d = await A.get(`/api/nutrition/day?date=${today()}`);
  assert.ok(d.body.totals.incomplete.includes("kcal"));
});

test("D2: custom foods outside physical limits are rejected with 400", async () => {
  const base = { name: "Label", basisUnit: "G", servingLabel: "1 bar", servingAmount: 40, perServing: { kcal: 160, protein: 10, carbs: 20, fat: 5 } };
  const kcal = await A.post("/api/foods", { ...base, perServing: { ...base.perServing, kcal: 5000 } }); // 12,500 kcal/100 g
  assert.equal(kcal.status, 400);
  assert.match(JSON.stringify(kcal.body.details), /not physically possible/);
  const prot = await A.post("/api/foods", { ...base, perServing: { ...base.perServing, protein: 100 } }); // 250 g protein/100 g
  assert.equal(prot.status, 400);
  const tiny = await A.post("/api/foods", { ...base, servingAmount: 0.001, perServing: { kcal: 10000, protein: 1, carbs: 1, fat: 1 } }); // was a 500
  assert.equal(tiny.status, 400);
  assert.equal((await A.post("/api/foods", { ...base, servingAmount: 0 })).status, 400);
  assert.equal((await A.post("/api/foods", { ...base, servingAmount: 5001 })).status, 400);
  const oil = await A.post("/api/foods", { name: "Olive oil", basisUnit: "ML", servingLabel: "1 tbsp", servingAmount: 15, perServing: { kcal: 120, protein: 0, carbs: 0, fat: 14 } });
  assert.equal(oil.status, 200, "real extreme (oil, 800 kcal/100 ml) still accepted");
  const ok = await A.post("/api/foods", base);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.food.per100.kcal, 400);
});

test("entries can't exceed the per-entry amount limit (prevents total overflow)", async () => {
  const s = banana.servings.find((x) => x.label === "100 g");
  const r = await A.post("/api/nutrition/entries", { date: today(), mealType: "SNACK", foodId: banana.id, servingId: s.id, quantity: 5000 }); // 500 kg
  assert.equal(r.status, 400);
  const ok = await A.post("/api/nutrition/entries", { date: today(), mealType: "SNACK", foodId: banana.id, servingId: null, quantity: 100 });
  assert.equal((await A.patch(`/api/nutrition/entries/${ok.body.entry.id}`, { quantity: 100001 })).status, 400);
  await A.del(`/api/nutrition/entries/${ok.body.entry.id}`);
});

test("T26: an entry backdated before the first target stays without one, and the target's date doesn't move", async () => {
  const E = client();
  const email = `e${run}@test.dev`;
  await E.signUp(email);
  await E.put("/api/profile", profile());
  assert.equal((await E.put("/api/nutrition/targets", { kcal: 2000, proteinG: 150, fatG: 60 })).status, 200);
  const past = addDays(today(), -5);
  assert.equal((await E.post("/api/nutrition/entries", { date: past, mealType: "LUNCH", foodId: banana.id, servingId: null, quantity: 100 })).status, 200);
  const pd = await E.get(`/api/nutrition/day?date=${past}`);
  assert.equal(pd.body.target, null, "the earlier day has no target");
  assert.equal(pd.body.calories, null);
  assert.equal(pd.body.macros, null);
  assert.equal(pd.body.totals.kcal, 89, "the entry itself still counts");
  const h = await E.get(`/api/nutrition/history?end=${today()}&days=7`);
  assert.equal(h.body.days.find((d) => d.date === past).target, null);
  assert.equal(h.body.days.find((d) => d.date === today()).target.kcal, 2000);
  const u = await prisma.user.findUnique({ where: { email } });
  const rows = await prisma.nutritionTarget.findMany({ where: { userId: u.id } });
  assert.deepEqual(rows.map((r) => r.effectiveFrom.toISOString().slice(0, 10)), [today()], "effectiveFrom stays today");
});

test("D5: serving ids stay stable across a refresh; an add in progress still succeeds", async () => {
  const before = (await A.post("/api/foods/resolve", { source: "USDA", sourceId: "173944" })).body.food;
  const held = before.servings.find((s) => s.label === "100 g"); // add-food sheet open with this serving
  const cup = before.servings.find((s) => s.label.startsWith("1 cup"));
  // Simulate provider change: a serving the provider no longer offers, and a real serving missing locally.
  const gone = await prisma.foodServing.create({ data: { foodId: before.id, label: "Old portion (77 g)", amount: 77, position: 99 } });
  await prisma.foodServing.delete({ where: { id: cup.id } });
  await prisma.food.update({ where: { id: before.id }, data: { fetchedAt: new Date(0) } }); // force refresh
  const after = (await A.post("/api/foods/resolve", { source: "USDA", sourceId: "173944" })).body.food;
  assert.equal(after.id, before.id);
  for (const s of before.servings.filter((x) => x.id !== cup.id)) {
    assert.equal(after.servings.find((x) => x.label === s.label)?.id, s.id, `id kept for "${s.label}"`);
  }
  assert.ok(after.servings.some((x) => x.label === cup.label && x.id !== cup.id), "re-added serving gets a new id");
  assert.ok(!after.servings.some((x) => x.id === gone.id), "removed serving deleted");
  assert.equal(new Set(after.servings.map((x) => x.label)).size, after.servings.length, "no duplicate labels");
  const e = await A.post("/api/nutrition/entries", { date: today(), mealType: "BREAKFAST", foodId: before.id, servingId: held.id, quantity: 1 });
  assert.equal(e.status, 200, "add with a serving id obtained before the refresh");
  assert.equal(e.body.entry.nutrients.kcal, 89);
  const r = await A.post("/api/nutrition/entries", { date: today(), mealType: "BREAKFAST", foodId: before.id, servingId: gone.id, quantity: 1 });
  assert.equal(r.status, 409);
  assert.equal(r.body.details.reason, "serving_removed");
  await A.del(`/api/nutrition/entries/${e.body.entry.id}`);
});

test("D6: heavy concurrent create and refresh of one food is safe (native upsert, row lock)", async () => {
  for (const [source, sourceId] of [["USDA", "171477"], ["OPEN_FOOD_FACTS", "3017624010966"]]) {
    await prisma.food.deleteMany({ where: { source, sourceId } }); // create path
    let rs = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? A : B).post("/api/foods/resolve", { source, sourceId })));
    assert.deepEqual(rs.map((r) => r.status), Array(20).fill(200), `${source} create`);
    assert.equal(new Set(rs.map((r) => r.body.food.id)).size, 1);
    await prisma.food.updateMany({ where: { source, sourceId }, data: { fetchedAt: new Date(0) } }); // refresh path
    rs = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? A : B).post("/api/foods/resolve", { source, sourceId })));
    assert.deepEqual(rs.map((r) => r.status), Array(20).fill(200), `${source} refresh`);
    const row = await prisma.food.findUnique({ where: { source_sourceId: { source, sourceId } }, include: { servings: true } });
    assert.equal(await prisma.food.count({ where: { source, sourceId } }), 1);
    assert.equal(new Set(row.servings.map((s) => s.label)).size, row.servings.length, "no duplicate servings");
    assert.equal(row.servings.filter((s) => s.isDefault).length, 1);
  }
});

// ─── Phase 3.6: matching, provenance and duplicate submissions ───────────────

const withKey = (c, path, body, key) => c.call("POST", path, body, { "Idempotency-Key": key });
const uniqueKey = (label) => `${label}-${run}-${Math.random().toString(36).slice(2)}`.padEnd(16, "x");
const customBody = (name, over = {}) => ({ name, basisUnit: "G", servingLabel: "1 pot", servingAmount: 100, perServing: { kcal: 100, protein: 9, carbs: 5, fat: 4 }, ...over });
const foodsNamed = async (c, name) => (await c.get("/api/foods")).body.foods.filter((f) => f.name === name);
const dayEntries = async (c, date) => (await c.get(`/api/nutrition/day?date=${date}`)).body.meals.flatMap((m) => m.entries);

test("idempotency: a retried custom food returns the first, with one row", async () => {
  const name = `Idem food ${run}`, key = uniqueKey("food");
  const first = await withKey(A, "/api/foods", customBody(name), key);
  assert.equal(first.status, 200);
  const retry = await withKey(A, "/api/foods", customBody(name), key);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.food.id, first.body.food.id);
  assert.deepEqual(retry.body.food, first.body.food);
  assert.equal((await foodsNamed(A, name)).length, 1);
});

test("idempotency: the same key with different values is refused, and saves nothing", async () => {
  const name = `Idem conflict ${run}`, key = uniqueKey("conflict");
  await withKey(A, "/api/foods", customBody(name), key);
  for (const change of [{ name: `${name} 2` }, { perServing: { kcal: 101, protein: 9, carbs: 5, fat: 4 } }, { servingAmount: 50 }, { basisUnit: "ML" }, { brand: "Other" }, { servingLabel: "1 tub" }]) {
    const r = await withKey(A, "/api/foods", customBody(name, change), key);
    assert.equal(r.status, 409, JSON.stringify(change));
    assert.equal(r.body.details.reason, "idempotency_conflict");
  }
  assert.equal((await A.get("/api/foods")).body.foods.filter((f) => f.name.startsWith(name)).length, 1);
});

test("idempotency: concurrent saves with one key make one food, and all answer with it", async () => {
  const name = `Idem race ${run}`, key = uniqueKey("race");
  const all = await Promise.all(Array.from({ length: 10 }, () => withKey(A, "/api/foods", customBody(name), key)));
  assert.deepEqual([...new Set(all.map((r) => r.status))], [200]);
  assert.equal(new Set(all.map((r) => r.body.food.id)).size, 1);
  assert.equal((await foodsNamed(A, name)).length, 1);
});

test("idempotency: a different key, or none, is a separate deliberate food with the same name", async () => {
  const name = `Idem repeat ${run}`;
  await withKey(A, "/api/foods", customBody(name), uniqueKey("one"));
  await withKey(A, "/api/foods", customBody(name), uniqueKey("two"));
  await A.post("/api/foods", customBody(name));
  await A.post("/api/foods", customBody(name));
  assert.equal((await foodsNamed(A, name)).length, 4, "names alone never deduplicate");
});

test("idempotency: one user's key can't reach another user's food or entry", async () => {
  const name = `Idem users ${run}`, key = uniqueKey("users");
  const a = await withKey(A, "/api/foods", customBody(`${name} A`), key);
  const b = await withKey(B, "/api/foods", customBody(`${name} B`), key);
  assert.equal(b.status, 200, "no conflict across users");
  assert.notEqual(b.body.food.id, a.body.food.id);
  assert.equal(b.body.food.name, `${name} B`);
  assert.equal((await A.get(`/api/foods/${b.body.food.id}`)).status, 404);

  const date = addDays(today(), -40);
  const entry = (food) => ({ date, mealType: "LUNCH", foodId: food.id, servingId: null, quantity: 10 });
  const ea = await withKey(A, "/api/nutrition/entries", entry(a.body.food), key);
  const eb = await withKey(B, "/api/nutrition/entries", entry(b.body.food), key);
  assert.equal(ea.status, 200);
  assert.equal(eb.status, 200);
  assert.notEqual(eb.body.entry.id, ea.body.entry.id);
  assert.equal((await A.patch(`/api/nutrition/entries/${eb.body.entry.id}`, { quantity: 1 })).status, 404);
});

test("idempotency: a retried entry returns the first, with one row, and totals count it once", async () => {
  const { body: { food } } = await A.post("/api/foods", customBody(`Idem entry ${run}`));
  const date = addDays(today(), -41), key = uniqueKey("entry");
  const input = { date, mealType: "LUNCH", foodId: food.id, servingId: food.servings[0].id, quantity: 1.5 };
  const first = await withKey(A, "/api/nutrition/entries", input, key);
  assert.equal(first.status, 200);
  const retry = await withKey(A, "/api/nutrition/entries", input, key);
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body.entry, first.body.entry);
  assert.equal((await dayEntries(A, date)).length, 1);
  assert.equal((await A.get(`/api/nutrition/day?date=${date}`)).body.totals.kcal, 150);
});

test("idempotency: an entry retried with different values is refused", async () => {
  const { body: { food } } = await A.post("/api/foods", customBody(`Idem entry conflict ${run}`));
  const date = addDays(today(), -42), key = uniqueKey("entryconflict");
  const input = { date, mealType: "LUNCH", foodId: food.id, servingId: food.servings[0].id, quantity: 1 };
  assert.equal((await withKey(A, "/api/nutrition/entries", input, key)).status, 200);
  const { body: { food: other } } = await A.post("/api/foods", customBody(`Idem entry other ${run}`));
  for (const change of [{ quantity: 2 }, { mealType: "DINNER" }, { date: addDays(date, -1) }, { servingId: null }, { foodId: other.id, servingId: other.servings[0].id }]) {
    assert.equal((await withKey(A, "/api/nutrition/entries", { ...input, ...change }, key)).status, 409, JSON.stringify(change));
  }
  assert.equal((await dayEntries(A, date)).length, 1);
  assert.equal((await dayEntries(A, addDays(date, -1))).length, 0);
});

test("idempotency: concurrent entries with one key make one row", async () => {
  const { body: { food } } = await A.post("/api/foods", customBody(`Idem entry race ${run}`));
  const date = addDays(today(), -43), key = uniqueKey("entryrace");
  const input = { date, mealType: "LUNCH", foodId: food.id, servingId: null, quantity: 80 };
  const all = await Promise.all(Array.from({ length: 10 }, () => withKey(A, "/api/nutrition/entries", input, key)));
  assert.deepEqual([...new Set(all.map((r) => r.status))], [200]);
  assert.equal(new Set(all.map((r) => r.body.entry.id)).size, 1);
  assert.equal((await dayEntries(A, date)).length, 1);
});

test("idempotency: deliberate repeats of one food stay separate entries", async () => {
  const { body: { food } } = await A.post("/api/foods", customBody(`Idem entry repeat ${run}`));
  const date = addDays(today(), -44);
  const input = { date, mealType: "SNACK", foodId: food.id, servingId: null, quantity: 50 };
  await withKey(A, "/api/nutrition/entries", input, uniqueKey("r1"));
  await withKey(A, "/api/nutrition/entries", input, uniqueKey("r2"));
  await A.post("/api/nutrition/entries", input);
  await A.post("/api/nutrition/entries", input);
  assert.equal((await dayEntries(A, date)).length, 4);
});

test("idempotency: a badly formed key is refused, before anything is saved", async () => {
  const name = `Idem bad key ${run}`;
  for (const key of ["short", "has spaces in this key", "x".repeat(200)]) {
    assert.equal((await withKey(A, "/api/foods", customBody(name), key)).status, 400, key);
  }
  assert.equal((await foodsNamed(A, name)).length, 0);
});

test("idempotency: the retry check still needs a signed-in user and the right origin", async () => {
  const key = uniqueKey("anon");
  assert.equal((await withKey(anon, "/api/foods", customBody("x"), key)).status, 401);
  assert.equal((await A.call("POST", "/api/foods", customBody("x"), { Origin: "https://evil.example", "Idempotency-Key": key })).status, 403);
});

test("a JSON body over the limit is refused, whatever its Content-Length says", async () => {
  const big = customBody(`Too big ${run}`, { padding: "x".repeat(300 * 1024) });
  assert.equal((await A.post("/api/foods", big)).status, 413);
  assert.equal((await foodsNamed(A, `Too big ${run}`)).length, 0);
  // Chunked, so there's no Content-Length to reject on: the reader's own count has to catch it.
  const res = await fetch(`${BASE}/api/foods`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: A.cookie() },
    duplex: "half",
    body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify(big))); c.close(); } }),
  });
  assert.equal(res.status, 413);
  assert.equal((await A.post("/api/foods", customBody(`Normal size ${run}`))).status, 200, "ordinary bodies still work");
  assert.equal((await A.call("POST", "/api/foods", undefined)).status, 400, "an empty body is invalid JSON, as before");
});

test("matching: custom foods match every word, in any order, on name or brand, for their owner only", async () => {
  const word = `zq${run}`;
  await A.post("/api/foods", customBody(`Yogurt, Greek ${word}`));
  await A.post("/api/foods", customBody(`Plain oats ${word}`, { brand: "Greek Valley" }));
  await A.post("/api/foods", customBody(`Greek salad only ${word}x`));
  await B.post("/api/foods", customBody(`Yogurt, Greek ${word} of B`));
  const names = async (q) => (await A.get(`/api/foods/search?sources=CUSTOM&q=${encodeURIComponent(q)}`)).body.results.CUSTOM.map((f) => f.name);
  assert.deepEqual(await names(`greek yogurt ${word}`), [`Yogurt, Greek ${word}`], "word order doesn't matter");
  assert.deepEqual(await names(`oats greek ${word}`), [`Plain oats ${word}`], "the brand counts");
  assert.equal((await names(`greek ${word}`)).length, 3, "each record stays separate");
  assert.deepEqual(await names(`greek yogurt missingword ${word}`), [], "every word must match");
});

test("matching: search never merges different records, and reports each one's own values", async () => {
  const r = await A.get("/api/foods/search?q=greek%20yogurt&sources=USDA,OPEN_FOOD_FACTS");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.results.USDA.map((f) => [f.sourceId, f.per100.kcal]), [["900101", 59], ["900102", 97]]);
  assert.deepEqual(r.body.results.OPEN_FOOD_FACTS.map((f) => [f.brand, f.per100.kcal]), [["Hillside", 73], ["Hillside", 120]]);
  const honey = r.body.results.OPEN_FOOD_FACTS[1];
  assert.equal(honey.per100.fat, null, "missing stays null");
  assert.equal(honey.complete, false);
  assert.equal(honey.hasNutrition, true);
});

test("provenance: entries report their record's source, and null once it's gone, with values kept", async () => {
  const date = addDays(today(), -45);
  const { body: { food: mine } } = await A.post("/api/foods", customBody(`Provenance ${run}`));
  const { body: { food: usda } } = await A.post("/api/foods/resolve", { source: "USDA", sourceId: "900201" });
  const { body: { food: off } } = await A.post("/api/foods/resolve", { source: "OPEN_FOOD_FACTS", sourceId: "8800000000127" });
  for (const food of [mine, usda, off]) {
    const r = await A.post("/api/nutrition/entries", { date, mealType: "LUNCH", foodId: food.id, servingId: null, quantity: 100 });
    assert.equal(r.body.entry.foodSource, food.source, "on creating");
  }
  const sources = async () => (await dayEntries(A, date)).map((e) => [e.foodName, e.foodSource, e.nutrients.kcal]);
  assert.deepEqual(await sources(), [[`Provenance ${run}`, "CUSTOM", 100], ["Beef, steak, sirloin, grilled", "USDA", 243], ["Premium White Rice", "OPEN_FOOD_FACTS", 355]]);
  const [entry] = await dayEntries(A, date);
  assert.equal((await A.patch(`/api/nutrition/entries/${entry.id}`, { quantity: 50 })).body.entry.foodSource, "CUSTOM", "on editing");
  assert.equal((await A.del(`/api/foods/${mine.id}`)).status, 200);
  assert.deepEqual((await sources())[0], [`Provenance ${run}`, null, 50], "the record is gone, and its saved values remain");
});

test("provenance: a custom food saved from a label looks like any custom food, as nothing else is stored", async () => {
  const { body: { food } } = await A.post("/api/foods", customBody(`Stored custom ${run}`));
  assert.equal(food.source, "CUSTOM");
  assert.equal(food.dataType, "Custom");
});

test("idempotency: a retry still matches when the database rounded what was sent", async () => {
  // Decimal(9,3): 33.3333 is stored as 33.333, and that must not read as a different request.
  const name = `Idem rounding ${run}`, key = uniqueKey("round");
  const body = customBody(name, { servingAmount: 33.3333, perServing: { kcal: 123.456789, protein: 1.111111, carbs: 2.222222, fat: 3.333333, fiber: 0.123456 } });
  const first = await withKey(A, "/api/foods", body, key);
  assert.equal(first.status, 200);
  const retry = await withKey(A, "/api/foods", body, key);
  assert.equal(retry.status, 200, "a retry of the same values isn't a conflict");
  assert.equal(retry.body.food.id, first.body.food.id);
  assert.equal((await foodsNamed(A, name)).length, 1);

  const date = addDays(today(), -46), entryKey = uniqueKey("roundentry");
  const entry = { date, mealType: "LUNCH", foodId: first.body.food.id, servingId: first.body.food.servings[0].id, quantity: 1.23456 };
  const logged = await withKey(A, "/api/nutrition/entries", entry, entryKey);
  assert.equal(logged.status, 200);
  const again = await withKey(A, "/api/nutrition/entries", entry, entryKey);
  assert.equal(again.status, 200);
  assert.equal(again.body.entry.id, logged.body.entry.id);
});

test("idempotency: a retry naming another food's serving is refused, even with the same label and size", async () => {
  const { body: { food } } = await A.post("/api/foods", customBody(`Idem serving a ${run}`));
  const { body: { food: other } } = await A.post("/api/foods", customBody(`Idem serving b ${run}`));
  assert.equal(other.servings[0].label, food.servings[0].label);
  const date = addDays(today(), -47), key = uniqueKey("serving");
  const input = { date, mealType: "LUNCH", foodId: food.id, servingId: food.servings[0].id, quantity: 1 };
  assert.equal((await withKey(A, "/api/nutrition/entries", input, key)).status, 200);
  assert.equal((await withKey(A, "/api/nutrition/entries", { ...input, servingId: other.servings[0].id }, key)).status, 409);
  assert.equal((await dayEntries(A, date)).length, 1);
});

test("idempotency: a stale retry can't reach another user, and can't damage anything", async () => {
  const { body: { food } } = await A.post("/api/foods", customBody(`Idem stale ${run}`));
  const date = addDays(today(), -48), key = uniqueKey("stale");
  const input = { date, mealType: "LUNCH", foodId: food.id, servingId: null, quantity: 100 };
  const first = await withKey(A, "/api/nutrition/entries", input, key);
  const id = first.body.entry.id;

  // Another user can't read, change or delete it by its derived id, or log against A's private food.
  assert.equal((await B.patch(`/api/nutrition/entries/${id}`, { quantity: 1 })).status, 404);
  assert.equal((await B.del(`/api/nutrition/entries/${id}`)).status, 404);
  assert.equal((await withKey(B, "/api/nutrition/entries", input, key)).status, 404);
  assert.equal((await dayEntries(B, date)).length, 0);
  assert.equal((await dayEntries(A, date)).length, 1);

  // A later edit is kept: the old request no longer matches, so it's refused rather than undoing it.
  assert.equal((await A.patch(`/api/nutrition/entries/${id}`, { quantity: 150 })).status, 200);
  assert.equal((await withKey(A, "/api/nutrition/entries", input, key)).status, 409);
  assert.equal((await dayEntries(A, date))[0].quantity, 150);

  // Without its record, the saved entry stays as it was, and the old request is refused.
  assert.equal((await A.del(`/api/foods/${food.id}`)).status, 200);
  assert.equal((await withKey(A, "/api/nutrition/entries", input, key)).status, 409);
  assert.equal((await dayEntries(A, date))[0].nutrients.kcal, 150);

  // A delete frees the key, which is the documented limit: only the owner's own request can recreate it.
  const { body: { food: kept } } = await A.post("/api/foods", customBody(`Idem stale kept ${run}`));
  const again = { ...input, foodId: kept.id, date: addDays(date, -1) }, keyTwo = uniqueKey("staletwo");
  const made = await withKey(A, "/api/nutrition/entries", again, keyTwo);
  assert.equal((await A.del(`/api/nutrition/entries/${made.body.entry.id}`)).status, 200);
  const remade = await withKey(A, "/api/nutrition/entries", again, keyTwo);
  assert.equal(remade.status, 200);
  assert.equal((await dayEntries(A, again.date)).length, 1);
});

test("the body limit leaves room for the largest real form", async () => {
  const { body: { exercises } } = await A.get("/api/exercises");
  const exercise = (id) => ({ exerciseId: id, targetSets: 20, targetRepsMin: 1, targetRepsMax: 100, targetWeightKg: 500, restSeconds: 600, notes: "n".repeat(1000) });
  const body = { name: `Largest plan ${run}`, notes: "n".repeat(1000), exercises: Array.from({ length: 30 }, (_, i) => exercise(exercises[i % exercises.length].id)) };
  assert.ok(JSON.stringify(body).length > 30_000);
  const r = await A.post("/api/templates", body);
  assert.equal(r.status, 200);
  assert.equal(r.body.template.exercises?.length ?? 30, 30);
});

test("a server error says nothing about why", async () => {
  // PostgreSQL can't store this character, so it fails in the database rather than in validation.
  const r = await A.post("/api/foods", customBody(`Bad \u0000 character ${run}`));
  assert.ok(r.status >= 400, `status ${r.status}`);
  assert.doesNotMatch(JSON.stringify(r.body), /prisma|postgres|invalid byte|sequence|\bquery\b/i);
});

// ─── Phase 4.0.1 Stage A: eligibility, access gate, no automatic targets ─────
// Test ids are from docs/PHASE_4_0_1_IMPLEMENTATION_PLAN.md, sections 12 and H4.
const fs = require("node:fs");
const path = require("node:path");
const { createSignedInUser } = require("./lib/test-users.cjs");

let stageUser = 0;
async function newUser(label, { withProfile = true } = {}) {
  const c = client();
  const email = `${label}${++stageUser}x${run}@test.dev`;
  const { user, token } = await createSignedInUser(prisma, email);
  c.signInWith(token);
  if (withProfile) assert.equal((await c.put("/api/profile", profile())).status, 200);
  return { c, user, email };
}
/** Relative to the UTC date. Fixtures mustn't run on 29 February, as the plan's Annex D says. */
const yearsAgo = (years, offsetDays = 0) => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear() - years, n.getUTCMonth(), n.getUTCDate() + offsetDays)).toISOString().slice(0, 10);
};
const dbDate = (iso) => new Date(`${iso}T00:00:00Z`);
const profileRow = (userId, birthDate) => ({
  userId, name: "Row", birthDate: dbDate(birthDate), sex: "FEMALE", heightCm: 170, currentWeightKg: 60, goal: "MAINTENANCE",
  activityLevel: "LIGHT", experience: "BEGINNER", workoutDaysPerWeek: 2, unitSystem: "METRIC", timezone: "UTC",
});
async function restrictedUser(label) {
  const u = await newUser(label, { withProfile: false });
  await prisma.profile.create({ data: profileRow(u.user.id, yearsAgo(17)) });
  return u;
}
const targetRows = (userId) => prisma.nutritionTarget.findMany({ where: { userId }, orderBy: { effectiveFrom: "asc" } });
const openPage = (c, p) => fetch(BASE + p, { headers: c ? { Cookie: c.cookie() } : {}, redirect: "manual" });
const redirectOf = (res) => res.headers.get("location")?.replace(ORIGIN, "") ?? null;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const SRC = path.join(__dirname, "..", "src", "app");
const urlOf = (root, file) => "/" + path.relative(root, path.dirname(file)).split(path.sep).join("/").replace(/\[[^\]]+\]/g, "x");
const EXEMPT = new Set(["/api/profile", "/api/account/delete", "/api/account/export", "/api/auth/login", "/api/auth/register", "/api/auth/register/complete", "/api/auth/password/forgot", "/api/auth/password/reset", "/api/account/password", "/api/auth/logout", "/api/health/db-identity"]);
function gatedEndpoints() {
  const root = SRC;
  const found = [];
  for (const f of walk(path.join(root, "api")).filter((x) => path.basename(x) === "route.ts")) {
    const url = urlOf(root, f);
    if (EXEMPT.has(url)) continue;
    for (const m of fs.readFileSync(f, "utf8").matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)) found.push([m[1], url]);
  }
  return found;
}
function appPages() {
  const root = path.join(SRC, "(app)");
  return walk(root).filter((x) => path.basename(x) === "page.tsx").map((f) => urlOf(root, f));
}
const sendAs = (c, m, url) => c.call(m, url, m === "GET" || m === "DELETE" ? undefined : {});

test("T4: a declared 17-year-old is refused and nothing is written", async () => {
  const { c, user } = await newUser("t4", { withProfile: false });
  const r = await c.put("/api/profile", { ...profile(), birthDate: yearsAgo(17) });
  assert.equal(r.status, 422);
  assert.equal(r.body.details.reason, "age_ineligible");
  assert.equal(await prisma.profile.count({ where: { userId: user.id } }), 0);
});

test("T1 at the route: the birthday boundary, and out-of-range dates", async () => {
  const { c, user } = await newUser("t1", { withProfile: false });
  assert.equal((await c.put("/api/profile", { ...profile(), birthDate: yearsAgo(18, 1) })).status, 422, "18 tomorrow");
  assert.equal((await c.put("/api/profile", { ...profile(), birthDate: yearsAgo(-1) })).status, 400, "in the future");
  assert.equal((await c.put("/api/profile", { ...profile(), birthDate: yearsAgo(111) })).status, 400, "over the data-entry bound");
  assert.equal((await c.put("/api/profile", { ...profile(), birthDate: "2000-02-30" })).status, 400, "not a date");
  assert.equal(await prisma.profile.count({ where: { userId: user.id } }), 0);
  assert.equal((await c.put("/api/profile", { ...profile(), birthDate: yearsAgo(18) })).status, 200, "18 today");
});

test("T3: the client's time zone can't change the answer", async () => {
  // Chosen so that a rule using the person's local date would give the opposite result.
  const now = new Date();
  if (now.getUTCHours() === 23 && now.getUTCMinutes() === 59) await new Promise((r) => setTimeout(r, 61_000));
  const hour = new Date().getUTCHours();
  if (hour >= 10) {
    // It's already tomorrow on Kiritimati, where this person has turned 18. Not yet in UTC.
    const { c, user } = await newUser("t3k", { withProfile: false });
    const r = await c.put("/api/profile", { ...profile("Pacific/Kiritimati"), birthDate: yearsAgo(18, 1) });
    assert.equal(r.status, 422);
    assert.equal(await prisma.profile.count({ where: { userId: user.id } }), 0);
  }
  if (hour < 11) {
    // It's still yesterday in Pago Pago, where this person is 17. They're 18 in UTC.
    const { c } = await newUser("t3p", { withProfile: false });
    assert.equal((await c.put("/api/profile", { ...profile("Pacific/Pago_Pago"), birthDate: yearsAgo(18) })).status, 200);
  }
});

test("T5: a refused edit changes nothing, and access continues", async () => {
  const { c, user } = await newUser("t5");
  const before = await prisma.profile.findUnique({ where: { userId: user.id } });
  const r = await c.put("/api/profile", { ...profile(), name: "Changed", currentWeightKg: 99, birthDate: yearsAgo(17) });
  assert.equal(r.status, 422);
  assert.deepEqual(await prisma.profile.findUnique({ where: { userId: user.id } }), before, "every column unchanged");
  assert.equal((await c.get("/api/sessions")).status, 200, "an uncommitted edit doesn't restrict");
  assert.equal((await openPage(c, "/dashboard")).status, 200);
});

test("T6: the refusal states no threshold, once the entered date is taken out", async () => {
  const { c } = await newUser("t6", { withProfile: false });
  const date = yearsAgo(17);
  const r = await c.put("/api/profile", { ...profile(), birthDate: date });
  const text = JSON.stringify(r.body).replace(date, "");
  assert.doesNotMatch(text, /18|13/);
  assert.doesNotMatch(text, /adult|years/i);
});

test("T7: a refused date doesn't reach the server log", async () => {
  const log = process.env.SERVER_LOG_FILE;
  assert.ok(log, "SERVER_LOG_FILE must be set");
  const { c } = await newUser("t7", { withProfile: false });
  const date = yearsAgo(16, -123);
  assert.equal((await c.put("/api/profile", { ...profile(), birthDate: date })).status, 422);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!fs.readFileSync(log, "utf8").includes(date), "date absent from the log");
});

test("T36: refused attempts are limited, without blocking the rest of an account", async () => {
  const fresh = await newUser("t36a", { withProfile: false });
  for (let i = 0; i < 10; i++) assert.equal((await fresh.c.put("/api/profile", { ...profile(), birthDate: yearsAgo(17) })).status, 422, `attempt ${i + 1}`);
  const limited = await fresh.c.put("/api/profile", { ...profile(), birthDate: yearsAgo(17) });
  assert.equal(limited.status, 429);
  assert.equal(JSON.stringify(limited.body).includes(yearsAgo(17)), false, "no date in the answer");
  assert.equal((await fresh.c.put("/api/profile", { ...profile(), birthDate: yearsAgo(30) })).status, 429, "applies to any new date until the window ends");
  assert.equal(await prisma.profile.count({ where: { userId: fresh.user.id } }), 0);

  const existing = await newUser("t36b");
  for (let i = 0; i < 10; i++) await existing.c.put("/api/profile", { ...profile(), birthDate: yearsAgo(17) });
  assert.equal((await existing.c.put("/api/profile", { ...profile(), birthDate: yearsAgo(31) })).status, 429);
  assert.equal((await existing.c.put("/api/profile", { ...profile(), name: "Still editable" })).status, 200, "an edit that keeps the date isn't limited");

  const other = await newUser("t36c", { withProfile: false });
  assert.equal((await other.c.put("/api/profile", { ...profile(), birthDate: yearsAgo(17) })).status, 422, "one account's limit isn't another's");
});

test("T33: every gated endpoint refuses a session with no profile, and a restricted one", async () => {
  const endpoints = gatedEndpoints();
  assert.ok(endpoints.length >= 40, `found ${endpoints.length}`);
  const none = await newUser("t33n", { withProfile: false });
  const restricted = await restrictedUser("t33r");
  for (const [m, url] of endpoints) {
    assert.equal((await sendAs(none.c, m, url)).status, 409, `no profile: ${m} ${url}`);
    const r = await sendAs(restricted.c, m, url);
    assert.equal(r.status, 403, `restricted: ${m} ${url}`);
    assert.equal(r.body.details.reason, "account_restricted");
    assert.equal((await sendAs(anon, m, url)).status, 401, `anonymous: ${m} ${url}`);
  }
  for (const u of [none, restricted]) {
    assert.equal(await prisma.food.count({ where: { userId: u.user.id } }), 0);
    assert.equal(await prisma.workoutSession.count({ where: { userId: u.user.id } }), 0);
    assert.equal(await prisma.foodEntry.count({ where: { userId: u.user.id } }), 0);
  }
});

test("T33: what a restricted person keeps: profile, correction and logout", async () => {
  const restricted = await restrictedUser("t33k");
  assert.equal((await restricted.c.get("/api/profile")).status, 200);
  const r = await restricted.c.put("/api/profile", { ...profile(), birthDate: yearsAgo(17) });
  assert.equal(r.status, 422, "the same rule applies to a correction");
  assert.equal((await restricted.c.get("/api/sessions")).status, 403, "still restricted");
  const fixed = await restricted.c.put("/api/profile", { ...profile(), birthDate: yearsAgo(30) });
  assert.equal(fixed.status, 200);
  assert.equal((await restricted.c.get("/api/sessions")).status, 200, "a corrected date restores access");
  const again = await restrictedUser("t33l");
  assert.equal(await prisma.user.count({ where: { id: again.user.id } }), 1, "the account isn't deleted");
  assert.equal((await again.c.post("/api/auth/logout", {})).status, 200);
  assert.equal((await again.c.get("/api/profile")).status, 401, "the session is gone");
});

test("the gate keeps login and the Origin check working", async () => {
  // Through the real sign-up, as this test logs in with the password.
  const email = `gate${run}@test.dev`;
  await client().signUp(email); // throws unless register, complete and login each answered 200
  const { id } = await prisma.user.findUnique({ where: { email } });
  await prisma.profile.create({ data: profileRow(id, yearsAgo(17)) });
  const fresh = client();
  assert.equal((await fresh.post("/api/auth/login", { email, password: "long password 123" })).status, 200, "a restricted person can still sign in");
  assert.equal((await fresh.call("PUT", "/api/profile", profile(), { Origin: "https://evil.example" })).status, 403, "cross-origin refused on the exception");
  assert.equal((await fresh.call("POST", "/api/foods", {}, { Origin: "https://evil.example" })).status, 403);
});

test("T34: pages send a restricted person to one place, with no redirect loop", async () => {
  const pages = appPages();
  assert.ok(pages.length > 10, `found ${pages.length}`);
  const restricted = await restrictedUser("t34r");
  const none = await newUser("t34n", { withProfile: false });
  const ok = await newUser("t34o");
  for (const p of pages) {
    const r = await openPage(restricted.c, p);
    assert.equal(redirectOf(r), "/account-restricted", `restricted: ${p} (${r.status})`);
    assert.equal(redirectOf(await openPage(none.c, p)), "/onboarding", `no profile: ${p}`);
  }
  assert.equal((await openPage(restricted.c, "/account-restricted")).status, 200, "the page itself loads");
  assert.equal(redirectOf(await openPage(restricted.c, "/onboarding")), "/dashboard", "which then leads back to the one place");
  assert.equal(redirectOf(await openPage(none.c, "/account-restricted")), "/onboarding");
  assert.equal((await openPage(none.c, "/onboarding")).status, 200);
  assert.equal(redirectOf(await openPage(ok.c, "/account-restricted")), "/dashboard");
  assert.equal((await openPage(ok.c, "/dashboard")).status, 200);
  assert.match(redirectOf(await openPage(null, "/account-restricted")), /\/login$/);
});

test("T8: reads write nothing, with and without entries, through the API and the pages", async () => {
  const { c, user } = await newUser("t8");
  const reads = async () => {
    for (const p of ["/api/nutrition/targets", `/api/nutrition/day?date=${today()}`, `/api/nutrition/history?end=${today()}&days=7`]) assert.equal((await c.get(p)).status, 200, p);
    for (const p of ["/nutrition", "/nutrition/targets", "/nutrition/history"]) assert.equal((await openPage(c, p)).status, 200, p);
    assert.equal(await prisma.nutritionTarget.count({ where: { userId: user.id } }), 0);
  };
  await reads();
  assert.equal((await c.post("/api/nutrition/entries", { date: addDays(today(), -3), mealType: "LUNCH", foodId: banana.id, servingId: null, quantity: 100 })).status, 200);
  await reads();
});

test("T10: a first manual save writes exactly one row, with no suggestion beside it", async () => {
  const { c, user } = await newUser("t10");
  await c.post("/api/nutrition/entries", { date: addDays(today(), -4), mealType: "LUNCH", foodId: banana.id, servingId: null, quantity: 100 });
  assert.equal((await c.put("/api/nutrition/targets", { kcal: 2000, proteinG: 120, fatG: 60 })).status, 200);
  const rows = await targetRows(user.id);
  assert.deepEqual(rows.map((r) => [r.source, r.effectiveFrom.toISOString().slice(0, 10)]), [["MANUAL", today()]]);
});

test("T11: a profile edit never changes a target row, of either source", async () => {
  for (const source of ["SUGGESTED", "MANUAL"]) {
    const { c, user } = await newUser("t11");
    await prisma.nutritionTarget.create({ data: { userId: user.id, effectiveFrom: dbDate(today()), kcal: 1234, proteinG: 80, carbsG: 100, fatG: 40, source } });
    const before = await targetRows(user.id);
    assert.equal((await c.put("/api/profile", { ...profile(), currentWeightKg: 110, goal: "FAT_LOSS" })).status, 200);
    assert.deepEqual(await targetRows(user.id), before, `${source} row unchanged`);
  }
});

test("T12: a legacy override column creates no target", async () => {
  const { c, user } = await newUser("t12");
  await prisma.profile.update({ where: { userId: user.id }, data: { calorieTargetOverride: 1500 } });
  assert.equal((await c.get("/api/nutrition/targets")).body.current, null);
  assert.equal((await c.get(`/api/nutrition/day?date=${today()}`)).body.target, null);
  assert.equal(await prisma.nutritionTarget.count({ where: { userId: user.id } }), 0);
});

test("T13: a sent override is ignored", async () => {
  const { c, user } = await newUser("t13");
  assert.equal((await c.put("/api/profile", { ...profile(), calorieTargetOverride: 800 })).status, 200);
  assert.equal((await prisma.profile.findUnique({ where: { userId: user.id } })).calorieTargetOverride, null, "column unchanged");
  assert.equal(await prisma.nutritionTarget.count({ where: { userId: user.id } }), 0);
});

test("T14: the person's own save replaces today's legacy row, and only that save converts it", async () => {
  const { c, user } = await newUser("t14");
  await prisma.nutritionTarget.create({ data: { userId: user.id, effectiveFrom: dbDate(today()), kcal: 1110, proteinG: 80, carbsG: 100, fatG: 20, source: "SUGGESTED" } });
  assert.equal((await c.get("/api/nutrition/targets")).body.current.source, "SUGGESTED", "a read doesn't convert it");
  assert.equal((await c.put("/api/profile", { ...profile(), currentWeightKg: 85 })).status, 200);
  assert.equal((await c.get("/api/nutrition/targets")).body.current.source, "SUGGESTED", "a profile edit doesn't convert it");
  assert.equal((await c.put("/api/nutrition/targets", { kcal: 2100, proteinG: 120, fatG: 60 })).status, 200);
  const rows = await targetRows(user.id);
  assert.deepEqual(rows.map((r) => [r.source, r.kcal]), [["MANUAL", 2100]]);
});

test("T15, T16: the suggestion route and the suggestion key are gone", async () => {
  const { c } = await newUser("t15");
  assert.equal((await c.post("/api/nutrition/targets/suggestion", {})).status, 404);
  const g = await c.get("/api/nutrition/targets");
  assert.equal(g.status, 200);
  assert.equal("suggestion" in g.body, false);
  assert.deepEqual(Object.keys(g.body).sort(), ["current", "history", "today"]);
});

test("T17: a day with no target works, with correct totals", async () => {
  const { c } = await newUser("t17");
  await c.post("/api/nutrition/entries", { date: today(), mealType: "LUNCH", foodId: banana.id, servingId: null, quantity: 100 });
  const d = await c.get(`/api/nutrition/day?date=${today()}`);
  assert.equal(d.status, 200);
  assert.deepEqual([d.body.target, d.body.calories, d.body.macros], [null, null, null]);
  assert.equal(d.body.totals.kcal, 89);
  const h = await c.get(`/api/nutrition/history?end=${today()}&days=7`);
  assert.equal(h.status, 200);
  assert.deepEqual([h.body.summary.avgTargetKcal, h.body.summary.proteinDaysWithTarget], [null, 0]);
  assert.equal(h.body.summary.daysLogged, 1);
});

test("T29: earlier rows survive reads, a profile edit and a save, and past days keep their own target", async () => {
  const { c, user } = await newUser("t29");
  const dates = [addDays(today(), -20), addDays(today(), -10), addDays(today(), -5)];
  await prisma.nutritionTarget.createMany({ data: [
    { userId: user.id, effectiveFrom: dbDate(dates[0]), kcal: 1110, proteinG: 80, carbsG: 100, fatG: 20, source: "SUGGESTED" },
    { userId: user.id, effectiveFrom: dbDate(dates[1]), kcal: 2500, proteinG: 150, carbsG: 288, fatG: 69, source: "MANUAL" },
    { userId: user.id, effectiveFrom: dbDate(dates[2]), kcal: 2200, proteinG: 140, carbsG: 255, fatG: 60, source: "MANUAL" },
  ] });
  await c.post("/api/nutrition/entries", { date: addDays(today(), -30), mealType: "LUNCH", foodId: banana.id, servingId: null, quantity: 100 });
  const before = await targetRows(user.id);
  await c.get("/api/nutrition/targets");
  await c.get(`/api/nutrition/history?end=${today()}&days=56`);
  await c.put("/api/profile", { ...profile(), currentWeightKg: 90 });
  assert.equal((await c.put("/api/nutrition/targets", { kcal: 1900, proteinG: 130, fatG: 55 })).status, 200);
  const after = await targetRows(user.id);
  assert.deepEqual(after.slice(0, 3), before, "earlier rows unchanged in every column");
  assert.equal(after.length, 4);
  const on = async (d) => (await c.get(`/api/nutrition/day?date=${d}`)).body.target;
  assert.equal(await on(addDays(today(), -30)), null);
  assert.deepEqual([(await on(addDays(today(), -15))).kcal, (await on(addDays(today(), -15))).source], [1110, "SUGGESTED"]);
  assert.equal((await on(addDays(today(), -7))).kcal, 2500);
  assert.equal((await on(addDays(today(), -1))).kcal, 2200);
  assert.equal((await on(today())).kcal, 1900);
});

test("T30: omitted macros and a null kcal are refused, and never become 0", async () => {
  const { c, user } = await newUser("t30");
  assert.equal((await c.put("/api/nutrition/targets", { kcal: 2000 })).status, 400);
  assert.equal((await c.put("/api/nutrition/targets", { kcal: 2000, proteinG: 100 })).status, 400);
  assert.equal((await c.put("/api/nutrition/targets", { kcal: 2000, fatG: null })).status, 400, "the key has to be sent, even as null");
  assert.equal((await c.put("/api/nutrition/targets", { kcal: null, proteinG: null, fatG: null })).status, 400, "stopping has its own route");
  assert.equal((await c.put("/api/nutrition/targets", { proteinG: 100, fatG: 50 })).status, 400);
  assert.equal(await prisma.nutritionTarget.count({ where: { userId: user.id } }), 0);
});

test("existing workouts still work for an eligible person", async () => {
  const { c } = await newUser("wk");
  assert.equal((await c.get("/api/exercises")).status, 200);
  assert.equal((await c.get("/api/templates")).status, 200);
  assert.equal((await c.get("/api/schedule")).status, 200);
  assert.equal((await c.get("/api/sessions")).status, 200);
});

// ─── Phase 4.0.1b, needing no null column. The rest is in nutrition-targets.test.cjs ───
test("T41: explicit zero stays zero, as the person's own value", async () => {
  const { c, user } = await newUser("zero");
  const r = await c.put("/api/nutrition/targets", { kcal: 2000, proteinG: 0, fatG: 0 });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.target.proteinG, r.body.target.carbsG, r.body.target.fatG], [0, 500, 0]);
  const rows = await targetRows(user.id);
  assert.deepEqual([rows[0].proteinG, rows[0].carbsG, rows[0].fatG], [0, 500, 0]);
  const m = (await c.get(`/api/nutrition/day?date=${today()}`)).body.macros;
  assert.deepEqual([m.protein.target, m.fat.target], [0, 0], "a target of 0 is still a target");
});

test("T40: stopping with no target writes nothing, and repeating it is harmless", async () => {
  const { c, user } = await newUser("stopnone");
  for (let i = 0; i < 2; i++) {
    const r = await c.post("/api/nutrition/targets/stop");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { stopped: false });
  }
  assert.equal(await prisma.nutritionTarget.count({ where: { userId: user.id } }), 0);
});

test("the stop route keeps sign-in, the Origin check and the access gate", async () => {
  assert.equal((await anon.post("/api/nutrition/targets/stop")).status, 401);
  const { c, user } = await newUser("stopauth");
  await prisma.nutritionTarget.create({ data: { userId: user.id, effectiveFrom: dbDate(addDays(today(), -3)), kcal: 2000, proteinG: 100, carbsG: 275, fatG: 50, source: "MANUAL" } });
  const before = await targetRows(user.id);
  assert.equal((await c.call("POST", "/api/nutrition/targets/stop", undefined, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await c.get("/api/nutrition/targets/stop")).status, 405, "reading can't stop a target");
  assert.deepEqual(await targetRows(user.id), before);
  const none = await newUser("stopnp", { withProfile: false });
  assert.equal((await none.c.post("/api/nutrition/targets/stop")).status, 409);
  const restricted = await restrictedUser("stopr");
  assert.equal((await restricted.c.post("/api/nutrition/targets/stop")).status, 403);
});

test("a legacy automatic row keeps its label and values through the new readers", async () => {
  const { c, user } = await newUser("legacyread");
  await prisma.nutritionTarget.create({ data: { userId: user.id, effectiveFrom: dbDate(addDays(today(), -2)), kcal: 1110, proteinG: 80, carbsG: 100, fatG: 20, source: "SUGGESTED" } });
  const g = (await c.get("/api/nutrition/targets")).body;
  assert.deepEqual([g.current.kcal, g.current.proteinG, g.current.carbsG, g.current.fatG, g.current.source], [1110, 80, 100, 20, "SUGGESTED"]);
  const d = (await c.get(`/api/nutrition/day?date=${today()}`)).body;
  assert.equal(d.macros.carbs.target, 100);
});
