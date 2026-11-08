// Phase 4.0.2 against the real database: deleting and exporting an account. Identity comes from the session,
// so every test here also proves nothing is reachable by naming someone else.
//   BASE_URL=http://localhost:3000 DATABASE_URL=<local test database> node --test scripts/account-data.test.cjs
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser, addSession } = require("./lib/test-users.cjs");
const dataMap = require("../src/lib/account-data-map.json");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();
const { signUpWithApi } = require("./lib/signup.cjs");

const BASE = target.baseUrl;
const ORIGIN = new URL(BASE).origin;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
let counter = 0;

const PASSWORD = "correct horse battery staple";
const dbDate = (iso) => new Date(`${iso}T00:00:00Z`);
const yearsAgo = (n) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - n); return d.toISOString().slice(0, 10); };
const CONFIRM = { password: PASSWORD, confirmation: "DELETE" };

function client(token) {
  const cookie = token ? `fit_session=${token}` : "";
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(BASE + path, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, body: json, text, headers: res.headers };
  };
  return { call, get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), remove: (b = CONFIRM) => call("POST", "/api/account/delete", b), exportData: (b = { password: PASSWORD }) => call("POST", "/api/account/export", b) };
}
async function newUser(label) {
  const tag = `${label}${++counter}x${run}`;
  const email = `acct${tag}@test.dev`;
  const { user, token } = await createSignedInUser(prisma, email, { password: PASSWORD });
  return { c: client(token), user, token, email, tag };
}
const legacyProfile = (tag, over = {}) => ({ name: `Name ${tag}`, birthDate: dbDate("1990-01-01"), sex: "FEMALE", heightCm: 170.33, currentWeightKg: 60.125, goalWeightKg: 55.5, goal: "MAINTENANCE", activityLevel: "LIGHT", experience: "BEGINNER", workoutDaysPerWeek: 0, unitSystem: "METRIC", timezone: "Asia/Dubai", calorieTargetOverride: 1800, ...over });

let builtIn, sharedFood;
before(async () => {
  await target.verifyServer();
  builtIn = await prisma.exercise.findFirst({ where: { userId: null } });
  if (!builtIn) builtIn = await prisma.exercise.create({ data: { name: `Built-in ${run}`, primaryMuscle: "CHEST", equipment: "BARBELL" } });
  sharedFood = await prisma.food.create({
    data: { source: "USDA", sourceId: `acct-shared-${run}`, name: `Shared food ${run}`, dataType: "Foundation", origin: "api.nal.usda.gov", kcalPer100: "100.5", fetchedAt: new Date(), servings: { create: { label: "100 g", amount: "100", isDefault: true } } },
    include: { servings: true },
  });
});
after(async () => {
  // Links seeded for people this run left in place. Nothing else removes a sign-up link until it expires.
  await prisma.accountToken.deleteMany({ where: { email: { endsWith: `x${run}@test.dev` } } });
  await prisma.$disconnect();
});

