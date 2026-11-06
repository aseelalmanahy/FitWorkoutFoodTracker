// Phase 4.0.4 against the real database: emailed sign-up and password-reset links, and changing a password.
// Tokens are placed directly in the database for most cases (their id is the SHA-256 of the token, as
// Session's is), so these tests don't spend sign-up's limit of 10 per 15 minutes per client, or wait for mail.
// The few that follow the real flow read the mail stub's files from MAIL_STUB_DIR.
//
// The server must have been started with MAIL_STUB_DIR set, and with TRUST_PROXY_HOPS=1. Each request here
// then names its own client in X-Forwarded-For, so a case needing 10 attempts or fewer isn't stopped by an
// earlier one. Sign-up is open on the test server, which is what FIT_TEST_OPEN_REGISTRATION does.
//   BASE_URL=http://localhost:3000 DATABASE_URL=<local test database> MAIL_STUB_DIR=<the server's> node --test scripts/account-tokens.test.cjs
//
// Not covered here: a server restart, as this suite doesn't own the server. The cooldown is read from the
// token rows (createdAt), which is what a restart would leave, so the rows are what is changed and checked.
// A request at exactly the expiry instant can't be made over HTTP, so expiry is checked 1 ms before now,
// and at a moment safely ahead of it.
const { test, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomBytes } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser, addSession } = require("./lib/test-users.cjs");
const { mailFiles, readMailLink } = require("./lib/signup.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const ORIGIN = new URL(BASE).origin;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
const SUFFIX = `x${run}@test.dev`;
const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a different long passphrase";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

let counter = 0, clients = 0;
const created = [];
const minted = [];

/** A client address nobody else in this run uses, as the trusted proxy would append it. */
const newIp = () => { const n = ++clients; return `198.51.${100 + (n >> 8)}.${n & 255}`; };

async function call(method, urlPath, body, { ip = newIp(), cookie, headers = {} } = {}) {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Origin: ORIGIN, "X-Forwarded-For": ip, ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json, text, headers: res.headers };
}
const sessionCookie = (res) => res.headers.getSetCookie().find((c) => c.startsWith("fit_session="))?.split(";")[0];
const register = (email, opts) => call("POST", "/api/auth/register", { email }, opts);
const complete = (token, password, opts) => call("POST", "/api/auth/register/complete", { token, password }, opts);
const forgot = (email, opts) => call("POST", "/api/auth/password/forgot", { email }, opts);
const reset = (token, password, opts) => call("POST", "/api/auth/password/reset", { token, password }, opts);
const login = (email, password, opts) => call("POST", "/api/auth/login", { email, password }, opts);
const changePassword = (cookie, currentPassword, newPassword, opts) => call("POST", "/api/account/password", { currentPassword, newPassword }, { ...opts, cookie });
const deleteAccount = (cookie, password) => call("POST", "/api/account/delete", { password, confirmation: "DELETE" }, { cookie });
const exportData = (cookie, password) => call("POST", "/api/account/export", { password }, { cookie });
const profileStatus = async (cookie) => (await call("GET", "/api/profile", undefined, { cookie })).status;

function emailFor(label) {
  const email = `tok${label}${++counter}${SUFFIX}`;
  created.push(email);
  return email;
}
async function newUser(label, { password = PASSWORD } = {}) {
  const email = emailFor(label);
  const { user, token } = await createSignedInUser(prisma, email, { password });
  return { user, email, cookie: `fit_session=${token}`, token };
}
/** A live token for this address, with its row written directly. Returns the token, which is what an email would carry. */
async function mint(purpose, email, { userId = null, expiresAt = new Date(Date.now() + 3_600_000), createdAt } = {}) {
  const token = randomBytes(32).toString("base64url");
  minted.push(token);
  await prisma.accountToken.create({ data: { id: sha256(token), purpose, email, userId, expiresAt, ...(createdAt ? { createdAt } : {}) } });
  return token;
}
const rowOf = (token) => prisma.accountToken.findUnique({ where: { id: sha256(token) } });
const users = (email) => prisma.user.count({ where: { email } });
const statuses = (results) => results.map((r) => r.status).sort();
const countOf = (results, status) => results.filter((r) => r.status === status).length;

/** Mail written since `seen`, to this address. */
function mailSince(email, seen) {
  const dir = process.env.MAIL_STUB_DIR;
  return [...mailFiles(dir)].filter((f) => !seen.has(f)).map((f) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return null; }
  }).filter((m) => m && String(m.to).trim().toLowerCase() === email);
}
/** Mail is written by a job shortly after the answer, so absence only means something after a wait. */
async function assertNoMailSince(email, seen, label = email) {
  await sleep(1500);
  assert.deepEqual(mailSince(email, seen).map((m) => m.kind), [], `no mail for ${label}`);
}
async function waitForKind(email, kind, seen, timeoutMs = 10_000) {
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; await sleep(100)) {
    const found = mailSince(email, seen).filter((m) => m.kind === kind);
    if (found.length) return found;
  }
  throw new Error(`no '${kind}' mail for ${email} arrived in ${timeoutMs} ms`);
}

