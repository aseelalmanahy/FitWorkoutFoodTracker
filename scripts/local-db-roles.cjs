// A4 (SEC-04): one PostgreSQL role per local environment, each able to connect to and write only its own databases.
//   node --env-file=.env.isolated scripts/local-db-roles.cjs --verify            read only: the access matrix as it is
//   node scripts/local-db-roles.cjs --plan                                     read only: what --apply would change
//   node scripts/local-db-roles.cjs --apply    --confirm=A4                     with the owner's A4 approval
//   node scripts/local-db-roles.cjs --rollback --confirm=A4 --state=<file>     undoes --apply, from its saved state
// --plan, --apply and --rollback connect as the PostgreSQL superuser through ADMIN_DATABASE_URL, set in the shell by
// the owner (postgresql://postgres:<password>@127.0.0.1:5432/postgres) and never written or printed. --verify uses the
// DATABASE_URL of the env file it's given.
//
// The plan:  fit         fitdb only (no longer allowed to create databases)
//            fit_review  fitdb_review, fitdb_restore_check
//            fit_test    fitdb_test, fitdb_test_other, fitdb_test_isolated, fitdb_test_isolated_other (creates databases,
//                        as local-db.cjs --init does)
// For each database that exists: PUBLIC loses CONNECT and TEMPORARY, its role gets them and becomes its owner, and
// every object in it that `fit` owns is given to that role one by one. Not REASSIGN OWNED: it also moves shared
// objects, so run in one database it would hand every other database `fit` owns to that role.
// Passwords are generated here (32 characters), written straight into the Git-ignored env files, and never printed.
// Before any change: every env file and the state to restore are copied to the backups folder.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { parseEnv } = require("node:util");

const refuse = (m) => { console.error(`REFUSED (nothing was changed): ${m}`); process.exit(4); };
const PLAN = Object.freeze({
  fit: Object.freeze({ databases: ["fitdb"], createdb: false }),
  fit_review: Object.freeze({ databases: ["fitdb_review", "fitdb_restore_check"], createdb: false }),
  fit_test: Object.freeze({ databases: ["fitdb_test", "fitdb_test_other", "fitdb_test_isolated", "fitdb_test_isolated_other"], createdb: true }),
});
const OLD_OWNER = "fit";
const ROLE_OF = Object.freeze(Object.fromEntries(Object.entries(PLAN).flatMap(([role, p]) => p.databases.map((d) => [d, role]))));
// The folders on the Desktop that hold env files, and what each file must name. FIT_ROLES_DESKTOP is for rehearsals only.
const DESKTOP = process.env.FIT_ROLES_DESKTOP ? path.resolve(process.env.FIT_ROLES_DESKTOP) : path.resolve(__dirname, "..", "..");
const ENV_FILES = Object.freeze([
  ["FitWorkoutFoodTracker", ".env", "fitdb"],
  ["FitWorkoutFoodTracker", ".env.test", "fitdb_test"],
  ["FitWorkoutFoodTracker-review", ".env.review", "fitdb_review"],
  ["FitWorkoutFoodTracker-review", ".env.isolated", "fitdb_test_isolated"],
  ["FitWorkoutFoodTracker-release", ".env.review", "fitdb_review"],
  ["FitWorkoutFoodTracker-release", ".env.isolated", "fitdb_test_isolated"],
].map(([folder, file, db]) => Object.freeze({ path: path.join(DESKTOP, folder, file), db, role: ROLE_OF[db] })));
const BACKUPS = path.join(DESKTOP, "FitWorkoutFoodTracker-backups");
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error("unexpected identifier"); return `"${s}"`; };

const args = process.argv.slice(2);
const mode = args[0];
const known = { "--verify": [], "--plan": [], "--apply": ["--confirm=A4"], "--rollback": ["--confirm=A4"] };
if (!Object.hasOwn(known, mode)) refuse("use --verify, --plan, --apply --confirm=A4, or --rollback --confirm=A4 --state=<file>.");
const stateArg = args.find((a) => a.startsWith("--state="));
for (const need of known[mode]) if (!args.includes(need)) refuse(`${mode} needs ${need}.`);
if (args.some((a) => a !== mode && !known[mode].includes(a) && !(mode === "--rollback" && a === stateArg))) refuse("unexpected argument.");
if (mode === "--rollback" && !stateArg) refuse("--rollback needs --state=<the state file --apply saved>.");

