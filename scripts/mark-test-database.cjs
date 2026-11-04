// Deliberately mark the database in DATABASE_URL as a dedicated TEST database, so that
// scripts/live-provider-check.cjs is allowed to write throwaway records to it.
// The marker is a PostgreSQL database comment:
//   fitworkoutfoodtracker:test-database:v1:<database name>
// Migrations never set it, so a development or production database is never marked by
// accident. Only run this on a database created solely for testing.
//
// Refuses (exit 4, nothing changed) unless ALL checks in scripts/lib/test-db-guard.cjs pass:
// local host, database name containing "test", --confirm equal to the exact database name,
// and, after connecting, the expected database on a loopback or local-socket server.
//
// Usage (bash or PowerShell; .env.test is a file holding the TEST database's DATABASE_URL):
//   node --env-file=.env.test scripts/mark-test-database.cjs --confirm fitdb_test
//   node --env-file=.env.test scripts/mark-test-database.cjs --remove --confirm fitdb_test
"use strict";
const { validateTargetUrl, assertConnectedTarget, redact, urlSecrets, TEST_DB_MARKER_PREFIX } = require("./lib/test-db-guard.cjs");

const args = process.argv.slice(2);
const i = args.indexOf("--confirm");
const confirm = i >= 0 ? args[i + 1] : undefined;
const remove = args.includes("--remove");
const secrets = urlSecrets(process.env.DATABASE_URL);

function fail(msg) {
  console.error(`NOT MARKED (nothing changed): ${redact(msg, secrets)}`);
  process.exit(4);
}

const v = validateTargetUrl(process.env.DATABASE_URL, confirm);
if (!v.ok) fail(`refusing to ${remove ? "unmark" : "mark"} this database:\n  - ${v.errors.join("\n  - ")}`);

(async () => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  try {
    await assertConnectedTarget((sql) => prisma.$queryRawUnsafe(sql), v.dbName);
    // The name is validated as [A-Za-z0-9_]+ above; COMMENT ON DATABASE takes no bind parameters.
    await prisma.$executeRawUnsafe(remove
      ? `COMMENT ON DATABASE "${v.dbName}" IS NULL`
      : `COMMENT ON DATABASE "${v.dbName}" IS '${TEST_DB_MARKER_PREFIX}${v.dbName}'`);
    console.log(remove ? `Removed the test-database marker from "${v.dbName}".` : `Marked "${v.dbName}" as a dedicated test database.`);
  } catch (e) {
    await prisma.$disconnect().catch(() => {});
    fail(e.message);
  }
  await prisma.$disconnect();
})();
