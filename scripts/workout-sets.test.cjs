// Phase 4.0.6 on real rows: a set can't be logged twice, no set arrives after a workout is finished, and /previous answers
// as /history does. Run through scripts/run-guarded-suites.cjs. Users are removed by this run's own addresses.
//
// Orderings are forced, not hoped for. This file holds a row lock of its own, so a request has to wait at a known point, and
// reads pg_stat_activity to see that it's waiting before the next one is sent. Then it lets go, and the database decides the rest.
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
let holderPid = null;

/** Holds a row lock in a transaction of this file's own, until told to let go. `during` gets the transaction. */
function holding(lockSql, id) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let locked;
  const ready = new Promise((resolve) => { locked = resolve; });
  const done = prisma.$transaction(async (tx) => {
    holderPid = (await tx.$queryRawUnsafe("SELECT pg_backend_pid() AS pid"))[0].pid;
    await tx.$queryRawUnsafe(lockSql, id);
    locked();
    const during = await gate;
    if (during) await during(tx);
  }, { timeout: 60_000 });
  return { ready, done, letGo: (during) => { release(during); return done; } };
}
const holdWorkout = (u) => holding(`SELECT 1 FROM "WorkoutSession" WHERE id = $1 FOR UPDATE`, u.session.id);
// Inserting a set has to take a key-share lock on its exercise, for the foreign key. So this stops a request after it has
// got past everything before its insert, which is the gap this is all about.
const holdExercise = (u) => holding(`SELECT 1 FROM "SessionExercise" WHERE id = $1 FOR UPDATE`, u.session.exercises[0].id);

/** Requests of this kind now waiting behind this file's lock, directly or in a queue. Only this database's, and read-only. */
async function waiting(pattern) {
  const rows = await prisma.$queryRawUnsafe(`SELECT pid, pg_blocking_pids(pid) AS by, query FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`);
  const behind = new Set([holderPid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rows) if (!behind.has(r.pid) && r.by.some((p) => behind.has(p))) { behind.add(r.pid); grew = true; }
  }
  return rows.filter((r) => behind.has(r.pid) && pattern.test(r.query)).length;
}

/**
 * Waits for a request to be seen waiting on a lock, or to answer. Which one happened is the result, so a request that didn't
 * wait fails on an assertion. Neither within the time is a failure of a different kind, and never a pass.
 */
