// Multi-gym and exercise swaps against a real database: gyms, equipment, machines, choosing a gym, swapping an
// exercise partway, and machine-specific history. Every check runs as a person through the app's own API.
//   BASE_URL=… DATABASE_URL=<designated test database> node --test scripts/gyms-api.test.cjs
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

function client(token) {
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Origin: ORIGIN, Cookie: `fit_session=${token}` }, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, body: json, text };
  };
  return { call, get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), put: (p, b) => call("PUT", p, b), patch: (p, b) => call("PATCH", p, b), del: (p) => call("DELETE", p) };
}
async function newUser(label) {
  const { user, token } = await createSignedInUser(prisma, `gym${label}${++counter}x${run}@test.dev`);
  await prisma.profile.create({ data: { userId: user.id, name: "Lifter", birthDate: new Date("1990-01-01T00:00:00Z"), timezone: "UTC", unitSystem: "METRIC" } });
  return { user, c: client(token) };
}
const ok = (r, label = "") => { assert.equal(r.status, 200, `${label} ${r.text}`); return r.body; };

const lib = {};
before(async () => {
  await target.verifyServer();
  for (const name of ["Barbell Bench Press", "Dumbbell Bench Press", "Machine Chest Press", "Push-Up", "Cable Fly", "Back Squat"]) {
    lib[name] = await prisma.exercise.findFirst({ where: { userId: null, name } });
    assert.ok(lib[name], `the built-in library has ${name}`);
  }
});
after(() => prisma.$disconnect());

async function gymWith(c, name, kinds = [], machines = []) {
  const { gym } = ok(await c.post("/api/gyms", { name }), "create gym");
  if (kinds.length) ok(await c.put(`/api/gyms/${gym.id}/equipment`, { kinds }), "kinds");
  const made = [];
  for (const m of machines) made.push(ok(await c.post(`/api/gyms/${gym.id}/equipment`, m), "machine").machine);
  return { gym, machines: made };
}
async function planFor(userId, exercises) {
  return prisma.workoutTemplate.create({ data: { userId, name: `Plan ${++counter}`, exercises: { create: exercises.map((e, position) => ({ exerciseId: e.id, position, targetSets: 3, targetRepsMin: 8, targetRepsMax: 10, targetWeightKg: 50 })) } }, include: { exercises: { orderBy: { position: "asc" } } } });
}
async function start(c, body) { return ok(await c.post("/api/sessions", body), "start").session; }
const exercisesOf = (sessionId) => prisma.sessionExercise.findMany({ where: { sessionId }, orderBy: { position: "asc" }, include: { sets: { orderBy: { setNumber: "asc" } } } });
const logSet = (c, sid, seId, reps, weightKg) => c.post(`/api/sessions/${sid}/exercises/${seId}/sets`, { reps, weightKg });
const finish = (c, sid) => c.patch(`/api/sessions/${sid}`, { finish: true });

test("gyms: create, list, rename; names are unique per person ignoring case, and validated", async () => {
  const { c } = await newUser("crud");
  const other = await newUser("crud-other");
  const { gym } = ok(await c.post("/api/gyms", { name: "  City Gym  " }));
  assert.equal(gym.name, "City Gym", "trimmed");
  assert.equal((await c.post("/api/gyms", { name: "city gym" })).status, 409, "a duplicate, ignoring case");
  ok(await other.c.post("/api/gyms", { name: "City Gym" }), "another person may use the same name");
  const { gym: home } = ok(await c.post("/api/gyms", { name: "Home" }));
  assert.equal((await c.patch(`/api/gyms/${home.id}`, { name: "CITY GYM" })).status, 409, "renaming onto another gym's name");
  assert.equal(ok(await c.patch(`/api/gyms/${home.id}`, { name: "Garage" })).gym.name, "Garage");
  assert.equal(ok(await c.patch(`/api/gyms/${gym.id}`, { name: "city gym" })).gym.name, "city gym", "a gym may change its own name's case");
  assert.deepEqual(ok(await c.get("/api/gyms")).gyms.map((g) => g.name).sort(), ["Garage", "city gym"].sort(), "only this person's, in the database's name order");
  for (const [label, body] of [["empty", { name: "   " }], ["too long", { name: "x".repeat(61) }], ["unknown field", { name: "A", userId: other.user.id }], ["no name", {}]]) {
    assert.equal((await c.post("/api/gyms", body)).status, 400, label);
  }
});

test("a person can have at most 20 gyms", async () => {
  const { user, c } = await newUser("limit");
  await prisma.gymLocation.createMany({ data: Array.from({ length: 20 }, (_, i) => ({ userId: user.id, name: `G${i}` })) });
  assert.equal((await c.post("/api/gyms", { name: "One more" })).status, 409);
  assert.equal(await prisma.gymLocation.count({ where: { userId: user.id } }), 20);
});

