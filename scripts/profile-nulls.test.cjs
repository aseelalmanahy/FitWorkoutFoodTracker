// Phase 4.0.1c, T45, against nullable columns. Refuses to run until the Profile migration is applied to the
// designated test database, which needs the owner's approval, so an unapplied migration is reported as
// BLOCKED and never counted as a pass.
//   BASE_URL=http://localhost:3000 DATABASE_URL=<local test database> node --test scripts/profile-nulls.test.cjs
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser, profileMigrationApplied, targetMigrationApplied, PROFILE_NULLABLE_COLUMNS } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const ORIGIN = new URL(BASE).origin;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
let counter = 0;

const FIELDS = [...PROFILE_NULLABLE_COLUMNS, "goalWeightKg"];
const dbDate = (iso) => new Date(`${iso}T00:00:00Z`);
const yearsAgo = (n) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - n); return d.toISOString().slice(0, 10); };
const required = (over = {}) => ({ name: "Sam", birthDate: "1990-01-01", unitSystem: "METRIC", timezone: "UTC", ...over });
const LEGACY = { name: "Sam", birthDate: dbDate("1990-01-01"), sex: "FEMALE", heightCm: 170.33, currentWeightKg: 60.125, goalWeightKg: 55.5, goal: "MAINTENANCE", activityLevel: "LIGHT", experience: "BEGINNER", workoutDaysPerWeek: 0, unitSystem: "METRIC", timezone: "UTC", calorieTargetOverride: 800 };

function client(token) {
  const cookie = `fit_session=${token}`;
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Origin: ORIGIN, Cookie: cookie }, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, body: json };
  };
  return { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), put: (p, b) => call("PUT", p, b), page: (p) => fetch(BASE + p, { headers: { Cookie: cookie }, redirect: "manual" }) };
}
async function newUser(label, row) {
  const { user, token } = await createSignedInUser(prisma, `pn${label}${++counter}x${run}@test.dev`);
  if (row) await prisma.profile.create({ data: { userId: user.id, ...row } });
  return { c: client(token), user };
}
const rowOf = (userId) => prisma.profile.findUnique({ where: { userId } });
const withoutTime = ({ updatedAt, ...rest }) => rest;
async function assertUnchanged(user, before, message) {
  assert.deepEqual(withoutTime(await rowOf(user.id)), withoutTime(before), message);
}
const assertAllNull = (row, message) => { for (const f of FIELDS) assert.equal(row[f], null, `${f}: ${message}`); };

before(async () => {
  await target.verifyServer(); // first: hooks don't wait for each other
  if (!(await profileMigrationApplied(prisma))) throw new Error("BLOCKED: the Profile migration isn't applied to this test database. Applying it needs the owner's approval.");
  if (!(await targetMigrationApplied(prisma))) throw new Error("BLOCKED: this database lacks the NutritionTarget migration.");
});
after(() => prisma.$disconnect());

// ─── Omitted fields, on rows that have values ────────────────────────────────

test("an omitted field leaves a legacy value exactly as stored", async () => {
  const { c, user } = await newUser("omit", LEGACY);
  const stored = await rowOf(user.id);
  const r = await c.put("/api/profile", required({ name: "Sam" }));
  assert.equal(r.status, 200);
  await assertUnchanged(user, stored, "every legacy value, unrounded, including a zero and the override");
  const renamed = await c.put("/api/profile", required({ name: "Renamed" }));
  assert.equal(renamed.status, 200);
  await assertUnchanged(user, { ...stored, name: "Renamed" }, "only the name changed");
});

test("a value changes only its own field", async () => {
  const { c, user } = await newUser("value", LEGACY);
  const stored = await rowOf(user.id);
  const changes = { sex: "MALE", heightCm: 180, currentWeightKg: 80, goalWeightKg: 75, goal: "STRENGTH", activityLevel: "ACTIVE", experience: "ADVANCED", workoutDaysPerWeek: 5 };
  let expected = stored;
  for (const [field, value] of Object.entries(changes)) {
    assert.equal((await c.put("/api/profile", required({ [field]: value }))).status, 200, field);
    expected = { ...expected, [field]: value };
    await assertUnchanged(user, expected, field);
  }
});

