// Migrations on disk that the owner hasn't approved, for databases that keep data (fitdb_review, production).
//
// prisma migrate deploy applies every folder in prisma/migrations that holds a migration.sql, whatever it's called. So
// every folder counts here, not only the usual timestamped names, and an approved migration also has to match the
// SHA-256 recorded when it was approved: one edited since is reported as not approved. Line endings are normalised
// first, so a Windows checkout gives the same hash.
"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")).digest("hex");

function unapprovedMigrations(root = ROOT) {
  const list = JSON.parse(fs.readFileSync(path.join(root, "prisma", "approved-migrations.json"), "utf8"));
  const approved = new Set(list.approved);
  const dir = path.join(root, "prisma", "migrations");
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue; // migration_lock.toml
    const name = entry.name;
    if (!approved.has(name)) { out.push(name); continue; }
    const sql = path.join(dir, name, "migration.sql");
    if (!fs.existsSync(sql) || sha256(sql) !== list.sha256?.[name]) out.push(`${name} (changed since it was approved)`);
  }
  return out.sort();
}

/**
 * SQL that leaves Prisma's migration history writable by its owner alone, or fails. The default privileges in
 * deploy/database-roles.sql would otherwise give the app's role rows in it (so it could mark a migration as applied, or
 * erase one). Fails closed, with an error, when:
 * - the table isn't on this connection's search path (unless missingOk: before the first deploy it doesn't exist yet);
 * - the role running it isn't the table's owner (another role did a deploy), as only the owner can revoke all grants;
 * - any other role still has any privilege on it afterwards, from whatever grantor (read from the table's own ACL,
 *   not information_schema, which shows only grants involving the current role).
 * It names no role, and running it again changes nothing.
 */
function protectHistorySql({ missingOk = false } = {}) {
  return `DO $$
DECLARE t regclass := to_regclass('_prisma_migrations'); owner_name text; r record;
BEGIN
  IF t IS NULL THEN
    ${missingOk ? "RETURN;" : "RAISE EXCEPTION 'No _prisma_migrations table on this connection''s search path: check the schema in DATABASE_URL.';"}
  END IF;
  SELECT pg_get_userbyid(c.relowner) INTO owner_name FROM pg_class c WHERE c.oid = t;
  IF owner_name <> current_user THEN
    RAISE EXCEPTION '_prisma_migrations is owned by %, not by %, which is running the migrations. Run them as its owner.', owner_name, current_user;
  END IF;
  FOR r IN SELECT DISTINCT a.grantee FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = t AND a.grantee <> c.relowner LOOP
    IF r.grantee = 0 THEN EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC', t);
    ELSE EXECUTE format('REVOKE ALL ON TABLE %s FROM %I', t, pg_get_userbyid(r.grantee)); END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = t AND a.grantee <> c.relowner) THEN
    RAISE EXCEPTION 'Another role can still use _prisma_migrations (granted by a role other than its owner). Remove that grant first.';
  END IF;
END $$;`;
}

module.exports = { unapprovedMigrations, sha256, protectHistorySql };