test("another person's gyms, machines and workouts are not found, through every route", async () => {
  const a = await newUser("iso-a");
  const b = await newUser("iso-b");
  const { gym, machines: [m] } = await gymWith(a.c, "A's gym", ["MACHINE"], [{ kind: "MACHINE", name: "A's press", exerciseId: lib["Machine Chest Press"].id }]);
  const aSession = await start(a.c, { name: "A", gymLocationId: gym.id });
  const aSe = ok(await a.c.post(`/api/sessions/${aSession.id}/exercises`, { exerciseId: lib["Machine Chest Press"].id })).sessionExercise;
  assert.equal((await b.c.post("/api/sessions", { name: "X", gymLocationId: gym.id })).status, 404, "start a workout at it");
  assert.equal(await prisma.workoutSession.count({ where: { userId: b.user.id } }), 0, "and nothing was made");
  const bSession = await start(b.c, { name: "B" });
  const bSe = ok(await b.c.post(`/api/sessions/${bSession.id}/exercises`, { exerciseId: lib["Machine Chest Press"].id })).sessionExercise;
  const cases = [
    ["read the gym", b.c.get(`/api/gyms/${gym.id}`)],
    ["rename it", b.c.patch(`/api/gyms/${gym.id}`, { name: "Mine now" })],
    ["change its equipment", b.c.put(`/api/gyms/${gym.id}/equipment`, { kinds: [] })],
    ["add a machine to it", b.c.post(`/api/gyms/${gym.id}/equipment`, { kind: "CABLE", name: "Sneaky" })],
    ["remove its machine", b.c.del(`/api/gyms/${gym.id}/machines/${m.id}`)],
    ["put a workout at it", b.c.put(`/api/sessions/${bSession.id}/gym`, { gymLocationId: gym.id })],
    ["use its machine", b.c.put(`/api/sessions/${bSession.id}/exercises/${bSe.id}/machine`, { gymEquipmentId: m.id })],
    ["read its machine's previous performance", b.c.get(`/api/exercises/${lib["Machine Chest Press"].id}/previous?machine=${m.id}`)],
    ["read its machine's history", b.c.get(`/api/exercises/${lib["Machine Chest Press"].id}/history?machine=${m.id}`)],
    ["see alternatives in A's workout", b.c.get(`/api/sessions/${aSession.id}/exercises/${aSe.id}/alternatives`)],
    ["swap in A's workout", b.c.post(`/api/sessions/${aSession.id}/exercises/${aSe.id}/substitute`, { exerciseId: lib["Push-Up"].id })],
    ["change A's workout's gym", b.c.put(`/api/sessions/${aSession.id}/gym`, { gymLocationId: null })],
  ];
  for (const [label, p] of cases) assert.equal((await p).status, 404, label);
  assert.equal(await prisma.workoutSession.count({ where: { userId: b.user.id } }), 1);
  assert.deepEqual(ok(await b.c.get("/api/gyms")).gyms, []);
  const after_ = await prisma.gymLocation.findUnique({ where: { id: gym.id }, include: { equipment: true } });
  assert.equal(after_.name, "A's gym");
  assert.deepEqual(after_.equipment.map((e) => e.name ?? "(kind)").sort(), ["(kind)", "A's press"].sort());
  assert.equal((await prisma.workoutSession.findUnique({ where: { id: aSession.id } })).gymLocationId, gym.id);
  assert.equal(await prisma.sessionExercise.count({ where: { sessionId: aSession.id } }), 1, "nothing swapped in A's workout");
});

test("equipment kinds: replaced as a list, idempotent, concurrent saves don't duplicate, machines untouched", async () => {
  const { c } = await newUser("kinds");
  const { gym, machines: [m] } = await gymWith(c, "Kinds", [], [{ kind: "CABLE", name: "Cable stack" }]);
  const kinds = (g) => g.equipment.filter((e) => e.name === null).map((e) => e.kind).sort();
  assert.deepEqual(kinds(ok(await c.put(`/api/gyms/${gym.id}/equipment`, { kinds: ["BARBELL", "DUMBBELL", "BARBELL"] })).gym), ["BARBELL", "DUMBBELL"]);
  assert.deepEqual(kinds(ok(await c.put(`/api/gyms/${gym.id}/equipment`, { kinds: ["DUMBBELL", "BARBELL"] })).gym), ["BARBELL", "DUMBBELL"], "the same list again changes nothing");
  await Promise.all(Array.from({ length: 6 }, () => c.put(`/api/gyms/${gym.id}/equipment`, { kinds: ["CABLE", "MACHINE"] })));
  const rows = await prisma.gymEquipment.findMany({ where: { gymId: gym.id } });
  assert.deepEqual(rows.filter((r) => r.name === null).map((r) => r.kind).sort(), ["CABLE", "MACHINE"], "six saves at once, one row per kind");
  assert.ok(rows.some((r) => r.id === m.id), "the named machine is kept");
  assert.equal((await c.put(`/api/gyms/${gym.id}/equipment`, { kinds: ["SPACESHIP"] })).status, 400);
});

test("machines: added, duplicates refused, exercise must be visible, removed only without history", async () => {
  const { c } = await newUser("machines");
  const other = await newUser("machines-other");
  const theirs = await prisma.exercise.create({ data: { userId: other.user.id, name: `Secret ${run}`, primaryMuscle: "CHEST", equipment: "MACHINE" } });
  const { gym, machines: [press] } = await gymWith(c, "Machines", [], [{ kind: "MACHINE", name: "Hammer press", exerciseId: lib["Machine Chest Press"].id }]);
  assert.equal(press.exerciseId, lib["Machine Chest Press"].id);
  assert.equal((await c.post(`/api/gyms/${gym.id}/equipment`, { kind: "MACHINE", name: "hammer PRESS" })).status, 409, "a duplicate at this gym");
  assert.equal((await c.post(`/api/gyms/${gym.id}/equipment`, { kind: "MACHINE", name: "X", exerciseId: theirs.id })).status, 400, "someone else's exercise");
  const { machine: spare } = ok(await c.post(`/api/gyms/${gym.id}/equipment`, { kind: "MACHINE", name: "Spare" }));
  ok(await c.del(`/api/gyms/${gym.id}/machines/${spare.id}`), "no history: removed");
  const s = await start(c, { name: "W", gymLocationId: gym.id });
  const se = ok(await c.post(`/api/sessions/${s.id}/exercises`, { exerciseId: lib["Machine Chest Press"].id })).sessionExercise;
  ok(await c.put(`/api/sessions/${s.id}/exercises/${se.id}/machine`, { gymEquipmentId: press.id }));
  assert.equal((await c.del(`/api/gyms/${gym.id}/machines/${press.id}`)).status, 409, "a machine a workout used is kept");
  assert.ok(await prisma.gymEquipment.findUnique({ where: { id: press.id } }));
});

