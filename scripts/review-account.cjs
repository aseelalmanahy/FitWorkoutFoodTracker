// Creates sign-in accounts on fitdb_review, by hand, as registration stays closed there:
//   node --env-file=.env.review scripts/review-account.cjs --owner     --confirm=fitdb_review
//   node --env-file=.env.review scripts/review-account.cjs --tester=1  --confirm=fitdb_review
//   node --env-file=.env.review scripts/review-account.cjs --status    --confirm=fitdb_review
// It writes one User row and nothing else: no profile, no history, no measurements. The owner fills in their own
// details, and no notice acceptance is recorded for them, as they haven't accepted anything. An existing account is
// never changed, and its password is never replaced. Passwords go only into Git-ignored files, never to the screen.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { REVIEW_MARKER, localDatabaseProblem, envFileProblem, readLocalIdentity, scrubber } = require("./lib/local-databases.cjs");

const NAME = "fitdb_review";
const ROOT = path.join(__dirname, "..");
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 }; // as src/lib/server/auth.ts
const refuse = (m) => { console.error(`REFUSED (nothing was written): ${m}`); process.exit(4); };

const args = process.argv.slice(2);
const what = args[0] ?? "";
const tester = /^--tester=([1-9])$/.exec(what)?.[1];
// C2, with the owner's approval: one account at a real address the owner controls, for one real password-reset email.
//   node --env-file=.env.review scripts/review-account.cjs --mail-tester --email=<address> --confirm=fitdb_review
// It has no usable password: none is generated into a file or shown. The owner sets one through the emailed link.
const mailArg = what === "--mail-tester" ? args[1] ?? "" : "";
const mailAddress = mailArg.startsWith("--email=") ? mailArg.slice("--email=".length).trim().toLowerCase() : "";
if (what === "--mail-tester") {
  if (args.length !== 3 || args[2] !== `--confirm=${NAME}` || !mailAddress) refuse(`use --mail-tester --email=<address> --confirm=${NAME}.`);
  if (!/^[^\s@"<>,;]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(mailAddress) || mailAddress.length > 254) refuse("that isn't an email address this can use.");
  if (/\.(local|invalid|test|example|localhost)$/.test(mailAddress)) refuse("that address can't receive mail; use one you control.");
} else if (args.length !== 2 || args[1] !== `--confirm=${NAME}` || !(what === "--owner" || what === "--status" || tester)) refuse(`use --owner, --tester=<1-9>, --status or --mail-tester --email=<address>, then --confirm=${NAME}.`);
const fileProblem = envFileProblem(NAME);
if (fileProblem) refuse(fileProblem);
const DB = process.env.DATABASE_URL;
const urlProblem = localDatabaseProblem(DB, NAME);
if (urlProblem) refuse(urlProblem);
const scrub = scrubber(DB);

// .local is reserved for this machine's own network, so these addresses can never receive mail.
const OWNER = { email: "owner@review.local", file: "review-account.local.md", title: "Owner review account" };
const testerAccount = (n) => ({ email: `review-tester-${n}@review.local`, file: `review-tester-${n}.local.md`, title: `Review tester ${n} (automated checks only)` });

const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient({ datasources: { db: { url: DB } }, errorFormat: "minimal" });

async function verified() {
  const id = await readLocalIdentity(db, NAME);
  if (id.marker !== REVIEW_MARKER) throw new Error(`${NAME} doesn't carry its review marker.`);
}

async function create(account) {
  if (spawnSync("git", ["check-ignore", "-q", account.file], { cwd: ROOT }).status !== 0) throw new Error(`${account.file} isn't ignored by Git, so no password is written to it.`);
  const file = path.join(ROOT, account.file);
  if (fs.existsSync(file)) throw new Error(`${account.file} already exists. Nothing is replaced.`);
  await verified();
  if (await db.user.findUnique({ where: { email: account.email }, select: { id: true } })) throw new Error(`${account.email} already has an account. It isn't changed.`);
  const password = randomBytes(18).toString("base64url");
  const { hash } = require("@node-rs/argon2");
  const passwordHash = await hash(password, ARGON);
  fs.writeFileSync(file, `# ${account.title}

**Local only. Never commit or share this file.** For the review environment at http://localhost:3002, on \`${NAME}\`.

| | |
|---|---|
| Email | ${account.email} |
| Password | ${password} |
| Application | http://localhost:3002 |
| Database | ${NAME} |

Created with \`scripts/review-account.cjs\`. Registration is closed in this environment, so accounts are made this way.
No email is sent from it, so a forgotten password can't be reset by email: ask for a new account instead.
`, { mode: 0o600 });
  try {
    await db.$transaction(async (tx) => {
      const [row] = await tx.$queryRawUnsafe("SELECT current_database() AS name");
      if (row.name !== NAME) throw new Error("the writing connection isn't fitdb_review.");
      await tx.user.create({ data: { email: account.email, passwordHash } });
    });
  } catch (e) {
    fs.rmSync(file, { force: true }); // no account was made, so this password belongs to nothing
    throw e;
  }
  console.log(`Created ${account.email}. Its password is in ${account.file}, which Git ignores.`);
}

/** C2: made with a random password that's hashed and immediately forgotten, so only the emailed reset link opens it. */
async function createMailTester(email) {
  await verified();
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) throw new Error("that address already has an account. It isn't changed.");
  const { hash } = require("@node-rs/argon2");
  const passwordHash = await hash(randomBytes(32).toString("base64url"), ARGON);
  await db.$transaction(async (tx) => {
    const [row] = await tx.$queryRawUnsafe("SELECT current_database() AS name");
    if (row.name !== NAME) throw new Error("the writing connection isn't fitdb_review.");
    await tx.user.create({ data: { email, passwordHash } });
  });
  console.log(`Created the mail test account (${email.replace(/^(.).*(@.*)$/, "$1…$2")}). It has no known password: use "Forgot password" on the review server to receive the reset email.`);
}

async function status() {
  await verified();
  for (const a of [OWNER, ...[1, 2, 3].map(testerAccount)]) {
    const u = await db.user.findUnique({ where: { email: a.email }, select: { id: true, profile: { select: { userId: true } } } });
    if (!u) { console.log(`${a.email}: no account`); continue; }
    const [w, f, b] = await Promise.all([db.workoutSession.count({ where: { userId: u.id } }), db.foodEntry.count({ where: { userId: u.id } }), db.bodyMetric.count({ where: { userId: u.id } })]);
    console.log(`${a.email}: exists, profile ${u.profile ? "filled in" : "not yet"}, workouts ${w}, food entries ${f}, weights ${b}, ${a.file} ${fs.existsSync(path.join(ROOT, a.file)) ? "present" : "MISSING"}`);
  }
}

(what === "--status" ? status() : what === "--mail-tester" ? createMailTester(mailAddress) : create(tester ? testerAccount(tester) : OWNER))
  .then(() => db.$disconnect())
  .catch(async (e) => { console.error(`STOPPED: ${scrub(e.message).slice(0, 300)}`); await db.$disconnect().catch(() => {}); process.exit(1); });