/** One row in every model the person can own, with their tag in every text field that takes one. */
async function seed({ user, tag }) {
  const id = user.id;
  await prisma.profile.create({ data: { userId: id, ...legacyProfile(tag) } });
  const custom = (name) => prisma.exercise.create({ data: { userId: id, name: `${name} ${tag}`, primaryMuscle: "BACK", equipment: "CABLE" } });
  const unused = await custom("Unused"), inPlan = await custom("Plan"), inSession = await custom("Session"), inBoth = await custom("Both"), inProgress = await custom("InProgress");
  const template = await prisma.workoutTemplate.create({
    data: { userId: id, name: `Plan ${tag}`, notes: `Plan notes ${tag}`, exercises: { create: [
      { exerciseId: inPlan.id, position: 0, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetWeightKg: 40.5, restSeconds: 90, notes: `TE notes ${tag}` },
      { exerciseId: inBoth.id, position: 1, targetSets: 2, targetRepsMin: 5, targetRepsMax: 5 },
      { exerciseId: builtIn.id, position: 2, targetSets: 2, targetRepsMin: 5, targetRepsMax: 5 },
    ] } },
    include: { exercises: true },
  });
  const slot = await prisma.scheduleSlot.create({ data: { userId: id, weekday: 2, templateId: template.id, position: 1 } });
  const done = await prisma.workoutSession.create({
    data: { userId: id, templateId: template.id, name: `Done ${tag}`, status: "COMPLETED", startedAt: new Date("2026-01-05T10:00:00Z"), endedAt: new Date("2026-01-05T11:00:00Z"), notes: `Session notes ${tag}`, exercises: { create: [
      { exerciseId: inSession.id, position: 0, restSeconds: 60, notes: `SE notes ${tag}`, sets: { create: [
        { setNumber: 1, reps: 10, weightKg: 20, isWarmup: true },
        { setNumber: 2, reps: 8, weightKg: 62.5, rpe: 8.5 },
      ] } },
      { exerciseId: inBoth.id, position: 1, sets: { create: { setNumber: 1, reps: 5, weightKg: 0 } } },
      { exerciseId: builtIn.id, position: 2, sets: { create: { setNumber: 1, reps: 5, weightKg: 30 } } },
    ] } },
  });
  const open = await prisma.workoutSession.create({ data: { userId: id, name: `Open ${tag}`, exercises: { create: { exerciseId: inProgress.id, position: 0, sets: { create: { setNumber: 1, reps: 3, weightKg: 12 } } } } } });
  const food = await prisma.food.create({
    data: { source: "CUSTOM", sourceId: `custom-${tag}`, userId: id, name: `Custom food ${tag}`, brand: `Brand ${tag}`, barcode: `bar${tag}`, dataType: "Custom", basisUnit: "ML", kcalPer100: "50.125", proteinPer100: "0", carbsPer100: "1.5", fatPer100: "2.5", fiberPer100: "0.5", fetchedAt: new Date("2026-01-01T00:00:00Z"), origin: `origin ${tag}`, servings: { create: { label: `Glass ${tag}`, amount: "250", isDefault: true, position: 3 } } },
    include: { servings: true },
  });
  const entry = (over) => ({ userId: id, date: dbDate("2026-01-05"), mealType: "LUNCH", foodName: `Entry ${tag}`, basisUnit: "G", servingLabel: `Serving ${tag}`, servingAmount: "100", quantity: "1.5", ...over });
  await prisma.foodEntry.create({ data: entry({ foodId: food.id, brand: `EBrand ${tag}`, basisUnit: "ML", kcalPer100: "50.125", proteinPer100: "0", carbsPer100: "1.5", fatPer100: "2.5", fiberPer100: "0.5", kcal: "75.19", protein: "0", carbs: "2.25", fat: "3.75", fiber: "0.75" }) });
  await prisma.foodEntry.create({ data: entry({ foodId: sharedFood.id, foodName: `Shared entry ${tag}`, kcalPer100: "100.5", kcal: "150.75" }) });
  await prisma.foodEntry.create({ data: entry({ foodName: `No food ${tag}`, mealType: "SNACK" }) }); // every nutrient null, and no food
  const target = (date, over) => prisma.nutritionTarget.create({ data: { userId: id, effectiveFrom: dbDate(date), source: "MANUAL", kcal: 2000, proteinG: 150, carbsG: 215, fatG: 60, ...over } });
  await target("2026-01-01", {});
  await target("2026-01-02", { source: "SUGGESTED", proteinG: 0, carbsG: 500, fatG: 0 });
  await target("2026-01-03", { proteinG: null, carbsG: null, fatG: null });
  await target("2026-01-04", { kcal: null, proteinG: null, carbsG: null, fatG: null });
  await addSession(prisma, id);
  await prisma.bodyMetric.create({ data: { userId: id, date: dbDate("2026-01-01"), value: 70.5 } });
  await prisma.feedback.create({ data: { userId: id, category: "BUG", description: `Feedback ${tag}`, route: "/dashboard", status: "TRIAGED", severity: "LOW", decisionNote: `Note ${tag}` } });
  // A pending reset link, and a sign-up link for the same address, which only the address ties to this person.
  const later = new Date(Date.now() + 3_600_000);
  const tokenId = () => require("node:crypto").randomBytes(32).toString("hex");
  await prisma.accountToken.create({ data: { id: tokenId(), purpose: "PASSWORD_RESET", email: user.email, userId: id, expiresAt: later } });
  await prisma.accountToken.create({ data: { id: tokenId(), purpose: "SIGNUP", email: user.email, expiresAt: later } });
  return { unused, inPlan, inSession, inBoth, inProgress, template, slot, done, open, food };
}