before(async () => {
  await target.verifyServer();
  mailFiles(process.env.MAIL_STUB_DIR); // fails clearly when MAIL_STUB_DIR isn't set
});
after(async () => {
  const mine = { OR: [{ email: { in: created } }, { email: { endsWith: SUFFIX } }] };
  await prisma.accountToken.deleteMany({ where: mine });
  const ids = (await prisma.user.findMany({ where: mine, select: { id: true } })).map((u) => u.id);
  await prisma.accountToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.profile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

// ─── A token's life ─────────────────────────────────────────────────────────

test("a sign-up token works up to its expiry and not after, and no account comes from an expired one", async () => {
  const live = emailFor("expl"), dead = emailFor("expd");
  const liveToken = await mint("SIGNUP", live), deadToken = await mint("SIGNUP", dead);
  await prisma.accountToken.update({ where: { id: sha256(deadToken) }, data: { expiresAt: new Date(Date.now() - 1) } });
  await prisma.accountToken.update({ where: { id: sha256(liveToken) }, data: { expiresAt: new Date(Date.now() + 5_000) } });
  const refused = await complete(deadToken, PASSWORD);
  assert.equal(refused.status, 400, "1 ms past expiry");
  assert.equal(await users(dead), 0);
  assert.equal(sessionCookie(refused), undefined);
  assert.equal((await complete(liveToken, PASSWORD)).status, 200, "not yet expired");
  assert.equal(await users(live), 1);
});

test("a reset token works up to its expiry and not after, and the password stays as it was", async () => {
  const dead = await newUser("rexpd"), live = await newUser("rexpl");
  const deadToken = await mint("PASSWORD_RESET", dead.email, { userId: dead.user.id });
  const liveToken = await mint("PASSWORD_RESET", live.email, { userId: live.user.id });
  await prisma.accountToken.update({ where: { id: sha256(deadToken) }, data: { expiresAt: new Date(Date.now() - 1) } });
  await prisma.accountToken.update({ where: { id: sha256(liveToken) }, data: { expiresAt: new Date(Date.now() + 5_000) } });
  assert.equal((await reset(deadToken, NEW_PASSWORD)).status, 400, "1 ms past expiry");
  assert.equal((await login(dead.email, PASSWORD)).status, 200, "the old password still works");
  assert.equal((await login(dead.email, NEW_PASSWORD)).status, 401);
  assert.equal(await profileStatus(dead.cookie), 200, "and its session is still there");
  assert.equal((await reset(liveToken, NEW_PASSWORD)).status, 200, "not yet expired");
  assert.equal((await login(live.email, NEW_PASSWORD)).status, 200);
});

test("a token works once", async () => {
  const email = emailFor("reuse");
  const signup = await mint("SIGNUP", email);
  assert.equal((await complete(signup, PASSWORD)).status, 200);
  assert.equal((await complete(signup, "another long passphrase")).status, 400, "the same sign-up link again");
  assert.equal(await users(email), 1);
  assert.equal((await login(email, PASSWORD)).status, 200, "the first password stands");
  assert.equal((await login(email, "another long passphrase")).status, 401);

  const u = await newUser("reuse2");
  const token = await mint("PASSWORD_RESET", u.email, { userId: u.user.id });
  assert.equal((await reset(token, NEW_PASSWORD)).status, 200);
  assert.equal((await reset(token, "yet another long passphrase")).status, 400, "the same reset link again");
  assert.equal((await login(u.email, NEW_PASSWORD)).status, 200);
  assert.equal((await login(u.email, "yet another long passphrase")).status, 401);
});

test("a token only does what it was made for", async () => {
  const u = await newUser("purpose");
  const resetToken = await mint("PASSWORD_RESET", u.email, { userId: u.user.id });
  const refusedComplete = await complete(resetToken, NEW_PASSWORD);
  assert.equal(refusedComplete.status, 400, "a reset token on complete");
  assert.equal((await login(u.email, NEW_PASSWORD)).status, 401, "so it changed nothing");
  assert.equal((await login(u.email, PASSWORD)).status, 200);

  const email = emailFor("purposeb");
  const signupToken = await mint("SIGNUP", email);
  assert.equal((await reset(signupToken, NEW_PASSWORD)).status, 400, "a sign-up token on reset");
  assert.equal(await users(email), 0, "so it created nothing");
  assert.equal(sessionCookie(refusedComplete), undefined);
});

test("purpose is checked by itself, on rows that no other rule would refuse", async () => {
  const nobody = emailFor("purposec");
  const resetRow = await mint("PASSWORD_RESET", nobody); // no user, so nothing else stops it making an account
  assert.equal((await complete(resetRow, PASSWORD)).status, 400);
  assert.equal(await users(nobody), 0, "a reset token made no account");
  const u = await newUser("purposed");
  const signupRow = await mint("SIGNUP", u.email, { userId: u.user.id }); // a user, so nothing else stops a reset
  assert.equal((await reset(signupRow, NEW_PASSWORD)).status, 400);
  assert.equal((await login(u.email, PASSWORD)).status, 200, "a sign-up token changed no password");
  assert.equal((await login(u.email, NEW_PASSWORD)).status, 401);
});

test("a reset link stops working if the account's address changes", async () => {
  const u = await newUser("moved");
  const token = await mint("PASSWORD_RESET", u.email, { userId: u.user.id });
  await prisma.user.update({ where: { id: u.user.id }, data: { email: `moved${SUFFIX}` } });
  assert.equal((await reset(token, NEW_PASSWORD)).status, 400);
  assert.equal((await login(`moved${SUFFIX}`, PASSWORD)).status, 200, "the password is unchanged");
});

test("a made-up or malformed token is refused the same way", async () => {
  const made = Buffer.alloc(32, 7).toString("base64url");
  for (const [label, token] of [["unknown", made], ["too short", "abc"], ["wrong characters", "!".repeat(43)]]) {
    const a = await complete(token, PASSWORD), b = await reset(token, PASSWORD);
    assert.equal(a.status, 400, `complete: ${label}`);
    assert.equal(b.status, 400, `reset: ${label}`);
    assert.equal(sessionCookie(a), undefined);
  }
});

// ─── Races ──────────────────────────────────────────────────────────────────

test("8 parallel completes of one token: one account, one success, no limit hit", async () => {
  const email = emailFor("par8");
  const token = await mint("SIGNUP", email);
  const ip = newIp();
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => complete(token, `${PASSWORD} ${i}`, { ip })));
  assert.equal(countOf(results, 200), 1, `exactly one succeeded: ${statuses(results)}`);
  assert.equal(countOf(results, 429), 0, "none was limited");
  assert.ok(results.every((r) => r.status === 200 || r.status === 400), `the rest were refused cleanly: ${statuses(results)}`);
  assert.equal(await users(email), 1);
  const winner = results.findIndex((r) => r.status === 200);
  assert.equal((await login(email, `${PASSWORD} ${winner}`)).status, 200, "the winner's password is the one set");
});

