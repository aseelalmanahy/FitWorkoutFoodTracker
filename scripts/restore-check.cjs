// DEPLOY-03: proves a backup of fitdb_review can be restored, by restoring it into a scratch database and checking it,
// without touching fitdb_review. It never creates, drops or overwrites a database: the owner creates the empty scratch
// database first, and drops it after (both need the owner's approval).
//   node --env-file=.env.review scripts/restore-check.cjs --backup=<file.dump> --confirm=fitdb_restore_check
// Refuses unless: the backup lists; fitdb_review is the marked local review database (only read); the scratch database
// is exactly fitdb_restore_check, on this machine, reachable with the same role, and empty (no tables, no marker).
// Then: pg_restore into it, and compare. Its migration history and every table must equal fitdb_review's schema;
// representative records (the owner's account, the built-in exercises) must be present and identical; row counts are
// reported beside fitdb_review's (which may have grown since the backup); fitdb_review's own fingerprint and row counts
// must be the same before and after. Passwords go only in the environment of pg_restore, and are never printed.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { REVIEW_MARKER, localDatabaseProblem, envFileProblem, readLocalIdentity, scrubber } = require("./lib/local-databases.cjs");

const SOURCE = "fitdb_review";
const SCRATCH = "fitdb_restore_check";
const PG_BIN = process.env.PG_BIN ?? (process.platform === "win32" ? "C:/Program Files/PostgreSQL/18/bin" : "/usr/bin");
const refuse = (m) => { console.error(`REFUSED (nothing was restored): ${m}`); process.exit(4); };

const args = process.argv.slice(2);
const backupArg = args.find((a) => a.startsWith("--backup="));
if (args.length !== 2 || !backupArg || !args.includes(`--confirm=${SCRATCH}`)) refuse(`use --backup=<file.dump> --confirm=${SCRATCH}.`);
const BACKUP = path.resolve(backupArg.slice("--backup=".length));
const fileProblem = envFileProblem(SOURCE);
if (fileProblem) refuse(fileProblem);
const SOURCE_URL = process.env.DATABASE_URL;
const urlProblem = localDatabaseProblem(SOURCE_URL, SOURCE);
if (urlProblem) refuse(urlProblem);
const scratchUrl = (() => { const u = new URL(SOURCE_URL); u.pathname = `/${SCRATCH}`; return u.toString(); })();
const scrub = scrubber(SOURCE_URL);
if (!fs.existsSync(BACKUP)) refuse("the backup file doesn't exist.");
const listing = spawnSync(path.join(PG_BIN, "pg_restore"), ["--list", BACKUP], { encoding: "utf8" });
if (listing.status !== 0) refuse(`the backup can't be listed: ${scrub(listing.stderr).slice(0, 200)}`);

const { PrismaClient } = require("@prisma/client");
const TABLES_SQL = `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`;
const COLUMNS_SQL = `SELECT table_name || '.' || column_name || ':' || data_type || ':' || is_nullable AS c FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1`;
const MIGRATIONS_SQL = `SELECT migration_name || ':' || checksum AS m FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY 1`;
const quote = (t) => `"${t.replace(/"/g, '""')}"`;

async function counts(db) {
  const out = {};
  for (const { name } of await db.$queryRawUnsafe(TABLES_SQL)) out[name] = Number((await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ${quote(name)}`))[0].n);
  return out;
}
const list = async (db, sql, key) => (await db.$queryRawUnsafe(sql)).map((r) => r[key]);

(async () => {
  const source = new PrismaClient({ datasources: { db: { url: SOURCE_URL } }, errorFormat: "minimal" });
  const scratch = new PrismaClient({ datasources: { db: { url: scratchUrl } }, errorFormat: "minimal" });
  try {
    const before = await readLocalIdentity(source, SOURCE);
    if (before.marker !== REVIEW_MARKER) refuse(`${SOURCE} doesn't carry its review marker.`);
    const sourceCountsBefore = await counts(source);

    let identity;
    try { identity = await readLocalIdentity(scratch, SCRATCH); } catch (e) { refuse(`${SCRATCH} can't be reached (create it first, empty, owned by the same role): ${scrub(e.message).slice(0, 160)}`); }
    if (identity.marker) refuse(`${SCRATCH} carries a database marker, so it isn't a fresh scratch database.`);
    if ((await scratch.$queryRawUnsafe(TABLES_SQL)).length) refuse(`${SCRATCH} isn't empty.`);

    const u = new URL(scratchUrl);
    const r = spawnSync(path.join(PG_BIN, "pg_restore"), ["--no-owner", "--no-privileges", "--exit-on-error", "-h", u.hostname, "-p", u.port || "5432", "-U", decodeURIComponent(u.username), "-d", SCRATCH, BACKUP],
      { encoding: "utf8", env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) } });
    if (r.status !== 0) throw new Error(`pg_restore failed: ${scrub(r.stderr).slice(0, 300)}`);

    const problems = [];
    const same = async (label, sql, key) => { const a = await list(source, sql, key), b = await list(scratch, sql, key); if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${label} differ`); return b.length; };
    const migrations = await same("migrations", MIGRATIONS_SQL, "m");
    const tables = await same("tables", TABLES_SQL, "name");
    const columns = await same("columns", COLUMNS_SQL, "c");
    // Representative records that don't change in use: the owner's account and the built-in exercises.
    const owner = `SELECT id, email, "createdAt" FROM "User" WHERE email = 'owner@review.local'`;
    const builtIn = `SELECT md5(string_agg(id || name, ',' ORDER BY id)) AS h, count(*)::int AS n FROM "Exercise" WHERE "userId" IS NULL`;
    if (JSON.stringify(await source.$queryRawUnsafe(owner)) !== JSON.stringify(await scratch.$queryRawUnsafe(owner))) problems.push("the owner's account differs");
    const [bs, bt] = [await source.$queryRawUnsafe(builtIn), await scratch.$queryRawUnsafe(builtIn)];
    if (JSON.stringify(bs) !== JSON.stringify(bt)) problems.push("the built-in exercises differ");
    const restored = await counts(scratch);
    const grew = Object.keys(restored).filter((t) => restored[t] > (sourceCountsBefore[t] ?? 0));
    if (grew.length) problems.push(`more rows than ${SOURCE} has now in: ${grew.join(", ")}`);

    const after = await readLocalIdentity(source, SOURCE);
    const sourceCountsAfter = await counts(source);
    if (after.fingerprint !== before.fingerprint || JSON.stringify(sourceCountsAfter) !== JSON.stringify(sourceCountsBefore)) problems.push(`${SOURCE} changed during the check (by something else; this only reads it)`);

    console.log(`Restored ${path.basename(BACKUP)} into ${SCRATCH}: ${migrations} migrations, ${tables} tables, ${columns} columns, the owner's account and ${bt[0].n} built-in exercises.`);
    console.log(`Rows (restored / ${SOURCE} now): ${Object.keys(restored).map((t) => `${t} ${restored[t]}/${sourceCountsBefore[t]}`).join(", ")}`);
    if (problems.length) { console.error(`FAILED: ${problems.join("; ")}.`); process.exitCode = 1; }
    else console.log(`RESTORE VERIFIED. ${SOURCE} unchanged. Drop ${SCRATCH} when done (the owner's step).`);
  } finally {
    await source.$disconnect().catch(() => {});
    await scratch.$disconnect().catch(() => {});
  }
})().catch((e) => { console.error(`FAILED: ${scrub(e.message).slice(0, 300)}`); process.exit(1); });
