// MIG-04's checks, in the order docs/MIG_04_RUNBOOK.md gives them. Run on fitdb_test on 2026-11-07, with the owner's written
// authorization. Its refusals are tested with no database: scripts/mig-04.test.cjs.
//   node --env-file=.env.test scripts/mig-04.cjs preflight
//   node --env-file=.env.test scripts/mig-04.cjs backup
//   node --env-file=.env.test scripts/mig-04.cjs apply --owner-authorized=MIG-04
//   node --env-file=.env.test scripts/mig-04.cjs verify
// Use the runbook's PowerShell blocks, which clear any DATABASE_URL in the window first. fitdb_test only. preflight, backup and verify change nothing on the database. Prints no credentials.
"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseEnv } = require("node:util");
const { databaseUrlProblem, environmentProblems, readDatabaseIdentity } = require("./lib/test-target-guard.cjs");
const { Stop, stop, TARGET, MIG, EXPECTED_BLOB, APPLIED_BEFORE, MAX_AGE_TO_APPLY_MS, MAX_AGE_TO_VERIFY_MS, checkState, checkIdentity, checkCounts, checkSameDatabase, verifyBeforeMigration, applyStep } = require("./lib/mig-04-verify.cjs");

const EXPECTED_SHA256 = "b5dd6a4b31dc8717952cef81a67bf42e7b71cc2f3de216d516c5864e5155bbf4";
const SCHEMA_BEFORE_COMMIT = "5434f90b9b5ca71ebb5dc542a8bc3facdd88908c"; // main: MIG-03 is the last thing it describes.
const AUTHORIZATION = "--owner-authorized=MIG-04";
const PG_BIN = "C:/Program Files/PostgreSQL/18/bin";
const BACKUPS = path.join(os.homedir(), "FitWorkoutFoodTracker-backups");
const STATE = path.join(os.tmpdir(), "fit-mig-04-state.json");
const ROOT = path.join(__dirname, "..");
const MIGRATIONS = path.join(ROOT, "prisma", "migrations");
const FILE = path.join(MIGRATIONS, MIG, "migration.sql");

const refuse = (message) => { console.error(`REFUSED: ${message}`); process.exit(4); };
const ok = (message) => console.log(`ok   ${message}`);

// ─── Before anything connects ────────────────────────────────────────────────

const [step, ...flags] = process.argv.slice(2);
if (!["preflight", "backup", "apply", "verify"].includes(step)) refuse("use preflight, backup, apply or verify.");
if (step === "apply" && !(flags.length === 1 && flags[0] === AUTHORIZATION)) refuse(`applying needs ${AUTHORIZATION}, used only after the owner has authorized it in writing.`);
if (step !== "apply" && flags.length) refuse(`${step} takes no options.`);

// node --env-file lets a variable already in the shell win, silently, so a DATABASE_URL left in a window would be used
// in place of the file's. Nothing else here could tell. So the value in use has to be the one in the file.
function effectiveUrlProblem() {
  const envFiles = process.execArgv.filter((a) => a.startsWith("--env-file"));
  if (envFiles.length !== 1 || !envFiles[0].startsWith("--env-file=") || path.basename(envFiles[0].slice("--env-file=".length)) !== ".env.test") return "run this with exactly --env-file=.env.test.";
  const fromFile = parseEnv(fs.readFileSync(envFiles[0].slice("--env-file=".length), "utf8")).DATABASE_URL;
  if (fromFile === undefined) return ".env.test doesn't set DATABASE_URL.";
  if (process.env.DATABASE_URL !== fromFile) return "a DATABASE_URL already in this shell is overriding .env.test. In PowerShell, run: Remove-Item Env:DATABASE_URL";
  return null;
}
const urlProblem = effectiveUrlProblem();
if (urlProblem) refuse(urlProblem);

const DB = process.env.DATABASE_URL;
const problems = [databaseUrlProblem(DB), ...environmentProblems(process.env)].filter(Boolean);
if (problems.length) refuse(problems.map((p) => p.message).join(" | "));
const url = new URL(DB);
if (decodeURIComponent(url.pathname.slice(1)) !== TARGET) refuse(`DATABASE_URL must name ${TARGET} exactly.`);
if ((url.searchParams.get("schema") ?? "public") !== "public") refuse("the schema must be public.");
if (process.env.NODE_ENV === "production") refuse("NODE_ENV is production.");