test("two live tokens for one address redeemed together: one account, no server error", async () => {
  const email = emailFor("twosign");
  const [a, b] = [await mint("SIGNUP", email), await mint("SIGNUP", email)];
  const ip = newIp();
  const results = await Promise.all([complete(a, `${PASSWORD} A`, { ip }), complete(b, `${PASSWORD} B`, { ip })]);
  assert.ok(results.every((r) => r.status < 500), `no server error: ${statuses(results)}`);
  assert.equal(countOf(results, 200), 1, `exactly one succeeded: ${statuses(results)}`);
  assert.equal(countOf(results, 400), 1);
  assert.equal(await users(email), 1);
  const winner = results[0].status === 200 ? "A" : "B";
  assert.equal((await login(email, `${PASSWORD} ${winner}`)).status, 200);
  assert.equal(await prisma.accountToken.count({ where: { email } }), 0, "and the other link is gone");
});

test("5 parallel resets of one token: one success", async () => {
  const u = await newUser("par5");
  const token = await mint("PASSWORD_RESET", u.email, { userId: u.user.id });
  const ip = newIp();
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => reset(token, `${NEW_PASSWORD} ${i}`, { ip })));
  assert.equal(countOf(results, 200), 1, `exactly one succeeded: ${statuses(results)}`);
  assert.ok(results.every((r) => r.status === 200 || r.status === 400), `the rest were refused cleanly: ${statuses(results)}`);
  const winner = results.findIndex((r) => r.status === 200);
  assert.equal((await login(u.email, `${NEW_PASSWORD} ${winner}`)).status, 200);
  assert.equal((await login(u.email, PASSWORD)).status, 401, "the old password is gone");
});

test("two reset tokens used together: one success, no server error", async () => {
  const u = await newUser("twores");
  const [a, b] = [await mint("PASSWORD_RESET", u.email, { userId: u.user.id }), await mint("PASSWORD_RESET", u.email, { userId: u.user.id })];
  const ip = newIp();
  const results = await Promise.all([reset(a, `${NEW_PASSWORD} A`, { ip }), reset(b, `${NEW_PASSWORD} B`, { ip })]);
  assert.ok(results.every((r) => r.status < 500), `no server error: ${statuses(results)}`);
  assert.equal(countOf(results, 200), 1, `exactly one succeeded: ${statuses(results)}`);
  const winner = results[0].status === 200 ? "A" : "B";
  assert.equal((await login(u.email, `${NEW_PASSWORD} ${winner}`)).status, 200);
  assert.equal(await prisma.accountToken.count({ where: { userId: u.user.id } }), 0, "and the other link is gone");
});

