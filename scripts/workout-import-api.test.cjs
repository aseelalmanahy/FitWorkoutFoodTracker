// Phase 3 against a real database: saving an imported program, and reading a plan's image as text.
//   BASE_URL=… DATABASE_URL=<designated test database> node --test scripts/workout-import-api.test.cjs
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser } = require("./lib/test-users.cjs");
const { screenshot, PLAN_LINES } = require("./lib/plan-fixtures.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const ORIGIN = new URL(BASE).origin;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
let counter = 0;

function client(token) {
  const call = async (method, path, body, headers = {}) => {
    const raw = body instanceof Buffer;
    const res = await fetch(BASE + path, { method, headers: { ...(body !== undefined && !raw ? { "Content-Type": "application/json" } : {}), Origin: ORIGIN, ...(token ? { Cookie: `fit_session=${token}` } : {}), ...headers }, body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, body: json, text };
  };
  return { call, post: (p, b, h) => call("POST", p, b, h) };
}
async function newUser(label) {
  const { user, token } = await createSignedInUser(prisma, `wimp${label}${++counter}x${run}@test.dev`);
  await prisma.profile.create({ data: { userId: user.id, name: "Importer", birthDate: new Date("1990-01-01T00:00:00Z"), timezone: "UTC", unitSystem: "METRIC" } });
  return { user, c: client(token) };
}
const ex = (exerciseId, over = {}) => ({ exerciseId, targetSets: 3, targetRepsMin: 8, targetRepsMax: 10, targetWeightKg: null, restSeconds: null, notes: null, ...over });
const counts = async (userId) => ({ templates: await prisma.workoutTemplate.count({ where: { userId } }), slots: await prisma.scheduleSlot.count({ where: { userId } }), exercises: await prisma.exercise.count({ where: { userId } }) });

let bench, squat;
before(async () => {
  await target.verifyServer();
  bench = await prisma.exercise.findFirst({ where: { userId: null, name: "Barbell Bench Press" } });
  squat = await prisma.exercise.findFirst({ where: { userId: null, name: { contains: "Squat" } } });
  assert.ok(bench && squat, "the built-in library is seeded");
});
after(() => prisma.$disconnect());

test("a confirmed program is saved as new plans, one per day, in order, with weekday slots only where stated", async () => {
  const { user, c } = await newUser("ok");
  const r = await c.post("/api/workouts/import", { programName: "Strength Block", days: [
    { name: "Monday - Upper", weekday: 0, notes: "Keep 2 in reserve", exercises: [ex(bench.id, { targetSets: 4, targetRepsMin: 6, targetRepsMax: 8, targetWeightKg: 80, restSeconds: 120, notes: "Superset A" }), ex(squat.id)] },
    { name: "Day 2", weekday: null, exercises: [ex(squat.id, { targetWeightKg: 102.06 })] },
  ] });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.templates.map((t) => t.name), ["Strength Block – Monday - Upper", "Strength Block – Day 2"]);
  const plans = await prisma.workoutTemplate.findMany({ where: { userId: user.id }, include: { exercises: { orderBy: { position: "asc" } }, slots: true }, orderBy: { name: "asc" } });
  const monday = plans.find((p) => p.name.endsWith("Upper"));
  assert.equal(monday.notes, "Keep 2 in reserve");
  assert.deepEqual(monday.exercises.map((e) => [e.position, e.exerciseId, e.targetSets, e.targetRepsMin, e.targetRepsMax, e.targetWeightKg, e.restSeconds, e.notes]), [[0, bench.id, 4, 6, 8, 80, 120, "Superset A"], [1, squat.id, 3, 8, 10, null, null, null]]);
  assert.deepEqual(monday.slots.map((s) => [s.weekday, s.position]), [[0, 0]]);
  assert.equal(plans.find((p) => p.name.endsWith("Day 2")).slots.length, 0, "a day with no weekday isn't scheduled");
});

test("nothing missing can be saved as if it were there, and nothing outside the bounds", async () => {
  const { user, c } = await newUser("bad");
  const day = (e) => ({ programName: "P", days: [{ name: "D", weekday: null, exercises: [e] }] });
  for (const [label, body] of [
    ["no sets", day({ ...ex(bench.id), targetSets: undefined })],
    ["no reps", day({ ...ex(bench.id), targetRepsMin: null })],
    ["max below min", day(ex(bench.id, { targetRepsMin: 10, targetRepsMax: 8 }))],
    ["no exercise", day({ ...ex(bench.id), exerciseId: undefined })],
    ["both an exercise and a new one", day(ex(bench.id, { newExercise: { name: "X", primaryMuscle: "CHEST", equipment: "BARBELL" } }))],
    ["a weight above 1000 kg", day(ex(bench.id, { targetWeightKg: 1200 }))],
    ["a weekday 7", { programName: "P", days: [{ name: "D", weekday: 7, exercises: [ex(bench.id)] }] }],
    ["an unknown field", { programName: "P", userId: "someone", days: [{ name: "D", weekday: null, exercises: [ex(bench.id)] }] }],
    ["no days", { programName: "P", days: [] }],
    ["15 days", { programName: "P", days: Array.from({ length: 15 }, () => ({ name: "D", weekday: null, exercises: [ex(bench.id)] })) }],
    ["31 exercises a day", { programName: "P", days: [{ name: "D", weekday: null, exercises: Array.from({ length: 31 }, () => ex(bench.id)) }] }],
  ]) assert.equal((await c.post("/api/workouts/import", body)).status, 400, label);
  assert.deepEqual(await counts(user.id), { templates: 0, slots: 0, exercises: 0 });
});

test("another person's exercise can't be used, and then nothing at all is saved", async () => {
  const { user, c } = await newUser("own");
  const other = await newUser("other");
  const theirs = await prisma.exercise.create({ data: { userId: other.user.id, name: `Secret move ${run}`, primaryMuscle: "BACK", equipment: "CABLE" } });
  const r = await c.post("/api/workouts/import", { programName: "P", days: [{ name: "A", weekday: 0, exercises: [ex(bench.id)] }, { name: "B", weekday: 1, exercises: [ex(theirs.id)] }] });
  assert.equal(r.status, 400);
  assert.deepEqual(await counts(user.id), { templates: 0, slots: 0, exercises: 0 }, "all or nothing");
});

test("new exercises are created once, and an existing one with the same name is reused, never duplicated", async () => {
  const { user, c } = await newUser("new");
  const mine = await prisma.exercise.create({ data: { userId: user.id, name: "Zercher Squat", primaryMuscle: "QUADS", equipment: "BARBELL" } });
  const r = await c.post("/api/workouts/import", { programName: "P", days: [{ name: "A", weekday: null, exercises: [
    { ...ex(undefined), exerciseId: undefined, newExercise: { name: "zercher squat", primaryMuscle: "QUADS", equipment: "BARBELL" } },
    { ...ex(undefined), exerciseId: undefined, newExercise: { name: "Landmine Press", primaryMuscle: "SHOULDERS", equipment: "BARBELL" } },
    { ...ex(undefined), exerciseId: undefined, newExercise: { name: "landmine press", primaryMuscle: "SHOULDERS", equipment: "BARBELL" } },
    { ...ex(undefined), exerciseId: undefined, newExercise: { name: "barbell bench press", primaryMuscle: "CHEST", equipment: "BARBELL" } },
  ] }] });
  assert.equal(r.status, 200, r.text);
  const own = await prisma.exercise.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } });
  assert.deepEqual(own.map((e) => e.name), ["Landmine Press", "Zercher Squat"], "one new exercise; the existing one and the built-in one reused");
  const used = (await prisma.templateExercise.findMany({ where: { template: { userId: user.id } }, orderBy: { position: "asc" } })).map((e) => e.exerciseId);
  assert.deepEqual(used, [mine.id, own[0].id, own[0].id, bench.id]);
});

