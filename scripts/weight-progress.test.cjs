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
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const put = (u, date, weightKg) => call("PUT", "/api/weight", { date, weightKg }, u.cookie);
const pageFor = async (u, urlPath) => { const res = await fetch(BASE + urlPath, { headers: { Cookie: u.cookie }, redirect: "manual" }); return { status: res.status, text: await res.text() }; };
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} against ${expected}`);

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
  assert.ok(row, "a save lands on the person's own row, not on anyone else's with that date");
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
  assert.ok(Array.isArray(res.body.weightLog), "the export has a weight log");
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

test("history comes back oldest first, however it was logged, with each date as it was entered", async () => {
  const u = await newUser("history");
  for (const [days, kg] of [[5, 81], [30, 80], [15, 79]]) assert.equal((await put(u, daysAgo(days), kg)).status, 200);
  const { body } = await call("GET", "/api/weight", undefined, u.cookie);
  assert.deepEqual(body.entries.map((e) => [e.date, e.weightKg]), [[daysAgo(30), 80], [daysAgo(15), 79], [daysAgo(5), 81]]);
});

test("the trend starts at the first entry, and a gap counts as time passing, never as zero", async () => {
  const u = await newUser("trend");
  await put(u, daysAgo(20), 80);
  await put(u, daysAgo(10), 78);
  await put(u, daysAgo(9), 78);
  const { trend } = (await call("GET", "/api/weight", undefined, u.cookie)).body;
  near(trend[0].trendKg, 80, "the first point is the entry");
  const second = 80 + (1 - Math.exp(-10 / 10)) * (78 - 80);
  near(trend[1].trendKg, second, "ten days carry about 63% of the difference");
  near(trend[2].trendKg, second + (1 - Math.exp(-1 / 10)) * (78 - second), "one day carries about 10%");
  assert.ok(trend.every((p) => p.trendKg > 77), "a missing day doesn't pull it toward zero");
});

test("logging a date again changes the trend, and deleting an entry takes it out", async () => {
  const u = await newUser("recalc");
  await put(u, daysAgo(10), 80);
  await put(u, daysAgo(5), 80);
  await put(u, daysAgo(5), 70);
  let { entries, trend } = (await call("GET", "/api/weight", undefined, u.cookie)).body;
  assert.deepEqual(entries.map((e) => e.weightKg), [80, 70]);
  near(trend[1].trendKg, 80 + (1 - Math.exp(-5 / 10)) * (70 - 80), "the trend uses the replacement");
  assert.equal((await call("DELETE", `/api/weight/${entries[1].id}`, undefined, u.cookie)).status, 200);
  ({ entries, trend } = (await call("GET", "/api/weight", undefined, u.cookie)).body);
  assert.deepEqual(entries.map((e) => e.weightKg), [80]);
  assert.equal(trend.length, 1);
  assert.equal((await call("DELETE", `/api/weight/${entries[0].id}x`, undefined, u.cookie)).status, 404, "nothing to delete is not found");
});

test("no number is stated for change until the log spans a week", async () => {
  const short = await newUser("short");
  await put(short, daysAgo(6), 80);
  await put(short, today(), 79);
  const tooSoon = await pageFor(short, "/progress/weight");
  assert.equal(tooSoon.status, 200);
  assert.doesNotMatch(tooSoon.text, /About, since/, "six days says nothing");
  const week = await newUser("week");
  await put(week, daysAgo(7), 80);
  await put(week, today(), 79);
  assert.match((await pageFor(week, "/progress/weight")).text, /About, since/, "seven days does");
});

test("a long history is paged, newest first, and all of it is kept", async () => {
  const u = await newUser("paged");
  const start = Date.UTC(2026, 0, 1);
  await prisma.bodyMetric.createMany({ data: Array.from({ length: 35 }, (_, i) => ({ userId: u.user.id, kind: "WEIGHT", date: new Date(start + i * 86_400_000), value: 80 })) });
  assert.equal((await call("GET", "/api/weight", undefined, u.cookie)).body.entries.length, 35);
  assert.doesNotMatch((await pageFor(u, "/progress/weight")).text, /Delete the entry for Jan 1, 2026/, "the oldest isn't on the first page");
  assert.match((await pageFor(u, "/progress/weight?page=2")).text, /Delete the entry for Jan 1, 2026/, "it's on the second");
});

test("values and dates out of range are refused, with nothing saved", async () => {
  const u = await newUser("limits");
  for (const body of [
    { date: today(), weightKg: 29.99 }, { date: today(), weightKg: 300.01 }, { date: today(), weightKg: 0 }, { date: today(), weightKg: -80 }, { date: today(), weightKg: "80" }, { date: today(), weightKg: null }, { date: today() },
    { date: "2026-13-01", weightKg: 80 }, { date: "not-a-date", weightKg: 80 }, { date: "1999-12-31", weightKg: 80 }, { date: daysAgo(-2), weightKg: 80 }, { weightKg: 80 },
  ]) {
    assert.equal((await call("PUT", "/api/weight", body, u.cookie)).status, 400, JSON.stringify(body));
  }
  assert.equal(await prisma.bodyMetric.count({ where: { userId: u.user.id } }), 0);
  for (const [date, kg] of [[today(), 30], [daysAgo(1), 300], [daysAgo(-1), 80], ["2000-01-01", 80]]) assert.equal((await put(u, date, kg)).status, 200, `${date} at ${kg}`);
});

test("a value is stored to two decimals, in kilograms, whatever the account's units", async () => {
  const u = await newUser("round");
  await prisma.profile.update({ where: { userId: u.user.id }, data: { unitSystem: "IMPERIAL" } });
  assert.equal((await put(u, today(), 80.126)).body.entry.weightKg, 80.13);
  assert.equal((await prisma.bodyMetric.findFirst({ where: { userId: u.user.id } })).value, 80.13);
});

test("an owner named in the body is ignored", async () => {
  const a = await newUser("body"), b = await newUser("bodyb");
  assert.equal((await call("PUT", "/api/weight", { date: today(), weightKg: 80, userId: b.user.id }, a.cookie)).status, 200);
  assert.equal(await prisma.bodyMetric.count({ where: { userId: a.user.id } }), 1);
  assert.equal(await prisma.bodyMetric.count({ where: { userId: b.user.id } }), 0);
});

test("a write from another origin is refused, with nothing saved", async () => {
  const u = await newUser("origin");
  await put(u, daysAgo(3), 80);
  const row = await prisma.bodyMetric.findFirst({ where: { userId: u.user.id } });
  const headers = { "Content-Type": "application/json", Origin: "https://elsewhere.invalid", Cookie: u.cookie };
  assert.equal((await fetch(`${BASE}/api/weight`, { method: "PUT", headers, body: JSON.stringify({ date: today(), weightKg: 90 }) })).status, 403);
  assert.equal((await fetch(`${BASE}/api/weight/${row.id}`, { method: "DELETE", headers })).status, 403);
  assert.deepEqual((await prisma.bodyMetric.findMany({ where: { userId: u.user.id } })).map((r) => r.value), [80]);
});

test("an ended session reaches nothing, and what's stored stays", async () => {
  for (const [label, end] of [["expired", (u) => prisma.session.updateMany({ where: { userId: u.user.id }, data: { expiresAt: new Date(Date.now() - 1000) } })], ["revoked", (u) => prisma.session.deleteMany({ where: { userId: u.user.id } })]]) {
    const u = await newUser(label);
    await put(u, today(), 80);
    const row = await prisma.bodyMetric.findFirst({ where: { userId: u.user.id } });
    await end(u);
    assert.equal((await call("GET", "/api/weight", undefined, u.cookie)).status, 401, label);
    assert.equal((await put(u, today(), 90)).status, 401, label);
    assert.equal((await call("DELETE", `/api/weight/${row.id}`, undefined, u.cookie)).status, 401, label);
    assert.equal((await prisma.bodyMetric.findUnique({ where: { id: row.id } })).value, 80, label);
  }
});

test("a malformed entry id is a clean refusal, not a server error", async () => {
  const u = await newUser("badid");
  for (const id of ["%00", "x".repeat(300), "'%20OR%201=1", "..%2F..%2Fapi"]) {
    const { status } = await call("DELETE", `/api/weight/${id}`, undefined, u.cookie);
    assert.equal(status, 404, `${id.slice(0, 20)} reads as not found, like any entry that doesn't exist`);
  }
});

