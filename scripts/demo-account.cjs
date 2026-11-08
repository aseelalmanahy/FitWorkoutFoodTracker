// Creates and extends the one permanent demo account, on fitdb_test only, when run by hand:
//   node --env-file=.env.test scripts/demo-account.cjs --populate --confirm=fitdb_test
//   node --env-file=.env.test scripts/demo-account.cjs --status   --confirm=fitdb_test
// See docs/MANUAL_UI_TESTING_GUIDE.md. It only ever adds this account's own rows, and never updates or deletes anything.
// Populating again adds the days since the last run, and keeps the same password. The password goes only into the Git-ignored
// demo-account.local.md, and output is fixed text and counts. Direct inserts skip sign-up, so this proves nothing about it.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { parseEnv } = require("node:util");
const { databaseUrlProblem, environmentProblems, readDatabaseIdentity, DB_IDENTITY_SQL } = require("./lib/test-target-guard.cjs");
const { assertConnectedTarget, TEST_DB_MARKER_PREFIX } = require("./lib/test-db-guard.cjs");
const { DEMO_EMAIL, DEMO_USER_ID, buildDemoRows } = require("./lib/demo-account-data.cjs");

const TARGET = "fitdb_test";
const MARKER = TEST_DB_MARKER_PREFIX + TARGET;
const ROOT = path.join(__dirname, "..");
const CREDENTIALS_NAME = "demo-account.local.md";
const CREDENTIALS = path.join(ROOT, CREDENTIALS_NAME);
const NOTICE_VERSION = /version: "([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, "src", "lib", "legal", "notice.ts"), "utf8"))[1];
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 }; // as src/lib/server/auth.ts
const BASE_ORDER = ["profile", "exercise", "workoutTemplate", "templateExercise", "scheduleSlot", "nutritionTarget", "food", "foodServing", "foodEntry", "workoutSession", "sessionExercise", "setEntry", "bodyMetric"];
// Multi-gym rows go before the workouts that name them, and only on a database with that migration (MIG-GYM).
const GYM_MIGRATION = "20261109120000_multi_gym";
let WRITE_ORDER = BASE_ORDER;
const withGyms = () => { WRITE_ORDER = [...BASE_ORDER.slice(0, BASE_ORDER.indexOf("workoutSession")), "gymLocation", "gymEquipment", ...BASE_ORDER.slice(BASE_ORDER.indexOf("workoutSession"))]; };

const refuse = (message) => { console.error(`REFUSED (nothing was written): ${message}`); process.exit(4); };

// ─── Checks before anything is loaded or connected ───────────────────────────

const args = process.argv.slice(2);
if (args.length !== 2 || !["--populate", "--status"].includes(args[0]) || args[1] !== `--confirm=${TARGET}`) refuse(`use --populate or --status, then --confirm=${TARGET}.`);
const mode = args[0];
// node --env-file lets a variable already in the shell win, silently. So the value in use has to be the file's.
const envFiles = process.execArgv.filter((a) => a.startsWith("--env-file"));
if (envFiles.length !== 1 || !envFiles[0].startsWith("--env-file=") || path.basename(envFiles[0].slice("--env-file=".length)) !== ".env.test") refuse("run this with exactly --env-file=.env.test.");
if (process.env.DATABASE_URL !== parseEnv(fs.readFileSync(envFiles[0].slice("--env-file=".length), "utf8")).DATABASE_URL) refuse("a DATABASE_URL already in this shell differs from .env.test's. In PowerShell, run: Remove-Item Env:DATABASE_URL");
const DB = process.env.DATABASE_URL;
const problems = [databaseUrlProblem(DB), ...environmentProblems(process.env)].filter(Boolean);
if (problems.length) refuse(problems.map((p) => p.message).join(" | "));
if (decodeURIComponent(new URL(DB).pathname.slice(1)) !== TARGET) refuse(`DATABASE_URL must name ${TARGET} exactly.`);
if (process.env.NODE_ENV === "production") refuse("NODE_ENV is production.");

const { PrismaClient } = require("@prisma/client");
const { hash, verify } = require("@node-rs/argon2");
const prisma = new PrismaClient({ datasources: { db: { url: DB } }, errorFormat: "minimal" });

// ─── The credentials file ────────────────────────────────────────────────────

function credentialsText(password) {
  return `# FitWorkoutFoodTracker demo account

**Local only. Never commit or share this file.** A synthetic account on \`fitdb_test\`, whose password works nowhere else.

| | |
|---|---|
| Name | FitWorkoutFoodTracker Demo |
| Email | ${DEMO_EMAIL} |
| Password | ${password} |
| Local application | http://localhost:3000 |
| Database | ${TARGET} |

## Signing in

1. Start the application, in PowerShell, from the repository root, and leave that window open:

   \`\`\`powershell
   Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
   node --env-file=.env.test scripts/demo-server.cjs --confirm=${TARGET}
   \`\`\`

2. Open http://localhost:3000 in a browser. If that window says a different address, use that one.
3. Enter the email and password above, and choose Log in.

\`docs/MANUAL_UI_TESTING_GUIDE.md\` says what to try.

Keep this file: the password isn't stored anywhere else, and populating again reuses it.
`;
}
const readPassword = () => {
  if (!fs.existsSync(CREDENTIALS)) return null;
  const match = /^\| Password \| (\S+) \|$/m.exec(fs.readFileSync(CREDENTIALS, "utf8").replace(/\r\n/g, "\n"));
  if (!match) throw new Stop(`${CREDENTIALS_NAME} has no password in it.`);
  return match[1];
};
class Stop extends Error {}