test("choosing a gym: at the start, during the workout, cleared; a machine only at the workout's gym and before its first set", async () => {
  const { c } = await newUser("choose");
  const { gym: a, machines: [ma] } = await gymWith(c, "A", [], [{ kind: "MACHINE", name: "A press" }]);
  const { gym: b } = await gymWith(c, "B");
  const s = await start(c, { name: "W", gymLocationId: a.id });
  assert.equal(s.gymLocationId, a.id);
  const se = ok(await c.post(`/api/sessions/${s.id}/exercises`, { exerciseId: lib["Machine Chest Press"].id })).sessionExercise;
  ok(await c.put(`/api/sessions/${s.id}/gym`, { gymLocationId: b.id }), "changed during the workout");
  assert.equal((await c.put(`/api/sessions/${s.id}/exercises/${se.id}/machine`, { gymEquipmentId: ma.id })).status, 409, "a machine at another gym");
  ok(await c.put(`/api/sessions/${s.id}/gym`, { gymLocationId: a.id }));
  ok(await c.put(`/api/sessions/${s.id}/exercises/${se.id}/machine`, { gymEquipmentId: ma.id }));
  ok(await logSet(c, s.id, se.id, 8, 40));
  assert.equal((await c.put(`/api/sessions/${s.id}/exercises/${se.id}/machine`, { gymEquipmentId: null })).status, 409, "after a set, the machine stays with it");
  assert.equal((await prisma.sessionExercise.findUnique({ where: { id: se.id } })).gymEquipmentId, ma.id);
  ok(await finish(c, s.id));
  assert.equal((await c.put(`/api/sessions/${s.id}/gym`, { gymLocationId: b.id })).status, 409, "a finished workout's gym isn't changed");
  assert.equal((await prisma.workoutSession.findUnique({ where: { id: s.id } })).gymLocationId, a.id);
  const none = await start(c, { name: "No gym" });
  assert.equal(none.gymLocationId, null, "no gym is chosen for you");
});

test("swapping partway: logged sets stay on the planned exercise, the plan is unchanged, the swap is recorded", async () => {
  const { user, c } = await newUser("swap");
  const { gym } = await gymWith(c, "Hotel gym", ["DUMBBELL", "BODYWEIGHT"]);
  const plan = await planFor(user.id, [lib["Barbell Bench Press"], lib["Back Squat"]]);
  const s = await start(c, { templateId: plan.id, gymLocationId: gym.id });
  const [bench, squat] = await exercisesOf(s.id);
  ok(await logSet(c, s.id, bench.id, 8, 60));
  ok(await logSet(c, s.id, bench.id, 7, 60));
  const setsBefore = (await exercisesOf(s.id))[0].sets;

  const alt = ok(await c.get(`/api/sessions/${s.id}/exercises/${bench.id}/alternatives`));
  const names = alt.alternatives.map((a) => a.name);
  assert.ok(names.includes("Dumbbell Bench Press") && names.includes("Machine Chest Press") && names.includes("Push-Up"), names.join(", "));
  assert.ok(!names.includes("Cable Fly"), "the same muscle isn't enough: a fly is a different movement");
  assert.ok(alt.alternatives.every((a) => a.reason === "same-pattern"));
  const available = Object.fromEntries(alt.alternatives.map((a) => [a.name, a.available]));
  assert.deepEqual([available["Dumbbell Bench Press"], available["Push-Up"], available["Machine Chest Press"]], [true, true, false], "marked by what this gym has");
  assert.equal(alt.gym.equipmentKnown, true);

  const r = ok(await c.post(`/api/sessions/${s.id}/exercises/${bench.id}/substitute`, { exerciseId: lib["Dumbbell Bench Press"].id }));
  assert.equal(r.planUpdated, false);
  const rows = await exercisesOf(s.id);
  assert.deepEqual(rows.map((e) => [e.exerciseId, e.position]), [[bench.exerciseId, 0], [lib["Dumbbell Bench Press"].id, 1], [squat.exerciseId, 2]], "the replacement follows the planned exercise");
  assert.deepEqual(rows[0].sets, setsBefore, "the logged sets are exactly as they were");
  assert.equal(rows[1].substitutesId, bench.id);
  assert.equal(rows[1].plannedExerciseId, bench.exerciseId);
  ok(await logSet(c, s.id, rows[1].id, 10, 22));
  ok(await finish(c, s.id));

  const plain = await prisma.workoutTemplate.findUnique({ where: { id: plan.id }, include: { exercises: { orderBy: { position: "asc" } } } });
  assert.deepEqual(plain.exercises.map((e) => e.exerciseId), plan.exercises.map((e) => e.exerciseId), "the plan is unchanged");
  const done = await exercisesOf(s.id);
  assert.deepEqual(done.map((e) => e.exerciseId), [bench.exerciseId, lib["Dumbbell Bench Press"].id], "the unperformed squat is dropped as before; both performed exercises stay");
  assert.deepEqual(done[0].sets, setsBefore, "finishing didn't change them either");

  // The person's own earlier swap is offered next time, said to be theirs.
  const s2 = await start(c, { templateId: plan.id });
  const [bench2] = await exercisesOf(s2.id);
  const again = ok(await c.get(`/api/sessions/${s2.id}/exercises/${bench2.id}/alternatives`));
  assert.equal(again.alternatives.find((a) => a.name === "Dumbbell Bench Press").reason, "used-before");
  assert.equal(again.gym, null);
  assert.ok(again.alternatives.every((a) => a.available), "no gym chosen: availability isn't claimed either way");
});

test("a swap that was never performed still records what was planned after finishing", async () => {
  const { user, c } = await newUser("swap-unlogged");
  const plan = await planFor(user.id, [lib["Barbell Bench Press"]]);
  const s = await start(c, { templateId: plan.id });
  const [bench] = await exercisesOf(s.id);
  const { sessionExercise: rep } = ok(await c.post(`/api/sessions/${s.id}/exercises/${bench.id}/substitute`, { exerciseId: lib["Push-Up"].id }));
  ok(await logSet(c, s.id, rep.id, 15, 0));
  ok(await finish(c, s.id));
  const done = await exercisesOf(s.id);
  assert.deepEqual(done.map((e) => [e.exerciseId, e.plannedExerciseId, e.substitutesId]), [[lib["Push-Up"].id, bench.exerciseId, null]], "the empty planned row went; the link to what was planned stays");
});