test("a restricted account corrects its date with the required fields only, and keeps its details", async () => {
  const row = { ...LEGACY, birthDate: dbDate(yearsAgo(17)) };
  const { c, user } = await newUser("restricted", row);
  const stored = await rowOf(user.id);
  assert.equal((await c.get("/api/sessions")).status, 403);
  assert.equal((await c.put("/api/profile", required({ birthDate: yearsAgo(16) }))).status, 422, "the same rule applies");
  await assertUnchanged(user, stored, "a refused correction changes nothing");
  assert.equal((await c.get("/api/sessions")).status, 403, "still restricted");
  assert.equal((await c.put("/api/profile", required({ birthDate: "1990-01-01" }))).status, 200);
  await assertUnchanged(user, { ...stored, birthDate: dbDate("1990-01-01") }, "only the date changed");
  assert.equal((await c.get("/api/sessions")).status, 200, "access restored");
});

test("one person's save and read stay their own", async () => {
  const a = await newUser("a", LEGACY);
  const b = await newUser("b", { ...LEGACY, name: "Bea", sex: "MALE" });
  const storedB = await rowOf(b.user.id);
  assert.equal((await a.c.put("/api/profile", { ...required({ name: "Ann", sex: "FEMALE" }), userId: b.user.id })).status, 200);
  await assertUnchanged(b.user, storedB, "B unchanged, even when A's body names B");
  assert.equal((await rowOf(a.user.id)).name, "Ann", "A's own row changed");
  const read = await a.c.get("/api/profile");
  assert.equal(read.body.profile.userId, a.user.id);
});

test("the unused override can't be written, and GET returns stored values", async () => {
  const { c, user } = await newUser("override", { ...LEGACY, calorieTargetOverride: null });
  assert.equal((await c.put("/api/profile", required({ calorieTargetOverride: 800 }))).status, 200);
  assert.equal((await rowOf(user.id)).calorieTargetOverride, null);
  const { profile } = (await c.get("/api/profile")).body;
  assert.equal(profile.heightCm, 170.33);
  assert.equal(profile.workoutDaysPerWeek, 0, "a zero stays a zero");
});

test("saving a profile changes no target, workout or food row, including a stopped target", async () => {
  const { c, user } = await newUser("records", LEGACY);
  const base = { userId: user.id, proteinG: null, carbsG: null, fatG: null, source: "MANUAL" };
  await prisma.nutritionTarget.create({ data: { ...base, effectiveFrom: dbDate("2026-01-01"), kcal: 2000 } });
  await prisma.nutritionTarget.create({ data: { ...base, effectiveFrom: dbDate("2026-02-01"), kcal: null } }); // a stopped row, from 4.0.1b
  assert.equal((await c.post("/api/sessions", { name: "Legs" })).status < 300, true, "a workout exists");
  const snapshot = async () => JSON.stringify({
    targets: await prisma.nutritionTarget.findMany({ where: { userId: user.id }, orderBy: { effectiveFrom: "asc" } }),
    sessions: await prisma.workoutSession.findMany({ where: { userId: user.id } }),
    food: await prisma.foodEntry.findMany({ where: { userId: user.id } }),
  });
  const before = await snapshot();
  assert.equal((await c.put("/api/profile", required({ currentWeightKg: 95, goal: "FAT_LOSS", name: "Changed" }))).status, 200);
  assert.equal(await snapshot(), before);
});

// ─── Nulls ───────────────────────────────────────────────────────────────────

test("T45: a new profile needs only the required fields, stores nulls, and gets in", async () => {
  const { c, user } = await newUser("new");
  const r = await c.put("/api/profile", required());
  assert.equal(r.status, 200);
  assertAllNull(await rowOf(user.id), "nothing invented");
  for (const f of FIELDS) assert.equal(r.body.profile[f], null, `${f} is null in the response`);
  assert.equal((await c.get("/api/sessions")).status, 200, "the gate reads the date only");
});

test("T45: a null row re-saved stays null", async () => {
  const { c, user } = await newUser("resave");
  await c.put("/api/profile", required());
  assert.equal((await c.put("/api/profile", required({ name: "Again" }))).status, 200);
  const row = await rowOf(user.id);
  assert.equal(row.name, "Again");
  assertAllNull(row, "still null");
});

test("T45: explicit null clears only its own field, and the rest of the row stays", async () => {
  const { c, user } = await newUser("clear", LEGACY);
  let expected = await rowOf(user.id);
  for (const field of FIELDS) {
    assert.equal((await c.put("/api/profile", required({ [field]: null }))).status, 200, field);
    expected = { ...expected, [field]: null };
    const { updatedAt: _a, ...now } = await rowOf(user.id);
    const { updatedAt: _b, ...want } = expected;
    assert.deepEqual(now, want, field);
  }
  assertAllNull(await rowOf(user.id), "all cleared");
  assert.equal(await prisma.profile.count({ where: { userId: user.id } }), 1, "the profile itself stays");
  assert.equal((await rowOf(user.id)).birthDate.toISOString().slice(0, 10), "1990-01-01", "the date stays");
});

