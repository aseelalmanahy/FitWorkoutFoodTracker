// Integration test (stub provider, NOT live) for "missing USDA nutrients stay null"
// (Phase 2.5 review, issue 2):
//   1. Through the app's API: nutrients absent from the provider response are null after
//      normalization (search and detail), and a reported 0 stays 0.
//   2. The live script's USDA-6 check, end to end, against an oracle server that mirrors the
//      stub's raw USDA responses: it must PASS on faithful data, FAIL when the raw data
//      contradicts the app, and report NOT RUN when the oracle is unavailable or disabled.
//      It also proves the oracle request uses USDA's public DEMO_KEY and never the app's key.
// Requires a production build and an already MARKED local test database (this test never
// marks or modifies markers):
//   SAFETY_DB_URL='postgresql://USER:PASSWORD@localhost:5432/fitdb_test' SAFETY_DB_CONFIRM='fitdb_test' \
//     node --test scripts/usda-missing-nutrients.test.cjs
"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { validateTargetUrl } = require("./lib/test-db-guard.cjs");
const { databaseUrlProblem, environmentProblems, verifyServerIdentity } = require("./lib/test-target-guard.cjs");
const { ROOT, startApp, startStub, runNode, killAll, killTree, freePort } = require("./lib/test-servers.cjs");

const DB = process.env.SAFETY_DB_URL;
const CONFIRM = process.env.SAFETY_DB_CONFIRM;
const SCRIPT = path.join(ROOT, "scripts", "live-provider-check.cjs");
const APP_KEY = "app-key-must-not-reach-the-oracle";
let stub, app, oracle, cookie = "";
const oracleLog = [];
let oracleMode = "mirror";

const appEnv = () => ({ DATABASE_URL: DB, FDC_BASE_URL: `${stub.url}/fdc/v1`, OFF_BASE_URL: `${stub.url}/off`, FDC_API_KEY: APP_KEY,
  EXPOSE_DB_IDENTITY: "1", FOOD_RATE_LIMIT_MULTIPLIER: "100" });
/** Each live-check run registers 3 users; the app allows 10 sign-ups per IP per 15 min (in memory), so
 *  tests that run the script repeatedly use a fresh app process. */
async function freshApp() { if (app) await killTree(app.child); app = await startApp(appEnv()); await verifyServerIdentity({ baseUrl: app.url, databaseUrl: DB }); }

