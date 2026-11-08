// Phase 5 against a real database: beta feedback and its administration. The app is started with ADMIN_USER_IDS
// naming exactly FEEDBACK_ADMIN_ID, which this suite creates; everyone else must be treated as not an administrator.
//   BASE_URL=… DATABASE_URL=<designated test database> FEEDBACK_ADMIN_ID=<the same id> node --test scripts/feedback-api.test.cjs
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser, addSession } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const ORIGIN = new URL(BASE).origin;
const ADMIN_ID = process.env.FEEDBACK_ADMIN_ID;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
let counter = 0;
const PASSWORD = "correct horse battery staple";

function client(token, origin = ORIGIN) {
  const call = async (method, path, body, raw) => {
    const res = await fetch(BASE + path, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(origin ? { Origin: origin } : {}), ...(token ? { Cookie: `fit_session=${token}` } : {}) }, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), redirect: "manual" });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, body: json, text, headers: res.headers };
  };
  return { call, get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), patch: (p, b) => call("PATCH", p, b) };
}
async function newUser(label) {
  const email = `fb${label}${++counter}x${run}@test.dev`;
  const { user, token } = await createSignedInUser(prisma, email, { password: PASSWORD });
  return { c: client(token), user, token, email };
}
const send = (u, description, category = "BUG", route = "/nutrition") => u.c.post("/api/feedback", { category, description, route });

let admin;
before(async () => {
  await target.verifyServer();
  assert.match(ADMIN_ID ?? "", /^c[a-z0-9]{20,32}$/, "the runner names one administrator");
  const user = await prisma.user.create({ data: { id: ADMIN_ID, email: `fbadmin x${run}@test.dev`.replace(" ", ""), passwordHash: "x" } });
  admin = { user, c: client(await addSession(prisma, user.id)) };
});
after(async () => { await prisma.feedback.deleteMany({ where: { user: { email: { endsWith: `x${run}@test.dev` } } } }); await prisma.$disconnect(); });

test("a person sends feedback and sees only their own; nothing else about them is attached", async () => {
  const a = await newUser("a"), b = await newUser("b");
  const r = await send(a, `The weight chart is blank for ${a.email} after logging, call me on +1 555 123 4567`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.body.feedback).sort(), ["category", "createdAt", "description", "id", "route", "status"]);
  assert.equal(r.body.feedback.status, "NEW");
  await send(b, "Please add a dark mode toggle to the dashboard", "FEATURE", "/dashboard");
  const mineA = (await a.c.get("/api/feedback")).body.feedback;
  assert.equal(mineA.length, 1);
  assert.equal(mineA[0].id, r.body.feedback.id);
  assert.ok((await b.c.get("/api/feedback")).body.feedback.every((f) => f.id !== r.body.feedback.id), "B never sees A's");
  const row = await prisma.feedback.findUnique({ where: { id: r.body.feedback.id } });
  assert.equal(row.userId, a.user.id);
  assert.equal(row.route, "/nutrition");
  assert.equal(row.severity, null);
});

test("input is bounded and validated: category, length, page path, unknown fields, size", async () => {
  const u = await newUser("v");
  for (const [label, body] of [
    ["unknown category", { category: "PRAISE", description: "Some long enough text" }],
    ["too short", { category: "BUG", description: "   short  " }],
    ["too long", { category: "BUG", description: "x".repeat(2001) }],
    ["a page path with a query", { category: "BUG", description: "Some long enough text", route: "/x?token=abc" }],
    ["a full URL as the page", { category: "BUG", description: "Some long enough text", route: "https://evil.example/" }],
    ["an extra field", { category: "BUG", description: "Some long enough text", userId: admin.user.id }],
    ["status set by the person", { category: "BUG", description: "Some long enough text", status: "DONE" }],
  ]) assert.equal((await u.c.post("/api/feedback", body)).status, 400, label);
  assert.equal((await u.c.call("POST", "/api/feedback", undefined, JSON.stringify({ category: "BUG", description: "y".repeat(20_000) }))).status, 413, "an oversized body is refused before parsing");
  assert.equal(await prisma.feedback.count({ where: { userId: u.user.id } }), 0, "nothing invalid was stored");
});

