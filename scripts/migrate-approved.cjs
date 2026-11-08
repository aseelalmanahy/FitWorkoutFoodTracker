// The production image's migration step: migrate deploy, only when every migration in the image is one the owner
// approved (prisma/approved-migrations.json). Otherwise it applies nothing and exits 4, naming the ones not approved.
//   node scripts/migrate-approved.cjs     (DATABASE_URL: the migration role's address)
"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { unapprovedMigrations } = require("./lib/approved-migrations.cjs");

const pending = unapprovedMigrations();
if (pending.length) {
  console.error(`REFUSED (nothing was applied): not approved for this database: ${pending.join(", ")}. Add them to prisma/approved-migrations.json only with the owner's approval.`);
  process.exit(4);
}
const r = spawnSync(process.execPath, [path.join(__dirname, "..", "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { stdio: "inherit" });
process.exit(r.status ?? 1);
