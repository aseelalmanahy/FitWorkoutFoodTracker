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

test("UI-01: a confirmed import is one program, its days in order and named by day; the schedule is unchanged unless asked", async () => {
  const { user, c } = await newUser("ok");
  const days = [
    { name: "Monday - Upper", weekday: 0, notes: "Keep 2 in reserve", exercises: [ex(bench.id, { targetSets: 4, targetRepsMin: 6, targetRepsMax: 8, targetWeightKg: 80, restSeconds: 120, notes: "Superset A" }), ex(squat.id)] },
    { name: "Day 2", weekday: null, exercises: [ex(squat.id, { targetWeightKg: 102.06 })] },
  ];
  const r = await c.post("/api/workouts/import", { programName: "Strength Block", days });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.program.name, "Strength Block");
  assert.deepEqual(r.body.templates.map((t) => t.name), ["Monday - Upper", "Day 2"], "each day keeps its own short name");
  const program = await prisma.workoutProgram.findUnique({ where: { id: r.body.program.id }, include: { templates: { orderBy: { programPosition: "asc" }, include: { exercises: { orderBy: { position: "asc" } }, slots: true } } } });
  assert.equal(program.userId, user.id);
  assert.equal(program.origin, "import");
  assert.deepEqual(program.templates.map((t) => [t.programPosition, t.name]), [[0, "Monday - Upper"], [1, "Day 2"]]);
  const monday = program.templates[0];
  assert.equal(monday.notes, "Keep 2 in reserve");
  assert.deepEqual(monday.exercises.map((e) => [e.position, e.exerciseId, e.targetSets, e.targetRepsMin, e.targetRepsMax, e.targetWeightKg, e.restSeconds, e.notes]), [[0, bench.id, 4, 6, 8, 80, 120, "Superset A"], [1, squat.id, 3, 8, 10, null, null, null]]);
  assert.equal(await prisma.scheduleSlot.count({ where: { userId: user.id } }), 0, "importing alone doesn't change the schedule, even with a weekday stated");
  assert.deepEqual(r.body.scheduled, []);

  // Asked for: the stated weekdays are added, and only those.
  const s = await c.post("/api/workouts/import", { programName: "Strength Block 2", schedule: true, days });
  assert.equal(s.status, 200, s.text);
  assert.deepEqual(s.body.scheduled, [{ name: "Monday - Upper", weekday: 0 }]);
  const slots = await prisma.scheduleSlot.findMany({ where: { userId: user.id } });
  assert.deepEqual(slots.map((x) => [x.weekday, x.templateId]), [[0, s.body.templates[0].id]], "a day with no weekday isn't scheduled");
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
  const r = await c.post("/api/workouts/import", { programName: "P", schedule: true, days: [{ name: "Wed", weekday: 2, exercises: [ex(bench.id)] }, { name: "Thu", weekday: 3, exercises: [ex(bench.id)] }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.unscheduled, ["Wed"]);
  const slots = await prisma.scheduleSlot.findMany({ where: { userId: user.id }, orderBy: [{ weekday: "asc" }, { position: "asc" }] });
  assert.deepEqual(slots.map((s) => [s.weekday, s.templateId]), [[2, existing[0].id], [2, existing[1].id], [2, existing[2].id], [3, r.body.templates[1].id]]);
  // A plan with the same name as an existing one is a new plan, not a change to it.
  const again = await c.post("/api/workouts/import", { programName: "Mine", days: [{ name: "0", weekday: null, exercises: [ex(squat.id)] }] });
  assert.equal(again.status, 200);
  assert.equal((await prisma.workoutTemplate.findUnique({ where: { id: existing[0].id }, include: { exercises: true } })).exercises.length, 0, "the existing plan is untouched");
});

test("a retried save with the same key returns the first one's plans and makes nothing more", async () => {
  const { user, c } = await newUser("idem");
  const body = { programName: "P", schedule: true, days: [{ name: "A", weekday: 4, exercises: [ex(bench.id)] }, { name: "B", weekday: null, exercises: [ex(squat.id)] }] };
  const key = { "Idempotency-Key": `import-${run}-abcdefghijklmnop` };
  const first = await c.post("/api/workouts/import", body, key);
  const second = await c.post("/api/workouts/import", body, key);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.repeated, true);
  assert.equal(second.body.program.id, first.body.program.id, "the same program, not a second one");
  assert.deepEqual(second.body.templates.map((t) => t.id).sort(), first.body.templates.map((t) => t.id).sort());
  assert.deepEqual(await counts(user.id), { templates: 2, slots: 1, exercises: 0 }, "nothing duplicated, nothing scheduled twice");
  assert.equal(await prisma.workoutProgram.count({ where: { userId: user.id } }), 1);
});