const scrub = (text) => {
  let out = String(text);
  for (const secret of [DB, url.password, decodeURIComponent(url.password)]) if (secret) out = out.split(secret).join("<redacted>");
  return out.replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/g, "$1***@");
};
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const git = (...args) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
const prismaCli = (...args) => {
  const r = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", ...args], { cwd: ROOT, env: { ...process.env, DATABASE_URL: DB }, encoding: "utf8", timeout: 180_000 });
  return { code: r.status, out: scrub(`${r.stdout ?? ""}${r.stderr ?? ""}`) };
};

/** The problem with MIG-04's file, if there is one. */
function fileProblem() {
  const blob = git("rev-parse", `HEAD:prisma/migrations/${MIG}/migration.sql`).stdout.trim();
  if (blob !== EXPECTED_BLOB) return `the committed file isn't the reviewed one: ${blob}`;
  if (git("diff", "--quiet", "HEAD", "--", "prisma/migrations", "prisma/schema.prisma").status !== 0) return "prisma/ has uncommitted changes.";
  const bytes = fs.readFileSync(FILE);
  if (bytes.includes(13)) return "the file has CR, so its recorded checksum would differ from the committed bytes.";
  if (sha256(bytes) !== EXPECTED_SHA256) return "the working file isn't the reviewed one.";
  const sql = bytes.toString("utf8").replace(/ON (DELETE|UPDATE) CASCADE/g, "");
  if (/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|RENAME|ALTER COLUMN)\b/.test(sql)) return "the file isn't purely additive.";
  ok(`MIG-04's file: blob ${blob.slice(0, 7)}, sha256 ${EXPECTED_SHA256.slice(0, 16)}…, LF only, additive`);
  return null;
}

// ─── Reading the database ────────────────────────────────────────────────────

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: DB } }, errorFormat: "minimal" });
const finish = async (code) => { await prisma.$disconnect().catch(() => {}); process.exit(code); };