test("a reset racing the account's deletion: no server error, and no account or link left behind", async () => {
  for (let i = 0; i < 4; i++) {
    const u = await newUser(`racedel${i}`);
    const token = await mint("PASSWORD_RESET", u.email, { userId: u.user.id });
    await mint("SIGNUP", u.email); // a link with no user, which only the address finds
    const [resetRes, deleteRes] = await Promise.all([
      reset(token, NEW_PASSWORD),
      (async () => { await sleep(i * 25); return deleteAccount(u.cookie, PASSWORD); })(),
    ]);
    assert.ok(resetRes.status < 500 && deleteRes.status < 500, `no server error: reset ${resetRes.status}, delete ${deleteRes.status}`);
    assert.ok([200, 400].includes(resetRes.status), `reset: ${resetRes.status}`);
    assert.ok([200, 401, 403, 409].includes(deleteRes.status), `delete: ${deleteRes.status}`);
    if (deleteRes.status !== 200) {
      // The reset won and changed the password and ended the session, so the owner signs in again and deletes.
      const again = await login(u.email, NEW_PASSWORD);
      assert.equal(again.status, 200);
      assert.equal((await deleteAccount(sessionCookie(again), NEW_PASSWORD)).status, 200);
    }
    assert.equal(await users(u.email), 0, "no account left behind");
    assert.equal(await prisma.accountToken.count({ where: { OR: [{ userId: u.user.id }, { email: u.email }] } }), 0, "and no link, by user or by address");
    assert.equal(await prisma.session.count({ where: { userId: u.user.id } }), 0);
  }
});

// ─── Races in a known order ─────────────────────────────────────────────────
// Timing alone might never hit the window. So this holds the row, or a table, the way a slow transaction would, sees in
// PostgreSQL's own view that each request is waiting on it, and lets go. Holds stay under Prisma's 5-second default.