test("the schedule only gains slots: a full weekday keeps its plans, and the import says it wasn't scheduled", async () => {
  const { user, c } = await newUser("sched");
  const existing = [];
  for (let i = 0; i < 3; i++) existing.push(await prisma.workoutTemplate.create({ data: { userId: user.id, name: `Mine ${i}` } }));
  for (const [i, t] of existing.entries()) await prisma.scheduleSlot.create({ data: { userId: user.id, weekday: 2, templateId: t.id, position: i } });
  const r = await c.post("/api/workouts/import", { programName: "P", days: [{ name: "Wed", weekday: 2, exercises: [ex(bench.id)] }, { name: "Thu", weekday: 3, exercises: [ex(bench.id)] }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.unscheduled, ["P – Wed"]);
  const slots = await prisma.scheduleSlot.findMany({ where: { userId: user.id }, orderBy: [{ weekday: "asc" }, { position: "asc" }] });
  assert.deepEqual(slots.map((s) => [s.weekday, s.templateId]), [[2, existing[0].id], [2, existing[1].id], [2, existing[2].id], [3, r.body.templates[1].id]]);
  // A plan with the same name as an existing one is a new plan, not a change to it.
  const again = await c.post("/api/workouts/import", { programName: "Mine", days: [{ name: "0", weekday: null, exercises: [ex(squat.id)] }] });
  assert.equal(again.status, 200);
  assert.equal((await prisma.workoutTemplate.findUnique({ where: { id: existing[0].id }, include: { exercises: true } })).exercises.length, 0, "the existing plan is untouched");
});

test("a retried save with the same key returns the first one's plans and makes nothing more", async () => {
  const { user, c } = await newUser("idem");
  const body = { programName: "P", days: [{ name: "A", weekday: 4, exercises: [ex(bench.id)] }, { name: "B", weekday: null, exercises: [ex(squat.id)] }] };
  const key = { "Idempotency-Key": `import-${run}-abcdefghijklmnop` };
  const first = await c.post("/api/workouts/import", body, key);
  const second = await c.post("/api/workouts/import", body, key);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.repeated, true);
  assert.deepEqual(second.body.templates.map((t) => t.id).sort(), first.body.templates.map((t) => t.id).sort());
  assert.deepEqual(await counts(user.id), { templates: 2, slots: 1, exercises: 0 });
});

test("a plan's screenshot is read as text on the server, with nothing stored; other uploads are refused", async () => {
  const { user, c } = await newUser("ocr");
  const png = await screenshot(PLAN_LINES);
  const before = await counts(user.id);
  const r = await c.post("/api/workouts/import/ocr", png, { "Content-Type": "image/png" });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.body), ["text"]);
  assert.match(r.body.text, /Bench Press/i);
  assert.match(r.body.text, /4\s*x\s*6/i);
  assert.deepEqual(await counts(user.id), before, "reading stores nothing");
  assert.equal((await c.post("/api/workouts/import/ocr", Buffer.from("%PDF-1.7 not an image"), { "Content-Type": "application/pdf" })).status, 415);
  assert.notEqual((await c.post("/api/workouts/import/ocr", Buffer.from("not really a png"), { "Content-Type": "image/png" })).status, 200);
  assert.equal((await client(null).post("/api/workouts/import/ocr", png, { "Content-Type": "image/png" })).status, 401);
});