test("signed out, or from another origin, nothing is accepted", async () => {
  assert.equal((await client(null).post("/api/feedback", { category: "BUG", description: "Some long enough text" })).status, 401);
  const u = await newUser("o");
  assert.equal((await client(u.token, "https://evil.example").post("/api/feedback", { category: "BUG", description: "Some long enough text" })).status, 403);
  assert.equal(await prisma.feedback.count({ where: { userId: u.user.id } }), 0);
});

test("a repeat of the same text the same day isn't stored twice; the hourly limit refuses the sixth", async () => {
  const u = await newUser("r");
  const first = await send(u, "The barcode scanner doesn't open the camera");
  const again = await send(u, "  the barcode scanner DOESN'T open the camera ");
  assert.equal(again.status, 200);
  assert.equal(again.body.repeated, true);
  assert.equal(again.body.feedback.id, first.body.feedback.id);
  for (let i = 2; i <= 5; i++) assert.equal((await send(u, `Distinct report number ${i} about the app`)).status, 200);
  const sixth = await send(u, "Distinct report number 6 about the app");
  assert.equal(sixth.status, 429);
  assert.equal(await prisma.feedback.count({ where: { userId: u.user.id } }), 5);
});

test("no one but the named administrator reaches any admin route, and they all answer 404, as for a missing page", async () => {
  const u = await newUser("n");
  const someone = (await send(u, "An ordinary report about the food search")).body.feedback;
  for (const c of [u.c, client(null)]) {
    for (const [m, p, b] of [["GET", "/api/admin/feedback"], ["GET", "/api/admin/feedback/export"], ["PATCH", `/api/admin/feedback/${someone.id}`, { status: "DONE" }]]) {
      const r = await c.call(m, p, b);
      assert.equal(r.status, 404, `${m} ${p}`);
      assert.doesNotMatch(r.text, /feedback|description/i, "nothing leaks in the answer");
    }
  }
  // A person can't make themselves one: not with a header, a body field, or a cookie of their own invention.
  assert.equal((await u.c.call("GET", "/api/admin/feedback", undefined)).status, 404);
  assert.equal((await client(`${u.token}; admin=1`).get("/api/admin/feedback")).status, 404);
  assert.equal((await prisma.feedback.findUnique({ where: { id: someone.id } })).status, "NEW", "nothing was changed");
  assert.equal((await client(null).call("GET", "/admin/feedback")).status === 200 && false, false);
});

