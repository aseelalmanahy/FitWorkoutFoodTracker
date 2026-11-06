// Phase 4.1 against the real database: isolation, export and deletion of weight entries. Needs MIG-04 on fitdb_test.
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
const PASSWORD = "correct horse battery staple";
let counter = 0;

async function call(method, urlPath, body, cookie) {
  const res = await fetch(BASE + urlPath, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json, text };
}
async function newUser(label, { profile = true, birthDate = "1990-01-01" } = {}) {
  const email = `weight${label}${++counter}${SUFFIX}`;
  const { user, token } = await createSignedInUser(prisma, email, { password: PASSWORD });
  if (profile) await prisma.profile.create({ data: { userId: user.id, name: `Weight ${label}`, birthDate: new Date(`${birthDate}T00:00:00Z`), unitSystem: "METRIC", timezone: "UTC" } });
  return { user, email, cookie: `fit_session=${token}` };
}
const today = () => new Date().toISOString().slice(0, 10);
const put = (u, date, weightKg) => call("PUT", "/api/weight", { date, weightKg }, u.cookie);

before(() => target.verifyServer());
after(async () => {
  const ids = (await prisma.user.findMany({ where: { email: { endsWith: SUFFIX } }, select: { id: true } })).map((u) => u.id);
  await prisma.bodyMetric.deleteMany({ where: { userId: { in: ids } } });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.profile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("logging stores kilograms for that person, and a date logged again replaces it", async () => {
  const u = await newUser("log");
  assert.equal((await put(u, today(), 80.5)).status, 200);
  assert.equal((await put(u, today(), 79.5)).status, 200);
  const rows = await prisma.bodyMetric.findMany({ where: { userId: u.user.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, 79.5);
  assert.equal(rows[0].kind, "WEIGHT");
});

test("logging doesn't change the profile's stored weight", async () => {
  const u = await newUser("separate");
  await prisma.profile.update({ where: { userId: u.user.id }, data: { currentWeightKg: 70 } });
  await put(u, today(), 90);
  assert.equal((await prisma.profile.findUnique({ where: { userId: u.user.id } })).currentWeightKg, 70);
});

test("one person can't read, delete or overwrite another's entries", async () => {
  const a = await newUser("a"), b = await newUser("b");
  await put(a, today(), 80);
  const row = await prisma.bodyMetric.findFirst({ where: { userId: a.user.id } });
  const listed = await call("GET", "/api/weight", undefined, b.cookie);
  assert.deepEqual(listed.body.entries, []);
  assert.equal((await call("DELETE", `/api/weight/${row.id}`, undefined, b.cookie)).status, 404);
  await put(b, today(), 60);
  assert.equal((await prisma.bodyMetric.findUnique({ where: { id: row.id } })).value, 80, "the same date for someone else is their own row");
  assert.equal(await prisma.bodyMetric.count({ where: { userId: b.user.id } }), 1);
});

test("no session, no entries", async () => {
  assert.equal((await call("GET", "/api/weight")).status, 401);
  assert.equal((await call("PUT", "/api/weight", { date: today(), weightKg: 80 })).status, 401);
  assert.equal((await call("DELETE", "/api/weight/anything")).status, 401);
});

test("a restricted account can't read, write or delete, and what's stored stays", async () => {
  const u = await newUser("restricted", { birthDate: `${new Date().getUTCFullYear() - 10}-01-01` });
  const row = await prisma.bodyMetric.create({ data: { userId: u.user.id, date: new Date("2026-01-01T00:00:00Z"), value: 70 } });
  assert.equal((await call("GET", "/api/weight", undefined, u.cookie)).status, 403);
  assert.equal((await put(u, today(), 80)).status, 403);
  assert.equal((await call("DELETE", `/api/weight/${row.id}`, undefined, u.cookie)).status, 403);
  assert.deepEqual((await prisma.bodyMetric.findMany({ where: { userId: u.user.id } })).map((r) => r.value), [70]);
});

test("saves racing for one date leave one row, and no server error", async () => {
  const u = await newUser("race");
  const results = await Promise.all([80, 81, 82, 83].map((kg) => put(u, today(), kg)));
  for (const r of results) assert.ok(r.status === 200 || r.status === 409, `status ${r.status}`);
  assert.ok(results.some((r) => r.status === 200));
  assert.equal(await prisma.bodyMetric.count({ where: { userId: u.user.id } }), 1);
});

test("a profile-less account is held at the access gate", async () => {
  const u = await newUser("noprof", { profile: false });
  assert.equal((await put(u, today(), 80)).status, 409);
  assert.equal(await prisma.bodyMetric.count({ where: { userId: u.user.id } }), 0);
});

test("the export holds the person's entries, and only theirs", async () => {
  const a = await newUser("exp"), b = await newUser("expb");
  await put(a, today(), 80.5);
  await put(b, today(), 61.5);
  const res = await call("POST", "/api/account/export", { password: PASSWORD }, a.cookie);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.weightLog.map((e) => [e.kind, e.date, e.value]), [["WEIGHT", today(), 80.5]]);
  assert.ok(!res.text.includes("61.5"));
});

test("deleting an account removes its entries, and nobody else's", async () => {
  const a = await newUser("del"), b = await newUser("delb");
  await put(a, today(), 80);
  await put(b, today(), 60);
  const res = await call("POST", "/api/account/delete", { password: PASSWORD, confirmation: "DELETE" }, a.cookie);
  assert.equal(res.status, 200);
  assert.equal(await prisma.bodyMetric.count({ where: { userId: a.user.id } }), 0);
  assert.equal(await prisma.bodyMetric.count({ where: { userId: b.user.id } }), 1);
});