test("missing, null and a value are three different requests", async () => {
  const { c, user } = await newUser("three", LEGACY);
  await c.put("/api/profile", required());
  assert.equal((await rowOf(user.id)).sex, "FEMALE", "omitted: unchanged");
  await c.put("/api/profile", required({ sex: null }));
  assert.equal((await rowOf(user.id)).sex, null, "null: cleared");
  await c.put("/api/profile", required());
  assert.equal((await rowOf(user.id)).sex, null, "omitted again: stays cleared");
  await c.put("/api/profile", required({ sex: "MALE" }));
  assert.equal((await rowOf(user.id)).sex, "MALE", "a value: set");
});

test("clearing a zero is different from storing one", async () => {
  const { c, user } = await newUser("zero", LEGACY);
  assert.equal((await rowOf(user.id)).workoutDaysPerWeek, 0);
  await c.put("/api/profile", required({ workoutDaysPerWeek: null }));
  assert.equal((await rowOf(user.id)).workoutDaysPerWeek, null);
  await c.put("/api/profile", required({ workoutDaysPerWeek: 0 }));
  assert.equal((await rowOf(user.id)).workoutDaysPerWeek, 0);
});

test("one person's clear stays their own", async () => {
  const a = await newUser("a", LEGACY);
  const b = await newUser("b", LEGACY);
  assert.equal((await a.c.put("/api/profile", required({ sex: null, heightCm: null }))).status, 200);
  assert.equal((await rowOf(a.user.id)).sex, null, "A's own row cleared");
  const other = await rowOf(b.user.id);
  assert.equal(other.sex, "FEMALE");
  assert.equal(other.heightCm, 170.33);
});

test("every page loads with a null row, and shows no null or NaN", async () => {
  const { c, user } = await newUser("pages");
  assert.equal((await c.put("/api/profile", required())).status, 200);
  assertAllNull(await rowOf(user.id), "the row these pages read");
  for (const path of ["/dashboard", "/profile", "/workouts", "/workouts/history", "/progress", "/nutrition", "/nutrition/targets", "/nutrition/history", "/nutrition/add"]) {
    const res = await c.page(path);
    assert.equal(res.status, 200, path);
    const text = (await res.text()).replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ");
    assert.doesNotMatch(text, /\b(null|undefined|NaN)\b/, path);
  }
});

test("Phase 4.0.1a: a null row under the minimum is restricted, and correctable", async () => {
  const { c, user } = await newUser("restricted", { name: "Row", birthDate: dbDate(yearsAgo(17)), unitSystem: "METRIC", timezone: "UTC" });
  assert.equal((await c.get("/api/sessions")).status, 403);
  assert.equal((await c.put("/api/profile", required({ birthDate: yearsAgo(17) }))).status, 422);
  assert.equal((await c.put("/api/profile", required())).status, 200);
  assert.equal((await c.get("/api/sessions")).status, 200);
  assertAllNull(await rowOf(user.id), "the correction invents nothing");
});

test("Phase 4.0.1b: targets work with a null profile, and clearing leaves them alone", async () => {
  const { c, user } = await newUser("targets", LEGACY);
  assert.equal((await c.put("/api/nutrition/targets", { kcal: 2000, proteinG: null, fatG: null })).status, 200);
  const rows = () => prisma.nutritionTarget.findMany({ where: { userId: user.id }, orderBy: { effectiveFrom: "asc" } });
  const before = await rows();
  assert.equal((await c.put("/api/profile", required(Object.fromEntries(FIELDS.map((f) => [f, null]))))).status, 200);
  assertAllNull(await rowOf(user.id), "the profile is null");
  assert.deepEqual(await rows(), before, "clearing changes no target");
  assert.equal((await c.get("/api/nutrition/targets")).body.current.kcal, 2000);
  assert.equal((await c.post("/api/nutrition/targets/stop", {})).status, 200);
  assert.equal((await c.get("/api/nutrition/targets")).body.current, null);
});

test("T44: the database has no default for a cleared field, and still refuses a row with no date", async () => {
  const { user } = await createSignedInUser(prisma, `pndirect${++counter}x${run}@test.dev`);
  await assert.rejects(prisma.$executeRawUnsafe(`INSERT INTO "Profile" ("userId", "name", "updatedAt") VALUES ('${user.id}', 'No date', now())`), /birthDate|null/i);
  const row = await prisma.profile.create({ data: { userId: user.id, name: "Direct", birthDate: dbDate("1990-01-01") } });
  assertAllNull(row, "no default");
});