/** How many of this database's connections are waiting on a lock. Only ever read here. */
const blockedCount = async () => (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`))[0].n;
// Counted from when the lock was taken, so that something left over from an earlier failure can't look like this test's request.
let blockedBefore = 0;
async function waitForBlocked(n, label) {
  for (const deadline = Date.now() + 3500; Date.now() < deadline; await sleep(25)) if ((await blockedCount()) - blockedBefore >= n) return;
  throw new Error(`${label}: ${n} request(s) never reached the lock`);
}
const heldLocks = new Set();
// A failing test must not leave its lock behind for the next one.
afterEach(async () => { for (const release of heldLocks) await release(); });
async function hold(sql, ...params) {
  blockedBefore = await blockedCount();
  let release, locked;
  const gate = new Promise((r) => { release = r; });
  const held = new Promise((r) => { locked = r; });
  const done = prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(sql, ...params);
    locked();
    await gate;
  }, { maxWait: 10_000, timeout: 30_000 });
  await held;
  const letGo = async () => { heldLocks.delete(letGo); release(); await done; };
  heldLocks.add(letGo);
  return letGo;
}
const holdUserRow = (userId) => hold(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, userId);

test("a reset first, then a login that checked the old password: the login gets no session", async () => {
  const u = await newUser("seqlogin");
  const token = await mint("PASSWORD_RESET", u.email, { userId: u.user.id });
  const release = await holdUserRow(u.user.id);
  const resetting = reset(token, NEW_PASSWORD);
  await waitForBlocked(1, "reset");
  const loggingIn = login(u.email, PASSWORD);
  await waitForBlocked(2, "login");
  await release();
  const [r, l] = await Promise.all([resetting, loggingIn]);
  assert.equal(r.status, 200);
  assert.equal(l.status, 401, "its password check no longer counts");
  assert.equal(sessionCookie(l), undefined);
  assert.equal(await prisma.session.count({ where: { userId: u.user.id } }), 0);
});

test("a login first, then a reset: the login's session doesn't survive", async () => {
  const u = await newUser("seqlogin2");
  await prisma.session.deleteMany({ where: { userId: u.user.id } });
  const token = await mint("PASSWORD_RESET", u.email, { userId: u.user.id });
  const release = await holdUserRow(u.user.id);
  const loggingIn = login(u.email, PASSWORD);
  await waitForBlocked(1, "login");
  const resetting = reset(token, NEW_PASSWORD);
  await waitForBlocked(2, "reset");
  await release();
  const [l, r] = await Promise.all([loggingIn, resetting]);
  assert.equal(r.status, 200);
  assert.equal(l.status, 200, "this order lets the login finish first");
  assert.equal(await profileStatus(sessionCookie(l)), 401, "and the reset then ends its session");
  assert.equal(await prisma.session.count({ where: { userId: u.user.id } }), 0);
});

test("a reset first, then a password change that checked the old one: the reset stands", async () => {
  const u = await newUser("seqchange");
  const token = await mint("PASSWORD_RESET", u.email, { userId: u.user.id });
  const release = await holdUserRow(u.user.id);
  const resetting = reset(token, NEW_PASSWORD);
  await waitForBlocked(1, "reset");
  const changing = changePassword(u.cookie, PASSWORD, "the attacker's chosen passphrase");
  await waitForBlocked(2, "change");
  await release();
  const [r, c] = await Promise.all([resetting, changing]);
  assert.equal(r.status, 200);
  assert.equal(c.status, 409, "it can't overwrite the owner's new password");
  assert.equal(sessionCookie(c), undefined, "and gets no session");
  assert.equal((await login(u.email, NEW_PASSWORD)).status, 200);
  assert.equal((await login(u.email, "the attacker's chosen passphrase")).status, 401);
});

test("a reset first, then a deletion that checked the old password: nothing is deleted", async () => {
  const u = await newUser("seqdelete");
  const token = await mint("PASSWORD_RESET", u.email, { userId: u.user.id });
  const release = await holdUserRow(u.user.id);
  const resetting = reset(token, NEW_PASSWORD);
  await waitForBlocked(1, "reset");
  const deleting = deleteAccount(u.cookie, PASSWORD);
  await waitForBlocked(2, "deletion");
  await release();
  const [r, d] = await Promise.all([resetting, deleting]);
  assert.equal(r.status, 200);
  assert.equal(d.status, 409);
  assert.equal(await users(u.email), 1, "the account stands");
  assert.equal((await login(u.email, NEW_PASSWORD)).status, 200);
});

test("S-19: a reset committing while an export reads: the export is refused, and hands over nothing", async () => {
  const u = await newUser("seqexport");
  const token = await mint("PASSWORD_RESET", u.email, { userId: u.user.id });
  // The export takes its snapshot, then waits here. The reset doesn't touch this table, so it finishes meanwhile.
  const release = await hold(`LOCK TABLE "NutritionTarget" IN ACCESS EXCLUSIVE MODE`);
  const exporting = exportData(u.cookie, PASSWORD);
  await waitForBlocked(1, "export");
  const r = await reset(token, NEW_PASSWORD);
  assert.equal(r.status, 200, "the export holds nothing that delays the reset");
  await release();
  const e = await exporting;
  assert.equal(e.status, 409, "its password check no longer counts");
  assert.equal(e.body.account, undefined, "no data");
  assert.ok(!e.text.includes(u.email), "not even the address");
});

test("S-19: without a reset, an export reads a consistent snapshot, for this person only", async () => {
  const u = await newUser("seqexport2"), other = await newUser("seqexport3");
  const res = await exportData(u.cookie, PASSWORD);
  assert.equal(res.status, 200);
  assert.equal(res.body.account.email, u.email);
  assert.ok(!res.text.includes(other.email));
  assert.ok(!/passwordHash|argon2/.test(res.text));
});

test("an export is one point in time: a row added while it reads isn't in the file", async () => {
  const u = await newUser("snapshot");
  const release = await hold(`LOCK TABLE "NutritionTarget" IN ACCESS EXCLUSIVE MODE`);
  const exporting = exportData(u.cookie, PASSWORD);
  await waitForBlocked(1, "export");
  // The export has its snapshot, and reads this table only after the one it's waiting on.
  await prisma.exercise.create({ data: { userId: u.user.id, name: `added late ${run}`, primaryMuscle: "BACK", equipment: "CABLE" } });
  await release();
  const e = await exporting;
  assert.equal(e.status, 200);
  assert.ok(!e.text.includes(`added late ${run}`), "the file holds what was true when it began");
  assert.equal((await deleteAccount(u.cookie, PASSWORD)).status, 200);
});

test("S-21: a row held past the transaction limit: login and reset refuse, change nothing, and recover", async (t) => {
  const u = await newUser("limit");
  await prisma.session.deleteMany({ where: { userId: u.user.id } });
  const token = await mint("PASSWORD_RESET", u.email, { userId: u.user.id });
  const release = await holdUserRow(u.user.id);
  const started = Date.now();
  const settledAt = {};
  const timed = (name, p) => p.then((res) => { settledAt[name] = Date.now() - started; return res; });
  const waiting = [timed("login", login(u.email, PASSWORD)), timed("reset", reset(token, NEW_PASSWORD))];
  await waitForBlocked(2, "login and reset");
  // The limit is per lock, and whichever arrived second waits for two: its place in the queue, then the row.
  await sleep(9000);
  assert.deepEqual(Object.keys(settledAt).sort(), ["login", "reset"], "both gave up by themselves, with the row still held");
  await release();
  const [l, r] = await Promise.all(waiting);
  t.diagnostic(`S-21: settled at ${JSON.stringify(settledAt)} ms, statuses login ${l.status}, reset ${r.status}`);
  assert.ok(Math.min(settledAt.login, settledAt.reset) < 5000, "the first in the queue, within one limit");
  assert.ok(Math.max(settledAt.login, settledAt.reset) < 9000, "the second, within two, and not when the row was released");
  assert.equal(l.status, 503, "login past the limit");
  assert.equal(r.status, 503, "reset past the limit");
  assert.equal(l.headers.get("retry-after"), "5");
  assert.ok(!/passwordHash|Prisma|55P03|lock/i.test(l.text + r.text), "and says nothing about why");
  assert.equal(sessionCookie(l), undefined);
  assert.equal(await prisma.session.count({ where: { userId: u.user.id } }), 0, "no session");
  assert.notEqual(await rowOf(token), null, "the link isn't spent");
  const ok = await login(u.email, PASSWORD);
  assert.equal(ok.status, 200, "the old password still stands, and the server has recovered");
  assert.equal((await reset(token, NEW_PASSWORD)).status, 200, "and the link still works");
});

test("S-21: a password change past the limit answers 503 too, keeps the old password and every session", async () => {
  const u = await newUser("limitchg");
  const other = `fit_session=${await addSession(prisma, u.user.id)}`;
  const release = await holdUserRow(u.user.id);
  const started = Date.now();
  const c = await changePassword(u.cookie, PASSWORD, NEW_PASSWORD);
  const elapsed = Date.now() - started;
  await release();
  assert.ok(elapsed < 5000, `it gave up by itself, in ${elapsed} ms`);
  assert.equal(c.status, 503);
  assert.ok(!/passwordHash|Prisma|55P03|lock/i.test(c.text), "and says nothing about why");
  assert.equal(sessionCookie(c), undefined);
  assert.equal(await profileStatus(u.cookie), 200, "this session stands");
  assert.equal(await profileStatus(other), 200, "and the other device's");
  assert.equal((await login(u.email, PASSWORD)).status, 200, "the old password stands");
  assert.equal((await login(u.email, NEW_PASSWORD)).status, 401);
});

test("a timed-out wait leaves no open transaction, and the limit ends with its transaction", async () => {
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%' AND pid <> pg_backend_pid()`);
  assert.equal(n, 0, "nothing is left idle in a transaction");
  const one = new PrismaClient({ datasources: { db: { url: `${target.databaseUrl}${target.databaseUrl.includes("?") ? "&" : "?"}connection_limit=1` } } });
  try {
    const [{ lock_timeout: normal }] = await one.$queryRawUnsafe("SHOW lock_timeout");
    const inside = await one.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '4s'`;
      return (await tx.$queryRawUnsafe("SHOW lock_timeout"))[0].lock_timeout;
    });
    assert.equal(inside, "4s");
    const [{ lock_timeout: after }] = await one.$queryRawUnsafe("SHOW lock_timeout");
    assert.equal(after, normal, "the same connection is back to normal afterward");
  } finally { await one.$disconnect(); }
});

// ─── Reset and change-password end sessions ─────────────────────────────────

test("a reset ends every session and the old password, and signs nobody in", async () => {
  const u = await newUser("endall");
  const others = [`fit_session=${await addSession(prisma, u.user.id)}`, `fit_session=${await addSession(prisma, u.user.id)}`];
  for (const c of [u.cookie, ...others]) assert.equal(await profileStatus(c), 200, "signed in before");
  const token = await mint("PASSWORD_RESET", u.email, { userId: u.user.id });
  const seen = mailFiles();
  const r = await reset(token, NEW_PASSWORD);
  assert.equal(r.status, 200);
  const set = r.headers.getSetCookie().find((c) => c.startsWith("fit_session="));
  assert.ok(!set || /^fit_session=;/.test(set), "the reset signs nobody in: any session cookie it sets is empty");
  for (const c of [u.cookie, ...others]) assert.equal(await profileStatus(c), 401, "every old session is ended");
  assert.equal((await login(u.email, PASSWORD)).status, 401, "the old password fails");
  assert.equal((await login(u.email, NEW_PASSWORD)).status, 200);
  assert.equal(await prisma.accountToken.count({ where: { userId: u.user.id } }), 0);
  assert.equal((await waitForKind(u.email, "password-changed", seen)).length, 1, "and the owner is told");
});

test("changing the password keeps this session, ends the others and any pending link, and tells the owner", async () => {
  const u = await newUser("chg");
  const other = `fit_session=${await addSession(prisma, u.user.id)}`;
  const pending = await mint("PASSWORD_RESET", u.email, { userId: u.user.id });
  const seen = mailFiles();

  const wrong = await changePassword(u.cookie, "not the password", NEW_PASSWORD);
  assert.equal(wrong.status, 403);
  assert.equal((await login(u.email, PASSWORD)).status, 200, "a wrong current password changes nothing");
  assert.equal(await profileStatus(other), 200);

  const r = await changePassword(u.cookie, PASSWORD, NEW_PASSWORD);
  assert.equal(r.status, 200);
  const current = sessionCookie(r) ?? u.cookie;
  assert.equal(await profileStatus(current), 200, "this browser stays signed in");
  assert.equal(await profileStatus(other), 401, "the other device is signed out");
  assert.equal((await login(u.email, PASSWORD)).status, 401);
  assert.equal((await login(u.email, NEW_PASSWORD)).status, 200);
  assert.equal(await rowOf(pending), null, "a pending link is gone");
  assert.equal((await reset(pending, "yet another long passphrase")).status, 400);
  assert.equal((await waitForKind(u.email, "password-changed", seen)).length, 1);
});

test("a change-password request that checked the old password can't overwrite a reset", async () => {
  for (let i = 0; i < 6; i++) {
    const u = await newUser(`stale${i}`);
    const token = await mint("PASSWORD_RESET", u.email, { userId: u.user.id });
    const changed = `${NEW_PASSWORD} change ${i}`, resetTo = `${NEW_PASSWORD} reset ${i}`;
    const [change, resetRes] = await Promise.all([
      changePassword(u.cookie, PASSWORD, changed),
      (async () => { await sleep(i * 30); return reset(token, resetTo); })(),
    ]);
    assert.ok(change.status < 500 && resetRes.status < 500, `no server error: change ${change.status}, reset ${resetRes.status}`);
    const wins = [[change, changed], [resetRes, resetTo]].filter(([r]) => r.status === 200);
    assert.equal(wins.length, 1, `exactly one of them took effect (change ${change.status}, reset ${resetRes.status})`);
    const [[, winning]] = wins;
    const losing = winning === changed ? resetTo : changed;
    assert.equal((await login(u.email, winning)).status, 200, "the password is the one that was accepted");
    assert.equal((await login(u.email, losing)).status, 401, "and not the one that was refused");
    assert.equal((await login(u.email, PASSWORD)).status, 401, "nor the old one");
  }
});

// ─── The same answer, whoever asks ──────────────────────────────────────────

test("forgot-password answers the same for a known and an unknown address, and only the known one gets mail", async () => {
  const known = await newUser("fgk");
  const unknown = emailFor("fgu");
  const seen = mailFiles();
  const a = await forgot(known.email), b = await forgot(unknown);
  assert.equal(a.status, 200);
  assert.equal(b.status, a.status);
  assert.equal(b.text, a.text, "byte for byte");
  assert.equal(a.headers.getSetCookie().length + b.headers.getSetCookie().length, 0);
  const token = await readMailLink(known.email, "password-reset", { ignore: seen });
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  await assertNoMailSince(unknown, seen, "an unknown address");
  assert.equal(await prisma.accountToken.count({ where: { email: unknown } }), 0);
});

test("register answers the same for an existing and a new address, and an existing account gets no link", async () => {
  const existing = await newUser("rgk");
  const fresh = emailFor("rgn");
  const seen = mailFiles();
  const a = await register(existing.email), b = await register(fresh);
  assert.equal(a.status, 200);
  assert.equal(b.status, a.status);
  assert.equal(b.text, a.text, "byte for byte");
  assert.equal(a.headers.getSetCookie().length + b.headers.getSetCookie().length, 0, "no session at sign-up");
  // Sign-up is open on this server, so the new address gets its link. Closed sign-up is covered by production-security.
  await readMailLink(fresh, "signup", { ignore: seen });
  await assertNoMailSince(existing.email, seen, "an existing account");
  assert.equal(await prisma.accountToken.count({ where: { email: existing.email } }), 0);
  assert.equal(await users(fresh), 0, "and nothing is created until the link is used");
});

test("a second link for one address within 60 seconds isn't sent, and one is after that, judged from the token rows", async () => {
  const u = await newUser("cool");
  const seen = mailFiles();
  assert.equal((await forgot(u.email)).status, 200);
  await readMailLink(u.email, "password-reset", { ignore: seen });
  const second = await forgot(u.email);
  assert.equal(second.status, 200, "the same answer");
  await sleep(1500);
  assert.equal(mailSince(u.email, seen).filter((m) => m.kind === "password-reset").length, 1, "no second mail");
  assert.equal(await prisma.accountToken.count({ where: { email: u.email, purpose: "PASSWORD_RESET" } }), 1, "and no second row");

  // What a restart would leave is the rows, so age the row instead.
  await prisma.accountToken.updateMany({ where: { email: u.email, purpose: "PASSWORD_RESET" }, data: { createdAt: new Date(Date.now() - 61_000) } });
  assert.equal((await forgot(u.email)).status, 200);
  for (let i = 0; i < 100 && mailSince(u.email, seen).filter((m) => m.kind === "password-reset").length < 2; i++) await sleep(100);
  assert.equal(mailSince(u.email, seen).filter((m) => m.kind === "password-reset").length, 2, "after the cooldown, a new mail");
  assert.equal(await prisma.accountToken.count({ where: { email: u.email, purpose: "PASSWORD_RESET" } }), 2, "and a new row");
});

test("only hashes are stored: no row's id is a token that was emailed", async () => {
  const email = emailFor("hash"), user = await newUser("hashu");
  const seen = mailFiles();
  await register(email);
  await forgot(user.email);
  const signup = await readMailLink(email, "signup", { ignore: seen });
  const resetToken = await readMailLink(user.email, "password-reset", { ignore: seen });
  for (const token of [signup, resetToken]) {
    assert.equal(await prisma.accountToken.count({ where: { id: token } }), 0, "no row's id is the token");
    assert.equal(await prisma.accountToken.count({ where: { id: sha256(token) } }), 1, "the row is its SHA-256");
    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "AccountToken" t WHERE t::text LIKE $1`, `%${token}%`);
    assert.equal(n, 0, "and the token appears nowhere in any column");
  }
  for (const row of await prisma.accountToken.findMany({ where: { email: { in: [email, user.email] } } })) {
    assert.match(row.id, /^[0-9a-f]{64}$/, "a hash, not a 43-character token");
  }
});