/** What the connected server says it is. lib/mig-04-verify.cjs decides whether that's right. */
async function readIdentity() {
  const own = await readDatabaseIdentity(DB, TARGET);
  const [i] = await prisma.$queryRawUnsafe(`SELECT current_database() AS db, current_schema() AS schema, inet_server_addr()::text AS addr, inet_server_port() AS port,
    (SELECT xmin::text FROM pg_shdescription WHERE objoid = (SELECT oid FROM pg_database WHERE datname = current_database())) AS "markerVersion"`);
  return { ...i, marker: own.marker, fingerprint: own.fingerprint };
}
const applied = () => prisma.$queryRawUnsafe(`SELECT migration_name AS name, checksum, finished_at AS finished, rolled_back_at AS "rolledBack", applied_steps_count AS steps FROM _prisma_migrations ORDER BY started_at`);
const onDisk = () => fs.readdirSync(MIGRATIONS).filter((d) => fs.statSync(path.join(MIGRATIONS, d)).isDirectory()).sort();
async function rowCounts() {
  const tables = await prisma.$queryRawUnsafe(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`);
  const out = {};
  for (const { name } of tables) out[name] = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${name}"`))[0].n;
  return out;
}
const bodyMetricObjects = async () => (await prisma.$queryRawUnsafe(`SELECT to_regclass('public."BodyMetric"')::text AS tbl, (SELECT count(*)::int FROM pg_type WHERE typname = 'BodyMetricKind') AS kinds`))[0];
const readState = () => {
  if (!fs.existsSync(STATE)) return null;
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { throw new Stop("the preflight record can't be read. Run preflight again."); }
};
const writeState = (state) => fs.writeFileSync(STATE, JSON.stringify(state));
const checksumOnDisk = (name) => {
  const file = path.join(MIGRATIONS, name, "migration.sql");
  return fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null;
};
function prismaTarget() {
  const status = prismaCli("migrate", "status");
  const named = /Datasource "db": PostgreSQL database "([^"]+)", schema "([^"]+)" at "([^"]+)"/.exec(status.out);
  return named && { db: named[1], schema: named[2], host: named[3], listsMig: status.out.includes(MIG) };
}
function driftFromBefore() {
  const before = path.join(os.tmpdir(), "fit-mig-04-schema-before.prisma");
  const shown = git("show", `${SCHEMA_BEFORE_COMMIT}:prisma/schema.prisma`);
  if (shown.status !== 0) throw new Stop("the schema before MIG-04 can't be read from Git.");
  fs.writeFileSync(before, shown.stdout);
  return prismaCli("migrate", "diff", "--from-url", DB, "--to-schema-datamodel", before, "--exit-code");
}
const fileFacts = (file) => {
  if (!fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return { size: bytes.length, sha256: sha256(bytes) };
};

/** Everything lib/mig-04-verify.cjs needs from the outside world. None of it writes to the database. */
const io = {
  ok, readState, fileFacts, checksumOnDisk, prismaTarget, driftFromBefore, applied, rowCounts, bodyMetricObjects, fileProblem, effectiveUrlProblem,
  backupsFolder: BACKUPS,
  identity: readIdentity,
  migrationsOnDisk: onDisk,
  archiveRowCounts: (file) => archiveRowCounts(file),
};

// ─── Steps ───────────────────────────────────────────────────────────────────

async function preflight() {
  const { identity, rows } = await verifyBeforeMigration(io);
  const counts = await rowCounts();
  writeState({ takenAt: Date.now(), blob: EXPECTED_BLOB, fingerprint: identity.fingerprint, counts, markerVersion: identity.markerVersion, checksums: Object.fromEntries(rows.map((r) => [r.name, r.checksum])) });
  console.log(`     rows: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log("PREFLIGHT PASSED");
}

/** Row counts per table, read from the archive itself with no database. It's text-format COPY, so one line is one row. */
function archiveRowCounts(file) {
  const r = spawnSync(`${PG_BIN}/pg_restore`, ["--data-only", "--file=-", file], { encoding: "utf8", maxBuffer: 1 << 30, timeout: 300_000 });
  if (r.status !== 0) stop(`pg_restore couldn't read the backup's data, exit ${r.status}.`);
  const counts = {};
  let table = null;
  for (const line of r.stdout.split("\n")) {
    if (table) {
      if (line === "\\." || line === "\\.\r") table = null;
      else counts[table]++;
    } else {
      const m = /^COPY public\."?([^" ]+)"? /.exec(line);
      if (m) { table = m[1]; counts[table] = 0; }
    }
  }
  return counts;
}

async function backup() {
  const state = checkState(readState(), Date.now(), { maxAgeMs: MAX_AGE_TO_APPLY_MS, needBackup: false });
  const identity = await readIdentity();
  checkIdentity(identity);
  checkSameDatabase(state, identity, await applied());
  fs.mkdirSync(BACKUPS, { recursive: true });
  const file = path.join(BACKUPS, `fitdb_test-pre-mig-04-${new Date().toISOString().replace(/[-:]|\.\d+/g, "")}.dump`);
  if (fs.existsSync(file)) stop("that backup file already exists.");
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
  delete env.DATABASE_URL;
  const dump = spawnSync(`${PG_BIN}/pg_dump`, ["--format=custom", `--file=${file}`, `--host=${url.hostname}`, `--port=${url.port || "5432"}`, `--username=${decodeURIComponent(url.username)}`, `--dbname=${TARGET}`, "--no-password"], { env, encoding: "utf8", timeout: 300_000 });
  if (dump.status !== 0) stop(`pg_dump exit ${dump.status}: ${scrub(dump.stderr).slice(0, 300)}`);
  const size = fs.statSync(file).size;
  if (!size) stop("the backup is empty.");
  ok(`pg_dump exited 0: ${file}, ${size} bytes`);

  const list = spawnSync(`${PG_BIN}/pg_restore`, ["--list", file], { encoding: "utf8", maxBuffer: 1 << 26, timeout: 120_000 });
  if (list.status !== 0) stop(`pg_restore --list exit ${list.status}.`);
  if (!/dbname: fitdb_test\s*$/m.test(list.stdout)) stop("the archive isn't of fitdb_test.");
  if (/BodyMetric/.test(list.stdout)) stop("the archive already holds MIG-04's objects.");
  ok("the archive's listing reads, and names fitdb_test");

  checkCounts(state.counts, archiveRowCounts(file), "the archive doesn't match the database");
  ok(`every table's row count in the archive equals the database's, ${Object.keys(state.counts).length} tables including _prisma_migrations`);
  writeState({ ...state, backup: { file, ...fileFacts(file) } });
  console.log("BACKUP VERIFIED. It hasn't been restored, as restoring needs a database that isn't authorized (T-10).");
}

/** migrate deploy applies every pending migration, so MIG-04 must be the newest one here, or another would come too. */
function laterMigrations() {
  return fs.readdirSync(path.join(ROOT, "prisma", "migrations")).filter((d) => /^\d{14}_/.test(d) && d > MIG);
}

async function apply() {
  const r = await applyStep({ ...io, deploy: () => {
    const later = laterMigrations();
    if (later.length) stop(`a later migration is in prisma/migrations (${later.join(", ")}): migrate deploy would apply it too. Nothing was applied. Run MIG-04 from a branch where it's the newest.`);
    return prismaCli("migrate", "deploy");
  } }, Date.now());
  console.log(r.out.split("\n").filter((l) => /Datasource|migration|applied|Applying|error/i.test(l)).map((l) => `     ${l.trim()}`).join("\n"));
  if (r.code !== 0) stop(`migrate deploy exit ${r.code}. Nothing further was attempted: no reset, no restore. Report it.`);
  console.log("APPLIED. Run verify next.");
}

