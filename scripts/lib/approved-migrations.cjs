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
 * Two SQL statements, run one after the other as separate commands, that leave Prisma's migration history writable by
 * its owner alone, or fail. The default privileges in deploy/database-roles.sql would otherwise give the app's role rows
 * in it (so it could mark a migration as applied, or erase one). Neither names a role; running them again changes nothing.
 *
 * 1. revoke: every grant in the table's own ACL (not information_schema, which shows only grants involving the current
 *    role) other than the owner's is revoked, each on its own, so one that can't be revoked (a grant passed on by
 *    another role) doesn't undo the others. Fails when the table isn't on this connection's search path (unless
 *    missingOk: before the first deploy it doesn't exist yet) or the role running it isn't its owner.
 * 2. verify: fails if any role but the owner can still insert, update, delete or truncate it, however it got that:
 *    a grant from any grantor, PUBLIC, membership of the owner role, or a predefined role such as pg_write_all_data.
 *    Superusers can't be restricted and aren't counted. A provider whose administrator role holds pg_write_all_data
 *    makes this fail, on purpose: the history isn't the migrator's alone there.
 */
function protectHistorySql({ missingOk = false } = {}) {
  const find = `t regclass := to_regclass('_prisma_migrations');`;
  const missing = missingOk ? "RETURN;" : "RAISE EXCEPTION 'No _prisma_migrations table on this connection''s search path: check the schema in DATABASE_URL.';";
  const revoke = `DO $$
DECLARE ${find} owner_name text; r record;
BEGIN
  IF t IS NULL THEN ${missing} END IF;
  SELECT pg_get_userbyid(c.relowner) INTO owner_name FROM pg_class c WHERE c.oid = t;
  IF owner_name <> current_user THEN
    RAISE EXCEPTION '_prisma_migrations is owned by %, not by %, which is running the migrations. Run them as its owner.', owner_name, current_user;
  END IF;
  FOR r IN SELECT DISTINCT a.grantee FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = t AND a.grantee <> c.relowner LOOP
    BEGIN
      IF r.grantee = 0 THEN EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC', t);
      ELSE EXECUTE format('REVOKE ALL ON TABLE %s FROM %I', t, pg_get_userbyid(r.grantee)); END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Could not revoke % on _prisma_migrations: %', CASE WHEN r.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(r.grantee) END, SQLERRM;
    END;
  END LOOP;
END $$;`;
  const verify = `DO $$
DECLARE ${find} who text;
BEGIN
  IF t IS NULL THEN ${missing} END IF;
  -- Effective privileges, and also membership whether inherited or not: a member that doesn't inherit can still
  -- SET ROLE to the owner, or to pg_write_all_data, and write.
  SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) INTO who FROM pg_roles r, pg_class c
    WHERE c.oid = t AND r.oid <> c.relowner AND NOT r.rolsuper AND r.rolname !~ '^pg_'
      AND (has_table_privilege(r.oid, t, 'INSERT,UPDATE,DELETE,TRUNCATE')
        OR pg_has_role(r.oid, c.relowner, 'MEMBER')
        OR pg_has_role(r.oid, 'pg_write_all_data', 'MEMBER'));
  IF who IS NOT NULL THEN
    RAISE EXCEPTION 'These roles can still change _prisma_migrations: %. Remove that access first (a grant from another role, membership of its owner, or a role such as pg_write_all_data).', who;
  END IF;
  -- Any grant left in the table's ACL other than the owner's (PUBLIC's would reach every role made later).
  IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = t AND a.grantee <> c.relowner) THEN
    RAISE EXCEPTION 'A grant on _prisma_migrations other than its owner''s is still there (it could not be revoked: see the warnings above). Remove it first.';
  END IF;
END $$;`;
  return [revoke, verify];
}

module.exports = { unapprovedMigrations, sha256, protectHistorySql };
