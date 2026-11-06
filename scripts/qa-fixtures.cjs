// Creates or removes the 10 QA fixture accounts, on fitdb_test only, and only when asked by hand:
//   node --env-file=.env.test scripts/qa-fixtures.cjs --create  --confirm=fitdb_test
//   node --env-file=.env.test scripts/qa-fixtures.cjs --status  --confirm=fitdb_test
//   node --env-file=.env.test scripts/qa-fixtures.cjs --cleanup --confirm=fitdb_test
// Nothing runs this automatically. See docs/QA_FIXTURES.md.
//
// Direct inserts skip the sign-up flow, its limits and its validation, on this test database only. So these accounts
// show how the app reads data, and prove nothing about sign-up, which account-tokens tests.
//
// No server runs here, so requireSafeTarget() and verifyServer() can't apply. The same lower-level checks do, in this
// order, before Prisma is even loaded. Output is fixed text, codes and counts, never an argument or a credential.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { databaseUrlProblem, environmentProblems, readDatabaseIdentity, DB_IDENTITY_SQL } = require("./lib/test-target-guard.cjs");
const { assertConnectedTarget, TEST_DB_MARKER_PREFIX } = require("./lib/test-db-guard.cjs");
const { FIXTURE_ACCOUNTS, FIXTURE_EMAILS, WRITE_ORDER, OWNED_WHERE, buildAccount } = require("./lib/qa-fixture-data.cjs");

const EXIT_REFUSED = 4;
const TARGET = "fitdb_test";
const MARKER = TEST_DB_MARKER_PREFIX + TARGET;
const ROOT = path.join(__dirname, "..");
const CREDENTIALS_NAME = "qa-test-accounts.local.md";
const CREDENTIALS = path.join(ROOT, CREDENTIALS_NAME);
const TRANSACTION = { maxWait: 10_000, timeout: 300_000 };
const BATCH = 1000;

const refuse = (message) => { console.error(`REFUSED (nothing was written): ${message}`); process.exit(EXIT_REFUSED); };

// ─── Checks before anything is loaded or connected ──────────────────────────

const args = process.argv.slice(2);
const MODES = new Set(["--create", "--status", "--cleanup"]);
const mode = args[0];
if (args.length !== 2 || !MODES.has(mode) || args[1] !== `--confirm=${TARGET}`) {
  refuse(`use exactly one of --create, --status or --cleanup, then --confirm=${TARGET}.`);
}
const DB = process.env.DATABASE_URL; // read once, and given to every client explicitly
const problems = [databaseUrlProblem(DB), ...environmentProblems(process.env)].filter(Boolean);
if (problems.length) refuse(problems.map((p) => p.message).join(" | "));
if (decodeURIComponent(new URL(DB).pathname.slice(1)) !== TARGET) refuse(`DATABASE_URL must name ${TARGET} exactly.`);
if (process.env.NODE_ENV === "production") refuse("NODE_ENV is production.");

const { PrismaClient, Prisma } = require("@prisma/client");
const { hash } = require("@node-rs/argon2");
const prisma = new PrismaClient({ datasources: { db: { url: DB } }, errorFormat: "minimal" });
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 }; // as src/lib/server/auth.ts

const delegateOf = (client, model) => client[model[0].toLowerCase() + model.slice(1)];
const MODELS = Prisma.dmmf.datamodel.models.map((m) => m.name).sort();

async function verifyIdentity() {
  const own = await readDatabaseIdentity(DB, TARGET);
  if (own.marker !== MARKER) refuse("the database doesn't carry its test marker.");
  console.log(`Target verified: ${TARGET}, loopback, marker matches.`);
}

/** Again on the connection doing the writing, as the check above used its own. */
async function verifyConnection(tx) {
  await assertConnectedTarget((sql) => tx.$queryRawUnsafe(sql), TARGET);
  const [row] = await tx.$queryRawUnsafe(DB_IDENTITY_SQL);
  if (row.marker !== MARKER) throw new Error("the writing connection's database doesn't carry its test marker");
}

