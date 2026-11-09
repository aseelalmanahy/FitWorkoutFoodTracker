// Migration safety, with no database: databases that keep data (fitdb_review, production) are never given a migration
// the owner hasn't approved, and the multi-gym migration only adds.
//   node --test scripts/migration-safety.test.cjs
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { unapprovedMigrations } = require("./lib/approved-migrations.cjs");

const ROOT = path.join(__dirname, "..");
const MIGRATIONS = path.join(ROOT, "prisma", "migrations");
const PENDING = ["20261108120000_feedback", "20261109120000_multi_gym", "20261110120000_workout_programs"];

test("every migration on disk is either approved or named as pending, and the pending ones aren't approved", () => {
  const list = JSON.parse(fs.readFileSync(path.join(ROOT, "prisma", "approved-migrations.json"), "utf8"));
  const onDisk = fs.readdirSync(MIGRATIONS).filter((d) => /^\d{14}_/.test(d)).sort();
  assert.deepEqual(unapprovedMigrations(), PENDING);
  for (const d of list.approved) assert.ok(onDisk.includes(d), `${d} is on disk`);
  for (const d of PENDING) assert.match(list.note, new RegExp(d), `${d} is named as pending`);
  assert.deepEqual([...list.approved].sort(), list.approved, "in order");
});