// ─── Steps ───────────────────────────────────────────────────────────────────

async function verifyTarget() {
  const own = await readDatabaseIdentity(DB, TARGET);
  if (own.marker !== MARKER) throw new Stop("the database doesn't carry its test marker.");
  const [mig] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = '20261106150000_body_metrics' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`);
  if (mig.n !== 1) throw new Stop("this database doesn't have MIG-04, which the weight log needs.");
  console.log(`Target verified: ${TARGET}, this machine, marker matches, MIG-04 applied.`);
  const [gym] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = '${GYM_MIGRATION}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`);
  if (gym.n === 1) { withGyms(); console.log("Multi-gym migration applied: gyms, machines and a swap are included."); }
  else console.log(`Multi-gym rows skipped: ${GYM_MIGRATION} isn't applied here (MIG-GYM, the owner's approval).`);
  return gym.n === 1;
}
const counts = async (client) => {
  const out = {};
  for (const model of WRITE_ORDER) {
    const where = model === "templateExercise" ? { template: { userId: DEMO_USER_ID } }
      : model === "foodServing" ? { food: { userId: DEMO_USER_ID } }
        : model === "sessionExercise" ? { session: { userId: DEMO_USER_ID } }
          : model === "setEntry" ? { sessionExercise: { session: { userId: DEMO_USER_ID } } }
            : { userId: DEMO_USER_ID };
    out[model] = await client[model].count({ where });
  }
  return out;
};
const printCounts = (label, c) => console.log(`${label}: ${WRITE_ORDER.map((m) => `${m} ${c[m]}`).join(", ")}`);

async function status() {
  await verifyTarget();
  const user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL }, select: { id: true, passwordHash: true, termsVersion: true } });
  if (!user) return console.log("The demo account doesn't exist yet.");
  const stored = readPassword();
  const works = stored !== null && (await verify(user.passwordHash, stored));
  console.log(`Account exists. ${CREDENTIALS_NAME}: ${stored === null ? "MISSING" : works ? "present, and its password works" : "present, and its password DOESN'T match"}.`);
  printCounts("Rows", await counts(prisma));
}

async function populate() {
  if (spawnSync("git", ["check-ignore", "-q", CREDENTIALS_NAME], { cwd: ROOT }).status !== 0) throw new Stop(`${CREDENTIALS_NAME} isn't ignored by Git.`);
  const gyms = await verifyTarget();
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL }, select: { id: true, passwordHash: true } });
  let password = readPassword();
  if (existing && existing.id !== DEMO_USER_ID) throw new Stop("that address belongs to some other account.");
  if (existing && password === null) throw new Stop(`the account exists, and ${CREDENTIALS_NAME} is missing. Its password is deliberately not replaced here.`);
  if (existing && !(await verify(existing.passwordHash, password))) throw new Stop(`${CREDENTIALS_NAME} doesn't match the account. Its password is deliberately not replaced here.`);
  let wroteFile = false;
  if (password === null) {
    password = randomBytes(18).toString("base64url");
    fs.writeFileSync(CREDENTIALS, credentialsText(password), { mode: 0o600 });
    wroteFile = true;
    console.log(`A new password was generated, and written to ${CREDENTIALS_NAME}.`);
  } else console.log(`Keeping the password in ${CREDENTIALS_NAME}.`);

  const builtIn = await prisma.exercise.findMany({ where: { userId: null }, select: { id: true, name: true }, orderBy: { id: "asc" } });
  const exerciseIdByName = {};
  for (const e of builtIn) exerciseIdByName[e.name] ??= e.id;
  const { today, rows } = buildDemoRows({ now: new Date(), exerciseIdByName, gyms });
  const passwordHash = existing ? null : await hash(password, ARGON);
  try {
    await prisma.$transaction(async (tx) => {
      // Again on the connection doing the writing.
      await assertConnectedTarget((sql) => tx.$queryRawUnsafe(sql), TARGET);
      const [row] = await tx.$queryRawUnsafe(DB_IDENTITY_SQL);
      if (row.marker !== MARKER) throw new Stop("the writing connection's database doesn't carry its test marker.");
      const before = await counts(tx);
      if (!existing) await tx.user.create({ data: { id: DEMO_USER_ID, email: DEMO_EMAIL, passwordHash, termsVersion: NOTICE_VERSION, termsAcceptedAt: new Date() } });
      for (const model of WRITE_ORDER) {
        const list = rows[model];
        for (let i = 0; i < list.length; i += 1000) await tx[model].createMany({ data: list.slice(i, i + 1000), skipDuplicates: true });
      }
      const after = await counts(tx);
      const added = Object.fromEntries(WRITE_ORDER.map((m) => [m, after[m] - before[m]]));
      printCounts("Added", added);
      printCounts("Now", after);
    }, { maxWait: 10_000, timeout: 180_000 });
  } catch (err) {
    if (wroteFile) fs.rmSync(CREDENTIALS, { force: true }); // No account was made, so this password belongs to nothing.
    throw err;
  }
  console.log(`DEMO ACCOUNT READY, with data through ${today}.`);
}

(mode === "--populate" ? populate() : status()).then(() => prisma.$disconnect()).catch(async (e) => {
  console.error(e instanceof Stop ? `STOP (nothing more was written): ${e.message}` : `FAILED: ${e.code ?? String(e.message).slice(0, 200).replace(/postgres(ql)?:\/\/\S+/g, "<address>")}`);
  await prisma.$disconnect().catch(() => {});
  process.exit(e instanceof Stop ? 3 : 1);
});