// ─── Accounts with no profile ───────────────────────────────────────────────

test("a profile-less account can log in, reset, change its password, export and delete", async () => {
  const u = await newUser("noprof");
  assert.equal(await prisma.profile.count({ where: { userId: u.user.id } }), 0);
  const first = await login(u.email, PASSWORD);
  assert.equal(first.status, 200, "log in");
  assert.ok(sessionCookie(first));

  const token = await mint("PASSWORD_RESET", u.email, { userId: u.user.id });
  assert.equal((await reset(token, NEW_PASSWORD)).status, 200, "reset");
  const second = await login(u.email, NEW_PASSWORD);
  assert.equal(second.status, 200);

  const third = "yet another long passphrase";
  const changed = await changePassword(sessionCookie(second), NEW_PASSWORD, third);
  assert.equal(changed.status, 200, "change password");
  const cookie = sessionCookie(changed) ?? sessionCookie(second);
  assert.equal(await profileStatus(cookie), 200);

  const exported = await call("POST", "/api/account/export", { password: third }, { cookie });
  assert.equal(exported.status, 200, "export");
  assert.equal(exported.body.account.email, u.email);
  assert.equal(exported.body.profile, null, "no profile is null, with nothing invented");

  assert.equal((await deleteAccount(cookie, third)).status, 200, "delete");
  assert.equal(await users(u.email), 0);
});