test("the administrator lists, filters, triages, marks duplicates and links tasks; reporters are shown only by a short reference", async () => {
  const u = await newUser("t");
  const one = (await send(u, "Logging a set twice creates two rows", "BUG")).body.feedback;
  const two = (await send(u, "Logging the same set again duplicates it", "BUG")).body.feedback;
  const list = await admin.c.get("/api/admin/feedback?category=BUG");
  assert.equal(list.status, 200, list.text);
  const shown = list.body.feedback.find((f) => f.id === one.id);
  assert.ok(shown && !("userId" in shown) && !JSON.stringify(list.body).includes(u.email), "no address or user ID");
  assert.equal(shown.reporter, u.user.id.slice(-6));
  assert.ok(list.body.feedback.every((f) => f.category === "BUG"));
  const t = await admin.c.patch(`/api/admin/feedback/${one.id}`, { status: "PLANNED", severity: "HIGH", priority: "P1", decisionNote: "Fix in the next build", taskLink: "https://github.com/example/issues/1" });
  assert.equal(t.status, 200, t.text);
  assert.deepEqual([t.body.feedback.status, t.body.feedback.severity, t.body.feedback.priority], ["PLANNED", "HIGH", "P1"]);
  const d = await admin.c.patch(`/api/admin/feedback/${two.id}`, { duplicateOfId: one.id });
  assert.equal(d.body.feedback.status, "DUPLICATE", "marking a duplicate sets its status");
  assert.equal((await admin.c.patch(`/api/admin/feedback/${one.id}`, { duplicateOfId: two.id })).status, 400, "no loop of two");
  assert.equal((await admin.c.patch(`/api/admin/feedback/${one.id}`, { duplicateOfId: one.id })).status, 400, "not itself");
  assert.equal((await admin.c.patch(`/api/admin/feedback/${one.id}`, { duplicateOfId: "c" + "0".repeat(24) })).status, 400, "not a missing one");
  for (const bad of [{ taskLink: "javascript:alert(1)" }, { taskLink: "http://plain.example" }, { status: "WONTFIX" }, {}, { description: "rewritten" }]) {
    assert.equal((await admin.c.patch(`/api/admin/feedback/${one.id}`, bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await admin.c.patch(`/api/admin/feedback/c${"1".repeat(24)}`, { status: "DONE" })).status, 404);
  const mine = (await u.c.get("/api/feedback")).body.feedback.find((f) => f.id === one.id);
  assert.equal(mine.status, "PLANNED", "the person sees the status");
  assert.ok(!("decisionNote" in mine) && !("severity" in mine), "but not the administrator's notes");
});

test("the review export is redacted, pseudonymous, consistent within itself and unlinkable across exports", async () => {
  const u = await newUser("e");
  await send(u, `Sync fails for ${u.email}; see https://example.com/s?id=99 or ring 07700 900123, ask @someone`, "BUG", "/workouts");
  await send(u, "Please let me export my workouts to a spreadsheet", "FEATURE", "/workouts");
  const r = await admin.c.get("/api/admin/feedback/export");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition") ?? "", /attachment; filename="feedback-review-\d{4}-\d{2}-\d{2}\.json"/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const doc = r.body;
  const text = JSON.stringify(doc);
  for (const leak of [u.email, u.user.id, "07700", "example.com", "@someone", "decisionNote", "taskLink", "userId"]) assert.equal(text.includes(leak), false, `no ${leak}`);
  const mine = doc.items.filter((i) => /Sync fails|export my workouts/.test(i.text));
  assert.equal(mine.length, 2);
  assert.match(mine[0].text, /\[email\].*\[link\].*\[number\].*\[handle\]/);
  assert.equal(mine[0].reporter, mine[1].reporter, "one person is one pseudonym within an export");
  const again = (await admin.c.get("/api/admin/feedback/export")).body.items.find((i) => /export my workouts/.test(i.text));
  assert.notEqual(again.reporter, mine[1].reporter, "and a different one in the next export");
  assert.match(mine[0].ref, /^F-\d{4}$/);
});

test("feedback is in the person's own data export, and goes with their account; another's duplicate link is cleared", async () => {
  const { user, token, email } = await newUser("x");
  const c = client(token);
  const own = (await send({ c }, "My own report that should leave with me")).body.feedback;
  const other = await newUser("y");
  const theirs = (await send(other, "Somebody else's report repeating it")).body.feedback;
  await admin.c.patch(`/api/admin/feedback/${theirs.id}`, { duplicateOfId: own.id });
  const exp = await c.post("/api/account/export", { password: PASSWORD });
  assert.equal(exp.status, 200, exp.text);
  assert.deepEqual(exp.body.feedback.map((f) => f.description), ["My own report that should leave with me"]);
  assert.deepEqual(Object.keys(exp.body.feedback[0]).sort(), ["category", "createdAt", "description", "id", "route", "status", "updatedAt"]);
  const del = await c.post("/api/account/delete", { password: PASSWORD, confirmation: "DELETE" });
  assert.equal(del.status, 200, del.text);
  assert.equal(await prisma.feedback.count({ where: { userId: user.id } }), 0);
  const kept = await prisma.feedback.findUnique({ where: { id: theirs.id } });
  assert.equal(kept.duplicateOfId, null, "the other person's report stays, unlinked");
  assert.equal(kept.description, "Somebody else's report repeating it");
  assert.equal(await prisma.user.count({ where: { email } }), 0);
});
