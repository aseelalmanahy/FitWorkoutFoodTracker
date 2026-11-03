// Integration tests for the Phase 2 nutrition API against a running server and
// its PostgreSQL database. External food APIs must point at
// scripts/stub-food-apis.cjs (FDC_BASE_URL / OFF_BASE_URL / FDC_API_KEY=stub).
//   BASE_URL=http://localhost:3000 node --test scripts/nutrition-api.test.cjs
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ORIGIN = new URL(BASE).origin;
const prisma = new PrismaClient();
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
  return { call, get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), put: (p, b) => call("PUT", p, b), patch: (p, b) => call("PATCH", p, b), del: (p) => call("DELETE", p) };
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
  for (const [c, email] of [[A, `a${run}@test.dev`], [B, `b${run}@test.dev`]]) {
    assert.equal((await c.post("/api/auth/register", { email, password: "long password 123" })).status, 200);
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
    ["GET", "/api/nutrition/targets"], ["PUT", "/api/nutrition/targets"], ["POST", "/api/nutrition/targets/suggestion"],
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

test("targets: seeded suggestion, manual update with derived carbs, consistency check", async () => {
  const g = await A.get("/api/nutrition/targets");
  assert.equal(g.status, 200);
  assert.equal(g.body.current.source, "SUGGESTED");
  const { kcal, proteinG, carbsG, fatG } = g.body.current;
  const e = 4 * proteinG + 4 * carbsG + 9 * fatG;
  assert.ok(e <= kcal && kcal - e < 4, "suggested macros add up to kcal");
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

test("suggested targets follow profile changes; apply-suggestion works", async () => {
  const s = await B.get("/api/nutrition/targets");
  const before = s.body.current.kcal;
  await B.put("/api/profile", { ...profile(), currentWeightKg: 95 });
  const after = (await B.get("/api/nutrition/targets")).body.current;
  assert.equal(after.source, "SUGGESTED");
  assert.ok(after.kcal > before);
  const a = await A.post("/api/nutrition/targets/suggestion");
  assert.equal(a.body.target.source, "SUGGESTED");
  await A.put("/api/nutrition/targets", { kcal: 2300, proteinG: 160, fatG: 70 }); // restore for later tests
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
  assert.notEqual((await B.get("/api/nutrition/targets")).body.current.kcal, 800);
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
  await C.post("/api/auth/register", { email: `c${run}@test.dev`, password: "long password 123" });
  await C.put("/api/profile", profile());
  await C.post("/api/nutrition/entries", { date: today(), mealType: "SNACK", foodId: nutella.id, servingId: null, quantity: 10 });
  for (let i = 0; i < 20; i++) await C.post("/api/nutrition/entries", { date: today(), mealType: "SNACK", foodId: banana.id, servingId: null, quantity: 10 });
  const ids = (await C.get("/api/foods/recent")).body.foods.map((f) => f.id);
  assert.deepEqual(ids, [banana.id, nutella.id], "most recent first, no duplicates, older foods not dropped");
});

test("concurrent first requests seed exactly one target (no race errors)", async () => {
  const D = client();
  const email = `d${run}@test.dev`;
  await D.post("/api/auth/register", { email, password: "long password 123" });
  await D.put("/api/profile", profile());
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => D.get(i % 2 ? "/api/nutrition/targets" : `/api/nutrition/day?date=${today()}`)));
  assert.deepEqual(rs.map((r) => r.status), Array(8).fill(200));
  const u = await prisma.user.findUnique({ where: { email } });
  assert.equal(await prisma.nutritionTarget.count({ where: { userId: u.id } }), 1);
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