test("updating the plan happens only when asked, and only for that entry", async () => {
  const { user, c } = await newUser("swap-plan");
  const plan = await planFor(user.id, [lib["Barbell Bench Press"], lib["Back Squat"], lib["Barbell Bench Press"]]);
  const s = await start(c, { templateId: plan.id });
  const [bench] = await exercisesOf(s.id);
  const r = ok(await c.post(`/api/sessions/${s.id}/exercises/${bench.id}/substitute`, { exerciseId: lib["Machine Chest Press"].id, updatePlan: true }));
  assert.equal(r.planUpdated, true);
  const t = await prisma.templateExercise.findMany({ where: { templateId: plan.id }, orderBy: { position: "asc" } });
  assert.deepEqual(t.map((e) => e.exerciseId), [lib["Machine Chest Press"].id, lib["Back Squat"].id, lib["Barbell Bench Press"].id], "the first matching entry only");
  assert.deepEqual(t.map((e) => [e.targetSets, e.targetRepsMin, e.targetRepsMax, e.targetWeightKg]), plan.exercises.map((e) => [e.targetSets, e.targetRepsMin, e.targetRepsMax, e.targetWeightKg]), "its targets stay");
  const empty = await start(c, { name: "No plan" }).catch(() => null);
  assert.equal(empty, null, "one workout at a time");
});

test("swaps: refused when finished, to the same or an unknown exercise, to another gym's machine, or twice differently; a retry returns the same swap; concurrent swaps make one", async () => {
  const { c } = await newUser("swap-rules");
  const other = await newUser("swap-rules-other");
  const theirs = await prisma.exercise.create({ data: { userId: other.user.id, name: `Hidden ${run}`, primaryMuscle: "CHEST", equipment: "BARBELL" } });
  const { gym: a } = await gymWith(c, "A");
  const { machines: [elsewhere] } = await gymWith(c, "B", [], [{ kind: "MACHINE", name: "B press" }]);
  const s = await start(c, { name: "W", gymLocationId: a.id });
  const add = async (ex) => ok(await c.post(`/api/sessions/${s.id}/exercises`, { exerciseId: ex.id })).sessionExercise;
  const one = await add(lib["Barbell Bench Press"]);
  const sub = (se, body) => c.post(`/api/sessions/${s.id}/exercises/${se.id}/substitute`, body);
  assert.equal((await sub(one, { exerciseId: lib["Barbell Bench Press"].id })).status, 400, "the same exercise");
  assert.equal((await sub(one, { exerciseId: theirs.id })).status, 400, "someone else's exercise");
  assert.equal((await sub(one, { exerciseId: lib["Machine Chest Press"].id, gymEquipmentId: elsewhere.id })).status, 409, "another gym's machine");
  assert.equal((await sub(one, { exerciseId: lib["Push-Up"].id, extra: 1 })).status, 400, "an unknown field");
  const first = ok(await sub(one, { exerciseId: lib["Push-Up"].id }));
  const retry = ok(await sub(one, { exerciseId: lib["Push-Up"].id }));
  assert.equal(retry.sessionExercise.id, first.sessionExercise.id, "the same swap again returns the one it made");
  assert.equal((await sub(one, { exerciseId: lib["Dumbbell Bench Press"].id })).status, 409, "a different swap of the same exercise");

  const two = await add(lib["Back Squat"]);
  const results = await Promise.all(Array.from({ length: 5 }, () => sub(two, { exerciseId: lib["Push-Up"].id })));
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200, 200], results.map((r) => r.text).join(" | "));
  assert.equal(new Set(results.map((r) => r.body.sessionExercise.id)).size, 1, "five at once: one swap");
  assert.equal(await prisma.sessionExercise.count({ where: { substitutesId: two.id } }), 1);
  const positions = (await exercisesOf(s.id)).map((e) => e.position);
  assert.deepEqual(positions, [...positions].sort((x, y) => x - y));
  assert.equal(new Set(positions).size, positions.length, "positions stay distinct");

  ok(await logSet(c, s.id, first.sessionExercise.id, 10, 0));
  ok(await finish(c, s.id));
  const leftover = (await exercisesOf(s.id)).find((e) => e.exerciseId === lib["Push-Up"].id);
  assert.equal((await c.post(`/api/sessions/${s.id}/exercises/${leftover.id}/substitute`, { exerciseId: lib["Dumbbell Bench Press"].id })).status, 409, "a finished workout");
});

test("previous performance and records are per machine; sets with no machine keep the shared history", async () => {
  const { c } = await newUser("context");
  const press = lib["Machine Chest Press"];
  const { gym: a, machines: [m1] } = await gymWith(c, "A", [], [{ kind: "MACHINE", name: "Plate-loaded press", exerciseId: press.id }]);
  const { gym: b, machines: [m2] } = await gymWith(c, "B", [], [{ kind: "MACHINE", name: "Selectorised press", exerciseId: press.id }]);
  async function workout(gymId, machineId, weightKg) {
    const s = await start(c, { name: "P", gymLocationId: gymId });
    const se = ok(await c.post(`/api/sessions/${s.id}/exercises`, { exerciseId: press.id })).sessionExercise;
    if (machineId) ok(await c.put(`/api/sessions/${s.id}/exercises/${se.id}/machine`, { gymEquipmentId: machineId }));
    ok(await logSet(c, s.id, se.id, 5, weightKg));
    ok(await finish(c, s.id));
    return s;
  }
  await workout(a.id, m1.id, 100);
  await workout(b.id, m2.id, 40);
  await workout(null, null, 60);
  const prev = async (q) => ok(await c.get(`/api/exercises/${press.id}/previous${q}`)).previous?.sets.map((x) => x.weightKg);
  assert.deepEqual(await prev(`?machine=${m1.id}`), [100]);
  assert.deepEqual(await prev(`?machine=${m2.id}`), [40]);
  assert.deepEqual(await prev(""), [60], "no machine: the shared history");
  const heaviest = async (q) => ok(await c.get(`/api/exercises/${press.id}/history${q}`)).records.heaviestWeight?.value;
  assert.equal(await heaviest(`?machine=${m2.id}`), 40, "B's machine's record isn't A's 100 kg");
  assert.equal(await heaviest(`?machine=${m1.id}`), 100);
  assert.equal(await heaviest(""), 60);
  const { machine: unused } = ok(await c.post(`/api/gyms/${a.id}/equipment`, { kind: "MACHINE", name: "New press" }));
  assert.equal(ok(await c.get(`/api/exercises/${press.id}/previous?machine=${unused.id}`)).previous, null, "a new machine starts with no history, never another's");
});