test("the dashboard's card reads this person's own entries and goal", async () => {
  const a = await newUser("cardA"), b = await newUser("cardB"), none = await newUser("cardNone");
  for (const u of [a, b]) await prisma.profile.update({ where: { userId: u.user.id }, data: { goal: "FAT_LOSS", goalWeightKg: 70 } });
  await put(a, today(), 90);
  await put(b, today(), 60);
  const own = (await pageFor(a, "/dashboard")).text;
  assert.match(own, /above your goal weight of 70 kg/);
  assert.doesNotMatch(own, /below your goal weight/);
  assert.match((await pageFor(b, "/dashboard")).text, /below your goal weight of 70 kg/);
  const empty = await pageFor(none, "/dashboard");
  assert.equal(empty.status, 200);
  assert.match(empty.text, /Choosing a goal is optional/);
  assert.doesNotMatch(empty.text, /goal weight of/);
});

test("the pages hold nothing for someone with no session", async () => {
  for (const urlPath of ["/progress/weight", "/dashboard"]) {
    const res = await fetch(BASE + urlPath, { redirect: "manual" });
    assert.ok([302, 303, 307, 308].includes(res.status), `${urlPath} answered ${res.status}`);
    assert.match(res.headers.get("location") ?? "", /\/login/);
  }
});