/** Everything that belongs to this person, by model, through every relation. Each list must be non-empty after seeding. */
async function ownedIds(id) {
  const ids = async (delegate, where) => (await delegate.findMany({ where, select: { id: true } })).map((r) => r.id);
  const email = (await prisma.user.findUnique({ where: { id }, select: { email: true } }))?.email;
  return {
    User: [id],
    Session: await ids(prisma.session, { userId: id }),
    AccountToken: await ids(prisma.accountToken, { OR: [{ userId: id }, ...(email ? [{ email }] : [])] }),
    Profile: (await prisma.profile.findMany({ where: { userId: id }, select: { userId: true } })).map((r) => r.userId),
    Exercise: await ids(prisma.exercise, { userId: id }),
    WorkoutTemplate: await ids(prisma.workoutTemplate, { userId: id }),
    TemplateExercise: await ids(prisma.templateExercise, { template: { userId: id } }),
    ScheduleSlot: await ids(prisma.scheduleSlot, { userId: id }),
    WorkoutSession: await ids(prisma.workoutSession, { userId: id }),
    SessionExercise: await ids(prisma.sessionExercise, { session: { userId: id } }),
    SetEntry: await ids(prisma.setEntry, { sessionExercise: { session: { userId: id } } }),
    Food: await ids(prisma.food, { userId: id }),
    FoodServing: await ids(prisma.foodServing, { food: { userId: id } }),
    FoodEntry: await ids(prisma.foodEntry, { userId: id }),
    NutritionTarget: await ids(prisma.nutritionTarget, { userId: id }),
    BodyMetric: await ids(prisma.bodyMetric, { userId: id }),
    Feedback: await ids(prisma.feedback, { userId: id }),
  };
}
const ID_FIELD = { Profile: "userId" };
const delegateOf = (model) => prisma[model[0].toLowerCase() + model.slice(1)];
async function remaining(owned) {
  const out = {};
  for (const [model, ids] of Object.entries(owned)) out[model] = await delegateOf(model).count({ where: { [ID_FIELD[model] ?? "id"]: { in: ids } } });
  return out;
}
/** Every row of every table that mentions this text, found from the database's own catalog, so a new table is covered. */
async function scanAllTables(needle) {
  const tables = await prisma.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`);
  assert.ok(tables.length >= 14, "found the tables");
  const hits = {};
  for (const { table_name } of tables) {
    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${table_name}" t WHERE t::text LIKE $1`, `%${needle}%`);
    if (n) hits[table_name] = n;
  }
  return hits;
}
/** A person's rows in full, for proving nothing changed. */
async function dump(id) {
  const owned = await ownedIds(id);
  const out = {};
  for (const [model, ids] of Object.entries(owned)) out[model] = await delegateOf(model).findMany({ where: { [ID_FIELD[model] ?? "id"]: { in: ids } }, orderBy: { [ID_FIELD[model] ?? "id"]: "asc" } });
  return JSON.stringify(out);
}
const shared = async () => JSON.stringify({
  exercises: await prisma.exercise.findMany({ where: { userId: null }, orderBy: { id: "asc" } }),
  food: await prisma.food.findUnique({ where: { id: sharedFood.id }, include: { servings: true } }),
});

// ─── Deletion ───────────────────────────────────────────────────────────────

test("what a plain cascade does, which is why deletion doesn't rely on it", async () => {
  const u = await newUser("plain");
  const exercise = await prisma.exercise.create({ data: { userId: u.user.id, name: `Plain ${u.tag}`, primaryMuscle: "BACK", equipment: "CABLE" } });
  await prisma.workoutSession.create({ data: { userId: u.user.id, name: "S", exercises: { create: { exerciseId: exercise.id, position: 0 } } } });
  await assert.rejects(prisma.user.delete({ where: { id: u.user.id } }), (e) => e.code === "P2003" || /foreign key/i.test(e.message), "RESTRICT stops it");
  assert.equal(await prisma.user.count({ where: { id: u.user.id } }), 1, "nothing was removed");
  assert.equal((await u.c.remove()).status, 200, "the ordered deletion succeeds");
  assert.equal(await prisma.user.count({ where: { id: u.user.id } }), 0);
});

test("deletion removes every row the person owns, in every model, and leaves others alone", async () => {
  const a = await newUser("full"), b = await newUser("control");
  await seed(a);
  await seed(b);
  const owned = await ownedIds(a.user.id);
  assert.deepEqual(Object.keys(owned).sort(), Object.keys(dataMap).sort(), "every model in the map is checked");
  for (const [model, ids] of Object.entries(owned)) assert.ok(ids.length > 0, `${model} was seeded`);
  const controlBefore = await dump(b.user.id), sharedBefore = await shared();

  const r = await a.c.remove();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true }, "a neutral answer");

  for (const [model, n] of Object.entries(await remaining(owned))) assert.equal(n, 0, `${model} rows gone`);
  assert.deepEqual(await scanAllTables(a.user.id), {}, "the user's id appears in no table");
  assert.deepEqual(await scanAllTables(a.tag), {}, "their text appears in no table");
  assert.deepEqual(await scanAllTables(a.email), {}, "their email appears in no table");
  assert.equal(await dump(b.user.id), controlBefore, "the control user is unchanged in every column");
  assert.equal(await shared(), sharedBefore, "built-in exercises and the shared food are unchanged");
});

for (const [label, build] of [
  ["unused", async (id, tag) => prisma.exercise.create({ data: { userId: id, name: `E ${tag}`, primaryMuscle: "BACK", equipment: "CABLE" } })],
  ["in a plan", async (id, tag) => { const e = await prisma.exercise.create({ data: { userId: id, name: `E ${tag}`, primaryMuscle: "BACK", equipment: "CABLE" } }); await prisma.workoutTemplate.create({ data: { userId: id, name: "T", exercises: { create: { exerciseId: e.id, position: 0, targetSets: 1, targetRepsMin: 1, targetRepsMax: 1 } } } }); }],
  ["in a session", async (id, tag) => { const e = await prisma.exercise.create({ data: { userId: id, name: `E ${tag}`, primaryMuscle: "BACK", equipment: "CABLE" } }); await prisma.workoutSession.create({ data: { userId: id, name: "S", status: "COMPLETED", exercises: { create: { exerciseId: e.id, position: 0 } } } }); }],
  ["in both", async (id, tag) => { const e = await prisma.exercise.create({ data: { userId: id, name: `E ${tag}`, primaryMuscle: "BACK", equipment: "CABLE" } }); await prisma.workoutTemplate.create({ data: { userId: id, name: "T", exercises: { create: { exerciseId: e.id, position: 0, targetSets: 1, targetRepsMin: 1, targetRepsMax: 1 } } } }); await prisma.workoutSession.create({ data: { userId: id, name: "S", status: "COMPLETED", exercises: { create: { exerciseId: e.id, position: 0 } } } }); }],
  ["in a session in progress", async (id, tag) => { const e = await prisma.exercise.create({ data: { userId: id, name: `E ${tag}`, primaryMuscle: "BACK", equipment: "CABLE" } }); await prisma.workoutSession.create({ data: { userId: id, name: "S", exercises: { create: { exerciseId: e.id, position: 0 } } } }); }],
]) {
  test(`a custom exercise ${label} doesn't stop deletion`, async () => {
    const u = await newUser("case");
    await build(u.user.id, u.tag);
    assert.equal((await u.c.remove()).status, 200);
    assert.deepEqual(await scanAllTables(u.user.id), {});
  });
}