async function waitsOrAnswers(answer, pattern, count = 1) {
  let answered = null;
  answer.then((r) => { answered = r; }, () => { answered = { status: "request failed" }; });
  const deadline = Date.now() + 4_000;
  for (;;) {
    if (answered) return { waited: false, answered };
    if ((await waiting(pattern)) >= count) return { waited: true };
    if (Date.now() > deadline) throw new Error("INFRASTRUCTURE: no answer and no lock wait within 4 seconds, which proves nothing");
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}
const ON_WORKOUT = /"WorkoutSession"/;
const ON_INSERT = /INSERT INTO "public"."SetEntry"/;
const finish = (u) => call(u, "PATCH", `/api/sessions/${u.session.id}`, { finish: true });

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

test("a fractional weight and an effort survive the round trip, so an honest retry isn't a conflict", async () => {
  const u = await newUser("float");
  for (const body of [{ weightKg: 62.3456, reps: 8, isWarmup: false, rpe: 7.5 }, { weightKg: 45.3592, reps: 5 }, { weightKg: 0.1, reps: 5, rpe: null }, { weightKg: 28.1227, reps: 3, isWarmup: true }]) {
    const k = key();
    const first = await call(u, "POST", u.path, body, k);
    const second = await call(u, "POST", u.path, body, k);
    assert.deepEqual([first.status, second.status], [200, 200], JSON.stringify(body));
    assert.equal(second.body.set.id, first.body.set.id);
    assert.equal(first.body.set.weightKg, body.weightKg);
  }
  const k = key();
  await call(u, "POST", u.path, { weightKg: 20, reps: 1 }, k);
  assert.equal((await call(u, "POST", u.path, { weightKg: 20, reps: 1, rpe: null, isWarmup: false }, k)).status, 200, "absent and explicit defaults are the same set");
  assert.equal((await u.rows()).length, 5);
});

test("a finished workout takes no new set, and an honest retry still gets the one it saved", async () => {
  const u = await newUser("finished");
  const k = key();
  const saved = await call(u, "POST", u.path, SET, k);
  await prisma.workoutSession.update({ where: { id: u.session.id }, data: { status: "COMPLETED", endedAt: new Date() } });
  const retry = await call(u, "POST", u.path, SET, k);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.set.id, saved.body.set.id);
  assert.equal((await call(u, "POST", u.path, SET, key())).status, 409);
  assert.equal((await call(u, "POST", u.path, SET)).status, 409);
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
  assert.equal((await call(b, "POST", a.path, SET, "short")).status, 404, "ownership is checked before the key");
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

test("a set whose insert is under way holds the finish back, and is in the workout when it finishes", async () => {
  const u = await newUser("insertfirst");
  await call(u, "POST", u.path, SET, key());
  const lock = holdExercise(u);
  await lock.ready;
  const logging = call(u, "POST", u.path, { ...SET, reps: 5 }, key());
  assert.equal((await waitsOrAnswers(logging, ON_INSERT)).waited, true, "the set reached its insert, and is held there");
  const finishing = finish(u);
  const seen = await waitsOrAnswers(finishing, ON_WORKOUT);
  assert.equal(seen.waited, true, `the finish has to wait for the set, and it answered ${seen.answered?.status}`);
  await lock.letGo();
  const [set, done] = await Promise.all([logging, finishing]);
  assert.equal(set.status, 200);
  assert.equal(done.status, 200);
  assert.deepEqual((await u.rows()).map((r) => r.setNumber), [1, 2]);
  assert.equal((await call(u, "POST", u.path, SET, key())).status, 409, "and it's finished now");
});

test("a workout finished first refuses the set that was waiting on it, and saves nothing", async () => {
  const u = await newUser("finishfirst");
  await call(u, "POST", u.path, SET, key());
  const lock = holdWorkout(u);
  await lock.ready;
  const finishing = finish(u);
  assert.equal((await waitsOrAnswers(finishing, ON_WORKOUT)).waited, true);
  const logging = call(u, "POST", u.path, { ...SET, reps: 5 }, key());
  assert.equal((await waitsOrAnswers(logging, ON_WORKOUT, 2)).waited, true, "the set's status check has to wait too");
  await lock.letGo();
  const [done, set] = await Promise.all([finishing, logging]);
  assert.equal(done.status, 200);
  assert.equal(set.status, 409, "the workout was finished ahead of it");
  assert.deepEqual((await u.rows()).map((r) => r.reps), [8]);
});

test("a set that gets the workout first is saved, and the finish behind it counts it", async () => {
  const u = await newUser("setfirst");
  const lock = holdWorkout(u);
  await lock.ready;
  const logging = call(u, "POST", u.path, SET, key());
  assert.equal((await waitsOrAnswers(logging, ON_WORKOUT)).waited, true);
  const finishing = finish(u);
  assert.equal((await waitsOrAnswers(finishing, ON_WORKOUT, 2)).waited, true);
  await lock.letGo();
  const [set, done] = await Promise.all([logging, finishing]);
  assert.equal(set.status, 200);
  assert.equal(done.status, 200, "its only set was already saved, so this isn't an empty workout");
  assert.equal((await u.rows()).length, 1);
});

test("a commit that finishes the workout while a set is waiting is seen by that set", async () => {
  const u = await newUser("commit");
  await call(u, "POST", u.path, SET, key());
  const lock = holdWorkout(u);
  await lock.ready;
  const logging = call(u, "POST", u.path, { ...SET, reps: 5 }, key());
  assert.equal((await waitsOrAnswers(logging, ON_WORKOUT)).waited, true);
  await lock.letGo((tx) => tx.workoutSession.update({ where: { id: u.session.id }, data: { status: "COMPLETED", endedAt: new Date() } }));
  assert.equal((await logging).status, 409);
  assert.deepEqual((await u.rows()).map((r) => r.reps), [8]);
});

test("an honest retry waiting behind the finish still gets the set it saved before it", async () => {
  const u = await newUser("retry2");
  const k = key();
  const saved = await call(u, "POST", u.path, SET, k);
  const lock = holdWorkout(u);
  await lock.ready;
  const finishing = finish(u);
  assert.equal((await waitsOrAnswers(finishing, ON_WORKOUT)).waited, true);
  const retry = call(u, "POST", u.path, SET, k);
  assert.equal((await waitsOrAnswers(retry, ON_WORKOUT, 2)).waited, true);
  await lock.letGo();
  const [done, again] = await Promise.all([finishing, retry]);
  assert.equal(done.status, 200);
  assert.equal(again.status, 200);
  assert.equal(again.body.set.id, saved.body.set.id);
  assert.equal((await u.rows()).length, 1);
});

test("a retry of a set never saved, behind the finish, is refused, not added", async () => {
  const u = await newUser("retry3");
  await call(u, "POST", u.path, SET, key());
  const lock = holdWorkout(u);
  await lock.ready;
  const finishing = finish(u);
  assert.equal((await waitsOrAnswers(finishing, ON_WORKOUT)).waited, true);
  const late = call(u, "POST", u.path, { ...SET, reps: 5 }, key());
  assert.equal((await waitsOrAnswers(late, ON_WORKOUT, 2)).waited, true);
  await lock.letGo();
  assert.equal((await finishing).status, 200);
  assert.equal((await late).status, 409);
  assert.equal((await u.rows()).length, 1);
});

test("finishing twice at once finishes once, with one end time", async () => {
  const u = await newUser("twice");
  await call(u, "POST", u.path, SET, key());
  const lock = holdWorkout(u);
  await lock.ready;
  const first = finish(u);
  assert.equal((await waitsOrAnswers(first, ON_WORKOUT)).waited, true);
  const second = finish(u);
  assert.equal((await waitsOrAnswers(second, ON_WORKOUT, 2)).waited, true);
  await lock.letGo();
  const answers = await Promise.all([first, second]);
  assert.deepEqual(answers.map((a) => a.status).sort(), [200, 409]);
  const row = await prisma.workoutSession.findUnique({ where: { id: u.session.id } });
  assert.equal(row.endedAt.toISOString(), answers.find((a) => a.status === 200).body.session.endedAt);
});

test("an exercise whose first set is under way isn't dropped by the finish", async () => {
  const u = await newUser("first");
  const lock = holdExercise(u);
  await lock.ready;
  const logging = call(u, "POST", u.path, SET, key());
  assert.equal((await waitsOrAnswers(logging, ON_INSERT)).waited, true);
  const finishing = finish(u);
  const seen = await waitsOrAnswers(finishing, ON_WORKOUT);
  assert.equal(seen.waited, true, `the finish has to wait for the set, and it answered ${seen.answered?.status}`);
  await lock.letGo();
  const [set, done] = await Promise.all([logging, finishing]);
  assert.equal(set.status, 200);
  assert.equal(done.status, 200);
  assert.equal(await prisma.sessionExercise.count({ where: { sessionId: u.session.id } }), 1);
  assert.equal((await u.rows()).length, 1);
});

test("sets racing with different keys get different numbers", async () => {
  const u = await newUser("numbers");
  const all = await Promise.all(Array.from({ length: 8 }, () => call(u, "POST", u.path, SET, key())));
  assert.deepEqual(all.map((r) => r.status), Array(8).fill(200));
  assert.deepEqual((await u.rows()).map((r) => r.setNumber), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("a free-running race ends one of two ways, and never in a server error", async () => {
  const u = await newUser("free");
  await call(u, "POST", u.path, SET, key());
  for (let i = 0; i < 15; i++) {
    const session = await prisma.workoutSession.create({ data: { userId: u.user.id, name: "Race", exercises: { create: { exerciseId: u.exercise.id, position: 0 } } }, include: { exercises: true } });
    const path = `/api/sessions/${session.id}/exercises/${session.exercises[0].id}/sets`;
    await prisma.setEntry.create({ data: { sessionExerciseId: session.exercises[0].id, setNumber: 1, reps: 1, weightKg: 1 } });
    const [set, done] = await Promise.all([call(u, "POST", path, SET, key()), call(u, "PATCH", `/api/sessions/${session.id}`, { finish: true })]);
    assert.equal(done.status, 200);
    assert.ok([200, 409].includes(set.status), `a set answered ${set.status}`);
    const count = await prisma.setEntry.count({ where: { sessionExerciseId: session.exercises[0].id } });
    assert.equal(count, set.status === 200 ? 2 : 1, "what the set was told is what happened");
  }
});

test("someone else's workout is refused before its row is held", async () => {
  const a = await newUser("holder"), b = await newUser("other");
  const lock = holdWorkout(a);
  await lock.ready;
  try {
    assert.equal((await call(b, "POST", a.path, SET, key())).status, 404, "answered at once, with the row held");
    assert.equal((await call(b, "PATCH", `/api/sessions/${a.session.id}`, { finish: true })).status, 404);
  } finally { await lock.letGo(); }
  assert.equal((await a.rows()).length, 0);
});

test("a workout removed while a set waits on it answers not found, and saves nothing", async () => {
  const u = await newUser("removed");
  const lock = holdWorkout(u);
  await lock.ready;
  const logging = call(u, "POST", u.path, SET, key());
  assert.equal((await waitsOrAnswers(logging, ON_WORKOUT)).waited, true);
  await lock.letGo((tx) => tx.workoutSession.delete({ where: { id: u.session.id } }));
  assert.equal((await logging).status, 404);
  assert.equal(await prisma.setEntry.count({ where: { sessionExerciseId: u.session.exercises[0].id } }), 0);
});

test("a lock held past the limit fails the request with nothing saved, and a retry then works", async () => {
  const u = await newUser("stuck");
  const k = key();
  const lock = holdWorkout(u);
  await lock.ready;
  const started = Date.now();
  const stuck = await call(u, "POST", u.path, SET, k);
  const took = Date.now() - started;
  assert.equal(stuck.status, 503, "it says to try again");
  assert.match(stuck.body.error, /nothing was changed/);
  assert.ok(took >= 3_500 && took < 12_000, `it gave up after the lock limit, and took ${took} ms`);
  await lock.letGo();
  assert.equal((await u.rows()).length, 0, "nothing was saved");
  const retry = await call(u, "POST", u.path, SET, k);
  assert.equal(retry.status, 200);
  assert.equal((await u.rows()).length, 1);
});

test("an exercise row held past the limit stops the insert with the same answer, and a retry works", async () => {
  const u = await newUser("stuckrow");
  const k = key();
  const lock = holdExercise(u);
  await lock.ready;
  const stuck = await call(u, "POST", u.path, SET, k);
  await lock.letGo();
  assert.equal(stuck.status, 503, "not a bare server error");
  assert.equal((await u.rows()).length, 0);
  assert.equal((await call(u, "POST", u.path, SET, k)).status, 200);
  assert.equal((await u.rows()).length, 1);
});

test("a finish stopped by a held row says to try again, and doesn't finish anything", async () => {
  const u = await newUser("stuckfinish");
  await call(u, "POST", u.path, SET, key());
  const empty = await prisma.sessionExercise.create({ data: { sessionId: u.session.id, exerciseId: u.exercise.id, position: 1 } });
  const lock = holding(`SELECT 1 FROM "SessionExercise" WHERE id = $1 FOR UPDATE`, empty.id);
  await lock.ready;
  const stuck = await finish(u);
  await lock.letGo();
  assert.equal(stuck.status, 503, "not a bare server error");
  const row = await prisma.workoutSession.findUnique({ where: { id: u.session.id } });
  assert.equal(row.status, "IN_PROGRESS");
  assert.equal(row.endedAt, null);
  assert.equal((await finish(u)).status, 200, "and it can be finished after");
});

test("one person can only have so many waiting, and the rest are told to try again, with nothing saved", async () => {
  const u = await newUser("queue");
  const lock = holdWorkout(u);
  await lock.ready;
  const queued = Array.from({ length: 8 }, () => call(u, "POST", u.path, SET, key()));
  const seen = await waitsOrAnswers(Promise.race(queued), ON_WORKOUT, 8);
  assert.equal(seen.waited, true, "all eight are waiting");
  const refused = await call(u, "POST", u.path, SET, key());
  assert.equal(refused.status, 503);
  assert.match(refused.body.error, /wasn't saved/);
  const other = await newUser("queueother");
  assert.equal((await call(other, "POST", other.path, SET, key())).status, 200, "someone else isn't affected");
  await lock.letGo();
  assert.deepEqual((await Promise.all(queued)).map((r) => r.status), Array(8).fill(200));
  assert.equal((await u.rows()).length, 8);
  assert.equal((await call(u, "POST", u.path, SET, key())).status, 200, "and the count comes back down");
  assert.equal((await u.rows()).length, 9);
});
