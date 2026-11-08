// Creates and prepares one of the two named local databases, by hand, or reports on it:
//   node --env-file=.env.review   scripts/local-db.cjs --init   --confirm=fitdb_review
//   node --env-file=.env.isolated scripts/local-db.cjs --init   --confirm=fitdb_test_isolated
//   node --env-file=.env.isolated scripts/local-db.cjs --init   --confirm=fitdb_test_isolated_other   (B1b, with approval)
// A companion (fitdb_test_isolated_other) uses its parent's settings file: its address is the parent's verified local
// address with only the name changed, so it can't point anywhere else.
//   node --env-file=.env.review   scripts/local-db.cjs --status --confirm=fitdb_review
// --init creates the database if it doesn't exist, applies the existing migrations with `prisma migrate deploy`, adds
// the built-in exercise library with the existing seed, and marks it. It never drops, resets or overwrites anything:
// a database that already holds tables without its own marker is refused. Running it again only applies new migrations.
// Output is fixed text and counts, never an address or a credential.
"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { LOCAL_DATABASES, companionUrl, localDatabaseProblem, envFileProblem, maintenanceUrl, readLocalIdentity, scrubber } = require("./lib/local-databases.cjs");

const ROOT = path.join(__dirname, "..");
const refuse = (m) => { console.error(`REFUSED (nothing was changed): ${m}`); process.exit(4); };

const args = process.argv.slice(2);
const mode = args[0];
const name = (args[1] ?? "").startsWith("--confirm=") ? args[1].slice("--confirm=".length) : "";
if (args.length !== 2 || !["--init", "--status"].includes(mode) || !Object.hasOwn(LOCAL_DATABASES, name)) refuse(`use --init or --status, then --confirm=${Object.keys(LOCAL_DATABASES).join(" or --confirm=")}.`);
const fileProblem = envFileProblem(name);
if (fileProblem) refuse(fileProblem);
const PARENT = LOCAL_DATABASES[name].companionOf;
if (PARENT) { const p = localDatabaseProblem(process.env.DATABASE_URL, PARENT); if (p) refuse(`${name} is derived from ${PARENT}'s settings: ${p}`); }
const DB = PARENT ? companionUrl(process.env.DATABASE_URL, name) : process.env.DATABASE_URL;
const urlProblem = localDatabaseProblem(DB, name);
if (urlProblem) refuse(urlProblem);
if (!/^[a-z_]+$/.test(name)) refuse("unexpected database name.");
// A database that keeps data gets only migrations the owner approved (prisma/approved-migrations.json); checked here,
// before connecting, and again just before migrate deploy. Disposable test databases get every migration.
if (mode === "--init" && name === "fitdb_review") {
  const pending = require("./lib/approved-migrations.cjs").unapprovedMigrations();
  if (pending.length) refuse(`not approved for ${name}: ${pending.join(", ")}.`);
}
const { marker: MARKER } = LOCAL_DATABASES[name];
const scrub = scrubber(DB);

const { PrismaClient } = require("@prisma/client");
const client = (url) => new PrismaClient({ datasources: { db: { url } }, errorFormat: "minimal" });

/** Runs a tool against this database only. Its own .env files can't win: an explicit DATABASE_URL takes precedence. */
function run(label, file, toolArgs) {
  const env = { ...process.env, DATABASE_URL: DB };
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, [file, ...toolArgs], { cwd: ROOT, env, encoding: "utf8", windowsHide: true });
  const out = scrub(`${r.stdout ?? ""}${r.stderr ?? ""}`).trim();
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status}): ${out.split(/\r?\n/).slice(-6).join(" / ")}`);
  return out;
}
const PRISMA = path.join(ROOT, "node_modules", "prisma", "build", "index.js");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

async function facts(db) {
  const [t] = await db.$queryRawUnsafe("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'");
  const migrated = t.n > 0 ? (await db.$queryRawUnsafe("SELECT count(*)::int AS n FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL"))[0].n : 0;
  const users = t.n > 0 ? await db.user.count() : 0;
  const builtIn = t.n > 0 ? await db.exercise.count({ where: { userId: null } }) : 0;
  return { tables: t.n, migrations: migrated, users, builtInExercises: builtIn };
}

async function init() {
  // 1. The server is local, and the database exists, or is created now. Its name comes from the fixed list above.
  const admin = client(maintenanceUrl(DB));
  let created = false;
  try {
    const [srv] = await admin.$queryRawUnsafe("SELECT host(inet_server_addr()) AS addr, current_database() AS name");
    if (srv.name !== "postgres" || (srv.addr !== null && srv.addr !== "127.0.0.1" && srv.addr !== "::1")) throw new Error("the database server isn't this machine.");
    const exists = (await admin.$queryRawUnsafe("SELECT 1 FROM pg_database WHERE datname = $1", name)).length > 0;
    if (!exists) { await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); created = true; }
  } finally { await admin.$disconnect(); }
  console.log(created ? `Created ${name}.` : `${name} already exists.`);

  // 2. Before any change: it's the right database, and either ours already, or empty.
  const db = client(DB);
  try {
    const id = await readLocalIdentity(db, name);
    const before = await facts(db);
    if (id.marker !== null && id.marker !== MARKER) throw new Error(`${name} carries another marker, so it isn't touched.`);
    if (id.marker === null && before.tables > 0) throw new Error(`${name} already holds ${before.tables} tables and isn't marked as prepared here, so it isn't touched.`);
    console.log(`Before: ${JSON.stringify(before)}${id.marker === MARKER ? ", already marked" : ""}.`);

    // 3. The existing migrations, the supported way. Never reset or db push.
    // A database that keeps data gets only migrations the owner approved; disposable test databases get all of them.
    if (name === "fitdb_review") {
      const pending = require("./lib/approved-migrations.cjs").unapprovedMigrations();
      if (pending.length) throw new Error(`not approved for ${name}: ${pending.join(", ")}. Nothing was migrated.`);
    }
    run("migrate deploy", PRISMA, ["migrate", "deploy"]);
    console.log("Migrations applied with prisma migrate deploy.");
    // 4. The built-in exercise library, from the existing seed. It only adds the ones missing.
    run("seed", TSX, [path.join("prisma", "seed.ts")]);
    console.log("Built-in exercises present.");
    // 5. Its marker, once it's prepared.
    if (id.marker === null) { await db.$executeRawUnsafe(`COMMENT ON DATABASE "${name}" IS '${MARKER}'`); console.log("Marked."); }

    // 6. Verified: migrations up to date, the marker in place, and what it holds.
    const status = run("migrate status", PRISMA, ["migrate", "status"]);
    if (!/up to date/i.test(status)) throw new Error("migrate status doesn't report the schema up to date.");
    const after = await readLocalIdentity(db, name);
    if (after.marker !== MARKER) throw new Error("the marker isn't in place.");
    console.log(`After: ${JSON.stringify(await facts(db))}. Schema up to date. Fingerprint ${after.fingerprint.slice(0, 12)}…`);
    console.log(`${name} READY.`);
  } finally { await db.$disconnect(); }
}

async function status() {
  const db = client(DB);
  try {
    const id = await readLocalIdentity(db, name);
    console.log(`${name}: marker ${id.marker === MARKER ? "correct" : id.marker === null ? "MISSING" : "WRONG"}, fingerprint ${id.fingerprint.slice(0, 12)}…, ${JSON.stringify(await facts(db))}`);
  } finally { await db.$disconnect(); }
}

(mode === "--init" ? init() : status()).catch((e) => { console.error(`STOPPED: ${scrub(e.message).slice(0, 300)}`); process.exit(1); });