test("eligible, restricted and profile-less accounts can all be deleted and exported", async () => {
  const cases = [
    ["eligible", legacyProfile("x")],
    ["restricted", legacyProfile("x", { birthDate: dbDate(yearsAgo(17)) })],
    ["nulls", { name: "Null", birthDate: dbDate("1990-01-01"), unitSystem: "METRIC", timezone: "UTC" }],
    ["noprofile", null],
  ];
  for (const [label, row] of cases) {
    const u = await newUser(label);
    if (row) await prisma.profile.create({ data: { userId: u.user.id, ...row } });
    if (label === "restricted") assert.equal((await u.c.get("/api/sessions")).status, 403, "restricted elsewhere");
    if (label === "noprofile") assert.equal((await u.c.get("/api/sessions")).status, 409, "no way in elsewhere");
    const exported = await u.c.exportData();
    assert.equal(exported.status, 200, `${label}: export`);
    assert.equal(exported.body.account.email, u.email);
    if (!row) assert.equal(exported.body.profile, null, "no profile is null, with nothing invented");
    assert.equal((await u.c.remove()).status, 200, `${label}: delete`);
    assert.equal(await prisma.user.count({ where: { id: u.user.id } }), 0, label);
  }
});

test("a missing or wrong confirmation deletes nothing, and doesn't spend a password attempt", async () => {
  const u = await newUser("confirm");
  await seed(u);
  const before = await dump(u.user.id);
  for (const body of [{ password: PASSWORD }, { password: PASSWORD, confirmation: "delete" }, { password: PASSWORD, confirmation: "" }, { password: PASSWORD, confirmation: true }, { confirmation: "DELETE" }, {}]) {
    for (let i = 0; i < 3; i++) assert.equal((await u.c.remove(body)).status, 400, JSON.stringify(body));
  }
  assert.equal(await dump(u.user.id), before, "unchanged");
  assert.equal((await u.c.remove()).status, 200, "not limited by requests that never reached the password");
});

test("a wrong password deletes nothing and exports nothing", async () => {
  const u = await newUser("wrong");
  await seed(u);
  const before = await dump(u.user.id);
  const r = await u.c.remove({ password: "not the password", confirmation: "DELETE" });
  assert.equal(r.status, 403);
  assert.equal(r.body.details.reason, "wrong_password");
  const e = await u.c.exportData({ password: "not the password" });
  assert.equal(e.status, 403);
  assert.doesNotMatch(e.text, new RegExp(u.tag), "no data in the refusal");
  assert.equal(await dump(u.user.id), before);
  assert.equal((await u.c.get("/api/profile")).status, 200, "still signed in");
});

test("anonymous and cross-origin requests are refused", async () => {
  const anon = client(null);
  assert.equal((await anon.remove()).status, 401);
  assert.equal((await anon.exportData()).status, 401);
  const u = await newUser("origin");
  for (const path of ["/api/account/delete", "/api/account/export"]) {
    assert.equal((await u.c.call("POST", path, CONFIRM, { Origin: "https://evil.example" })).status, 403, path);
  }
  assert.equal(await prisma.user.count({ where: { id: u.user.id } }), 1);
  for (const method of ["GET", "PUT", "DELETE"]) assert.equal((await u.c.call(method, "/api/account/delete", method === "GET" ? undefined : CONFIRM)).status, 405, method);
  assert.equal((await u.c.get("/api/account/export")).status, 405, "no export by GET");
});