const { PrismaClient } = require("@prisma/client");
const client = (url) => new PrismaClient({ datasources: { db: { url } }, errorFormat: "minimal" });
const withDb = (url, db) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };
const withLogin = (url, user, password) => { const u = new URL(url); u.username = user; u.password = password; return u.toString(); };
const secrets = new Set();
const scrub = (s) => { let out = String(s); for (const x of secrets) if (x) out = out.split(x).join("[redacted]"); return out.replace(/postgres(ql)?:\/\/[^\s"']+/g, "[address]"); };

function readEnvUrl(file) {
  const url = parseEnv(fs.readFileSync(file, "utf8")).DATABASE_URL;
  if (!url) throw new Error(`${path.basename(path.dirname(file))}/${path.basename(file)} has no DATABASE_URL.`);
  const u = new URL(url);
  secrets.add(u.password); secrets.add(decodeURIComponent(u.password));
  return u;
}
function adminUrl() {
  const raw = process.env.ADMIN_DATABASE_URL;
  if (!raw) refuse("set ADMIN_DATABASE_URL to the local superuser's address in this shell first.");
  let u;
  try { u = new URL(raw); } catch { refuse("ADMIN_DATABASE_URL can't be parsed."); }
  secrets.add(u.password); secrets.add(decodeURIComponent(u.password));
  if (!LOOPBACK.has(u.hostname)) refuse("ADMIN_DATABASE_URL isn't this machine.");
  if ([...u.searchParams.keys()].length) refuse("ADMIN_DATABASE_URL has parameters, and one such as host= can redirect the connection.");
  if (u.pathname !== "/postgres") refuse("ADMIN_DATABASE_URL must name the postgres maintenance database.");
  return u.toString();
}

/**
 * The objects in a database's public schema that carry their own owner. Sequences behind serial and identity columns
 * and the row types of tables follow their table, so they aren't listed separately.
 */
async function objectsOf(adminAddr, db) {
  const c = client(withDb(adminAddr, db));
  try {
    return await c.$queryRawUnsafe(`
      SELECT 'table' AS kind, c.oid::regclass::text AS name, pg_get_userbyid(c.relowner) AS owner FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
      UNION ALL SELECT 'sequence', c.oid::regclass::text, pg_get_userbyid(c.relowner) FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S' AND NOT EXISTS (SELECT 1 FROM pg_depend x WHERE x.objid = c.oid AND x.deptype IN ('a','i'))
      UNION ALL SELECT 'type', t.oid::regtype::text, pg_get_userbyid(t.typowner) FROM pg_type t
        WHERE t.typnamespace = 'public'::regnamespace AND (t.typtype IN ('e','d') OR (t.typtype = 'c' AND (SELECT relkind FROM pg_class WHERE oid = t.typrelid) = 'c'))
      UNION ALL SELECT 'function', p.oid::regprocedure::text, pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      UNION ALL SELECT 'schema', n.nspname, pg_get_userbyid(n.nspowner) FROM pg_namespace n WHERE n.nspname = 'public'
      ORDER BY 1, 2`);
  } finally { await c.$disconnect(); }
}

/** Everything the plan depends on, read only. */
async function survey(admin, adminAddr) {
  const [me] = await admin.$queryRawUnsafe("SELECT current_user AS name, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super, current_database() AS db, host(inet_server_addr()) AS addr");
  if (!me.super) throw new Error("ADMIN_DATABASE_URL isn't a superuser.");
  if (me.addr !== null && me.addr !== "127.0.0.1" && me.addr !== "::1") throw new Error("the database server isn't this machine.");
  const roles = Object.fromEntries((await admin.$queryRawUnsafe("SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin FROM pg_roles WHERE rolname = ANY($1::text[])", [OLD_OWNER, ...Object.keys(PLAN)])).map((r) => [r.rolname, r]));
  if (!roles[OLD_OWNER]) throw new Error(`role ${OLD_OWNER} doesn't exist.`);
  const dbs = await admin.$queryRawUnsafe("SELECT datname, pg_get_userbyid(datdba) AS owner, datacl::text AS acl FROM pg_database WHERE datname = ANY($1::text[]) ORDER BY 1", Object.keys(ROLE_OF));
  for (const d of dbs) if (d.owner !== OLD_OWNER && d.owner !== ROLE_OF[d.datname]) throw new Error(`${d.datname} is owned by ${d.owner}, which this plan doesn't expect.`);
  const objects = {};
  for (const d of dbs) {
    objects[d.datname] = await objectsOf(adminAddr, d.datname);
    const foreign = objects[d.datname].filter((o) => ![OLD_OWNER, ROLE_OF[d.datname], "pg_database_owner", me.name].includes(o.owner));
    if (foreign.length) throw new Error(`${d.datname} holds objects owned by ${[...new Set(foreign.map((o) => o.owner))].join(", ")}, which this plan doesn't expect.`);
  }
  const files = ENV_FILES.map((f) => {
    if (!fs.existsSync(f.path)) return { ...f, missing: true };
    const u = readEnvUrl(f.path);
    const a = new URL(adminAddr);
    if (decodeURIComponent(u.pathname.slice(1)) !== f.db) throw new Error(`${path.basename(path.dirname(f.path))}/${path.basename(f.path)} names another database than ${f.db}.`);
    if (!LOOPBACK.has(u.hostname) || (u.port || "5432") !== (a.port || "5432")) throw new Error(`${path.basename(path.dirname(f.path))}/${path.basename(f.path)} isn't on the same local server.`);
    return { ...f, user: decodeURIComponent(u.username) };
  });
  return { me, roles, dbs, objects, files };
}

function describe(s) {
  const lines = [];
  for (const [role, p] of Object.entries(PLAN)) lines.push(`role ${role}: ${s.roles[role] ? "exists" : "to create"}; ${p.createdb ? "may" : "may not"} create databases; databases ${p.databases.filter((d) => s.dbs.some((x) => x.datname === d)).join(", ") || "(none yet)"}`);
  for (const d of s.dbs) {
    const mine = s.objects[d.datname].filter((o) => o.owner === OLD_OWNER).length;
    lines.push(`${d.datname}: owner ${d.owner} -> ${ROLE_OF[d.datname]}; access list ${d.acl ?? "default (any role may connect)"} -> ${ROLE_OF[d.datname]} only; ${mine} objects owned by ${OLD_OWNER} -> ${ROLE_OF[d.datname]}`);
  }
  for (const f of s.files) lines.push(`${path.basename(path.dirname(f.path))}/${path.basename(f.path)}: ${f.missing ? "not present, skipped" : `${f.user} -> ${f.role}, new password`}`);
  return lines;
}

async function ownTo(adminAddr, db, objects, from, to) {
  const c = client(withDb(adminAddr, db));
  try {
    for (const o of objects.filter((x) => x.owner === from)) {
      const sql = o.kind === "table" ? `ALTER TABLE ${o.name} OWNER TO ${ident(to)}`
        : o.kind === "sequence" ? `ALTER SEQUENCE ${o.name} OWNER TO ${ident(to)}`
        : o.kind === "type" ? `ALTER TYPE ${o.name} OWNER TO ${ident(to)}`
        : o.kind === "function" ? `ALTER FUNCTION ${o.name} OWNER TO ${ident(to)}`
        : `ALTER SCHEMA public OWNER TO ${ident(to)}`;
      await c.$executeRawUnsafe(sql);
    }
  } finally { await c.$disconnect(); }
}

function rewriteEnv(file, user, password) {
  const raw = fs.readFileSync(file, "utf8");
  const nl = raw.includes("\r\n") ? "\r\n" : "\n";
  let done = 0;
  const out = raw.split(/\r?\n/).map((line) => {
    const m = /^(\s*DATABASE_URL\s*=\s*)(["']?)(.*?)\2\s*$/.exec(line);
    if (!m) return line;
    done++;
    return `${m[1]}${m[2]}${withLogin(m[3], user, password)}${m[2]}`;
  }).join(nl);
  if (done !== 1) throw new Error(`${path.basename(file)} doesn't have exactly one DATABASE_URL line.`);
  fs.writeFileSync(`${file}.a4-tmp`, out, { mode: 0o600 });
  fs.renameSync(`${file}.a4-tmp`, file);
}

/** The access matrix: every role in the plan against every database present, from the catalog. Read only. */
async function matrix(db) {
  const rows = await db.$queryRawUnsafe(`
    SELECT r.rolname AS role, d.datname AS db, has_database_privilege(r.rolname, d.datname, 'CONNECT') AS connect,
           pg_get_userbyid(d.datdba) AS owner
    FROM pg_roles r CROSS JOIN pg_database d
    WHERE r.rolname = ANY($1::text[]) AND d.datname = ANY($2::text[]) ORDER BY 2, 1`, [OLD_OWNER, ...Object.keys(PLAN)], Object.keys(ROLE_OF));
  const [pub] = await db.$queryRawUnsafe("SELECT array_agg(datname ORDER BY datname) FILTER (WHERE datacl IS NULL OR datacl::text ~ '(^|[{,])=[^/]*c') AS dbs FROM pg_database WHERE datname = ANY($1::text[])", Object.keys(ROLE_OF));
  return { rows, publicConnect: pub.dbs ?? [] };
}
function matrixProblems(m) {
  const problems = [];
  for (const r of m.rows) {
    const want = ROLE_OF[r.db] === r.role;
    if (r.connect !== want) problems.push(`${r.role} ${r.connect ? "can" : "can't"} connect to ${r.db}`);
    if (r.role === ROLE_OF[r.db] && r.owner !== r.role) problems.push(`${r.db} is owned by ${r.owner}, not ${r.role}`);
  }
  for (const d of m.publicConnect) problems.push(`any role can connect to ${d}`);
  return [...new Set(problems)];
}
function printMatrix(m) {
  const dbs = [...new Set(m.rows.map((r) => r.db))];
  const roles = [...new Set(m.rows.map((r) => r.role))];
  console.log(`| database | owner | ${roles.join(" | ")} | any role |`);
  console.log(`|---|---|${roles.map(() => "---").join("|")}|---|`);
  for (const d of dbs) console.log(`| ${d} | ${m.rows.find((r) => r.db === d).owner} | ${roles.map((r) => (m.rows.find((x) => x.db === d && x.role === r)?.connect ? "connect" : "-")).join(" | ")} | ${m.publicConnect.includes(d) ? "connect" : "-"} |`);
}

/** Each env file's own login reaches its database and owns its tables, and no other database. Writes nothing. */
async function loginChecks(adminAddr, files, dbs) {
  const problems = [];
  for (const f of files.filter((x) => !x.missing)) {
    const u = readEnvUrl(f.path);
    for (const d of dbs) {
      const c = client(withDb(u.toString(), d.datname));
      let ok = false;
      try { await c.$queryRawUnsafe("SELECT 1"); ok = true; } catch { ok = false; } finally { await c.$disconnect(); }
      const want = d.datname === f.db || ROLE_OF[d.datname] === f.role;
      if (ok !== want) problems.push(`${path.basename(path.dirname(f.path))}/${path.basename(f.path)} ${ok ? "reaches" : "can't reach"} ${d.datname}`);
    }
    const own = client(withDb(u.toString(), f.db));
    try {
      const [w] = await own.$queryRawUnsafe(`SELECT bool_and(has_table_privilege(c.oid, 'INSERT') AND has_table_privilege(c.oid, 'UPDATE') AND has_table_privilege(c.oid, 'DELETE') AND pg_get_userbyid(c.relowner) = current_user) AS writes, count(*)::int AS n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'`);
      if (w.n > 0 && !w.writes) problems.push(`${path.basename(f.path)}'s login can't write every table of ${f.db}`);
    } catch (e) { problems.push(`${path.basename(f.path)}: ${scrub(e.message).slice(0, 120)}`); } finally { await own.$disconnect(); }
  }
  return problems;
}

async function verify() {
  const url = process.env.DATABASE_URL;
  if (!url) refuse("run --verify with an env file, for example --env-file=.env.isolated.");
  const u = new URL(url);
  secrets.add(u.password);
  if (!LOOPBACK.has(u.hostname)) refuse("DATABASE_URL isn't this machine.");
  const db = client(url);
  try {
    const m = await matrix(db);
    printMatrix(m);
    const problems = matrixProblems(m);
    console.log(problems.length ? `NOT ISOLATED: ${problems.join("; ")}.` : "ISOLATED: each role connects to its own databases only, and owns them.");
    process.exitCode = problems.length ? 3 : 0;
  } finally { await db.$disconnect(); }
}

async function plan() {
  const addr = adminUrl();
  const admin = client(addr);
  try { for (const l of describe(await survey(admin, addr))) console.log(l); } finally { await admin.$disconnect(); }
}

async function apply() {
  const addr = adminUrl();
  const admin = client(addr);
  try {
    const s = await survey(admin, addr);
    for (const l of describe(s)) console.log(`plan: ${l}`);
    // Backups first: every env file, and what --rollback needs.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.join(BACKUPS, `A4-${stamp}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of s.files.filter((x) => !x.missing)) fs.copyFileSync(f.path, path.join(dir, `${path.basename(path.dirname(f.path))}${path.basename(f.path)}`));
    const state = { stamp, roles: s.roles, dbs: s.dbs, objects: s.objects, files: s.files.filter((x) => !x.missing).map((f) => ({ path: f.path, backup: path.join(dir, `${path.basename(path.dirname(f.path))}${path.basename(f.path)}`) })) };
    const stateFile = path.join(dir, "state.json");
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    console.log(`Backed up ${state.files.length} env files and the state to restore, in the backups folder (A4-${stamp}).`);

    const passwords = {};
    for (const [role, p] of Object.entries(PLAN)) {
      passwords[role] = randomBytes(24).toString("base64url");
      secrets.add(passwords[role]);
      const attrs = `LOGIN NOSUPERUSER NOCREATEROLE ${p.createdb ? "CREATEDB" : "NOCREATEDB"} PASSWORD '${passwords[role]}'`;
      await admin.$executeRawUnsafe(s.roles[role] ? `ALTER ROLE ${ident(role)} WITH ${attrs}` : `CREATE ROLE ${ident(role)} WITH ${attrs}`);
    }
    console.log("Roles set, with new passwords.");
    for (const d of s.dbs) {
      const role = ROLE_OF[d.datname];
      await admin.$executeRawUnsafe(`REVOKE CONNECT, TEMPORARY ON DATABASE ${ident(d.datname)} FROM PUBLIC`);
      for (const other of Object.keys(PLAN).filter((r) => r !== role)) await admin.$executeRawUnsafe(`REVOKE ALL ON DATABASE ${ident(d.datname)} FROM ${ident(other)}`);
      await admin.$executeRawUnsafe(`GRANT CONNECT, TEMPORARY ON DATABASE ${ident(d.datname)} TO ${ident(role)}`);
      await admin.$executeRawUnsafe(`ALTER DATABASE ${ident(d.datname)} OWNER TO ${ident(role)}`);
      if (role !== OLD_OWNER) await ownTo(addr, d.datname, s.objects[d.datname], OLD_OWNER, role);
      console.log(`${d.datname}: owned by ${role}, and only ${role} may connect.`);
    }
    for (const f of s.files.filter((x) => !x.missing)) rewriteEnv(f.path, f.role, passwords[f.role]);
    console.log("Env files updated with each environment's own role.");

    const problems = [...matrixProblems(await matrix(admin)), ...(await loginChecks(addr, s.files, s.dbs))];
    if (problems.length) throw new Error(`applied, but not isolated: ${problems.join("; ")}. Roll back with --rollback --confirm=A4 --state=<the state.json in A4-${stamp}>`);
    console.log("A4 APPLIED AND VERIFIED: each login reaches only its own databases, and owns and writes them. Restart each server so it uses its new settings.");
  } finally { await admin.$disconnect(); }
}

async function rollback() {
  const addr = adminUrl();
  const state = JSON.parse(fs.readFileSync(path.resolve(stateArg.slice("--state=".length)), "utf8"));
  const admin = client(addr);
  try {
    for (const f of state.files) fs.copyFileSync(f.backup, f.path);
    console.log(`Env files restored (${state.files.length}).`);
    const main = state.files.find((f) => path.basename(f.path) === ".env");
    const oldFit = main ? decodeURIComponent(readEnvUrl(main.path).password) : null;
    for (const d of state.dbs) {
      const role = ROLE_OF[d.datname];
      // Everything the role owns there goes back to fit, which owned every object before, including any added since.
      if (role !== OLD_OWNER) await ownTo(addr, d.datname, await objectsOf(addr, d.datname), role, OLD_OWNER);
      await admin.$executeRawUnsafe(`ALTER DATABASE ${ident(d.datname)} OWNER TO ${ident(d.owner)}`);
      if (d.acl === null) await admin.$executeRawUnsafe(`GRANT CONNECT, TEMPORARY ON DATABASE ${ident(d.datname)} TO PUBLIC`);
      if (role !== OLD_OWNER) await admin.$executeRawUnsafe(`REVOKE ALL ON DATABASE ${ident(d.datname)} FROM ${ident(role)}`);
      console.log(`${d.datname}: owner ${d.owner} again.`);
    }
    const fitBefore = state.roles[OLD_OWNER];
    await admin.$executeRawUnsafe(`ALTER ROLE ${ident(OLD_OWNER)} WITH ${fitBefore.rolcreatedb ? "CREATEDB" : "NOCREATEDB"}${oldFit ? ` PASSWORD '${oldFit.replace(/'/g, "''")}'` : ""}`);
    for (const role of Object.keys(PLAN).filter((r) => r !== OLD_OWNER && !state.roles[r])) await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS ${ident(role)}`);
    console.log("A4 ROLLED BACK: the previous owners, connections, passwords and env files are back.");
  } finally { await admin.$disconnect(); }
}

({ "--verify": verify, "--plan": plan, "--apply": apply, "--rollback": rollback })[mode]().catch((e) => { console.error(`STOPPED: ${scrub(e.message).slice(0, 400)}`); process.exit(1); });