before(async () => {
  const v = validateTargetUrl(DB, CONFIRM);
  if (!v.ok) throw new Error(`REFUSING: SAFETY_DB_URL/SAFETY_DB_CONFIRM must name a local, marked test database: ${v.errors.join("; ")}`);
  const unsafe = [databaseUrlProblem(DB), ...environmentProblems(process.env)].filter(Boolean);
  if (unsafe.length) throw new Error(`REFUSING: ${unsafe.map((p) => p.message).join(" ")}`);
  stub = await startStub();
  await freshApp(); // verified before any request below
  // Oracle: mirrors the stub's raw /food/{id} payloads (or tampers with / fails them).
  const port = await freePort();
  oracle = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    oracleLog.push({ path: u.pathname, apiKey: u.searchParams.get("api_key"), headerKey: req.headers["x-api-key"] || null });
    if (oracleMode === "error") { res.writeHead(500); return res.end("{}"); }
    const m = u.pathname.match(/^\/food\/(\d+)$/);
    if (!m) { res.writeHead(404); return res.end("{}"); }
    const r = await fetch(`${stub.url}/fdc/v1/food/${m[1]}`, { headers: { "x-api-key": "stub" } });
    const body = await r.json();
    if (oracleMode === "tamper" && m[1] === "999001") {
      body.foodNutrients = [...(body.foodNutrients || []), { nutrient: { id: 1008, unitName: "kcal" }, amount: 130 }];
    }
    res.writeHead(r.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => oracle.listen(port, "127.0.0.1", r));
  oracle.url = `http://127.0.0.1:${port}`;
  const reg = await fetch(`${app.url}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json", Origin: app.url },
    body: JSON.stringify({ email: `missing-nutrients-${Date.now()}@example.test`, password: "long password 123" }) });
  assert.equal(reg.status, 200);
  cookie = reg.headers.get("set-cookie").split(";")[0];
  const prof = await fetch(`${app.url}/api/profile`, { method: "PUT", headers: { "Content-Type": "application/json", Origin: app.url, Cookie: cookie },
    body: JSON.stringify({ name: "Missing nutrients", birthDate: "1990-01-01", sex: "FEMALE", heightCm: 165, currentWeightKg: 60, goalWeightKg: null,
      goal: "MAINTENANCE", activityLevel: "LIGHT", experience: "BEGINNER", workoutDaysPerWeek: 3, unitSystem: "METRIC", timezone: "UTC", calorieTargetOverride: null }) });
  assert.equal(prof.status, 200);
});
after(async () => {
  if (oracle) await new Promise((r) => oracle.close(r));
  // Remove the account this test created (cascade), through a guarded local test-DB connection.
  if (DB && validateTargetUrl(DB, CONFIRM).ok) {
    const { PrismaClient } = require("@prisma/client");
    const db = new PrismaClient({ datasources: { db: { url: DB } } });
    await db.user.deleteMany({ where: { email: { startsWith: "missing-nutrients-" } } }).catch(() => {});
    await db.$disconnect();
  }
  await killAll();
});

const api = async (method, p, body) => {
  const r = await fetch(`${app.url}${p}`, { method, headers: { Cookie: cookie, Origin: app.url, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

test("app API: absent USDA nutrients are null after normalization (search and detail); a reported 0 stays 0", { timeout: 60_000 }, async () => {
  // Stub fixture 999001 ("Rice ... no energy reported") reports ONLY protein.
  const s = await api("GET", "/api/foods/search?q=rice&sources=USDA");
  const rice = s.body.results.USDA.find((i) => i.sourceId === "999001");
  assert.deepEqual(rice.per100, { kcal: null, protein: 2.7, carbs: null, fat: null, fiber: null });
  assert.equal(rice.complete, false);
  const detail = await api("POST", "/api/foods/resolve", { source: "USDA", sourceId: "999001" });
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.food.per100, { kcal: null, protein: 2.7, carbs: null, fat: null, fiber: null });
  // Stub fixture 171477 (chicken) reports carbs = 0 and no fiber at all.
  const chicken = await api("POST", "/api/foods/resolve", { source: "USDA", sourceId: "171477" });
  assert.equal(chicken.body.food.per100.carbs, 0, "a reported zero stays zero");
  assert.equal(chicken.body.food.per100.fiber, null, "an absent nutrient is null, not zero");
  // Logging the incomplete food keeps the missing values missing in the entry and day totals.
  const e = await api("POST", "/api/nutrition/entries", { date: new Date().toISOString().slice(0, 10), mealType: "LUNCH", foodId: detail.body.food.id, servingId: null, quantity: 100 });
  assert.equal(e.status, 200);
  assert.deepEqual(e.body.entry.nutrients, { kcal: null, protein: 2.7, carbs: null, fat: null, fiber: null });
  const day = await api("GET", `/api/nutrition/day?date=${new Date().toISOString().slice(0, 10)}`);
  assert.ok(day.body.totals.incomplete.includes("kcal"));
  await api("DELETE", `/api/nutrition/entries/${e.body.entry.id}`);
});

async function runLiveCheck(env) {
  const report = path.join(os.tmpdir(), `lpc-usda6-${process.pid}-${Date.now()}.json`);
  try {
    const r = await runNode([SCRIPT], { BASE_URL: app.url, DATABASE_URL: DB, REPORT_FILE: report, FDC_API_KEY: "", ...env }, 240_000);
    const usda6 = (r.out.match(/^(PASS|FAIL|NOT RUN)\s+USDA-6 .*$/m) || [])[0] || "";
    return { ...r, usda6 };
  } finally { fs.rmSync(report, { force: true }); }
}

test("USDA-6 PASSES on faithful raw data and names the genuinely absent nutrients; oracle gets DEMO_KEY only", { timeout: 300_000 }, async () => {
  oracleMode = "mirror";
  oracleLog.length = 0;
  const r = await runLiveCheck({ LIVE_CHECK_USDA_ORACLE_URL: oracle.url });
  assert.match(r.usda6, /^PASS\s+USDA-6 .*fdcId 999001 .*absent in raw USDA response → null in app: kcal, carbs, fat, fiber/, r.out);
  assert.match(r.out, /LIVE VERIFICATION: NOT LIVE/, "stub data is still never reported as live");
  assert.ok(oracleLog.length >= 1, "oracle was consulted");
  for (const call of oracleLog) {
    assert.equal(call.apiKey, "DEMO_KEY");
    assert.equal(call.headerKey, null);
    assert.notEqual(call.apiKey, APP_KEY);
  }
});

test("USDA-6 FAILS when the raw USDA data contradicts the app (a 'missing' value is actually reported)", { timeout: 300_000 }, async () => {
  oracleMode = "tamper";
  const r = await runLiveCheck({ LIVE_CHECK_USDA_ORACLE_URL: oracle.url });
  assert.match(r.usda6, /^FAIL\s+USDA-6 .*fdcId 999001: kcal: USDA reports 130 but the app returned null/, r.out);
});

test("USDA-6 is NOT RUN (never PASS) when the oracle is unavailable or disabled", { timeout: 300_000 }, async () => {
  await freshApp();
  oracleMode = "error";
  const down = await runLiveCheck({ LIVE_CHECK_USDA_ORACLE_URL: oracle.url });
  assert.match(down.usda6, /^NOT RUN\s+USDA-6 .*oracle \(DEMO_KEY\) was unavailable/, down.out);
  const off = await runLiveCheck({ LIVE_CHECK_USDA_ORACLE: "off" });
  assert.match(off.usda6, /^NOT RUN\s+USDA-6 .*disabled/, off.out);
});