test("nobody can delete or export someone else's account by naming it, or with their own password", async () => {
  const a = await newUser("a"), b = await newUser("b");
  await seed(a); await seed(b);
  const before = await dump(b.user.id);
  const asA = await a.c.exportData({ password: PASSWORD, userId: b.user.id, email: b.email });
  assert.equal(asA.status, 200);
  assert.equal(asA.body.account.email, a.email, "the session decides");
  assert.doesNotMatch(asA.text, new RegExp(b.tag));
  assert.doesNotMatch(asA.text, new RegExp(b.user.id));

  await prisma.user.update({ where: { id: b.user.id }, data: { passwordHash: (await prisma.user.findUnique({ where: { id: a.user.id } })).passwordHash } });
  const { hash } = require("@node-rs/argon2");
  await prisma.user.update({ where: { id: a.user.id }, data: { passwordHash: await hash("a different password", { memoryCost: 19456, timeCost: 2, parallelism: 1 }) } });
  assert.equal((await a.c.remove({ password: PASSWORD, confirmation: "DELETE" })).status, 403, "B's password can't delete A");
  assert.equal(await prisma.user.count({ where: { id: a.user.id } }), 1);

  assert.equal((await a.c.remove({ password: "a different password", confirmation: "DELETE", userId: b.user.id })).status, 200);
  assert.equal(await prisma.user.count({ where: { id: a.user.id } }), 0, "A is gone");
  const after = JSON.parse(await dump(b.user.id)), was = JSON.parse(before);
  delete after.User[0].passwordHash; delete was.User[0].passwordHash; delete after.User[0].updatedAt; delete was.User[0].updatedAt; // changed above, by this test
  assert.deepEqual(after, was, "B is unchanged, though A's body named B");
});

test("deletion ends every session, clears cookies, and frees the email", async () => {
  const u = await newUser("sessions");
  const other = client(await addSession(prisma, u.user.id));
  assert.equal((await other.get("/api/profile")).status, 200);
  const r = await u.c.remove();
  assert.equal(r.status, 200);
  const cookies = r.headers.getSetCookie();
  assert.ok(cookies.some((c) => /^fit_session=;/.test(c)), "session cookie cleared");
  assert.ok(cookies.some((c) => /^fit_device=;/.test(c) && /Path=\/api\/auth\/login/i.test(c)), "device cookie cleared, on its own path");
  for (const c of [u.c, other]) {
    assert.equal((await c.get("/api/profile")).status, 401, "this device is signed out");
    assert.equal((await c.remove()).status, 401, "a repeat is safe, and the same as any signed-out request");
    assert.equal((await c.exportData()).status, 401);
  }
  const login = await client(null).post("/api/auth/login", { email: u.email, password: PASSWORD });
  assert.equal(login.status, 401, "the old password doesn't sign in");
  assert.equal(login.body.error, "Incorrect email or password", "the same answer as for an email that never existed");
  // The whole flow: a link is mailed, the password is set from it, and the new account can sign in. It throws unless each step answered 200.
  const anon = client(null);
  const again = await signUpWithApi(BASE, u.email, PASSWORD, { post: (p, b) => anon.post(p, b) });
  assert.ok(again.value, "the email can register again, and sign in");
  const fresh = await prisma.user.findUnique({ where: { email: u.email } });
  assert.notEqual(fresh.id, u.user.id);
  assert.equal(await prisma.profile.count({ where: { userId: fresh.id } }), 0, "nothing came back");
  await prisma.session.deleteMany({ where: { userId: fresh.id } });
  await prisma.user.delete({ where: { id: fresh.id } });
});

test("password attempts are limited across deletion and export, per person", async () => {
  const u = await newUser("limit"), other = await newUser("limitother");
  for (let i = 0; i < 5; i++) assert.equal((await u.c.remove({ password: "guess", confirmation: "DELETE" })).status, 403);
  for (let i = 0; i < 5; i++) assert.equal((await u.c.exportData({ password: "guess" })).status, 403);
  const limited = await u.c.remove();
  assert.equal(limited.status, 429, "even the right password waits");
  assert.ok(limited.headers.get("retry-after"));
  assert.equal((await u.c.exportData()).status, 429);
  assert.equal(await prisma.user.count({ where: { id: u.user.id } }), 1);
  assert.equal((await other.c.exportData()).status, 200, "one person's limit isn't another's");
});

test("oversized bodies are refused before any password check", async () => {
  const u = await newUser("big");
  const huge = "x".repeat(5000);
  assert.equal((await u.c.remove({ password: huge, confirmation: "DELETE" })).status, 413);
  assert.equal((await u.c.exportData({ password: huge })).status, 413);
  assert.equal((await u.c.remove({ password: "x".repeat(257), confirmation: "DELETE" })).status, 400);
  for (let i = 0; i < 12; i++) await u.c.exportData({ password: huge });
  assert.equal((await u.c.exportData()).status, 200, "none of those spent an attempt");
});

test("a failure part-way undoes everything", async () => {
  const a = await newUser("rollback"), b = await newUser("rollbackother");
  const seeded = await seed(a);
  // Another person's plan refers to A's exercise, which the API doesn't allow, so the deletion fails at
  // that step, after sessions and templates have gone inside the transaction.
  const crossing = await prisma.workoutTemplate.create({ data: { userId: b.user.id, name: "Crossing", exercises: { create: { exerciseId: seeded.unused.id, position: 0, targetSets: 1, targetRepsMin: 1, targetRepsMax: 1 } } } });
  const before = await dump(a.user.id);
  const r = await a.c.remove();
  assert.equal(r.status, 409);
  assert.match(r.body.error, /nothing was changed/);
  assert.doesNotMatch(r.text, new RegExp(`${a.user.id}|${seeded.unused.id}|${b.user.id}`), "no identifiers in the answer");
  assert.equal(await dump(a.user.id), before, "every row and column is back");
  assert.equal((await a.c.get("/api/profile")).status, 200, "the session survived");
  assert.equal(await prisma.workoutTemplate.count({ where: { id: crossing.id } }), 1, "the other person's row wasn't touched");
  await prisma.workoutTemplate.delete({ where: { id: crossing.id } });
  assert.equal((await a.c.remove()).status, 200, "it works once the reference has gone");
  assert.deepEqual(await scanAllTables(a.user.id), {});
});

