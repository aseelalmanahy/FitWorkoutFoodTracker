// The production image's migration step: migrate deploy, only when every migration in the image is one the owner
// approved (prisma/approved-migrations.json). Otherwise it applies nothing and exits 4, naming the ones not approved.
//   node scripts/migrate-approved.cjs     (DATABASE_URL: the migration role's address)
//
// It also keeps Prisma's migration history writable by its owner alone (protectHistorySql: shown live, the app's role
// could otherwise mark a migration as applied, so a later deploy skips it, or erase one, so it runs again):
//   before deploying: if the history exists and another role can use it, or the migrator doesn't own it, nothing is
//                     applied (exit 4);
//   after deploying:  the same, whether the deploy succeeded or not; it reports success only when both have.
"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { unapprovedMigrations, protectHistorySql } = require("./lib/approved-migrations.cjs");

const SCHEMA = path.join(__dirname, "..", "prisma", "schema.prisma");
const prisma = (args, input) => spawnSync(process.execPath, [path.join(__dirname, "..", "node_modules", "prisma", "build", "index.js"), ...args], input === undefined ? { stdio: "inherit" } : { input, stdio: ["pipe", "inherit", "inherit"] });
// Revoke, then verify, as two separate commands: what the first revoked stays revoked even if the second then fails.
const protectHistory = (missingOk) => {
  const [revoke, verify] = protectHistorySql({ missingOk });
  const revoked = prisma(["db", "execute", "--stdin", "--schema", SCHEMA], revoke).status === 0;
  return revoked && prisma(["db", "execute", "--stdin", "--schema", SCHEMA], verify).status === 0;
};

const pending = unapprovedMigrations();
if (pending.length) {
  console.error(`REFUSED (nothing was applied): not approved for this database: ${pending.join(", ")}. Add them to prisma/approved-migrations.json only with the owner's approval.`);
  process.exit(4);
}
if (!protectHistory(true)) {
  console.error("REFUSED (nothing was applied): the migration history isn't the migrator's alone (see the error above). Fix its owner or grants first.");
  process.exit(4);
}
const deployed = prisma(["migrate", "deploy"]);
const protectedAfter = protectHistory(deployed.status !== 0);
if (deployed.status !== 0) {
  console.error(`The deploy failed${protectedAfter ? "" : ", and the migration history couldn't be protected either"}. See the errors above.`);
  process.exit(deployed.status ?? 1);
}
if (!protectedAfter) {
  console.error("The migrations were applied, but the migration history isn't the migrator's alone (see the error above). Fix it, then run this step again.");
  process.exit(1);
}
console.log("Migrations applied; only the migrator can change their history.");