async function verifySchema() {
  const [mig] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL AND migration_name = '20261106140000_account_tokens'`);
  if (mig.n !== 1) refuse("this database doesn't have the migrations this code needs.");
  const owned = Object.keys(OWNED_WHERE([], [])).sort();
  if (JSON.stringify(owned) !== JSON.stringify(MODELS)) refuse("a model isn't covered by the fixture's ownership rules.");
}

const totals = async (client) => {
  const out = {};
  for (const model of MODELS) out[model] = await delegateOf(client, model).count();
  return out;
};
const ownedCounts = async (client, ids, emails) => {
  const where = OWNED_WHERE(ids, emails);
  const out = {};
  for (const model of MODELS) out[model] = await delegateOf(client, model).count({ where: where[model] });
  return out;
};
const printCounts = (label, counts) => console.log(`${label}: ${MODELS.map((m) => `${m} ${counts[m]}`).join(", ")}`);

// ─── The credentials file ───────────────────────────────────────────────────

function assertIgnored() {
  const r = spawnSync("git", ["check-ignore", "-q", CREDENTIALS_NAME], { cwd: ROOT });
  if (r.status !== 0) refuse(`${CREDENTIALS_NAME} isn't ignored by Git.`);
}

function credentialsText(accounts) {
  const row = (a) => `| ${a.n} | ${a.name} | ${a.email} | ${a.password} | ${a.scenario} | ${a.expected} |`;
  return [
    "# QA fixture accounts",
    "",
    "**Local only. Never commit or share this file.** Synthetic accounts on `fitdb_test`, created by `scripts/qa-fixtures.cjs`. These passwords work nowhere else.",
    "",
    "| # | Name | Email | Password | Scenario | Expected features |",
    "|---|---|---|---|---|---|",
    ...accounts.map(row),
    "",
    "Used by cleanup and the browser test, which refuse if these don't match the database:",
    "",
    "```json",
    JSON.stringify(accounts.map(({ n, email, password, userId }) => ({ n, email, password, userId })), null, 2),
    "```",
    "",
  ].join("\n");
}

function readCredentials() {
  const match = /```json\n([\s\S]*?)\n```/.exec(fs.readFileSync(CREDENTIALS, "utf8").replace(/\r\n/g, "\n"));
  if (!match) refuse(`${CREDENTIALS_NAME} has no account list.`);
  const list = JSON.parse(match[1]);
  const emails = list.map((a) => a.email);
  const expectedIds = FIXTURE_ACCOUNTS.map((a) => a.userId);
  if (JSON.stringify(emails) !== JSON.stringify(FIXTURE_EMAILS) || JSON.stringify(list.map((a) => a.userId)) !== JSON.stringify(expectedIds)) refuse(`${CREDENTIALS_NAME} doesn't list exactly the fixture accounts.`);
  return list;
}

// ─── Create ─────────────────────────────────────────────────────────────────