test("concurrent deletions: one outcome, no errors, nothing left", async () => {
  const u = await newUser("race");
  const seeded = await seed(u);
  const owned = await ownedIds(u.user.id);
  const results = await Promise.all(Array.from({ length: 5 }, () => u.c.remove()));
  const statuses = results.map((r) => r.status);
  assert.ok(statuses.includes(200), `one succeeded: ${statuses}`);
  assert.ok(statuses.every((s) => s === 200 || s === 401), `only success or signed out: ${statuses}`);
  for (const [model, n] of Object.entries(await remaining(owned))) assert.equal(n, 0, model);
  assert.equal(seeded.food.userId, u.user.id);
});

test("two deletions that reach the database together: the second finds nothing to do, and reports the same", async () => {
  const u = await newUser("queued");
  await seed(u);
  const owned = await ownedIds(u.user.id);
  // Holding the row makes both requests pass the password check and wait at the lock, so this is the same every run.
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const holding = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${u.user.id} FOR UPDATE`;
    await held;
  }, { timeout: 20_000 });
  const requests = [u.c.remove(), u.c.remove()];
  await new Promise((resolve) => setTimeout(resolve, 2500));
  release();
  await holding;
  const statuses = (await Promise.all(requests)).map((r) => r.status);
  assert.deepEqual(statuses, [200, 200], "the same answer to both");
  for (const [model, n] of Object.entries(await remaining(owned))) assert.equal(n, 0, model);
});

test("a deletion racing writes and an export leaves nothing behind, and no partial file", async () => {
  const u = await newUser("racewrite");
  await seed(u);
  const owned = await ownedIds(u.user.id);
  const [removed, exported, ...writes] = await Promise.all([
    u.c.remove(),
    u.c.exportData(),
    ...Array.from({ length: 6 }, (_, i) => u.c.post("/api/sessions", { name: `Racing ${i}` })),
  ]);
  assert.equal(removed.status, 200);
  assert.ok([200, 401].includes(exported.status), `export: ${exported.status}`);
  if (exported.status === 200) assert.equal(exported.body.account.email, u.email, "a whole file, from before the deletion");
  for (const w of writes) assert.ok(w.status < 500 || w.status === 409, `write: ${w.status}`);
  for (const [model, n] of Object.entries(await remaining(owned))) assert.equal(n, 0, model);
  assert.deepEqual(await scanAllTables(u.user.id), {}, "no write outlived the account");
});

// ─── Export ─────────────────────────────────────────────────────────────────

/** Every object in the file that has an id, whatever depth it's at. */
function byId(document) {
  const found = new Map();
  (function walk(v) {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") { if (typeof v.id === "string") found.set(v.id, v); Object.values(v).forEach(walk); }
  })(document);
  return found;
}
function allKeys(document) {
  const keys = new Set();
  (function walk(v) {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") { for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } }
  })(document);
  return keys;
}
const DATE_ONLY = new Set(["birthDate", "date", "effectiveFrom"]);
const expected = (field, v) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return DATE_ONLY.has(field) ? v.toISOString().slice(0, 10) : v.toISOString();
  if (typeof v === "object" && typeof v.toNumber === "function") return v.toNumber();
  return v;
};

test("the file has every row and every mapped field, with stored values, and nothing of anyone else's", async () => {
  const a = await newUser("exp"), b = await newUser("expother");
  await seed(a); await seed(b);
  const r = await a.c.exportData();
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /^attachment; filename="fitworkoutfoodtracker-export-\d{4}-\d{2}-\d{2}\.json"$/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.match(r.headers.get("content-type"), /^application\/json/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  const doc = r.body;
  assert.equal(doc.format, "fitworkoutfoodtracker-export");
  assert.equal(doc.formatVersion, 1);
  assert.ok(doc.units.mass && doc.units.length && doc.units.energy, "units are stated");
  const index = byId(doc);

  const owned = await ownedIds(a.user.id);
  const checked = [];
  for (const [model, entry] of Object.entries(dataMap)) {
    if (!entry.export.length) continue;
    const key = ID_FIELD[model] ?? "id";
    const rows = await delegateOf(model).findMany({ where: { [key]: { in: owned[model] } } });
    assert.ok(rows.length > 0, `${model} seeded`);
    for (const row of rows) {
      const out = model === "User" ? doc.account : model === "Profile" ? doc.profile : index.get(row.id);
      assert.ok(out, `${model} ${row.id} is in the file`);
      for (const field of entry.export) {
        assert.ok(field in out, `${model}.${field} has a key`);
        assert.deepEqual(out[field], expected(field, row[field]), `${model}.${field}`);
      }
      checked.push(model);
    }
  }
  assert.deepEqual([...new Set(checked)].sort(), Object.keys(dataMap).filter((m) => dataMap[m].export.length).sort(), "every exported model was compared");

  assert.doesNotMatch(r.text, new RegExp(`${b.tag}|${b.user.id}|${b.email}`), "nothing of the control user's");
  const stored = await prisma.user.findUnique({ where: { id: a.user.id } });
  assert.equal(r.text.includes(stored.passwordHash), false, "no password hash");
  assert.equal(r.text.includes(a.token), false, "no session token");
  const sessionIds = await prisma.session.findMany({ where: { userId: a.user.id }, select: { id: true } });
  for (const s of sessionIds) assert.equal(r.text.includes(s.id), false, "no session id");
  assert.equal(r.text.includes(a.user.id), false, "no internal user id");
  for (const key of ["passwordHash", "password", "token", "userId", "expiresAt", "sessions"]) assert.equal(allKeys(doc).has(key), false, `no ${key} key`);
  assert.equal(r.text.includes(sharedFood.name), false, "the shared catalogue isn't exported, only where a logged value came from");
});

test("nulls stay null, zero stays zero, and stopped targets are visible", async () => {
  const u = await newUser("nulls");
  await seed(u);
  const { body: doc } = await u.c.exportData();
  const targets = doc.nutritionTargets;
  assert.deepEqual(targets.map((t) => t.effectiveFrom), ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"], "all, past and present, in order");
  assert.equal(targets[1].source, "SUGGESTED", "provenance of a legacy target");
  assert.equal(targets[1].proteinG, 0, "a legacy zero stays zero");
  assert.equal(targets[2].kcal, 2000);
  assert.equal(targets[2].proteinG, null, "a calories-only target has null macros");
  assert.deepEqual([targets[3].kcal, targets[3].proteinG, targets[3].carbsG, targets[3].fatG], [null, null, null, null], "a stopped row is exported as null");
  const noFood = doc.foodEntries.find((e) => e.mealType === "SNACK");
  assert.equal(noFood.foodId, null);
  assert.equal(noFood.provenance, null);
  for (const f of ["kcal", "protein", "carbs", "fat", "fiber", "kcalPer100", "brand"]) { assert.ok(f in noFood, f); assert.equal(noFood[f], null, f); }
  const custom = doc.foodEntries.find((e) => e.foodName.startsWith("Entry"));
  assert.equal(custom.protein, 0, "a logged zero stays zero");
  assert.equal(custom.provenance.source, "CUSTOM");
  assert.equal(custom.provenance.sourceId, null, "a custom food's internal id isn't exposed");
  const shared_ = doc.foodEntries.find((e) => e.foodName.startsWith("Shared entry"));
  assert.deepEqual([shared_.provenance.source, shared_.provenance.sourceId, shared_.provenance.dataType], ["USDA", sharedFood.sourceId, "Foundation"], "where a provider's value came from");
  const nulls = await newUser("nullprofile");
  await prisma.profile.create({ data: { userId: nulls.user.id, name: "N", birthDate: dbDate("1990-01-01"), unitSystem: "METRIC", timezone: "UTC" } });
  const { body: n } = await nulls.c.exportData();
  for (const f of ["sex", "heightCm", "currentWeightKg", "goalWeightKg", "goal", "activityLevel", "experience", "workoutDaysPerWeek"]) { assert.ok(f in n.profile, f); assert.equal(n.profile[f], null, f); }
  assert.deepEqual([n.customExercises, n.workoutPlans, n.workoutSessions, n.progress, n.customFoods, n.foodEntries, n.nutritionTargets, n.schedule], [[], [], [], [], [], [], [], []]);
});

test("workouts come out nested, with what a built-in exercise was, and progress from completed sessions only", async () => {
  const u = await newUser("nested");
  const seeded = await seed(u);
  const { body: doc } = await u.c.exportData();
  const done = doc.workoutSessions.find((s) => s.id === seeded.done.id);
  assert.equal(done.status, "COMPLETED");
  assert.equal(done.templateId, seeded.template.id);
  assert.deepEqual(done.exercises.map((e) => e.position), [0, 1, 2]);
  assert.deepEqual(done.exercises[0].sets.map((s) => [s.setNumber, s.reps, s.weightKg, s.isWarmup, s.rpe]), [[1, 10, 20, true, null], [2, 8, 62.5, false, 8.5]]);
  assert.deepEqual(done.exercises[2].exercise, { name: builtIn.name, primaryMuscle: builtIn.primaryMuscle, equipment: builtIn.equipment, builtIn: true });
  assert.equal(done.exercises[0].exercise.builtIn, false);
  assert.ok(doc.workoutSessions.some((s) => s.status === "IN_PROGRESS"), "a session in progress is included");
  assert.equal(doc.schedule[0].templateId, seeded.template.id);
  const p = doc.progress.find((x) => x.exerciseId === seeded.inSession.id);
  assert.deepEqual([p.completedSessions, p.workingSets, p.heaviestWorkingSetKg], [1, 1, 62.5], "warm-ups don't count");
  assert.equal(p.firstPerformedAt, "2026-01-05T10:00:00.000Z");
  assert.equal(doc.progress.some((x) => x.exerciseId === seeded.inProgress.id), false, "a session in progress isn't progress");
});

test("a large account exports whole, and an oversized one is refused, then still deletes", async () => {
  const big = await newUser("large");
  const exercise = await prisma.exercise.create({ data: { userId: big.user.id, name: `Large ${big.tag}`, primaryMuscle: "BACK", equipment: "CABLE" } });
  const fill = async (count) => {
    const session = await prisma.workoutSession.create({ data: { userId: big.user.id, name: "Large", exercises: { create: { exerciseId: exercise.id, position: 0 } } }, include: { exercises: true } });
    const sessionExerciseId = session.exercises[0].id;
    for (let done = 0; done < count; done += 5000) {
      await prisma.setEntry.createMany({ data: Array.from({ length: Math.min(5000, count - done) }, (_, i) => ({ sessionExerciseId, setNumber: done + i + 1, reps: 5, weightKg: 50 })) });
    }
  };
  await fill(20_000);
  const whole = await big.c.exportData();
  assert.equal(whole.status, 200);
  assert.equal(whole.body.workoutSessions[0].exercises[0].sets.length, 20_000, "nothing was cut");
  console.log(`# 20,000 sets exported as ${(whole.text.length / 1048576).toFixed(1)} MiB, about ${Math.round(whole.text.length / 20000)} bytes a set`);

  await fill(230_001);
  const refused = await big.c.exportData();
  assert.equal(refused.status, 413, "over the row limit");
  assert.match(refused.body.error, /too much data/);
  assert.equal(refused.body.workoutSessions, undefined, "no partial file");

  const started = Date.now();
  const removed = await big.c.remove();
  assert.equal(removed.status, 200, "an oversized account can still be deleted");
  console.log(`# deleted 250,001 sets in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  assert.equal(await prisma.setEntry.count({ where: { sessionExercise: { exerciseId: exercise.id } } }), 0);
  assert.equal(await prisma.user.count({ where: { id: big.user.id } }), 0);
});

test("someone else's custom food or exercise reference never reveals it", async () => {
  const a = await newUser("foreign"), b = await newUser("foreignowner");
  const theirs = await prisma.exercise.create({ data: { userId: b.user.id, name: `Secret exercise ${b.tag}`, primaryMuscle: "BACK", equipment: "CABLE" } });
  const theirFood = await prisma.food.create({ data: { source: "CUSTOM", sourceId: `c-${b.tag}`, userId: b.user.id, name: `Secret food ${b.tag}`, origin: `origin ${b.tag}` } });
  // Not possible through the API: built directly, so the export's own check is what's tested.
  await prisma.workoutSession.create({ data: { userId: a.user.id, name: "S", exercises: { create: { exerciseId: theirs.id, position: 0 } } } });
  await prisma.foodEntry.create({ data: { userId: a.user.id, date: dbDate("2026-01-05"), mealType: "LUNCH", foodId: theirFood.id, foodName: "Mine", basisUnit: "G", servingLabel: "s", servingAmount: "1", quantity: "1" } });
  const r = await a.c.exportData();
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.text, new RegExp(b.tag));
  assert.equal(r.body.workoutSessions[0].exercises[0].exercise, null);
  assert.equal(r.body.foodEntries[0].provenance, null);
});

test("another person's food entry keeps what they logged when the food's owner leaves", async () => {
  const owner = await newUser("foodowner"), other = await newUser("foodother");
  const food = await prisma.food.create({ data: { source: "CUSTOM", sourceId: `c-${owner.tag}`, userId: owner.user.id, name: `Their food ${owner.tag}`, kcalPer100: "10" } });
  // Not possible through the API, as custom foods are private. Built directly, as the schema allows it.
  const entry = await prisma.foodEntry.create({ data: { userId: other.user.id, date: dbDate("2026-01-05"), mealType: "LUNCH", foodId: food.id, foodName: "Kept copy", basisUnit: "G", kcalPer100: "10", servingLabel: "s", servingAmount: "1", quantity: "1", kcal: "1.5" } });
  assert.equal((await owner.c.remove()).status, 200);
  const after = await prisma.foodEntry.findUnique({ where: { id: entry.id } });
  assert.equal(after.foodId, null, "the link goes");
  assert.equal(after.foodName, "Kept copy", "their own copy stays");
  assert.equal(Number(after.kcal), 1.5);
  assert.equal(await prisma.food.count({ where: { id: food.id } }), 0);
});

test("what deletion and export say doesn't reach the server's logs in a request's own values", async () => {
  // The routes hold a password only in memory, and never call a logger with it. A wrong attempt produces no output to compare here,
  // so this checks the source: nothing in these modules logs anything but through the shared safe logger.
  const fs = require("node:fs"), path = require("node:path");
  const root = path.join(__dirname, "..", "src");
  for (const f of ["lib/server/account/delete.ts", "lib/server/account/export.ts", "lib/server/account/reauth.ts", "app/api/account/delete/route.ts", "app/api/account/export/route.ts"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, f), "utf8"), /console\.|logServerError/, f);
  }
});
