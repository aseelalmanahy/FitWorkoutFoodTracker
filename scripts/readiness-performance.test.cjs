// Phase 4.0.6: how long the heaviest reads take for one person with about a year of use, on a local production build.
// It records times, and sets no limit, as none has been decided. It says nothing about a deployed server, real networks
// or more than one person at a time. Run through scripts/run-guarded-suites.cjs. The user is removed by this run's address.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const ORIGIN = new URL(BASE).origin;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
const EMAIL = `perfx${run}@test.dev`;
const PASSWORD = "correct horse battery staple";
const DAYS = 365, ENTRIES_A_DAY = 6, SESSIONS = 150, EXERCISES = 5, SETS = 4;
let cookie, userId;

const dayAgo = (n) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - n));

before(async () => {
  await target.verifyServer();
  const { user, token } = await createSignedInUser(prisma, EMAIL, { password: PASSWORD });
  userId = user.id;
  cookie = `fit_session=${token}`;
  await prisma.profile.create({ data: { userId, name: "Perf", birthDate: new Date("1990-01-01T00:00:00Z"), unitSystem: "METRIC", timezone: "UTC" } });
  await prisma.nutritionTarget.create({ data: { userId, effectiveFrom: dayAgo(DAYS), source: "MANUAL", kcal: 2000, proteinG: 150, carbsG: 215, fatG: 60 } });
  const meals = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"];
  const entries = [];
  for (let d = 0; d < DAYS; d++) for (let e = 0; e < ENTRIES_A_DAY; e++) {
    entries.push({ userId, date: dayAgo(d), mealType: meals[e % 4], foodName: `Food ${e}`, basisUnit: "G", servingLabel: "g", servingAmount: "1", quantity: "100", kcal: "300", protein: "20", carbs: "30", fat: "10", fiber: "2" });
  }
  await prisma.foodEntry.createMany({ data: entries });
  const exercises = [];
  for (let e = 0; e < EXERCISES; e++) exercises.push(await prisma.exercise.create({ data: { userId, name: `Exercise ${e} ${run}`, primaryMuscle: "BACK", equipment: "CABLE" } }));
  for (let s = 0; s < SESSIONS; s++) {
    const when = dayAgo(s * 2);
    await prisma.workoutSession.create({ data: {
      userId, name: `Session ${s}`, status: "COMPLETED", startedAt: when, endedAt: new Date(when.getTime() + 3_600_000),
      exercises: { create: exercises.map((ex, position) => ({ exerciseId: ex.id, position, sets: { create: Array.from({ length: SETS }, (_, i) => ({ setNumber: i + 1, reps: 8, weightKg: 40 + (SESSIONS - s) * 0.25 })) } })) },
    } });
  }
});

after(async () => {
  // By this run's own address. An undefined id in a filter means no filter to Prisma, so setup failing mustn't reach one.
  const ids = (await prisma.user.findMany({ where: { email: EMAIL }, select: { id: true } })).map((u) => u.id);
  await prisma.foodEntry.deleteMany({ where: { userId: { in: ids } } });
  await prisma.nutritionTarget.deleteMany({ where: { userId: { in: ids } } });
  await prisma.workoutSession.deleteMany({ where: { userId: { in: ids } } });
  await prisma.exercise.deleteMany({ where: { userId: { in: ids } } });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.profile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

async function timed(method, path, body) {
  const times = [];
  let status, size;
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    const res = await fetch(BASE + path, { method, redirect: "manual", headers: { Cookie: cookie, Origin: ORIGIN, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    times.push(performance.now() - start);
    status = res.status;
    size = text.length;
  }
  times.sort((a, b) => a - b);
  console.log(`PERF ${method.padEnd(4)} ${path.padEnd(42)} median ${times[2].toFixed(0).padStart(5)} ms  slowest ${times[4].toFixed(0).padStart(5)} ms  ${(size / 1024).toFixed(0).padStart(6)} KB`);
  return status;
}

test(`one person with ${DAYS} days of food and ${SESSIONS} workouts: each read succeeds, and its time is recorded`, async () => {
  const end = new Date().toISOString().slice(0, 10);
  console.log(`PERF seeded ${DAYS * ENTRIES_A_DAY} food entries and ${SESSIONS * EXERCISES * SETS} sets`);
  for (const path of ["/dashboard", "/progress", "/workouts", "/workouts/history", "/nutrition", "/nutrition/history", `/api/nutrition/day?date=${end}`, `/api/nutrition/history?end=${end}&days=84`]) {
    assert.equal(await timed("GET", path), 200, path);
  }
  assert.equal(await timed("POST", "/api/account/export", { password: PASSWORD }), 200, "export");
});