// ─── Deletion ───────────────────────────────────────────────────────────────

test("deleting an account removes its links by user and by address, and only its own", async () => {
  const u = await newUser("delt"), bystander = await newUser("deltb");
  const byUser = await mint("PASSWORD_RESET", u.email, { userId: u.user.id });
  const byAddress = await mint("SIGNUP", u.email); // no user, so no cascade reaches it
  const other = await mint("PASSWORD_RESET", bystander.email, { userId: bystander.user.id });
  assert.equal((await deleteAccount(u.cookie, PASSWORD)).status, 200);
  assert.equal(await rowOf(byUser), null, "the link tied to the user");
  assert.equal(await rowOf(byAddress), null, "the link tied only to the address");
  assert.equal(await prisma.accountToken.count({ where: { OR: [{ userId: u.user.id }, { email: u.email }] } }), 0);
  assert.notEqual(await rowOf(other), null, "someone else's link is untouched");
  assert.equal((await complete(byAddress, PASSWORD)).status, 400, "so the address can't be revived with an old link");
  assert.equal(await users(u.email), 0);
});

// ─── Logs. Keep this last, as it reads what everything above caused. ────────

test("the server's log holds no address, token or password from this run", async () => {
  const log = process.env.SERVER_LOG_FILE;
  assert.ok(log, "the runner passes the server's log");
  await sleep(1000);
  const text = fs.readFileSync(log, "utf8");
  const mailed = [...mailFiles()].map((f) => { try { return JSON.parse(fs.readFileSync(path.join(process.env.MAIL_STUB_DIR, f), "utf8")); } catch { return null; } }).filter(Boolean);
  const tokens = [...minted, ...mailed.map((m) => /#token=([A-Za-z0-9_-]{43})/.exec(m.text)?.[1]).filter(Boolean)];
  assert.ok(tokens.length > 10, "the check has tokens to look for");
  for (const token of tokens) assert.ok(!text.includes(token), "a token reached the log");
  for (const email of created) assert.ok(!text.includes(email), "an address reached the log");
  for (const password of [PASSWORD, NEW_PASSWORD, "the attacker's chosen passphrase"]) assert.ok(!text.includes(password), "a password reached the log");
  assert.ok(!text.includes(SUFFIX), "not even part of an address");
  assert.ok(!/argon2id/.test(text), "nor a password hash");
});