test("the production image's migration step refuses, applying nothing, while a migration isn't approved", () => {
  // An address nothing listens on, so a step that tried to migrate would fail differently, and no database is reached.
  const r = spawnSync(process.execPath, [path.join(__dirname, "migrate-approved.cjs")], { cwd: ROOT, env: { ...process.env, DATABASE_URL: "postgresql://none:SECRETPW@127.0.0.1:1/production" }, encoding: "utf8", timeout: 30_000 });
  assert.equal(r.status, 4, r.stderr);
  assert.match(r.stderr, /REFUSED \(nothing was applied\): not approved for this database: 20261108120000_feedback, 20261109120000_multi_gym, 20261110120000_workout_programs/);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /SECRETPW|prisma migrate|Datasource/);
  const docker = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
  // The guarded step first, and the exercise seed only after it succeeded (&&), so a refusal still exits 4 alone.
  assert.match(docker, /CMD \["sh", "-c", "node scripts\/migrate-approved\.cjs && node node_modules\/tsx\/dist\/cli\.mjs prisma\/seed\.ts"\]/, "the image runs the guarded step, then the seed");
  assert.doesNotMatch(docker, /CMD \[[^\]]*migrate[", ]+deploy/, "and never migrate deploy directly");
});

test("the review database isn't migrated while a migration isn't approved, before anything connects", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fit-review-"));
  try {
    fs.writeFileSync(path.join(dir, ".env.review"), "DATABASE_URL=postgresql://none:SECRETPW@127.0.0.1:1/fitdb_review\n");
    const env = { ...process.env };
    delete env.DATABASE_URL;
    const r = spawnSync(process.execPath, ["--env-file=.env.review", path.join(__dirname, "local-db.cjs"), "--init", "--confirm=fitdb_review"], { cwd: dir, env, encoding: "utf8", timeout: 30_000 });
    const out = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 4, out);
    assert.match(out, /not approved for fitdb_review: 20261108120000_feedback, 20261109120000_multi_gym, 20261110120000_workout_programs/);
    assert.doesNotMatch(out, /SECRETPW/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the multi-gym migration only adds: nullable columns on existing tables, new tables, indexes and keys; nothing dropped or rewritten", () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS, "20261109120000_multi_gym", "migration.sql"), "utf8");
  // A foreign key's ON DELETE / ON UPDATE clause is checked below; nothing else in the file may change or remove anything.
  const statements = sql.replace(/ON (DELETE|UPDATE) (SET NULL|CASCADE|RESTRICT|NO ACTION)/g, "");
  assert.doesNotMatch(statements, /\bDROP\b|\bTRUNCATE\b|\bDELETE\b|\bUPDATE\s+"|\bRENAME\b|ALTER COLUMN|SET NOT NULL|SET DEFAULT/i);
  const added = [...sql.matchAll(/ADD COLUMN\s+"(\w+)"\s+([^,;\n]+)/g)].map((m) => [m[1], m[2].trim()]);
  assert.deepEqual(added.map(([c]) => c).sort(), ["gymEquipmentId", "gymLocationId", "plannedExerciseId", "substitutesId", "templateExerciseId"]);
  // Saving a plan replaces its entries: a workout row's link to its entry is cleared, never the row or its sets.
  assert.match(sql, /"SessionExercise_templateExerciseId_fkey"[^;]+REFERENCES "TemplateExercise"\("id"\) ON DELETE SET NULL/);
  for (const [c, type] of added) assert.equal(type, "TEXT", `${c} is nullable with no default, so every existing workout has no gym and no machine`);
  assert.deepEqual([...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]).sort(), ["GymEquipment", "GymLocation"]);
  // Deleting a gym clears a workout's gym; a machine or planned exercise that sets were done on can't be deleted from under them.
  assert.match(sql, /"WorkoutSession_gymLocationId_fkey"[^;]+ON DELETE SET NULL/);
  assert.match(sql, /"SessionExercise_gymEquipmentId_fkey"[^;]+ON DELETE RESTRICT/);
  assert.match(sql, /"SessionExercise_plannedExerciseId_fkey"[^;]+ON DELETE RESTRICT/);
  assert.match(sql, /"SessionExercise_substitutesId_fkey"[^;]+ON DELETE SET NULL/);
  assert.match(sql, /"GymLocation_userId_fkey"[^;]+ON DELETE CASCADE/);
  assert.match(sql, /CREATE UNIQUE INDEX "GymLocation_userId_name_key"/);
});

test("any folder prisma would apply counts, whatever its name, and an approved migration edited since approval doesn't pass", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fit-approved-"));
  try {
    const mig = path.join(root, "prisma", "migrations");
    const add = (name, sql) => { fs.mkdirSync(path.join(mig, name), { recursive: true }); fs.writeFileSync(path.join(mig, name, "migration.sql"), sql); };
    add("20260101000000_ok", "CREATE TABLE a (id int);\n");
    fs.writeFileSync(path.join(mig, "migration_lock.toml"), 'provider = "postgresql"\n');
    const { sha256 } = require("./lib/approved-migrations.cjs");
    const list = (hash) => fs.writeFileSync(path.join(root, "prisma", "approved-migrations.json"), JSON.stringify({ approved: ["20260101000000_ok"], sha256: { "20260101000000_ok": hash } }));
    list(sha256(path.join(mig, "20260101000000_ok", "migration.sql")));
    assert.deepEqual(unapprovedMigrations(root), [], "approved, unchanged, and the lock file isn't a migration");
    fs.writeFileSync(path.join(mig, "20260101000000_ok", "migration.sql"), "CREATE TABLE a (id int);\r\n");
    assert.deepEqual(unapprovedMigrations(root), [], "a Windows checkout's line endings are the same file");
    add("hotfix_drop_everything", "DROP TABLE a;\n");
    add("20260102000000-dashed", "SELECT 1;\n");
    assert.deepEqual(unapprovedMigrations(root), ["20260102000000-dashed", "hotfix_drop_everything"]);
    fs.rmSync(path.join(mig, "hotfix_drop_everything"), { recursive: true });
    fs.rmSync(path.join(mig, "20260102000000-dashed"), { recursive: true });
    fs.writeFileSync(path.join(mig, "20260101000000_ok", "migration.sql"), "CREATE TABLE a (id int);\nDROP TABLE b;\n");
    assert.deepEqual(unapprovedMigrations(root), ["20260101000000_ok (changed since it was approved)"]);
    list(undefined);
    fs.writeFileSync(path.join(mig, "20260101000000_ok", "migration.sql"), "CREATE TABLE a (id int);\n");
    assert.deepEqual(unapprovedMigrations(root), ["20260101000000_ok (changed since it was approved)"], "no recorded hash: not approved");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("every approved migration has its hash recorded, and npm run db:deploy goes through the guard", () => {
  const list = JSON.parse(fs.readFileSync(path.join(ROOT, "prisma", "approved-migrations.json"), "utf8"));
  assert.deepEqual(Object.keys(list.sha256).sort(), [...list.approved].sort());
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["db:deploy"], "node scripts/migrate-approved.cjs");
  assert.ok(!Object.values(pkg.scripts).some((s) => /migrate deploy/.test(s)), "no script runs migrate deploy unguarded");
});

test("the migrate step protects the migration history before deploying (or applies nothing), and after, whatever the deploy did", () => {
  const src = fs.readFileSync(path.join(__dirname, "migrate-approved.cjs"), "utf8");
  const at = (s) => { const i = src.indexOf(s); assert.ok(i > 0, s); return i; };
  const refusePending = at("if (pending.length)");
  const before = at("if (!protectHistory(true))");
  const deploy = at('const deployed = prisma(["migrate", "deploy"]);');
  const after = at("const protectedAfter = protectHistory(deployed.status !== 0);");
  const success = at('console.log("Migrations applied; only the migrator can change their history.");');
  assert.ok(refusePending < before && before < deploy && deploy < after && after < success, "approved?, protected?, deploy, protect again, then success");
  assert.match(src.slice(before, deploy), /REFUSED \(nothing was applied\)[\s\S]*process\.exit\(4\)/);
  assert.match(src.slice(after, success), /if \(!protectedAfter\)[\s\S]*process\.exit\(1\)/, "no success message unless protected");
  assert.match(fs.readFileSync(path.join(ROOT, "deploy", "database-roles.sql"), "utf8"), /_prisma_migrations/, "the role template says why");
});

test("the history SQL fails closed: not on the search path, not the owner, or any role but the owner able to change it", () => {
  const { protectHistorySql } = require("./lib/approved-migrations.cjs");
  const strict = protectHistorySql();
  const first = protectHistorySql({ missingOk: true });
  assert.equal(strict.length, 2, "revoke, then verify, as separate statements");
  for (const sql of strict) assert.match(sql, /IF t IS NULL THEN RAISE EXCEPTION/, "missing: an error");
  for (const sql of first) assert.match(sql, /IF t IS NULL THEN RETURN;/, "before the first deploy, missing is fine");
  for (const [revoke, verify] of [strict, first]) {
    for (const sql of [revoke, verify]) {
      assert.match(sql, /to_regclass\('_prisma_migrations'\)/, "the table found as the connection sees it, then used schema-qualified");
      assert.doesNotMatch(sql, /fit_app|fit_migrator/, "names no role");
    }
    assert.match(revoke, /IF owner_name <> current_user THEN\s+RAISE EXCEPTION/, "only the owner can revoke every grant");
    assert.match(revoke, /aclexplode\(c\.relacl\)/, "grants read from the table's own ACL, whatever their grantor");
    assert.match(revoke, /format\('REVOKE ALL ON TABLE %s FROM %I', t, pg_get_userbyid\(r\.grantee\)\)/, "roles quoted as identifiers");
    assert.match(revoke, /BEGIN\s+IF r\.grantee = 0[\s\S]*EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/, "each revoke on its own, so one failure doesn't undo the rest");
    assert.match(verify, /has_table_privilege\(r\.oid, t, 'INSERT,UPDATE,DELETE,TRUNCATE'\)/, "effective privileges, however obtained");
    assert.match(verify, /r\.oid <> c\.relowner AND NOT r\.rolsuper AND r\.rolname !~ '\^pg_'/, "every role but the owner, superusers and the predefined roles themselves");
    assert.match(verify, /IF who IS NOT NULL THEN\s+RAISE EXCEPTION/, "anyone left: an error");
    assert.match(verify, /pg_has_role\(r\.oid, c\.relowner, 'MEMBER'\)/, "members of the owner, inherited or not (SET ROLE)");
    assert.match(verify, /pg_has_role\(r\.oid, 'pg_write_all_data', 'MEMBER'\)/, "members of pg_write_all_data, inherited or not");
    assert.match(verify, /IF EXISTS \(SELECT 1 FROM pg_class c, aclexplode\(c\.relacl\) a WHERE c\.oid = t AND a\.grantee <> c\.relowner\) THEN\s+RAISE EXCEPTION/, "no grant but the owner's left, PUBLIC's included");
  }
  const src = fs.readFileSync(path.join(__dirname, "migrate-approved.cjs"), "utf8");
  assert.match(src, /const revoked = prisma\(\[[^\]]+\], revoke\)\.status === 0;\s+return revoked && prisma\(\[[^\]]+\], verify\)\.status === 0;/, "two commands, both must succeed");
});

test("the workout-programs migration (UI-01) only adds: a new table and two nullable columns; nothing dropped or rewritten", () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS, "20261110120000_workout_programs", "migration.sql"), "utf8");
  const statements = sql.replace(/ON (DELETE|UPDATE) (SET NULL|CASCADE|RESTRICT|NO ACTION)/g, "");
  assert.doesNotMatch(statements, /\bDROP\b|\bTRUNCATE\b|\bDELETE\b|\bUPDATE\s+"|\bRENAME\b|ALTER COLUMN|SET NOT NULL|SET DEFAULT/i);
  const added = [...sql.matchAll(/ADD COLUMN\s+"(\w+)"\s+([^,;\n]+)/g)].map((m) => [m[1], m[2].trim()]);
  assert.deepEqual(added, [["programId", "TEXT"], ["programPosition", "INTEGER"]], "two nullable columns");
  assert.match(sql, /CREATE TABLE "WorkoutProgram"/);
  // Ungrouping or deleting a program keeps its plans: the plan's link is cleared, never the plan.
  assert.match(sql, /"WorkoutTemplate_programId_fkey"[^;]+REFERENCES "WorkoutProgram"\("id"\) ON DELETE SET NULL/);
});
