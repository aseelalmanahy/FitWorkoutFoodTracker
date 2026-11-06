// Integration tests for provider protection (rate limits + backoff), against a
// running server with DEFAULT budgets (do not set FOOD_RATE_LIMIT_MULTIPLIER) and
// FDC_BASE_URL/OFF_BASE_URL pointing at scripts/stub-food-apis.cjs started with
// STUB_LOG_FILE so provider hits can be counted. Run against a freshly started
// server: budgets are per process.
//   STUB_LOG_FILE=/tmp/stub.log BASE_URL=http://localhost:3000 DATABASE_URL=<local test database> node --test scripts/provider-protection.test.cjs
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const target = require("./lib/test-target-guard.cjs").requireSafeTarget();
const { signUpWithApi } = require("./lib/signup.cjs");
const BASE = target.baseUrl;
const ORIGIN = new URL(BASE).origin;
const LOG = process.env.STUB_LOG_FILE;
const run = Date.now();
const hits = (re) => (LOG && fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").split("\n").filter((l) => re.test(l)).length : NaN);

function client() {
  let cookie = "";
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set && set.startsWith("fit_session=")) cookie = set.split(";")[0];
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, body: json, headers: res.headers };
  };
  return { signUp: async (email, password = "long password 123") => { cookie = (await signUpWithApi(BASE, email, password)).cookie; }, get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), put: (p, b) => call("PUT", p, b) };
}
const profile = { name: "P", birthDate: "1990-01-01", sex: "MALE", heightCm: 180, currentWeightKg: 80, goalWeightKg: null, goal: "MAINTENANCE",
  activityLevel: "MODERATE", experience: "BEGINNER", workoutDaysPerWeek: 3, unitSystem: "METRIC", timezone: "UTC", calorieTargetOverride: null };
const users = {};
async function user(name) {
  const c = client();
  await c.signUp(`${name}${run}@test.dev`);
  await c.put("/api/profile", profile);
  return (users[name] = c);
}
const offSearch = (c, q) => c.get(`/api/foods/search?q=${encodeURIComponent(q)}&sources=OPEN_FOOD_FACTS`);
const offErr = (r) => r.body.errors.find((e) => e.source === "OPEN_FOOD_FACTS");

before(async () => {
  await target.verifyServer(); // first: hooks don't wait for each other
  assert.ok(LOG, "STUB_LOG_FILE must be set (same path as the stub)");
  for (const n of ["p1", "p2", "p3", "p4", "p5", "p6"]) await user(n);
});

test("per-user limit: 4 Open Food Facts searches per minute, then user_rate_limited (not sent to provider)", async () => {
  const before = hits(/\/off\/search\?/);
  for (let i = 0; i < 4; i++) {
    const r = await offSearch(users.p1, `p1query${i}${run}`);
    assert.equal(r.status, 200);
    assert.equal(offErr(r), undefined, `search ${i + 1} allowed`);
  }
  const r = await offSearch(users.p1, `p1query-over${run}`);
  assert.equal(r.status, 200, "search still answers (other sources unaffected)");
  assert.equal(offErr(r).kind, "user_rate_limited");
  assert.ok(offErr(r).retryAfterSec > 0 && offErr(r).retryAfterSec <= 60);
  assert.equal(hits(/\/off\/search\?/) - before, 4, "5th search never reached the provider");
});

test("a limited user's cached queries and other providers still work", async () => {
  const cached = await offSearch(users.p1, `p1query0${run}`);
  assert.equal(offErr(cached), undefined, "cached result served without budget");
  const usda = await users.p1.get("/api/foods/search?q=banana&sources=USDA");
  assert.equal(usda.body.errors.length, 0);
  assert.equal(usda.body.results.USDA[0].name, "Bananas, raw");
});

test("one user's excess doesn't block other users", async () => {
  const r = await offSearch(users.p2, `p2query${run}`);
  assert.equal(offErr(r), undefined);
});

test("global budget: OFF search capped at 10/min for the whole app, reported as unavailable", async () => {
  // used so far: p1=4, p2=1 → 5. p2 takes 3 more (8), p3 takes 2 (10).
  for (let i = 1; i < 4; i++) assert.equal(offErr(await offSearch(users.p2, `p2query${i}${run}`)), undefined);
  for (let i = 0; i < 2; i++) assert.equal(offErr(await offSearch(users.p3, `p3query${i}${run}`)), undefined);
  const r = await offSearch(users.p4, `p4query${run}`);
  assert.equal(offErr(r).kind, "unavailable");
  assert.ok(offErr(r).retryAfterSec > 0);
  assert.equal(hits(/\/off\/search\?/) >= 10, true);
});

test("per-user limit on barcode/resolve: 6 product lookups per minute → 429 with Retry-After", async () => {
  const before = hits(/api\/v2\/product/);
  for (let i = 0; i < 6; i++) {
    const r = await users.p5.get(`/api/foods/barcode/${String(900000000000 + i)}`); // unknown → provider 404
    assert.equal(r.status, 404, `lookup ${i + 1}`);
  }
  const over = await users.p5.get("/api/foods/barcode/900000000099");
  assert.equal(over.status, 429);
  assert.equal(over.body.details.kind, "user_rate_limited");
  assert.ok(Number(over.headers.get("retry-after")) > 0, "Retry-After header set");
  const resolve = await users.p5.post("/api/foods/resolve", { source: "OPEN_FOOD_FACTS", sourceId: "900000000098" });
  assert.equal(resolve.status, 429, "resolve shares the same product budget");
  assert.equal(hits(/api\/v2\/product/) - before, 6);
  // Another user is unaffected.
  assert.equal((await users.p6.get("/api/foods/barcode/3017624010966")).status, 200);
});

test("backoff: a provider 429 with Retry-After stops calls for everyone until it expires", async () => {
  const before = hits(/fdc\/v1/);
  const r = await users.p6.get("/api/foods/search?q=ratelimit&sources=USDA");
  const e = r.body.errors.find((x) => x.source === "USDA");
  assert.equal(e.kind, "unavailable", "provider 429 is reported generically");
  assert.equal(e.retryAfterSec, 30);
  const next = await users.p1.get(`/api/foods/search?q=apple${run}&sources=USDA`);
  assert.equal(next.body.errors.find((x) => x.source === "USDA").kind, "unavailable");
  // An uncached id (cached foods are served without contacting the provider, by design).
  const res = await users.p1.post("/api/foods/resolve", { source: "USDA", sourceId: String(7000000 + (run % 1000000)) });
  assert.equal(res.status, 503);
  assert.ok(Number(res.headers.get("retry-after")) > 0 && Number(res.headers.get("retry-after")) <= 30);
  assert.equal(hits(/fdc\/v1/) - before, 1, "only the first request reached USDA");
});

test("backoff: 3 consecutive provider failures open the circuit", async () => {
  // p6 has product budget left; barcode 0000000000500 → provider 500.
  const before = hits(/product\/0000000000500/);
  for (let i = 0; i < 3; i++) assert.equal((await users.p6.get("/api/foods/barcode/0000000000500")).status, 502);
  const r = await users.p6.get("/api/foods/barcode/0000000000500");
  assert.equal(r.status, 503);
  assert.equal(r.body.details.kind, "unavailable");
  assert.equal(hits(/product\/0000000000500/) - before, 3, "4th lookup not sent to the provider");
});