async function create() {
  assertIgnored();
  if (fs.existsSync(CREDENTIALS)) refuse(`${CREDENTIALS_NAME} already exists, so these accounts may exist. Run --cleanup first.`);
  const existing = await prisma.user.count({ where: { email: { in: [...FIXTURE_EMAILS] } } });
  const tokens = await prisma.accountToken.count({ where: { email: { in: [...FIXTURE_EMAILS] } } });
  if (existing || tokens) refuse("fixture accounts or links already exist. Run --cleanup first.");

  const builtIn = await prisma.exercise.findMany({ where: { userId: null }, select: { id: true, name: true }, orderBy: { id: "asc" } });
  const exerciseIdByName = {};
  for (const e of builtIn) exerciseIdByName[e.name] ??= e.id;
  const now = new Date();
  const built = FIXTURE_ACCOUNTS.map((a) => ({ a, rows: buildAccount(a, { now, exerciseIdByName }) }));

  const accounts = [];
  for (const { a } of built) {
    const password = randomBytes(18).toString("base64url");
    accounts.push({ ...a, password, passwordHash: await hash(password, ARGON) });
  }

  const before = await totals(prisma);
  printCounts("Before", before);
  // Written before the transaction, as a crash must never leave accounts nobody can log in to or clean up.
  fs.writeFileSync(CREDENTIALS, credentialsText(accounts), { flag: "wx", mode: 0o600 });
  try {
    await prisma.$transaction(async (tx) => {
      await verifyConnection(tx);
      for (const [i, { rows }] of built.entries()) {
        await tx.user.create({ data: { ...rows.user, passwordHash: accounts[i].passwordHash } });
        await tx.profile.create({ data: rows.profile });
      }
      for (const [model, key] of WRITE_ORDER) {
        const all = built.flatMap(({ rows }) => rows[key]);
        for (let at = 0; at < all.length; at += BATCH) await tx[model].createMany({ data: all.slice(at, at + BATCH) });
      }
      const ids = FIXTURE_ACCOUNTS.map((a) => a.userId);
      const owned = await ownedCounts(tx, ids, [...FIXTURE_EMAILS]);
      const after = await totals(tx);
      for (const model of MODELS) {
        if (after[model] - before[model] !== owned[model]) throw new Error(`rows outside the fixture changed in ${model}`);
      }
      if (owned.User !== 10 || owned.Profile !== 10) throw new Error("not exactly 10 accounts");
      printCounts("Fixture rows", owned);
      printCounts("After", after);
    }, TRANSACTION);
  } catch (err) {
    fs.rmSync(CREDENTIALS, { force: true });
    console.error(`FAILED, and rolled back: ${err.code ?? err.message ?? "unknown"}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Created exactly 10 accounts. Credentials are in ${CREDENTIALS_NAME}, which Git ignores.`);
}

// ─── Status ─────────────────────────────────────────────────────────────────

async function status() {
  for (const a of FIXTURE_ACCOUNTS) {
    const user = await prisma.user.findUnique({ where: { email: a.email }, select: { id: true } });
    if (!user) { console.log(`#${a.n} ${a.slug}: absent`); continue; }
    const owned = await ownedCounts(prisma, [user.id], [a.email]);
    console.log(`#${a.n} ${a.slug}: templates ${owned.WorkoutTemplate}, slots ${owned.ScheduleSlot}, sessions ${owned.WorkoutSession}, sets ${owned.SetEntry}, foods ${owned.Food}, entries ${owned.FoodEntry}, targets ${owned.NutritionTarget}, login sessions ${owned.Session}`);
  }
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

async function cleanup() {
  if (!fs.existsSync(CREDENTIALS)) refuse(`${CREDENTIALS_NAME} is missing, so these accounts can't be proved to be the fixture's.`);
  const listed = readCredentials();
  const found = await prisma.user.findMany({ where: { email: { in: [...FIXTURE_EMAILS] } }, select: { id: true, email: true } });
  const pair = new Map(listed.map((a) => [a.email, a.userId]));
  for (const u of found) if (pair.get(u.email) !== u.id) refuse("an account at a fixture address isn't the one this file created.");
  const ids = found.map((u) => u.id);
  const emails = [...FIXTURE_EMAILS];
  const ownedTokens = await prisma.accountToken.count({ where: { email: { in: emails } } });
  if (!ids.length && !ownedTokens) {
    fs.rmSync(CREDENTIALS, { force: true });
    console.log("No fixture rows exist. Removed the credentials file.");
    return;
  }
  if (ids.length && ids.length !== FIXTURE_EMAILS.length) refuse(`found ${ids.length} of ${FIXTURE_EMAILS.length} accounts, which isn't what this script creates. Nothing was changed.`);
  try {
    await prisma.$transaction(async (tx) => {
      await verifyConnection(tx);
      if (ids.some((id) => typeof id !== "string" || !id)) throw new Error("an id is missing"); // undefined would mean no filter at all
      const beforeAll = await totals(tx);
      const owned = await ownedCounts(tx, ids, emails);
      printCounts("Removing", owned);
      // The same order as account deletion: restrictions on exercises mean sessions and plans go first.
      const mine = { userId: { in: ids } };
      await tx.workoutSession.deleteMany({ where: mine });
      await tx.scheduleSlot.deleteMany({ where: mine });
      await tx.workoutTemplate.deleteMany({ where: mine });
      await tx.exercise.deleteMany({ where: mine });
      await tx.foodEntry.deleteMany({ where: mine });
      await tx.food.deleteMany({ where: mine });
      await tx.nutritionTarget.deleteMany({ where: mine });
      await tx.profile.deleteMany({ where: mine });
      await tx.session.deleteMany({ where: mine });
      await tx.accountToken.deleteMany({ where: mine });
      await tx.accountToken.deleteMany({ where: { email: { in: emails } } }); // sign-up links have no user
      await tx.user.deleteMany({ where: { id: { in: ids } } });
      const afterAll = await totals(tx);
      for (const model of MODELS) {
        if (beforeAll[model] - afterAll[model] !== owned[model]) throw new Error(`rows outside the fixture changed in ${model}`);
      }
      printCounts("After", afterAll);
    }, TRANSACTION);
  } catch (err) {
    console.error(`FAILED, and rolled back, with nothing forced: ${err.code ?? err.message ?? "unknown"}`);
    process.exitCode = 1;
    return;
  }
  fs.rmSync(CREDENTIALS, { force: true });
  console.log("Removed the fixture accounts and the credentials file. Nothing else changed.");
}

(async () => {
  await verifyIdentity();
  await verifySchema();
  if (mode === "--create") await create();
  else if (mode === "--status") await status();
  else await cleanup();
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(`FAILED: ${err.code ?? "unexpected error"}`);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
