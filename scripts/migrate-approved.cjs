// The production image's migration step: migrate deploy, only when every migration in the image is one the owner
// approved (prisma/approved-migrations.json). Otherwise it applies nothing and exits 4, naming the ones not approved.
//   node scripts/migrate-approved.cjs     (DATABASE_URL: the migration role's address)
//
// After a successful deploy it also takes away every other role's access to Prisma's own history table. The
// database-roles.sql default privileges give the app's role (fit_app) rows in every table the migrator creates, and
// that includes _prisma_migrations: shown live, fit_app could insert a forged "applied" row (so a later deploy skips
// that migration) or delete one (so it runs again). The app never reads that table. The migrator owns it, so it can
// revoke; the statement names no role, and is the same on every run.
"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { unapprovedMigrations } = require("./lib/approved-migrations.cjs");

const PROTECT_HISTORY = `DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants WHERE table_schema = current_schema() AND table_name = '_prisma_migrations' AND grantee <> current_user LOOP
    IF r.grantee = 'PUBLIC' THEN EXECUTE 'REVOKE ALL ON TABLE "_prisma_migrations" FROM PUBLIC';
    ELSE EXECUTE format('REVOKE ALL ON TABLE "_prisma_migrations" FROM %I', r.grantee); END IF;
  END LOOP;
END $$;`;

const prisma = (args, input) => spawnSync(process.execPath, [path.join(__dirname, "..", "node_modules", "prisma", "build", "index.js"), ...args], input === undefined ? { stdio: "inherit" } : { input, stdio: ["pipe", "inherit", "inherit"] });

const pending = unapprovedMigrations();
if (pending.length) {
  console.error(`REFUSED (nothing was applied): not approved for this database: ${pending.join(", ")}. Add them to prisma/approved-migrations.json only with the owner's approval.`);
  process.exit(4);
}
const deployed = prisma(["migrate", "deploy"]);
if (deployed.status !== 0) process.exit(deployed.status ?? 1);
const protectedHistory = prisma(["db", "execute", "--stdin", "--schema", path.join(__dirname, "..", "prisma", "schema.prisma")], PROTECT_HISTORY);
if (protectedHistory.status !== 0) {
  console.error("The migrations were applied, but other roles' access to _prisma_migrations couldn't be removed. Run this step again as the migrator.");
  process.exit(protectedHistory.status ?? 1);
}
console.log("Migrations applied; only the migrator can change their history.");
