// Read-only counts of account facts, on a test database, by hand:
//   node --env-file=.env.test scripts/account-facts.cjs --confirm=fitdb_test
// A script, and never a route. Nothing here deletes or changes anything, and no path from it leads to deletion.
// Applying any retention rule is a separate design, needing its own approval: docs/PHASE_4_0_5_PLAN.md, section 6.
// Limited to the test database until Decision 14 says otherwise.
"use strict";
const { databaseUrlProblem, environmentProblems, readDatabaseIdentity } = require("./lib/test-target-guard.cjs");
const { TEST_DB_MARKER_PREFIX } = require("./lib/test-db-guard.cjs");
const { reportAccountFacts } = require("./lib/account-facts.cjs");

const TARGET = "fitdb_test";
const refuse = (message) => { console.error(`REFUSED: ${message}`); process.exit(4); };

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== `--confirm=${TARGET}`) refuse(`use exactly --confirm=${TARGET}.`);
const DB = process.env.DATABASE_URL;
const problems = [databaseUrlProblem(DB), ...environmentProblems(process.env)].filter(Boolean);
if (problems.length) refuse(problems.map((p) => p.message).join(" | "));
if (decodeURIComponent(new URL(DB).pathname.slice(1)) !== TARGET) refuse(`DATABASE_URL must name ${TARGET} exactly.`);
if (process.env.NODE_ENV === "production") refuse("NODE_ENV is production.");

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: DB } }, errorFormat: "minimal" });

(async () => {
  const own = await readDatabaseIdentity(DB, TARGET);
  if (own.marker !== TEST_DB_MARKER_PREFIX + TARGET) refuse("the database doesn't carry its test marker.");
  const report = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return reportAccountFacts({ count: (model, where) => tx[model].count({ where }) }, new Date());
  });
  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(`FAILED: ${err.code ?? "unexpected error"}`);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
