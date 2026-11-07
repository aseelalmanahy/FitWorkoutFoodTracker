// e2e-privacy.cjs removes what it made, and only that, however it ends. Each case runs the real script against a real
// server, in one browser, and makes it fail at a chosen point. Through scripts/run-guarded-suites.cjs. Rows are matched by
// exact address, and anything a failed case left is removed by this file, so it leaves nothing behind either.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const SCRIPT = path.join(__dirname, "e2e-privacy.cjs");
const stamp = Date.now();
let runs = 0;
const usedAddresses = [];
const addressFor = (run) => `privacychromium${run}@test.dev`;

const bystanders = [];
/** A new run's number, with rows beside it that share that number and look like its address. Only an exact match leaves them alone. */
async function prepareRun() {
  const run = `${stamp}${++runs}`;
  usedAddresses.push(addressFor(run));
  for (const email of [`${addressFor(run).replace("@", "x@")}`, `x${addressFor(run)}`, `privacyfirefox${run}@test.dev`, addressFor(run).replace("@test.dev", "@other.dev")]) {
    bystanders.push(email);
    await prisma.user.create({ data: { email, passwordHash: "not-a-real-hash" } });
    await prisma.accountToken.create({ data: { id: `bystander${email}`, purpose: "SIGNUP", email, expiresAt: new Date(Date.now() + 3_600_000) } });
  }
  return run;
}

function runScript(run, failAt) {
  const env = { ...process.env, E2E_PRIVACY_RUN: run, E2E_PRIVACY_BROWSERS: "chromium", E2E_PRIVACY_FAIL_AT: failAt };
  delete env.NODE_TEST_CONTEXT;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], { env, windowsHide: true });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const killer = setTimeout(() => { child.kill(); reject(new Error(`the script hadn't ended after 150 seconds, which isn't a result. Output:\n${out}`)); }, 150_000);
    child.on("error", reject);
    child.on("close", (code) => { clearTimeout(killer); resolve({ code, out, err, address: addressFor(run) }); });
  });
}
const rows = async (address) => ({
  tokens: await prisma.accountToken.count({ where: { email: address } }),
  users: await prisma.user.count({ where: { email: address } }),
});
const totals = async () => ({ tokens: await prisma.accountToken.count(), users: await prisma.user.count() });
async function bystandersIntact() {
  assert.equal(await prisma.user.count({ where: { email: { in: bystanders } } }), bystanders.length, "the look-alike accounts are still there");
  assert.equal(await prisma.accountToken.count({ where: { email: { in: bystanders } } }), bystanders.length, "the look-alike tokens are still there");
}

before(() => target.verifyServer());
after(async () => {
  const all = [...usedAddresses, ...bystanders];
  await prisma.accountToken.deleteMany({ where: { email: { in: all } } });
  await prisma.user.deleteMany({ where: { email: { in: all } } });
  await prisma.$disconnect();
});

async function failsAndCleansUp(failAt, reached, reason) {
  const run = await prepareRun();
  const before = await totals();
  const r = await runScript(run, failAt);
  assert.match(r.out, reached, "the failure happened where it was meant to, with those rows existing");
  assert.notEqual(r.code, 0, "a failed run says so");
  assert.match(r.err, reason, "and says why, with the cause intact");
  assert.doesNotMatch(r.out, /ALL PRIVACY CHECKS PASSED/);
  assert.match(r.out, /browsers left open: 0/);
  assert.deepEqual(await rows(r.address), { tokens: 0, users: 0 }, "nothing from the run is left");
  await bystandersIntact();
  assert.deepEqual(await totals(), before, "and nothing else was added or removed");
}

test("a failure with only a token made removes the token", () => failsAndCleansUp("after-token", /injected at after-token: tokens=1 users=0/, /injected failure at after-token/));
test("a failure after the account was made removes the account", () => failsAndCleansUp("after-account", /injected at after-account: tokens=\d users=1/, /injected failure at after-account/));
test("a run that hangs reaches its deadline, and removes the account", () => failsAndCleansUp("hang-after-account", /injected at after-account: tokens=\d users=1/, /ran past its deadline/));

test("a successful run removes what it made", async () => {
  const run = await prepareRun();
  const before = await totals();
  const r = await runScript(run, "");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /ALL PRIVACY CHECKS PASSED/);
  assert.match(r.out, /browsers left open: 0/);
  assert.deepEqual(await rows(r.address), { tokens: 0, users: 0 });
  await bystandersIntact();
  assert.deepEqual(await totals(), before);
});

test("a run whose cleanup fails is a failed run, even with every check passing", async () => {
  const r = await runScript(await prepareRun(), "cleanup");
  assert.notEqual(r.code, 0);
  assert.match(r.err, /CLEANUP FAILED/);
  assert.doesNotMatch(r.out, /ALL PRIVACY CHECKS PASSED/);
  assert.equal((await rows(r.address)).users, 1, "the injected failure stopped the cleanup, so the account is still there for after() to remove");
});

test("a failure that quotes the page's address doesn't show its sign-up token", async () => {
  const r = await runScript(await prepareRun(), "quoting-token");
  assert.notEqual(r.code, 0);
  assert.match(r.err, /register\/complete#token=<hidden>/, "the failure itself is still reported");
  assert.doesNotMatch(r.out + r.err, /#token=(?!<hidden>)/);
  assert.deepEqual(await rows(r.address), { tokens: 0, users: 0 });
});