test("an imported plan can be done at different gyms, and the plan stays independent of the gym", async () => {
  const { user, c } = await newUser("import");
  const r = ok(await c.post("/api/workouts/import", { programName: "Travel", days: [{ name: "Push", weekday: null, exercises: [
    { exerciseId: lib["Barbell Bench Press"].id, targetSets: 3, targetRepsMin: 6, targetRepsMax: 8, targetWeightKg: null, restSeconds: null, notes: null },
  ] }] }));
  const planId = r.templates[0].id;
  const { gym: home } = await gymWith(c, "Home", ["DUMBBELL"]);
  const { gym: city } = await gymWith(c, "City", ["BARBELL", "MACHINE"]);
  for (const gym of [home, city]) {
    const s = await start(c, { templateId: planId, gymLocationId: gym.id });
    const [se] = await exercisesOf(s.id);
    assert.equal(se.exerciseId, lib["Barbell Bench Press"].id);
    const alts = ok(await c.get(`/api/sessions/${s.id}/exercises/${se.id}/alternatives`)).alternatives;
    const db = alts.find((a) => a.name === "Dumbbell Bench Press");
    assert.equal(db.available, gym === home, `${gym.name}: dumbbells ${gym === home ? "listed" : "not listed"}`);
    ok(await logSet(c, s.id, se.id, 6, 50));
    ok(await finish(c, s.id));
  }
  const plan = await prisma.workoutTemplate.findUnique({ where: { id: planId } });
  assert.ok(!("gymLocationId" in plan), "a plan has no gym");
  const sessions = await prisma.workoutSession.findMany({ where: { userId: user.id }, orderBy: { startedAt: "asc" } });
  assert.deepEqual(sessions.map((s) => s.gymLocationId), [home.id, city.id]);
  const filtered = await c.call("GET", `/workouts/history?gym=${home.id}`);
  assert.equal(filtered.status, 200);
});

test("limits and duplicates hold under concurrent saves", async () => {
  const { user, c } = await newUser("race");
  const created = await Promise.all(Array.from({ length: 25 }, (_, i) => c.post("/api/gyms", { name: `Gym ${i}` })));
  assert.equal(created.filter((r) => r.status === 200).length, 20, created.map((r) => r.status).join(","));
  assert.ok(created.every((r) => r.status === 200 || r.status === 409));
  assert.equal(await prisma.gymLocation.count({ where: { userId: user.id } }), 20, "twenty-five at once: still at most twenty");
  const same = await newUser("race-same");
  const dup = await Promise.all(Array.from({ length: 6 }, (_, i) => same.c.post("/api/gyms", { name: i % 2 ? "Twin" : "TWIN" })));
  assert.equal(dup.filter((r) => r.status === 200).length, 1, "one name, ignoring case, however many at once");
  const { gym } = dup.find((r) => r.status === 200).body;
  const machines = await Promise.all(Array.from({ length: 6 }, () => same.c.post(`/api/gyms/${gym.id}/equipment`, { kind: "MACHINE", name: "Press" })));
  assert.equal(machines.filter((r) => r.status === 200).length, 1);
  assert.equal(await prisma.gymEquipment.count({ where: { gymId: gym.id, name: { not: null } } }), 1);
});

test("a workout's gym can't change under machines chosen at it, and a machine set up for one exercise isn't used for another", async () => {
  const { c } = await newUser("gym-change");
  const { gym: a, machines: [press] } = await gymWith(c, "A", [], [{ kind: "MACHINE", name: "Press", exerciseId: lib["Machine Chest Press"].id }]);
  const { gym: b } = await gymWith(c, "B");
  const s = await start(c, { name: "W", gymLocationId: a.id });
  const pressSe = ok(await c.post(`/api/sessions/${s.id}/exercises`, { exerciseId: lib["Machine Chest Press"].id })).sessionExercise;
  const squatSe = ok(await c.post(`/api/sessions/${s.id}/exercises`, { exerciseId: lib["Back Squat"].id })).sessionExercise;
  assert.equal((await c.put(`/api/sessions/${s.id}/exercises/${squatSe.id}/machine`, { gymEquipmentId: press.id })).status, 409, "a chest press machine for squats");
  assert.equal((await c.post(`/api/sessions/${s.id}/exercises/${squatSe.id}/substitute`, { exerciseId: lib["Push-Up"].id, gymEquipmentId: press.id })).status, 409, "nor for a swap to push-ups");
  ok(await c.put(`/api/sessions/${s.id}/exercises/${pressSe.id}/machine`, { gymEquipmentId: press.id }));
  assert.equal((await c.put(`/api/sessions/${s.id}/gym`, { gymLocationId: b.id })).status, 409, "an exercise is on a machine at A");
  assert.equal((await prisma.workoutSession.findUnique({ where: { id: s.id } })).gymLocationId, a.id);
  ok(await c.put(`/api/sessions/${s.id}/gym`, { gymLocationId: a.id }), "choosing the same gym again is fine");
  ok(await c.put(`/api/sessions/${s.id}/exercises/${pressSe.id}/machine`, { gymEquipmentId: null }));
  ok(await c.put(`/api/sessions/${s.id}/gym`, { gymLocationId: b.id }), "with the machine cleared, the gym can change");
  // A gym change and a machine choice at the same moment: never a machine from a gym the workout isn't at.
  ok(await c.put(`/api/sessions/${s.id}/gym`, { gymLocationId: a.id }));
  await Promise.all([c.put(`/api/sessions/${s.id}/gym`, { gymLocationId: b.id }), c.put(`/api/sessions/${s.id}/exercises/${pressSe.id}/machine`, { gymEquipmentId: press.id })]);
  const after_ = await prisma.workoutSession.findUnique({ where: { id: s.id }, include: { exercises: { include: { machine: true } } } });
  for (const e of after_.exercises) if (e.machine) assert.equal(e.machine.gymId, after_.gymLocationId, "the machine is at the workout's gym");
});

