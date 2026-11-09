// Read-only before/after evidence for applying an approved migration to a local database (MIG-FB and MIG-GYM on
// fitdb_test first). Never writes: every statement runs in a READ ONLY transaction.
//   node --env-file=<env> scripts/table-fingerprint.cjs --save=<file.json>                 before: record
//   node --env-file=<env> scripts/table-fingerprint.cjs --compare=<file.json>              after: compare
// For every table that existed before, it records the row count and an MD5 over the rows' ORIGINAL columns only,
// in primary-key order, so columns a migration adds don't change it. --compare recomputes over those same columns
// and fails (exit 1) on any difference, any missing table or column, or an unvalidated foreign key. The file holds
// table and column names, counts and hashes only, never row content or the connection string.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PG_BIN = process.env.PG_BIN || "C:/Program Files/PostgreSQL/18/bin";
const args = process.argv.slice(2);
const save = args.find((a) => a.startsWith("--save="))?.slice(7);
const compare = args.find((a) => a.startsWith("--compare="))?.slice(10);
if (args.length !== 1 || (!save && !compare)) { console.error("use --save=<file.json> or --compare=<file.json>"); process.exit(4); }
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL isn't set (use --env-file)"); process.exit(4); }
const conn = process.env.DATABASE_URL.replace(/\?.*$/, "");
const q = (sql) => {
  const r = spawnSync(path.join(PG_BIN, "psql"), [conn, "-X", "-q", "-At", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", `SET default_transaction_read_only = on; ${sql}`], { encoding: "utf8", maxBuffer: 64 * 2 ** 20 });
  if (r.status !== 0) throw new Error((r.stderr || "").replace(/postgres(ql)?:\/\/\S+/g, "<url>").slice(0, 400));
  return r.stdout.replace(/\r/g, "").trim();
};
const ident = (s) => `"${s.replace(/"/g, '""')}"`;
const columnsOf = (t) => q(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${t.replace(/'/g, "''")}' ORDER BY ordinal_position`).split("\n").filter(Boolean);
const pkOf = (t) => q(`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = '"public".${ident(t)}'::regclass AND i.indisprimary ORDER BY a.attnum`).split("\n").filter(Boolean);
const fingerprint = (t, cols) => {
  const order = (pkOf(t).length ? pkOf(t) : cols).map(ident).join(", ");
  const row = `ROW(${cols.map(ident).join(", ")})::text`;
  const [count, md5] = q(`SELECT count(*), coalesce(md5(string_agg(${row}, E'\\n' ORDER BY ${order})), 'empty') FROM "public".${ident(t)}`).split("\t");
  return { count: Number(count), md5 };
};
const db = q("SELECT current_database()");
const unvalidatedFks = Number(q("SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' AND c.contype = 'f' AND NOT c.convalidated"));
const migrations = q(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY 1`).split("\n").filter(Boolean);

if (save) {
  const tables = {};
  for (const t of q("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY 1").split("\n").filter(Boolean)) {
    const cols = columnsOf(t);
    tables[t] = { columns: cols, ...fingerprint(t, cols) };
  }
  fs.writeFileSync(save, JSON.stringify({ database: db, takenAt: new Date().toISOString(), migrations, unvalidatedFks, tables }, null, 2));
  console.log(`SAVED ${db}: ${Object.keys(tables).length} tables, ${Object.values(tables).reduce((n, t) => n + t.count, 0)} rows, ${migrations.length} migrations, ${unvalidatedFks} unvalidated foreign keys.`);
} else {
  const before = JSON.parse(fs.readFileSync(compare, "utf8"));
  const problems = [];
  if (before.database !== db) problems.push(`a different database (${db}, not ${before.database})`);
  for (const [t, b] of Object.entries(before.tables)) {
    const now = columnsOf(t);
    const missing = b.columns.filter((c) => !now.includes(c));
    if (!now.length) { problems.push(`${t}: table missing`); continue; }
    if (missing.length) { problems.push(`${t}: columns missing: ${missing.join(", ")}`); continue; }
    const a = fingerprint(t, b.columns);
    if (a.count !== b.count || a.md5 !== b.md5) problems.push(`${t}: rows changed (${b.count} → ${a.count})`);
  }
  if (unvalidatedFks) problems.push(`${unvalidatedFks} unvalidated foreign keys`);
  const added = migrations.filter((m) => !before.migrations.includes(m));
  const lost = before.migrations.filter((m) => !migrations.includes(m));
  if (lost.length) problems.push(`migration history lost: ${lost.join(", ")}`);
  console.log(`${db}: ${Object.keys(before.tables).length} existing tables compared over their original columns; migrations added: ${added.join(", ") || "none"}.`);
  if (problems.length) { console.log(`DIFFERENT:\n- ${problems.join("\n- ")}`); process.exit(1); }
  console.log("UNCHANGED: every existing row identical over its original columns; every foreign key validated.");
}
