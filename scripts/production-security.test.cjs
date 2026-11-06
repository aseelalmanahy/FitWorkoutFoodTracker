// Phase 4.0.3 against a running production build and the test database, with sign-up closed.
// With HTTPS_ORIGIN set, the server is expected to have APP_ORIGIN set to it, as a deployment would.
//   BASE_URL=... DATABASE_URL=<local test database> ALLOWED_EMAIL=... node --test scripts/production-security.test.cjs
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { mailFiles, readMailLink } = require("./lib/signup.cjs");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const LOCAL_ORIGIN = new URL(BASE).origin;
const HTTPS_ORIGIN = process.env.HTTPS_ORIGIN || "";
const ORIGIN = HTTPS_ORIGIN || LOCAL_ORIGIN;
const ALLOWED_EMAIL = process.env.ALLOWED_EMAIL;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
const PASSWORD = "correct horse battery staple";
const NEUTRAL = /Sign-up is by invitation/;

const call = async (method, path, body, headers = {}) => {
  const res = await fetch(BASE + path, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Origin: ORIGIN, ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json, text, headers: res.headers };
};
// Sign-up asks for an address only. A link is mailed to an invited address that has no account, and nothing is
// mailed to any other, with the same answer to all. The mail stub's files are in MAIL_STUB_DIR.
const register = (email) => call("POST", "/api/auth/register", { email });
const complete = (token, password = PASSWORD) => call("POST", "/api/auth/register/complete", { token, password });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Every message mailed to this address so far, whatever its kind. */
function mailsTo(email) {
  const dir = process.env.MAIL_STUB_DIR;
  mailFiles(dir); // throws a clear error if MAIL_STUB_DIR isn't set
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith(".json")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  return names.map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return null; } })
    .filter((m) => m && String(m.to).trim().toLowerCase() === email.toLowerCase());
}
/** Mail is written by a job shortly after the answer, so absence is only meaningful after a wait. */
async function assertNoMail(email, label = email) {
  await sleep(1500);
  assert.deepEqual(mailsTo(email).map((m) => m.kind), [], `no mail for ${label}`);
}

before(() => target.verifyServer());
after(() => prisma.$disconnect());