test("removing a machine while it's being chosen: no workout is left on a removed machine, and no 500", async () => {
  const { c } = await newUser("machine-race");
  const { gym } = await gymWith(c, "Race gym");
  const s = await start(c, { name: "W", gymLocationId: gym.id });
  const outcomes = new Set();
  for (let i = 0; i < 12; i++) {
    const { machine } = ok(await c.post(`/api/gyms/${gym.id}/equipment`, { kind: "MACHINE", name: `Press ${i}` }));
    const se = ok(await c.post(`/api/sessions/${s.id}/exercises`, { exerciseId: lib["Machine Chest Press"].id })).sessionExercise;
    const put = () => c.put(`/api/sessions/${s.id}/exercises/${se.id}/machine`, { gymEquipmentId: machine.id });
    const del = () => c.del(`/api/gyms/${gym.id}/machines/${machine.id}`);
    // Alternate which request is sent first, so both orders are exercised.
    let assign, remove;
    if (i % 2) [assign, remove] = await Promise.all([put(), del()]);
    else [remove, assign] = await Promise.all([del(), put()]);
    const exists = await prisma.gymEquipment.findUnique({ where: { id: machine.id } });
    const row = await prisma.sessionExercise.findUnique({ where: { id: se.id } });
    if (exists) assert.deepEqual([assign.status, remove.status, row.gymEquipmentId], [200, 409, machine.id], `${i}: chosen first, so it's kept with the workout`);
    else assert.deepEqual([remove.status, assign.status, row.gymEquipmentId], [200, 404, null], `${i}: removed first, so it can't be chosen`);
    outcomes.add(exists ? "kept" : "removed");
  }
  // A machine with a finished workout's sets on it is never removed.
  const { machine: used } = ok(await c.post(`/api/gyms/${gym.id}/equipment`, { kind: "MACHINE", name: "Used" }));
  const se = ok(await c.post(`/api/sessions/${s.id}/exercises`, { exerciseId: lib["Machine Chest Press"].id })).sessionExercise;
  ok(await c.put(`/api/sessions/${s.id}/exercises/${se.id}/machine`, { gymEquipmentId: used.id }));
  ok(await logSet(c, s.id, se.id, 8, 40));
  ok(await finish(c, s.id));
  const removals = await Promise.all(Array.from({ length: 4 }, () => c.del(`/api/gyms/${gym.id}/machines/${used.id}`)));
  assert.deepEqual(removals.map((r) => r.status), [409, 409, 409, 409]);
  const kept = await prisma.sessionExercise.findUnique({ where: { id: se.id }, include: { sets: true } });
  assert.deepEqual([kept.gymEquipmentId, kept.sets.length], [used.id, 1], "the finished workout keeps its machine and set");
  console.log(`# machine race outcomes: ${[...outcomes].join(", ")}`);
});

test("a swap retried with updatePlan makes the plan change it asked for; a retry without it never undoes one", async () => {
  const { user, c } = await newUser("retry-plan");
  const plan = await planFor(user.id, [lib["Barbell Bench Press"], lib["Back Squat"]]);
  const s = await start(c, { templateId: plan.id });
  const [bench] = await exercisesOf(s.id);
  const entry = () => prisma.templateExercise.findFirst({ where: { templateId: plan.id, position: 0 } });
  const swap = (body) => c.post(`/api/sessions/${s.id}/exercises/${bench.id}/substitute`, { exerciseId: lib["Dumbbell Bench Press"].id, ...body });
  const first = ok(await swap({}));
  assert.equal(first.planUpdated, false);
  assert.equal((await entry()).exerciseId, lib["Barbell Bench Press"].id);
  const retries = await Promise.all([swap({ updatePlan: true }), swap({ updatePlan: true })]);
  for (const r of retries) {
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.sessionExercise.id, first.sessionExercise.id, "still the one swap");
    assert.equal(r.body.planUpdated, true, "the plan update asked for in the retry is made, not dropped");
  }
  assert.equal((await entry()).exerciseId, lib["Dumbbell Bench Press"].id);
  const again = ok(await swap({ updatePlan: false }));
  assert.equal(again.planUpdated, true, "reports the plan as it is");
  assert.equal((await entry()).exerciseId, lib["Dumbbell Bench Press"].id, "a retry without updatePlan doesn't undo it");
  assert.equal(await prisma.sessionExercise.count({ where: { substitutesId: bench.id } }), 1);
  assert.equal((await prisma.templateExercise.findFirst({ where: { templateId: plan.id, position: 1 } })).exerciseId, lib["Back Squat"].id, "no other entry changed");
});