async function verify() {
  const state = checkState(readState(), Date.now(), { maxAgeMs: MAX_AGE_TO_VERIFY_MS, needBackup: true });
  const identity = await readIdentity();
  checkIdentity(identity);
  if (identity.fingerprint !== state.fingerprint) stop("the preflight record is for a different database.");
  if (identity.markerVersion !== state.markerVersion) stop("the marker's row changed.");
  ok(`connected to ${identity.db}, and the marker's catalog row is unchanged`);

  const status = prismaCli("migrate", "status");
  if (status.code !== 0 || !/Database schema is up to date/.test(status.out)) { console.log(status.out.slice(0, 600)); stop("migrate status isn't clean."); }
  ok("migrate status: up to date");
  const rows = await applied();
  if (rows.length !== APPLIED_BEFORE + 1 || rows[rows.length - 1].name !== MIG) stop("MIG-04 isn't the one new migration, in last place.");
  const me = rows[rows.length - 1];
  if (!me.finished || me.rolledBack || me.steps !== 1) stop("MIG-04's row isn't clean.");
  if (me.checksum !== EXPECTED_SHA256) stop("MIG-04's recorded checksum isn't the reviewed file's.");
  for (const r of rows.slice(0, -1)) if (state.checksums[r.name] !== r.checksum) stop(`an earlier migration's record changed: ${r.name}`);
  ok(`${rows.length} applied, MIG-04 last and clean, its checksum the reviewed file's, earlier records unchanged`);

  const columns = await prisma.$queryRawUnsafe(`SELECT column_name AS name, data_type AS type, is_nullable AS nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'BodyMetric' ORDER BY 1`);
  const shape = columns.map((c) => `${c.name} ${c.type} ${c.nullable}`).join(", ");
  const wanted = "createdAt timestamp without time zone NO, date date NO, id text NO, kind USER-DEFINED NO, updatedAt timestamp without time zone NO, userId text NO, value double precision NO";
  if (shape !== wanted) stop(`BodyMetric's columns aren't as reviewed: ${shape}`);
  const [labels] = await prisma.$queryRawUnsafe(`SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) AS labels FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'BodyMetricKind'`);
  if (labels.labels !== "WEIGHT") stop("BodyMetricKind isn't WEIGHT alone.");
  const indexes = await prisma.$queryRawUnsafe(`SELECT indexdef AS def FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'BodyMetric' ORDER BY 1`);
  if (!indexes.some((i) => /UNIQUE INDEX "BodyMetric_userId_kind_date_key".*\("userId", kind, date\)/.test(i.def))) stop("the one-a-day unique index is missing.");
  const [fk] = await prisma.$queryRawUnsafe(`SELECT confdeltype::text AS del, confrelid::regclass::text AS parent FROM pg_constraint WHERE conname = 'BodyMetric_userId_fkey'`);
  if (fk?.del !== "c" || fk?.parent !== '"User"') stop("the foreign key to User, deleting with the account, is missing.");
  ok("BodyMetric: columns, enum, one-a-day index, and the foreign key that deletes with the account");

  checkCounts({ ...state.counts, _prisma_migrations: state.counts._prisma_migrations + 1, BodyMetric: 0 }, await rowCounts(), "row counts after applying");
  ok(`every table's row count is unchanged, ${Object.keys(state.counts).length} tables, _prisma_migrations up by one, and BodyMetric is empty`);

  const drift = prismaCli("migrate", "diff", "--from-url", DB, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code");
  if (drift.code !== 0) { console.log(drift.out.slice(0, 800)); stop(`the database doesn't equal this branch's schema (exit ${drift.code}).`); }
  ok("no drift: the database equals prisma/schema.prisma");
  console.log("VERIFY PASSED");
}

const steps = { preflight, backup, apply, verify };
steps[step]().then(() => finish(0)).catch(async (e) => {
  if (e instanceof Stop) {
    console.error(`STOP: ${e.message}`);
    return finish(3);
  }
  console.error(`FAILED: ${scrub(e.code ?? e.message).slice(0, 300)}`);
  await finish(1);
});