test("UI-01: a program can be renamed, reordered and ungrouped; plans, schedule and logged workouts are kept", async () => {
  const { user, c } = await newUser("prog");
  const r = await c.post("/api/workouts/import", { programName: "Full Body", schedule: true, days: [
    { name: "A", weekday: 0, exercises: [ex(bench.id)] }, { name: "B", weekday: 2, exercises: [ex(squat.id)] }, { name: "C", weekday: null, exercises: [ex(bench.id)] },
  ] });
  const [a, b, cc] = r.body.templates;
  const pid = r.body.program.id;
  // A workout logged from day A.
  const session = await prisma.workoutSession.create({ data: { userId: user.id, templateId: a.id, name: "A", status: "COMPLETED", endedAt: new Date(), exercises: { create: [{ exerciseId: bench.id, position: 0, sets: { create: [{ setNumber: 1, reps: 8, weightKg: 60 }] } }] } } });

  const renamed = await c.call("PATCH", `/api/programs/${pid}`, { name: "Full Body 3x" });
  assert.equal(renamed.status, 200, renamed.text);
  assert.equal(renamed.body.program.name, "Full Body 3x");
  const reordered = await c.call("PATCH", `/api/programs/${pid}`, { templateIds: [cc.id, a.id, b.id] });
  assert.deepEqual(reordered.body.program.templates.map((t) => t.name), ["C", "A", "B"]);
  const takenOut = await c.call("PATCH", `/api/programs/${pid}`, { templateIds: [cc.id, a.id] });
  assert.deepEqual(takenOut.body.program.templates.map((t) => t.name), ["C", "A"]);
  const bNow = await prisma.workoutTemplate.findUnique({ where: { id: b.id }, include: { slots: true } });
  assert.equal(bNow.programId, null, "a day taken out is an individual plan");
  assert.deepEqual(bNow.slots.map((s) => s.weekday), [2], "and keeps its schedule");

  assert.equal((await c.call("DELETE", `/api/programs/${pid}`)).status, 200);
  assert.equal(await prisma.workoutProgram.count({ where: { userId: user.id } }), 0);
  const plans = await prisma.workoutTemplate.findMany({ where: { userId: user.id }, include: { exercises: true, slots: true }, orderBy: { name: "asc" } });
  assert.deepEqual(plans.map((p) => [p.name, p.programId, p.exercises.length, p.slots.map((s) => s.weekday)]), [["A", null, 1, [0]], ["B", null, 1, [2]], ["C", null, 1, []]], "every plan kept, with its exercises and schedule");
  const kept = await prisma.workoutSession.findUnique({ where: { id: session.id }, include: { exercises: { include: { sets: true } } } });
  assert.equal(kept.templateId, a.id, "the logged workout still points at its plan");
  assert.equal(kept.exercises[0].sets[0].weightKg, 60);
});

test("UI-01: plans saved earlier can be grouped by hand; nobody else's plans or programs can be touched", async () => {
  const { user, c } = await newUser("group");
  const other = await newUser("group-other");
  const mine = [];
  for (const n of ["Day 1", "Day 2"]) mine.push(await prisma.workoutTemplate.create({ data: { userId: user.id, name: n } }));
  const theirs = await prisma.workoutTemplate.create({ data: { userId: other.user.id, name: "Theirs" } });
  const g = await c.post("/api/programs", { name: "My old import", templateIds: [mine[1].id, mine[0].id] });
  assert.equal(g.status, 200, g.text);
  const p = await prisma.workoutProgram.findUnique({ where: { id: g.body.program.id }, include: { templates: { orderBy: { programPosition: "asc" } } } });
  assert.deepEqual([p.origin, p.templates.map((t) => t.name)], ["manual", ["Day 2", "Day 1"]]);
  assert.equal((await c.post("/api/programs", { name: "X", templateIds: [theirs.id] })).status, 404, "another person's plan can't be grouped");
  assert.equal((await other.c.call("PATCH", `/api/programs/${p.id}`, { name: "Mine now" })).status, 404, "nor their program renamed");
  assert.equal((await other.c.call("DELETE", `/api/programs/${p.id}`)).status, 404, "or ungrouped");
  assert.equal((await c.call("PATCH", `/api/programs/${p.id}`, { templateIds: [mine[0].id, theirs.id] })).status, 404);
  assert.equal((await prisma.workoutTemplate.findUnique({ where: { id: theirs.id } })).programId, null, "their plan is untouched");
  assert.equal((await c.post("/api/programs", { name: "Dup", templateIds: [mine[0].id, mine[0].id] })).status, 400, "a plan can't be a program's day twice");
});