if (HTTPS_ORIGIN) {
  test("on an HTTPS deployment, pages carry HSTS and the policy upgrades requests", async () => {
    const page = await call("GET", "/login");
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("strict-transport-security"), "max-age=86400");
    assert.match(page.headers.get("content-security-policy"), /upgrade-insecure-requests/);
  });

  test("mutations must come from APP_ORIGIN exactly, and no header can change that", async () => {
    const body = { email: `a${run}@test.dev`, password: PASSWORD };
    for (const [label, headers] of [
      ["a forged forwarded host", { Origin: "https://evil.example", "X-Forwarded-Host": "evil.example" }],
      ["this server's own address", { Origin: LOCAL_ORIGIN }],
      ["another origin", { Origin: "https://evil.example" }],
      ["a forged host", { Origin: "https://evil.example", Host: "evil.example" }],
      ["a forged protocol", { Origin: "http://app.example.invalid", "X-Forwarded-Proto": "https" }],
    ]) assert.equal((await call("POST", "/api/auth/login", body, headers)).status, 403, label);
    assert.equal((await call("POST", "/api/auth/login", body)).status, 401, "the configured origin reaches the handler");
    const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(res.status, 403, "no origin at all");
  });

  test("session and device cookies are Secure on this deployment too", async () => {
    const email = `cookie${run}@test.dev`;
    const { user } = await createSignedInUser(prisma, email, { password: PASSWORD });
    const res = await call("POST", "/api/auth/login", { email, password: PASSWORD });
    assert.equal(res.status, 200);
    assert.equal(res.headers.getSetCookie().length, 2, "session and device");
    for (const cookie of res.headers.getSetCookie()) {
      assert.match(cookie, /; *secure/i, cookie.split("=")[0]);
      assert.match(cookie, /; *httponly/i, cookie.split("=")[0]);
      assert.match(cookie, /; *samesite=lax/i, cookie.split("=")[0]);
    }
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
} else {
  // ─── Closed registration ──────────────────────────────────────────────────

  test("sign-up is closed: an address that isn't invited gets no account, no session, no token and no mail", async () => {
    const email = `stranger${run}@test.dev`;
    const r = await register(email);
    assert.equal(r.status, 200, "the same answer as for an invited address, so nothing says who is invited");
    assert.equal(r.headers.getSetCookie().length, 0, "no session");
    assert.equal(await prisma.user.count({ where: { email } }), 0, "nothing is stored");
    assert.equal(await prisma.accountToken.count({ where: { email } }), 0, "no link is created for it");
    await assertNoMail(email);
  });

  test("an invited address gets a link, sets a password with it, then signs in, and the app works for it", async () => {
    const r = await register(ALLOWED_EMAIL);
    assert.equal(r.status, 200);
    assert.equal(r.headers.getSetCookie().length, 0, "no session at sign-up");
    const token = await readMailLink(ALLOWED_EMAIL, "signup");
    const done = await complete(token);
    assert.equal(done.status, 200);
    assert.equal(done.headers.getSetCookie().some((c) => c.startsWith("fit_session=")), false, "completing sets no session either");
    assert.equal(await prisma.user.count({ where: { email: ALLOWED_EMAIL } }), 1, "the account exists now");
    const login = await call("POST", "/api/auth/login", { email: ALLOWED_EMAIL, password: PASSWORD });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().find((c) => c.startsWith("fit_session="));
    assert.ok(cookie, "signed in by login");
    const session = cookie.split(";")[0];
    assert.equal((await call("GET", "/api/profile", undefined, { Cookie: session })).status, 200);
    assert.equal((await call("GET", "/api/sessions", undefined, { Cookie: session })).status, 409, "the eligibility gate still applies");
    const refused = await call("PUT", "/api/profile", { name: "T", birthDate: "2020-01-01", unitSystem: "METRIC", timezone: "UTC" }, { Cookie: session });
    assert.equal(refused.status, 422, "and the under-minimum rule");
  });

  const timed = async (email) => { const t = Date.now(); const r = await register(email); return { ...r, ms: Date.now() - t }; };

  test("an existing account and an address that isn't invited get the same answer, taking about as long, and no mail", async () => {
    const existing = await timed(ALLOWED_EMAIL);
    const stranger = await timed(`other${run}@test.dev`);
    // Both answer before anything is looked up, so a real gap would mean a lookup has moved in front of the response.
    assert.ok(Math.abs(stranger.ms - existing.ms) < 250, `stranger ${stranger.ms} ms, existing ${existing.ms} ms`);
    const { user } = await createSignedInUser(prisma, `unlisted${run}@test.dev`);
    const unlisted = await register(`unlisted${run}@test.dev`);
    for (const r of [existing, stranger, unlisted]) {
      assert.equal(r.status, 200);
      assert.equal(r.text, stranger.text, "byte for byte");
      assert.equal(r.headers.getSetCookie().length, 0);
    }
    await sleep(1500);
    assert.deepEqual(mailsTo(`other${run}@test.dev`), [], "none for an address that isn't invited");
    assert.deepEqual(mailsTo(`unlisted${run}@test.dev`), [], "none for an existing account that isn't invited");
    assert.deepEqual(mailsTo(ALLOWED_EMAIL).map((m) => m.kind), ["signup"], "none for the invited existing account beyond the link it signed up with");
    assert.equal(await prisma.accountToken.count({ where: { email: { in: [`other${run}@test.dev`, `unlisted${run}@test.dev`] } } }), 0);
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  test("the allowlist can't be bypassed by the form of an address", async () => {
    const [local, domain] = ALLOWED_EMAIL.split("@");
    const variants = [`${local}+x@${domain}`, `x${local}@${domain}`, `${local}@x${domain}`, `${local}@${domain}.evil.invalid`];
    for (const variant of variants) {
      assert.equal((await register(variant)).status, 200, variant);
      assert.equal(await prisma.user.count({ where: { email: variant } }), 0, variant);
      assert.equal(await prisma.accountToken.count({ where: { email: variant } }), 0, variant);
    }
    const shouting = await register(ALLOWED_EMAIL.toUpperCase());
    assert.equal(shouting.status, 200, "the same address in capitals is the existing account, and answered the same");
    assert.equal(await prisma.user.count({ where: { email: ALLOWED_EMAIL.toUpperCase() } }), 0);
    await sleep(1500);
    for (const variant of variants) assert.deepEqual(mailsTo(variant), [], `no mail for ${variant}`);
    assert.equal(mailsTo(ALLOWED_EMAIL).length, 1, "and the capitals didn't get the invited account a second link");
  });

  test("the registration limit still applies when closed", async () => {
    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) limited = (await register(`limit${i}x${run}@test.dev`)).status === 429;
    assert.ok(limited, "429 reached");
  });

  test("the completion limit applies too, and a made-up token only ever fails", async () => {
    // One completion was spent above; 10 are allowed per client per 15 minutes.
    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) {
      const r = await complete(Buffer.alloc(32, i + 1).toString("base64url"));
      if (r.status === 429) limited = true;
      else assert.ok(r.status >= 400 && r.status < 500, `a made-up token is refused, not accepted or a server error: ${r.status}`);
      assert.equal(r.headers.getSetCookie().length, 0, "no session");
    }
    assert.ok(limited, "429 reached");
    assert.equal(await prisma.user.count({ where: { email: { startsWith: "limit", endsWith: `x${run}@test.dev` } } }), 0, "and the uninvited addresses from the limit test have no account");
  });

  // ─── Headers ──────────────────────────────────────────────────────────────

  test("pages have the baseline headers and a Content Security Policy with a fresh nonce", async () => {
    const first = await call("GET", "/login");
    assert.equal(first.status, 200);
    const h = first.headers;
    assert.equal(h.get("x-frame-options"), "DENY");
    assert.equal(h.get("x-content-type-options"), "nosniff");
    assert.equal(h.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.match(h.get("permissions-policy"), /microphone=\(\)/);
    assert.equal(h.get("cross-origin-opener-policy"), "same-origin");
    assert.match(h.get("x-robots-tag"), /noindex/);
    assert.equal(h.get("x-powered-by"), null);
    assert.equal(h.get("strict-transport-security"), null, "no HSTS without an HTTPS origin");
    const policy = h.get("content-security-policy");
    assert.match(policy, /frame-ancestors 'none'/);
    assert.doesNotMatch(policy.match(/script-src [^;]+/)[0], /'unsafe-inline'|'unsafe-eval'/);
    const nonce = policy.match(/'nonce-([^']+)'/)[1];
    assert.ok(first.text.includes(`nonce="${nonce}"`), "the page's scripts carry it");
    const inline = [...first.text.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)];
    assert.ok(inline.length > 0, "there are inline scripts to check");
    for (const m of inline) assert.ok(m[1].includes(`nonce="${nonce}"`), `inline script without the nonce: ${m[1]}`);
    const second = await call("GET", "/login");
    assert.notEqual(second.headers.get("content-security-policy").match(/'nonce-([^']+)'/)[1], nonce, "fresh on each request");
    assert.equal(first.text.includes("x-nonce"), false);
  });

  test("signed-out redirects keep their policy, and public pages stay public", async () => {
    for (const path of ["/dashboard", "/profile", "/account", "/onboarding", "/account-restricted", "/nutrition/targets"]) {
      const r = await call("GET", path);
      assert.equal(r.status, 307, path);
      assert.match(r.headers.get("location"), /\/login$/, path);
      assert.ok(r.headers.get("content-security-policy"), path);
    }
    for (const path of ["/login", "/register", "/account-deleted"]) assert.equal((await call("GET", path)).status, 200, path);
  });

  test("the sign-up page says it's by invitation", async () => {
    assert.match((await call("GET", "/register")).text, /Sign-up is by invitation/);
  });

  test("API responses can't be cached or load anything", async () => {
    const r = await call("GET", "/api/profile");
    assert.equal(r.status, 401);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.match(r.headers.get("content-security-policy"), /default-src 'none'/);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  });

  // ─── Health and errors ────────────────────────────────────────────────────

  test("health says only that it's up", async () => {
    const r = await call("GET", "/api/health");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { status: "ok" });
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(r.text, /fitdb|postgres|localhost|version|\d+\.\d+/i);
    for (const method of ["POST", "PUT", "DELETE"]) assert.equal((await call(method, "/api/health", {})).status, 405, method);
  });

  test("errors are safe, and Prisma's text stays out of the server log", async () => {
    const owner = await createSignedInUser(prisma, `s10a${run}@test.dev`, { password: PASSWORD });
    const other = await createSignedInUser(prisma, `s10b${run}@test.dev`, { password: PASSWORD });
    const exercise = await prisma.exercise.create({ data: { userId: owner.user.id, name: `S10 ${run}`, primaryMuscle: "BACK", equipment: "CABLE" } });
    const crossing = await prisma.workoutTemplate.create({ data: { userId: other.user.id, name: "Crossing", exercises: { create: { exerciseId: exercise.id, position: 0, targetSets: 1, targetRepsMin: 1, targetRepsMax: 1 } } } });
    const session = `fit_session=${owner.token}`;
    const r = await call("POST", "/api/account/delete", { password: PASSWORD, confirmation: "DELETE" }, { Cookie: session });
    assert.equal(r.status, 409, "the failure that S-10 was seen on");
    assert.doesNotMatch(r.text, new RegExp(`${exercise.id}|prisma|Postgres|constraint`, "i"), "nothing internal in the answer");
    const broken = await call("POST", "/api/auth/login", undefined, { "Content-Type": "application/json" });
    assert.equal(broken.status, 400);
    assert.doesNotMatch(broken.text, /stack|at .*\.js|prisma/i);

    await new Promise((resolve) => setTimeout(resolve, 300));
    const log = fs.readFileSync(process.env.SERVER_LOG_FILE, "utf8");
    assert.equal(log.includes(exercise.id), false, "no row id in the log");
    assert.equal(log.includes(owner.user.id), false, "no user id in the log");
    assert.equal(log.includes(`s10a${run}`), false, "no email in the log");
    assert.doesNotMatch(log, /prisma:error|Invalid `|PostgresError|violates/, "no raw Prisma text");
    assert.equal(log.includes(PASSWORD), false, "no password in the log");

    await prisma.workoutTemplate.delete({ where: { id: crossing.id } });
    assert.equal((await call("POST", "/api/account/delete", { password: PASSWORD, confirmation: "DELETE" }, { Cookie: session })).status, 200, "account deletion still works");
    await prisma.session.deleteMany({ where: { userId: other.user.id } });
    await prisma.user.delete({ where: { id: other.user.id } });
  });

  test("account export still downloads under these headers", async () => {
    const u = await createSignedInUser(prisma, `exportcheck${run}@test.dev`, { password: PASSWORD });
    const session = `fit_session=${u.token}`;
    const r = await call("POST", "/api/account/export", { password: PASSWORD }, { Cookie: session });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-disposition"), /^attachment; filename=/);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.body.account.email, `exportcheck${run}@test.dev`);
    assert.equal((await call("POST", "/api/account/delete", { password: PASSWORD, confirmation: "DELETE" }, { Cookie: session })).status, 200);
  });

  test("image validation is off while AI is off", async () => {
    const u = await createSignedInUser(prisma, `images${run}@test.dev`);
    await prisma.profile.create({ data: { userId: u.user.id, name: "I", birthDate: new Date("1990-01-01T00:00:00Z"), unitSystem: "METRIC", timezone: "UTC" } });
    const res = await fetch(`${BASE}/api/images/validate`, { method: "POST", headers: { Origin: ORIGIN, Cookie: `fit_session=${u.token}`, "Content-Type": "image/png" }, body: Buffer.from("x") });
    assert.equal(res.status, 404);
    await prisma.profile.delete({ where: { userId: u.user.id } });
    await prisma.session.deleteMany({ where: { userId: u.user.id } });
    await prisma.user.delete({ where: { id: u.user.id } });
  });
}
