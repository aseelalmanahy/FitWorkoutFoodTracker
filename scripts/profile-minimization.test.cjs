// Phase 4.0.1c: what's refused, which holds with or without the Profile migration, as no test here gets as
// far as a write. scripts/profile-nulls.test.cjs covers what's saved, which needs the migration: Prisma's
// upsert is one INSERT ... ON CONFLICT, so even a body that omits a field for an existing row is refused
// by NOT NULL until then.
//   BASE_URL=http://localhost:3000 DATABASE_URL=<local test database> node --test scripts/profile-minimization.test.cjs
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const ORIGIN = new URL(BASE).origin;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
let counter = 0;

const dbDate = (iso) => new Date(`${iso}T00:00:00Z`);
const yearsAgo = (n) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - n); return d.toISOString().slice(0, 10); };
const required = (over = {}) => ({ name: "Sam", birthDate: "1990-01-01", unitSystem: "METRIC", timezone: "UTC", ...over });
const LEGACY = { name: "Sam", birthDate: dbDate("1990-01-01"), sex: "FEMALE", heightCm: 170.33, currentWeightKg: 60.125, goalWeightKg: 55.5, goal: "MAINTENANCE", activityLevel: "LIGHT", experience: "BEGINNER", workoutDaysPerWeek: 0, unitSystem: "METRIC", timezone: "UTC", calorieTargetOverride: 800 };

function client(token) {
  const cookie = token ? `fit_session=${token}` : "";
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(BASE + path, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, body: json };
  };
  return { call, get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), put: (p, b) => call("PUT", p, b) };
}
async function newUser(label, row) {
  const { user, token } = await createSignedInUser(prisma, `pm${label}${++counter}x${run}@test.dev`);
  if (row) await prisma.profile.create({ data: { userId: user.id, ...row } });
  return { c: client(token), user };
}
const rowOf = (userId) => prisma.profile.findUnique({ where: { userId } });
const withoutTime = ({ updatedAt, ...rest }) => rest;
async function assertUnchanged(user, before, message) {
  assert.deepEqual(withoutTime(await rowOf(user.id)), withoutTime(before), message);
}

before(() => target.verifyServer());
after(() => prisma.$disconnect());

test("what's used stays required: omitted or null is 400, and nothing is written", async () => {
  const { c, user } = await newUser("required", LEGACY);
  const stored = await rowOf(user.id);
  for (const field of ["name", "birthDate", "unitSystem", "timezone"]) {
    const { [field]: _dropped, ...omitted } = required();
    const missing = await c.put("/api/profile", omitted);
    assert.equal(missing.status, 400, `${field} omitted`);
    assert.ok(missing.body.details.fieldErrors[field], `${field} named`);
    assert.equal((await c.put("/api/profile", required({ [field]: null }))).status, 400, `${field} null`);
  }
  await assertUnchanged(user, stored, "row unchanged");
});

test("a new account can't be created without a date of birth", async () => {
  const { c, user } = await newUser("nodob");
  const { birthDate: _d, ...noDate } = required();
  assert.equal((await c.put("/api/profile", noDate)).status, 400);
  assert.equal(await rowOf(user.id), null, "no row");
  assert.equal((await c.get("/api/sessions")).status, 409, "still no way in");
});

test("invalid optional values are refused, and a blank isn't a clear", async () => {
  const { c, user } = await newUser("invalid", LEGACY);
  const stored = await rowOf(user.id);
  const invalid = { sex: "", heightCm: 99, currentWeightKg: 301, goalWeightKg: 29, goal: "", activityLevel: "NONE", experience: 0, workoutDaysPerWeek: 8 };
  for (const [field, value] of Object.entries(invalid)) {
    const r = await c.put("/api/profile", required({ [field]: value }));
    assert.equal(r.status, 400, `${field} = ${JSON.stringify(value)}`);
    assert.ok(r.body.details.fieldErrors[field], `${field} named`);
  }
  assert.equal((await c.put("/api/profile", required({ workoutDaysPerWeek: 2.5 }))).status, 400);
  assert.equal((await c.put("/api/profile", required({ heightCm: "180" }))).status, 400, "a string isn't a number");
  await assertUnchanged(user, stored, "row unchanged");
});

test("invalid and under-minimum dates are refused with only the required fields, and nothing is stored", async () => {
  const { c, user } = await newUser("dates");
  for (const date of ["2000-02-30", "not-a-date", yearsAgo(-1), yearsAgo(111)]) assert.equal((await c.put("/api/profile", required({ birthDate: date }))).status, 400, date);
  const refused = await c.put("/api/profile", required({ birthDate: yearsAgo(17) }));
  assert.equal(refused.status, 422);
  assert.equal(refused.body.details.reason, "age_ineligible");
  assert.equal(await rowOf(user.id), null, "no row");
  assert.equal((await c.get("/api/sessions")).status, 409, "still no way in");
});

test("a legacy adult can't move to an under-minimum date", async () => {
  const { c, user } = await newUser("adult", LEGACY);
  const stored = await rowOf(user.id);
  assert.equal((await c.put("/api/profile", required({ birthDate: yearsAgo(17) }))).status, 422);
  await assertUnchanged(user, stored, "row unchanged");
  assert.equal((await c.get("/api/sessions")).status, 200, "access unchanged");
});

test("anonymous and cross-origin requests are refused", async () => {
  const anon = client(null);
  assert.equal((await anon.get("/api/profile")).status, 401);
  assert.equal((await anon.put("/api/profile", required())).status, 401);
  const { c, user } = await newUser("origin", LEGACY);
  const stored = await rowOf(user.id);
  assert.equal((await c.call("PUT", "/api/profile", required({ name: "Evil" }), { Origin: "https://evil.example" })).status, 403);
  await assertUnchanged(user, stored, "row unchanged");
});

test("a restricted account stays restricted while the date it sends is under the minimum", async () => {
  const { c, user } = await newUser("restricted", { ...LEGACY, birthDate: dbDate(yearsAgo(17)) });
  const stored = await rowOf(user.id);
  assert.equal((await c.get("/api/sessions")).status, 403);
  assert.equal((await c.get("/api/profile")).status, 200, "it can still read its profile");
  assert.equal((await c.put("/api/profile", required({ birthDate: yearsAgo(16) }))).status, 422, "the same rule applies");
  await assertUnchanged(user, stored, "a refused correction changes nothing");
  assert.equal((await c.get("/api/sessions")).status, 403, "still restricted");
});