test("UI-06: a program becomes active only on confirmation, with its preview; the schedule and the choice change together", async () => {
  const { user, c } = await newUser("active");
  const solo = await prisma.workoutTemplate.create({ data: { userId: user.id, name: "Mobility" } });
  await prisma.scheduleSlot.create({ data: { userId: user.id, weekday: 6, templateId: solo.id } });
  const r = await c.post("/api/workouts/import", { programName: "Push Pull Legs", days: ["Push", "Pull", "Legs"].map((name) => ({ name, weekday: null, exercises: [ex(bench.id)] })) });
  const pid = r.body.program.id;
  const [push, pull, legs] = r.body.templates;
  assert.equal((await prisma.profile.findUnique({ where: { userId: user.id } })).activeProgramId, null, "importing doesn't make it active");
  const session = await prisma.workoutSession.create({ data: { userId: user.id, templateId: push.id, name: "Push", status: "COMPLETED", endedAt: new Date(), exercises: { create: [{ exerciseId: bench.id, position: 0, sets: { create: [{ setNumber: 1, reps: 8, weightKg: 70 }] } }] } } });

  // The preview changes nothing, suggests Mon/Wed/Fri, and shows the existing Sunday slot.
  const preview = await c.call("GET", `/api/programs/${pid}/activate`);
  assert.equal(preview.status, 200, preview.text);
  assert.deepEqual(preview.body.proposed, { [push.id]: [0], [pull.id]: [2], [legs.id]: [4] });
  assert.deepEqual(preview.body.current.map((s) => [s.weekday, s.name]), [[6, "Mobility"]]);
  assert.equal(await prisma.scheduleSlot.count({ where: { userId: user.id } }), 1);

  // A preview that's out of date is refused, and nothing changes.
  await prisma.scheduleSlot.create({ data: { userId: user.id, weekday: 5, templateId: solo.id } });
  const stale = await c.post(`/api/programs/${pid}/activate`, { weekdays: preview.body.proposed, version: preview.body.version });
  assert.equal(stale.status, 409, stale.text);
  assert.equal((await prisma.profile.findUnique({ where: { userId: user.id } })).activeProgramId, null);
  assert.equal(await prisma.scheduleSlot.count({ where: { userId: user.id } }), 2, "nothing was removed");

  // Too many on one day, or a plan from outside the program, is refused.
  const fresh = (await c.call("GET", `/api/programs/${pid}/activate`)).body;
  assert.equal((await c.post(`/api/programs/${pid}/activate`, { weekdays: { [solo.id]: [0] }, version: fresh.version })).status, 400);

  // Confirmed with a changed day: the schedule is exactly the program's, and it's the active program.
  const ok = await c.post(`/api/programs/${pid}/activate`, { weekdays: { [push.id]: [0, 3], [pull.id]: [1], [legs.id]: [] }, version: fresh.version });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.body.removed.map((s) => s.weekday).sort(), [5, 6], "the removed assignments are reported");
  const slots = await prisma.scheduleSlot.findMany({ where: { userId: user.id }, orderBy: [{ weekday: "asc" }, { position: "asc" }] });
  assert.deepEqual(slots.map((s) => [s.weekday, s.templateId]), [[0, push.id], [1, pull.id], [3, push.id]]);
  assert.equal((await prisma.profile.findUnique({ where: { userId: user.id } })).activeProgramId, pid);
  assert.ok(await prisma.workoutTemplate.findUnique({ where: { id: solo.id } }), "the plan taken off the schedule still exists");
  assert.equal((await prisma.workoutSession.findUnique({ where: { id: session.id } })).templateId, push.id, "history is untouched");

  // With an active program, only its workouts can be added to the schedule.
  const days = [[push.id], [pull.id], [], [push.id], [], [], []];
  assert.equal((await c.call("PUT", "/api/schedule", { days: days.map((d, i) => (i === 6 ? [solo.id] : d)) })).status, 400);
  assert.equal((await c.call("PUT", "/api/schedule", { days: days.map((d, i) => (i === 4 ? [legs.id] : d)) })).status, 200);

  // Deleting the active program: no program is active, every plan and the schedule stay.
  assert.equal((await c.call("DELETE", `/api/programs/${pid}`)).status, 200);
  assert.equal((await prisma.profile.findUnique({ where: { userId: user.id } })).activeProgramId, null);
  assert.equal(await prisma.scheduleSlot.count({ where: { userId: user.id } }), 4);
  assert.equal(await prisma.workoutTemplate.count({ where: { userId: user.id } }), 4);
});