test("updatePlan that can't be done refuses the whole swap, with the reason: no plan, an added exercise, an edited plan", async () => {
  const { user, c } = await newUser("plan-refused");
  const noPlan = await start(c, { name: "Free" });
  const free = ok(await c.post(`/api/sessions/${noPlan.id}/exercises`, { exerciseId: lib["Barbell Bench Press"].id })).sessionExercise;
  const r1 = await c.post(`/api/sessions/${noPlan.id}/exercises/${free.id}/substitute`, { exerciseId: lib["Push-Up"].id, updatePlan: true });
  assert.equal(r1.status, 409, r1.text);
  assert.match(r1.body.error, /didn't come from a plan.*Nothing was swapped/);
  assert.equal(await prisma.sessionExercise.count({ where: { sessionId: noPlan.id } }), 1, "nothing swapped");
  assert.equal((await c.del(`/api/sessions/${noPlan.id}`)).status, 200);

  const plan = await planFor(user.id, [lib["Barbell Bench Press"]]);
  const s = await start(c, { templateId: plan.id });
  const [fromPlan] = await exercisesOf(s.id);
  const added = ok(await c.post(`/api/sessions/${s.id}/exercises`, { exerciseId: lib["Barbell Bench Press"].id })).sessionExercise;
  const r2 = await c.post(`/api/sessions/${s.id}/exercises/${added.id}/substitute`, { exerciseId: lib["Push-Up"].id, updatePlan: true });
  assert.equal(r2.status, 409, "added during the workout, so not in the plan, even though the plan has the same exercise");
  // The plan is saved again, so its entries are new rows and this workout's link to its entry is gone.
  const saved = await c.call("PUT", `/api/templates/${plan.id}`, { name: "Edited", notes: null, exercises: [{ exerciseId: lib["Barbell Bench Press"].id, targetSets: 3, targetRepsMin: 5, targetRepsMax: 8, targetWeightKg: null, restSeconds: null, notes: null }] });
  assert.equal(saved.status, 200, saved.text);
  const r3 = await c.post(`/api/sessions/${s.id}/exercises/${fromPlan.id}/substitute`, { exerciseId: lib["Push-Up"].id, updatePlan: true });
  assert.equal(r3.status, 409);
  assert.match(r3.body.error, /isn't in the plan as it is now/);
  assert.equal(await prisma.sessionExercise.count({ where: { substitutesId: { in: [added.id, fromPlan.id] } } }), 0, "nothing swapped");
  assert.deepEqual((await prisma.templateExercise.findMany({ where: { templateId: plan.id } })).map((e) => e.exerciseId), [lib["Barbell Bench Press"].id], "the plan is as saved");
  ok(await c.post(`/api/sessions/${s.id}/exercises/${fromPlan.id}/substitute`, { exerciseId: lib["Push-Up"].id }), "without updatePlan, the swap works");
});

test("a plan with the same exercise twice: the swap changes only the entry its row came from, also when repeating a workout", async () => {
  const { user, c } = await newUser("dup-entry");
  const plan = await planFor(user.id, [lib["Barbell Bench Press"], lib["Back Squat"], lib["Barbell Bench Press"]]);
  const entries = async () => (await prisma.templateExercise.findMany({ where: { templateId: plan.id }, orderBy: { position: "asc" } })).map((e) => e.exerciseId);
  const s = await start(c, { templateId: plan.id });
  const rows = await exercisesOf(s.id);
  assert.deepEqual(rows.map((r) => r.templateExerciseId), plan.exercises.map((e) => e.id), "each row knows its entry");
  const second = rows[2];
  ok(await logSet(c, s.id, second.id, 5, 60));
  const r = ok(await c.post(`/api/sessions/${s.id}/exercises/${second.id}/substitute`, { exerciseId: lib["Machine Chest Press"].id, updatePlan: true }));
  assert.equal(r.planUpdated, true);
  assert.deepEqual(await entries(), [lib["Barbell Bench Press"].id, lib["Back Squat"].id, lib["Machine Chest Press"].id], "the second bench entry, not the first");
  ok(await logSet(c, s.id, r.sessionExercise.id, 8, 50));
  ok(await logSet(c, s.id, rows[0].id, 5, 60));
  ok(await finish(c, s.id));
  // Repeating that workout: its rows keep their entries, so a swap there changes the right one too.
  const again = await start(c, { fromSessionId: s.id });
  const copied = await exercisesOf(again.id);
  const firstBench = copied.find((x) => x.exerciseId === lib["Barbell Bench Press"].id && x.templateExerciseId === plan.exercises[0].id);
  assert.ok(firstBench, "the repeated row still names the first entry");
  ok(await c.post(`/api/sessions/${again.id}/exercises/${firstBench.id}/substitute`, { exerciseId: lib["Dumbbell Bench Press"].id, updatePlan: true }));
  assert.deepEqual(await entries(), [lib["Dumbbell Bench Press"].id, lib["Back Squat"].id, lib["Machine Chest Press"].id]);
});

test("gym and machine names: one per person whatever the case, accent encoding, spacing or invisible characters, even at once", async () => {
  const { user, c } = await newUser("names");
  const variants = ["Café", "CAFÉ", "Cafe\u0301", "  café  ", "café\u200B", "Ca\u202Efé"];
  const made = await Promise.all(variants.map((name) => c.post("/api/gyms", { name })));
  assert.equal(made.filter((r) => r.status === 200).length, 1, made.map((r) => `${r.status}`).join(","));
  assert.ok(made.every((r) => r.status === 200 || r.status === 409));
  const stored = (await prisma.gymLocation.findMany({ where: { userId: user.id } })).map((g) => g.name);
  assert.equal(stored.length, 1);
  assert.match(stored[0], /^(Café|CAFÉ|café)$/u, `stored clean and composed: ${JSON.stringify(stored[0])}`);
  assert.equal((await c.post("/api/gyms", { name: "Straße" })).status, 200);
  assert.equal((await c.post("/api/gyms", { name: "STRASSE" })).status, 409, "case folding, not just lower-casing");
  const { gym: other } = ok(await c.post("/api/gyms", { name: "Other" }));
  assert.equal((await c.patch(`/api/gyms/${other.id}`, { name: "cafe\u0301" })).status, 409, "renaming onto another's name");
  const both = await Promise.all([c.patch(`/api/gyms/${other.id}`, { name: "Twin" }), c.post("/api/gyms", { name: "TWIN" })]);
  assert.equal(both.filter((r) => r.status === 200).length, 1, "a rename and a create of the same name at once: one wins");
  assert.equal((await c.post("/api/gyms", { name: "\u200B\u202E " })).status, 400, "only invisible characters is no name");
  const { gym } = ok(await c.post("/api/gyms", { name: "Machines" }));
  ok(await c.post(`/api/gyms/${gym.id}/equipment`, { kind: "MACHINE", name: "Leg Press" }));
  assert.equal((await c.post(`/api/gyms/${gym.id}/equipment`, { kind: "MACHINE", name: "LEG  PRESS\u200B" })).status, 409);
  const someoneElse = await newUser("names-other");
  assert.equal((await someoneElse.c.post("/api/gyms", { name: "café" })).status, 200, "another person may use the same name");
});

test("machine removal and choice, in each order, forced: the one holding the machine first wins, the other gets a clear answer", async () => {
  const { c } = await newUser("machine-order");
  const { gym } = await gymWith(c, "Order gym");
  const s = await start(c, { name: "W", gymLocationId: gym.id });
  const setup = async (name) => {
    const { machine } = ok(await c.post(`/api/gyms/${gym.id}/equipment`, { kind: "MACHINE", name }));
    const se = ok(await c.post(`/api/sessions/${s.id}/exercises`, { exerciseId: lib["Machine Chest Press"].id })).sessionExercise;
    return { machine, se };
  };
  const held = (work) => { let release; const done = new Promise((r) => { release = r; }); const tx = prisma.$transaction(async (t) => { await work(t); await done; }, { timeout: 20_000 }); return { tx, release }; };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  // An assignment in progress holds the machine for share, as the app's own does; a removal sent now waits, then sees it.
  const a = await setup("Held by a choice");
  const choice = held(async (t) => {
    await t.$queryRaw`SELECT id FROM "GymEquipment" WHERE id = ${a.machine.id} FOR SHARE`;
    await t.sessionExercise.update({ where: { id: a.se.id }, data: { gymEquipmentId: a.machine.id } });
  });
  await pause(300);
  const removal = c.del(`/api/gyms/${gym.id}/machines/${a.machine.id}`);
  await pause(500);
  choice.release();
  await choice.tx;
  const removed = await removal;
  assert.equal(removed.status, 409, removed.text);
  assert.match(removed.body.error, /used in a workout, so it's kept/);
  assert.ok(await prisma.gymEquipment.findUnique({ where: { id: a.machine.id } }), "the machine is kept");

  // A removal in progress holds the machine for update; a choice sent now waits, then finds it gone.
  const b = await setup("Held by a removal");
  const removing = held(async (t) => {
    await t.$queryRaw`SELECT id FROM "GymEquipment" WHERE id = ${b.machine.id} FOR UPDATE`;
    await t.gymEquipment.delete({ where: { id: b.machine.id } });
  });
  await pause(300);
  const chosen = c.put(`/api/sessions/${s.id}/exercises/${b.se.id}/machine`, { gymEquipmentId: b.machine.id });
  await pause(500);
  removing.release();
  await removing.tx;
  const answer = await chosen;
  assert.equal(answer.status, 404, answer.text);
  assert.equal((await prisma.sessionExercise.findUnique({ where: { id: b.se.id } })).gymEquipmentId, null, "no workout points at a removed machine");
  // And a swap onto a machine being removed: the same.
  const d = await setup("Held for a swap");
  const removing2 = held(async (t) => {
    await t.$queryRaw`SELECT id FROM "GymEquipment" WHERE id = ${d.machine.id} FOR UPDATE`;
    await t.gymEquipment.delete({ where: { id: d.machine.id } });
  });
  await pause(300);
  const swapped = c.post(`/api/sessions/${s.id}/exercises/${d.se.id}/substitute`, { exerciseId: lib["Dumbbell Bench Press"].id, gymEquipmentId: d.machine.id });
  await pause(500);
  removing2.release();
  await removing2.tx;
  assert.equal((await swapped).status, 404);
  assert.equal(await prisma.sessionExercise.count({ where: { substitutesId: d.se.id } }), 0, "nothing swapped");
});

test("a swap and a plan save at the same moment, and a gym rename against machine changes: never a 500, always consistent", async () => {
  const { user, c } = await newUser("deadlocks");
  const plan = await planFor(user.id, [lib["Barbell Bench Press"], lib["Back Squat"], lib["Push-Up"]]);
  const body = { name: "Saved again", notes: null, exercises: [lib["Barbell Bench Press"], lib["Back Squat"], lib["Push-Up"]].map((e) => ({ exerciseId: e.id, targetSets: 3, targetRepsMin: 5, targetRepsMax: 8, targetWeightKg: null, restSeconds: null, notes: null })) };
  const statuses = [];
  for (let i = 0; i < 8; i++) {
    const s = await start(c, { templateId: plan.id });
    const [bench] = await exercisesOf(s.id);
    const [swap, save] = await Promise.all([
      c.post(`/api/sessions/${s.id}/exercises/${bench.id}/substitute`, { exerciseId: lib["Dumbbell Bench Press"].id }),
      c.call("PUT", `/api/templates/${plan.id}`, body),
    ]);
    statuses.push(`${swap.status}/${save.status}`);
    assert.ok([200, 503].includes(swap.status), `swap ${swap.status} ${swap.text}`);
    assert.ok([200, 503].includes(save.status), `save ${save.status} ${save.text}`);
    const rows = await exercisesOf(s.id);
    const replacement = rows.find((r) => r.substitutesId === bench.id);
    assert.equal(Boolean(replacement), swap.status === 200, "a swap answered 200 exists, one answered 503 doesn't");
    if (replacement) {
      const entry = replacement.templateExerciseId && await prisma.templateExercise.findUnique({ where: { id: replacement.templateExerciseId } });
      assert.ok(!replacement.templateExerciseId || entry, "a replacement never links to an entry that's gone");
    }
    assert.equal((await prisma.templateExercise.count({ where: { templateId: plan.id } })), 3, "the plan has its three entries");
    assert.equal((await c.call("DELETE", `/api/sessions/${s.id}`)).status, 200);
  }
  const { gym } = ok(await c.post("/api/gyms", { name: "Lock order" }));
  for (let i = 0; i < 8; i++) {
    const answers = await Promise.all([
      c.patch(`/api/gyms/${gym.id}`, { name: `Lock order ${i}` }),
      c.post(`/api/gyms/${gym.id}/equipment`, { kind: "MACHINE", name: `M${i}` }),
      c.put(`/api/gyms/${gym.id}/equipment`, { kinds: i % 2 ? ["BARBELL"] : ["DUMBBELL", "CABLE"] }),
    ]);
    for (const a of answers) assert.ok([200, 503].includes(a.status), `${a.status} ${a.text}`);
  }
  console.log(`# swap/save statuses: ${statuses.join(" ")}`);
});

test("a retry asking for a plan update that can't be made says the earlier swap stays", async () => {
  const { user, c } = await newUser("retry-refused");
  const plan = await planFor(user.id, [lib["Barbell Bench Press"]]);
  const s = await start(c, { templateId: plan.id });
  const [bench] = await exercisesOf(s.id);
  ok(await c.post(`/api/sessions/${s.id}/exercises/${bench.id}/substitute`, { exerciseId: lib["Push-Up"].id }));
  // The plan is saved again, so the row's link to its entry is gone.
  assert.equal((await c.call("PUT", `/api/templates/${plan.id}`, { name: "P", notes: null, exercises: [{ exerciseId: lib["Barbell Bench Press"].id, targetSets: 3, targetRepsMin: 5, targetRepsMax: 8, targetWeightKg: null, restSeconds: null, notes: null }] })).status, 200);
  const r = await c.post(`/api/sessions/${s.id}/exercises/${bench.id}/substitute`, { exerciseId: lib["Push-Up"].id, updatePlan: true });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /The swap you made earlier stays; the plan wasn't changed/);
  assert.doesNotMatch(r.body.error, /Nothing was swapped/);
  assert.equal(await prisma.sessionExercise.count({ where: { substitutesId: bench.id } }), 1, "and it does stay");
});
