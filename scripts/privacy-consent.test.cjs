// Phase 4.0.5 against the real database: acceptance recorded with the account, and the public pages.
// Run through scripts/run-guarded-suites.cjs. Rows are removed by this run's own addresses.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash, randomBytes } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser } = require("./lib/test-users.cjs");
const { mailFiles, readMailLink, NOTICE_VERSION } = require("./lib/signup.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const ORIGIN = new URL(BASE).origin;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
const SUFFIX = `x${run}@test.dev`;
const PASSWORD = "correct horse battery staple";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
let counter = 0, clients = 0;
const email = (label) => `consent${label}${++counter}${SUFFIX}`;
const newIp = () => { const n = ++clients; return `198.51.${120 + (n >> 8)}.${n & 255}`; };

async function call(method, urlPath, body, { ip = newIp(), cookie } = {}) {
  const res = await fetch(BASE + urlPath, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Origin: ORIGIN, "X-Forwarded-For": ip, ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json, text, headers: res.headers };
}
async function mint(address) {
  const token = randomBytes(32).toString("base64url");
  await prisma.accountToken.create({ data: { id: sha256(token), purpose: "SIGNUP", email: address, expiresAt: new Date(Date.now() + 3_600_000) } });
  return token;
}
const complete = (body, opts) => call("POST", "/api/auth/register/complete", body, opts);

before(async () => {
  await target.verifyServer();
  mailFiles(process.env.MAIL_STUB_DIR);
});
after(async () => {
  const mine = { email: { endsWith: SUFFIX } };
  await prisma.accountToken.deleteMany({ where: mine });
  const ids = (await prisma.user.findMany({ where: mine, select: { id: true } })).map((u) => u.id);
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("a real sign-up records the server's version and time with the account, and the export shows them", async () => {
  const address = email("real");
  const seen = mailFiles();
  assert.equal((await call("POST", "/api/auth/register", { email: address })).status, 200);
  const token = await readMailLink(address, "signup", { ignore: seen });
  const started = Date.now();
  const done = await complete({ token, password: PASSWORD, acceptedVersion: NOTICE_VERSION, termsVersion: "forged", termsAcceptedAt: "1999-01-01T00:00:00Z" });
  assert.equal(done.status, 200);
  const user = await prisma.user.findUnique({ where: { email: address } });
  assert.equal(user.termsVersion, NOTICE_VERSION);
  assert.ok(user.termsAcceptedAt.getTime() >= started - 2000 && user.termsAcceptedAt.getTime() <= Date.now() + 2000, "the server's time");

  const login = await call("POST", "/api/auth/login", { email: address, password: PASSWORD });
  const cookie = login.headers.getSetCookie().find((c) => c.startsWith("fit_session=")).split(";")[0];
  const exported = await call("POST", "/api/account/export", { password: PASSWORD }, { cookie });
  assert.equal(exported.status, 200);
  assert.equal(exported.body.account.termsVersion, NOTICE_VERSION);
  assert.equal(exported.body.account.termsAcceptedAt, user.termsAcceptedAt.toISOString());
});

test("missing acceptance creates nothing, and leaves the link usable", async () => {
  const address = email("miss");
  const token = await mint(address);
  assert.equal((await complete({ token, password: PASSWORD })).status, 400);
  assert.equal((await complete({ token, password: PASSWORD, acceptedVersion: "" })).status, 400);
  assert.equal(await prisma.user.count({ where: { email: address } }), 0);
  assert.equal(await prisma.accountToken.count({ where: { id: sha256(token) } }), 1);
  assert.equal((await complete({ token, password: PASSWORD, acceptedVersion: NOTICE_VERSION })).status, 200);
});

test("an out-of-date version gets 409, creates nothing, names no version, and leaves the link usable", async () => {
  const address = email("old");
  const token = await mint(address);
  const r = await complete({ token, password: PASSWORD, acceptedVersion: "draft-1999-01-01" });
  assert.equal(r.status, 409);
  assert.ok(!r.text.includes(NOTICE_VERSION));
  assert.equal(await prisma.user.count({ where: { email: address } }), 0);
  assert.equal(await prisma.accountToken.count({ where: { id: sha256(token) } }), 1);
});

test("a wrong version reads the same for a real link and a made-up one", async () => {
  const token = await mint(email("oracle"));
  const made = Buffer.alloc(32, 9).toString("base64url");
  const [a, b] = [await complete({ token, password: PASSWORD, acceptedVersion: "old" }), await complete({ token: made, password: PASSWORD, acceptedVersion: "old" })];
  assert.equal(a.status, b.status);
  assert.equal(a.text, b.text);
});

test("parallel completion still gives one account, each with acceptance", async () => {
  const address = email("par");
  const token = await mint(address);
  const ip = newIp();
  const results = await Promise.all(Array.from({ length: 6 }, () => complete({ token, password: PASSWORD, acceptedVersion: NOTICE_VERSION }, { ip })));
  assert.equal(results.filter((r) => r.status === 200).length, 1, results.map((r) => r.status).join());
  assert.equal(await prisma.user.count({ where: { email: address, termsVersion: NOTICE_VERSION } }), 1);
});

test("an account with no acceptance keeps working, and its export shows null, not an invented value", async () => {
  const u = await createSignedInUser(prisma, email("none"), { password: PASSWORD });
  const exported = await call("POST", "/api/account/export", { password: PASSWORD }, { cookie: `fit_session=${u.token}` });
  assert.equal(exported.status, 200);
  assert.equal(exported.body.account.termsVersion, null);
  assert.equal(exported.body.account.termsAcceptedAt, null);
});

test("the pages are public, marked as drafts, show their version, and set no cookie", async () => {
  for (const route of ["/privacy", "/terms"]) {
    const r = await call("GET", route);
    assert.equal(r.status, 200, route);
    assert.match(r.text, /Draft\./, route);
    assert.ok(r.text.includes(NOTICE_VERSION), route);
    assert.match(r.text, /TO CONFIRM/, route);
    assert.equal(r.headers.getSetCookie().length, 0, route);
    assert.match(r.headers.get("x-robots-tag") ?? "", /noindex/, route);
  }
});

test("the report's transaction really refuses writes", async () => {
  await assert.rejects(prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.$executeRawUnsafe(`UPDATE "User" SET email = email WHERE false`);
  }), /read-only|25006/);
});

test("the account-facts report reads real rows, changes nothing, and names nobody", async () => {
  const before = await prisma.user.count();
  const r = spawnSync(process.execPath, [path.join(__dirname, "account-facts.cjs"), `--confirm=${decodeURIComponent(new URL(target.databaseUrl).pathname.slice(1))}`], { encoding: "utf8", timeout: 120_000, env: { ...process.env, BASE_URL: "", NODE_TEST_CONTEXT: "" } });
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  const report = JSON.parse(r.stdout);
  assert.equal(report.rows.length, 4);
  assert.doesNotMatch(r.stdout, /@|cm[a-z0-9]{20}/, "no address or id");
  assert.equal(await prisma.user.count(), before);
});