test("UI-06: nobody can preview or activate another person's program", async () => {
  const a = await newUser("act-a");
  const b = await newUser("act-b");
  const r = await a.c.post("/api/workouts/import", { programName: "Mine", days: [{ name: "Day", weekday: null, exercises: [ex(bench.id)] }] });
  const pid = r.body.program.id;
  assert.equal((await b.c.call("GET", `/api/programs/${pid}/activate`)).status, 404);
  assert.equal((await b.c.post(`/api/programs/${pid}/activate`, { weekdays: {}, version: "0-0" })).status, 404);
  assert.equal((await prisma.profile.findUnique({ where: { userId: b.user.id } })).activeProgramId, null);
});

test("UI-05: deleting a plan keeps its logged workouts, and takes it off the schedule only", async () => {
  const { user, c } = await newUser("del");
  const plan = await prisma.workoutTemplate.create({ data: { userId: user.id, name: "Old plan", exercises: { create: [{ exerciseId: bench.id, position: 0, targetSets: 3, targetRepsMin: 8, targetRepsMax: 10 }] } } });
  const other = await prisma.workoutTemplate.create({ data: { userId: user.id, name: "Other" } });
  await prisma.scheduleSlot.createMany({ data: [{ userId: user.id, weekday: 0, templateId: plan.id }, { userId: user.id, weekday: 0, templateId: other.id, position: 1 }] });
  const done = await prisma.workoutSession.create({ data: { userId: user.id, templateId: plan.id, name: "Old plan", status: "COMPLETED", endedAt: new Date(), exercises: { create: [{ exerciseId: bench.id, position: 0, sets: { create: [{ setNumber: 1, reps: 8, weightKg: 60 }] } }] } } });
  const open = await prisma.workoutSession.create({ data: { userId: user.id, templateId: plan.id, name: "Old plan", status: "IN_PROGRESS" } });
  assert.equal((await c.call("DELETE", `/api/templates/${plan.id}`)).status, 200);
  assert.equal(await prisma.workoutTemplate.count({ where: { id: plan.id } }), 0);
  assert.deepEqual((await prisma.scheduleSlot.findMany({ where: { userId: user.id } })).map((s) => s.templateId), [other.id], "only its own schedule place went");
  const kept = await prisma.workoutSession.findUnique({ where: { id: done.id }, include: { exercises: { include: { sets: true } } } });
  assert.equal(kept.exercises[0].sets[0].weightKg, 60, "its logged workout is kept, with its sets");
  assert.equal((await prisma.workoutSession.findUnique({ where: { id: open.id } })).status, "IN_PROGRESS", "a workout in progress carries on");
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

test("phase 4: a package photo's words come back as search choices only, with numbers, nutrition and claims left out", async () => {
  const { c } = await newUser("pkg");
  const png = await screenshot(["HILLSIDE", "Greek Yogurt", "High in Protein", "73 kcal per 100g"]);
  const r = await c.post("/api/foods/photo-text", png, { "Content-Type": "image/png" });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.body), ["lines"]);
  assert.ok(r.body.lines.some((l) => /greek yogurt/i.test(l)), JSON.stringify(r.body.lines));
  assert.ok(r.body.lines.every((l) => !/kcal|protein|\d/i.test(l)), `no value or claim: ${JSON.stringify(r.body.lines)}`);
  assert.equal((await client(null).post("/api/foods/photo-text", png, { "Content-Type": "image/png" })).status, 401);
  assert.equal((await c.post("/api/foods/photo-text", Buffer.from("x"), { "Content-Type": "text/plain" })).status, 415);
});

