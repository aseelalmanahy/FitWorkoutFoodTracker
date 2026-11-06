// Phase 4.0.6 on real rows: a set can't be logged twice, and /previous answers as /history does.
// Run through scripts/run-guarded-suites.cjs. Users are removed by this run's own addresses.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const ORIGIN = new URL(BASE).origin;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
const SUFFIX = `x${run}@test.dev`;
let counter = 0;
const SET = { weightKg: 60, reps: 8, isWarmup: false };

async function call(u, method, path, body, key) {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: u.cookie, ...(key ? { "Idempotency-Key": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json };
}
async function newUser(label) {
  const { user, token } = await createSignedInUser(prisma, `sets${label}${++counter}${SUFFIX}`);
  await prisma.profile.create({ data: { userId: user.id, name: "Sets", birthDate: new Date("1990-01-01T00:00:00Z"), unitSystem: "METRIC", timezone: "UTC" } });
  const u = { user, cookie: `fit_session=${token}` };
  u.exercise = await prisma.exercise.create({ data: { userId: user.id, name: `Row ${user.id}`, primaryMuscle: "BACK", equipment: "CABLE" } });
  u.session = await prisma.workoutSession.create({ data: { userId: user.id, name: "Session", exercises: { create: { exerciseId: u.exercise.id, position: 0 } } }, include: { exercises: true } });
  u.path = `/api/sessions/${u.session.id}/exercises/${u.session.exercises[0].id}/sets`;
  u.rows = () => prisma.setEntry.findMany({ where: { sessionExerciseId: u.session.exercises[0].id }, orderBy: { setNumber: "asc" } });
  return u;
}
const key = () => `k${run}${++counter}aaaaaaaaaaaa`;

before(() => target.verifyServer());
after(async () => {
  const ids = (await prisma.user.findMany({ where: { email: { endsWith: SUFFIX } }, select: { id: true } })).map((u) => u.id);
  await prisma.workoutSession.deleteMany({ where: { userId: { in: ids } } });
  await prisma.exercise.deleteMany({ where: { userId: { in: ids } } });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.profile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("a retry with the same key returns the saved set, with one row", async () => {
  const u = await newUser("retry");
  const k = key();
  const first = await call(u, "POST", u.path, SET, k);
  const second = await call(u, "POST", u.path, SET, k);
  assert.deepEqual([first.status, second.status], [200, 200]);
  assert.equal(second.body.set.id, first.body.set.id);
  assert.equal((await u.rows()).length, 1);
});

test("attempts racing with one key leave one row, and each gets it", async () => {
  const u = await newUser("race");
  const k = key();
  const all = await Promise.all(Array.from({ length: 6 }, () => call(u, "POST", u.path, SET, k)));
  assert.deepEqual(all.map((r) => r.status), [200, 200, 200, 200, 200, 200]);
  assert.equal(new Set(all.map((r) => r.body.set.id)).size, 1);
  assert.equal((await u.rows()).length, 1);
});

test("the same key with different values is refused, and changes nothing", async () => {
  const u = await newUser("conflict");
  const k = key();
  await call(u, "POST", u.path, SET, k);
  const res = await call(u, "POST", u.path, { ...SET, reps: 9 }, k);
  assert.equal(res.status, 409);
  assert.equal(res.body.details.reason, "idempotency_conflict");
  assert.deepEqual((await u.rows()).map((r) => r.reps), [8]);
});

test("different keys and no key each log a set", async () => {
  const u = await newUser("many");
  await call(u, "POST", u.path, SET, key());
  await call(u, "POST", u.path, SET, key());
  await call(u, "POST", u.path, SET);
  assert.deepEqual((await u.rows()).map((r) => r.setNumber), [1, 2, 3]);
});

test("one person's key is separate from another's, and their session can't be reached", async () => {
  const a = await newUser("a"), b = await newUser("b");
  const k = key();
  const mine = await call(a, "POST", a.path, SET, k);
  const theirs = await call(b, "POST", b.path, SET, k);
  assert.deepEqual([mine.status, theirs.status], [200, 200]);
  assert.notEqual(mine.body.set.id, theirs.body.set.id);
  assert.equal((await call(b, "POST", a.path, SET, k)).status, 404);
  assert.equal((await a.rows()).length, 1);
});

test("a malformed key is refused, and stores nothing", async () => {
  const u = await newUser("badkey");
  assert.equal((await call(u, "POST", u.path, SET, "short")).status, 400);
  assert.equal((await u.rows()).length, 0);
});

test("/previous answers as /history does for an exercise someone can't see", async () => {
  const a = await newUser("seen"), b = await newUser("unseen");
  for (const path of ["previous", "history"]) {
    assert.equal((await call(a, "GET", `/api/exercises/${a.exercise.id}/${path}`)).status, 200, `own: ${path}`);
    assert.equal((await call(b, "GET", `/api/exercises/${a.exercise.id}/${path}`)).status, 404, `someone else's: ${path}`);
    assert.equal((await call(a, "GET", `/api/exercises/no-such-exercise/${path}`)).status, 404, `none: ${path}`);
  }
  assert.equal((await call(a, "GET", `/api/exercises/${a.exercise.id}/previous`)).body.previous, null, "not done yet is still null");
});