test("UI-05B/05C: an individual plan is added at a chosen place without copies; removing can also unschedule; other programs and people are refused", async () => {
  const { user, c } = await newUser("addrm");
  const other = await newUser("addrm-other");
  const r = await c.post("/api/workouts/import", { programName: "Upper Lower", schedule: true, days: [
    { name: "Upper", weekday: 0, exercises: [ex(bench.id)] }, { name: "Lower", weekday: 3, exercises: [ex(squat.id)] },
  ] });
  const pid = r.body.program.id;
  const [upper, lower] = r.body.templates;
  const solo = await prisma.workoutTemplate.create({ data: { userId: user.id, name: "Arms", exercises: { create: [{ exerciseId: bench.id, position: 0, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12 }] } } });
  await prisma.scheduleSlot.create({ data: { userId: user.id, weekday: 2, templateId: solo.id } });
  await prisma.workoutSession.create({ data: { userId: user.id, templateId: solo.id, name: "Arms", status: "COMPLETED", endedAt: new Date(), exercises: { create: [{ exerciseId: bench.id, position: 0, sets: { create: [{ setNumber: 1, reps: 10, weightKg: 30 }] } }] } } });
  const elsewhere = await c.post("/api/programs", { name: "Other", templateIds: [(await prisma.workoutTemplate.create({ data: { userId: user.id, name: "Cardio" } })).id] });
  const cardio = elsewhere.body.program;
  const theirs = await prisma.workoutTemplate.create({ data: { userId: other.user.id, name: "Theirs" } });
  const before = { templates: await prisma.workoutTemplate.count({ where: { userId: user.id } }), exercises: await prisma.templateExercise.count({ where: { template: { userId: user.id } } }), sessions: await prisma.workoutSession.count({ where: { userId: user.id } }) };
  const slotsOf = async (id) => (await prisma.scheduleSlot.findMany({ where: { templateId: id } })).map((s) => s.weekday);

  // Add Arms as day 2 of 3: it joins in place; its Wednesday stays; nothing is copied.
  const added = await c.call("PATCH", `/api/programs/${pid}`, { templateIds: [upper.id, solo.id, lower.id] });
  assert.equal(added.status, 200, added.text);
  assert.deepEqual(added.body.program.templates.map((t) => t.name), ["Upper", "Arms", "Lower"]);
  assert.deepEqual(await slotsOf(solo.id), [2], "its schedule isn't changed by joining");
  assert.deepEqual({ templates: await prisma.workoutTemplate.count({ where: { userId: user.id } }), exercises: await prisma.templateExercise.count({ where: { template: { userId: user.id } } }), sessions: await prisma.workoutSession.count({ where: { userId: user.id } }) }, before, "no plan, exercise or session duplicated");

  // A day of another program isn't moved silently; another person's plan is unknown.
  const cardioDay = (await prisma.workoutTemplate.findFirst({ where: { programId: cardio.id } })).id;
  const moved = await c.call("PATCH", `/api/programs/${pid}`, { templateIds: [upper.id, solo.id, lower.id, cardioDay] });
  assert.equal(moved.status, 409, moved.text);
  assert.equal((await prisma.workoutTemplate.findUnique({ where: { id: cardioDay } })).programId, cardio.id, "it stays in its own program");
  assert.equal((await c.call("PATCH", `/api/programs/${pid}`, { templateIds: [upper.id, theirs.id] })).status, 404);
  assert.equal((await prisma.workoutTemplate.findUnique({ where: { id: theirs.id } })).programId, null);
  assert.equal((await c.call("PATCH", `/api/programs/${pid}`, { unscheduleRemoved: true })).status, 400, "unscheduling needs the days that stay");

  // B: removed, kept on the schedule. A: removed, and off the schedule, in the same change. Plans and history stay.
  await c.call("PATCH", `/api/programs/${pid}`, { templateIds: [upper.id, lower.id] });
  assert.deepEqual(await slotsOf(solo.id), [2], "B keeps it scheduled");
  const off = await c.call("PATCH", `/api/programs/${pid}`, { templateIds: [upper.id], unscheduleRemoved: true });
  assert.equal(off.status, 200, off.text);
  assert.deepEqual(await slotsOf(lower.id), [], "A takes it off the schedule");
  assert.deepEqual(await slotsOf(upper.id), [0], "the days that stay keep theirs");
  assert.deepEqual(await slotsOf(solo.id), [2], "and a plan already outside the program isn't touched");
  const lowerNow = await prisma.workoutTemplate.findUnique({ where: { id: lower.id }, include: { exercises: true } });
  assert.deepEqual([lowerNow.programId, lowerNow.exercises.length], [null, 1], "the plan and its exercises stay");
  assert.equal(await prisma.workoutSession.count({ where: { userId: user.id, status: "COMPLETED" } }), 1, "history stays");
  // Added back to where it was.
  const back = await c.call("PATCH", `/api/programs/${pid}`, { templateIds: [upper.id, lower.id] });
  assert.deepEqual(back.body.program.templates.map((t) => t.name), ["Upper", "Lower"]);
});
