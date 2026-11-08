// A4 rehearsal: runs local-db-roles.cjs --apply, --verify and --rollback against a throwaway PostgreSQL cluster that this
// script creates in a temporary folder, on 127.0.0.1 and a spare port, with the real migrations and stand-in env files,
// and then deletes. It never connects to the machine's PostgreSQL service or reads a real env file.
//   node scripts/local-db-roles.rehearsal.cjs [--pg-bin="C:\Program Files\PostgreSQL\18\bin"] [--port=55433]
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const BIN = arg("pg-bin", process.platform === "win32" ? "C:\\Program Files\\PostgreSQL\\18\\bin" : "/usr/lib/postgresql/18/bin");
const PORT = Number(arg("port", "55433"));
const ROOT = path.join(__dirname, "..");
const exe = (n) => path.join(BIN, process.platform === "win32" ? `${n}.exe` : n);
const DBS = ["fitdb", "fitdb_review", "fitdb_test", "fitdb_test_other", "fitdb_test_isolated"];
const FILES = [["FitWorkoutFoodTracker", ".env", "fitdb"], ["FitWorkoutFoodTracker", ".env.test", "fitdb_test"], ["FitWorkoutFoodTracker-review", ".env.review", "fitdb_review"],
  ["FitWorkoutFoodTracker-review", ".env.isolated", "fitdb_test_isolated"], ["FitWorkoutFoodTracker-release", ".env.review", "fitdb_review"], ["FitWorkoutFoodTracker-release", ".env.isolated", "fitdb_test_isolated"]];

const step = (m) => console.log(`  ✓ ${m}`);
const run = (file, args, env = {}, ok = [0]) => {
  const r = spawnSync(file, args, { encoding: "utf8", env: { ...process.env, ...env }, windowsHide: true });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (!ok.includes(r.status)) throw new Error(`${path.basename(file)} ${args[0] ?? ""} exited ${r.status}: ${out.slice(-600)}`);
  return out;
};
const portFree = (port) => new Promise((resolve) => { const s = net.createServer().once("error", () => resolve(false)).listen(port, "127.0.0.1", () => s.close(() => resolve(true))); });

(async () => {
  if (!fs.existsSync(exe("initdb"))) throw new Error(`no PostgreSQL binaries at ${BIN}`);
  if (!(await portFree(PORT))) throw new Error(`port ${PORT} is in use; choose another with --port=`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fit-a4-rehearsal-"));
  const data = path.join(tmp, "data");
  const desktop = path.join(tmp, "Desktop");
  const adminPw = randomBytes(18).toString("base64url");
  const fitPw = randomBytes(18).toString("base64url");
  const url = (user, pw, db) => `postgresql://${user}:${pw}@127.0.0.1:${PORT}/${db}`;
  const ADMIN = url("postgres", adminPw, "postgres");
  let started = false;
  const { PrismaClient } = require("@prisma/client");
  const q = async (u, sql, ...params) => { const c = new PrismaClient({ datasources: { db: { url: u } } }); try { return await c.$queryRawUnsafe(sql, ...params); } finally { await c.$disconnect(); } };
  const x = async (u, sql) => { const c = new PrismaClient({ datasources: { db: { url: u } } }); try { return await c.$executeRawUnsafe(sql); } finally { await c.$disconnect(); } };
  const reaches = async (u) => { try { await q(u, "SELECT 1"); return true; } catch { return false; } };
  try {
    fs.writeFileSync(path.join(tmp, "pw"), adminPw);
    run(exe("initdb"), ["-D", data, "-U", "postgres", "--auth=scram-sha-256", `--pwfile=${path.join(tmp, "pw")}`, "-E", "UTF8"]);
    fs.rmSync(path.join(tmp, "pw"));
    // The server inherits pg_ctl's standard streams, so they aren't pipes: a pipe would stay open as long as it runs.
    started = true;
    const s = spawnSync(exe("pg_ctl"), ["-D", data, "-l", path.join(tmp, "log"), "-o", `-p ${PORT} -c listen_addresses=127.0.0.1`, "-w", "start"], { stdio: "ignore", windowsHide: true, timeout: 60_000 });
    if (s.status !== 0) throw new Error(`pg_ctl start exited ${s.status}: ${fs.existsSync(path.join(tmp, "log")) ? fs.readFileSync(path.join(tmp, "log"), "utf8").slice(-400) : ""}`);
    step(`throwaway cluster on 127.0.0.1:${PORT}, in a temporary folder`);

    // Today's shape: one role, fit, owning every database, with PostgreSQL's default access, and the real schema.
    await x(ADMIN, `CREATE ROLE fit LOGIN CREATEDB PASSWORD '${fitPw}'`);
    for (const db of DBS) {
      await x(ADMIN, `CREATE DATABASE "${db}" OWNER fit`);
      run(process.execPath, [path.join(ROOT, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { DATABASE_URL: url("fit", fitPw, db) });
    }
    await x(url("fit", fitPw, "fitdb_review"), `INSERT INTO "Exercise" (id, name, "createdAt", "updatedAt") SELECT 'rehearsal-1', 'Squat', now(), now() WHERE EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Exercise' AND column_name = 'updatedAt')`).catch(() => {});
    for (const [folder, file, db] of FILES) {
      fs.mkdirSync(path.join(desktop, folder), { recursive: true });
      fs.writeFileSync(path.join(desktop, folder, file), `# stand-in\nDATABASE_URL="${url("fit", fitPw, db)}"\nOTHER_SETTING=kept\n`);
    }
    const original = Object.fromEntries(FILES.map(([f, n]) => [`${f}/${n}`, fs.readFileSync(path.join(desktop, f, n), "utf8")]));
    for (const db of DBS) assert.equal(await reaches(url("fit", fitPw, db)), true);
    step(`today's shape: fit owns ${DBS.length} migrated databases and reaches every one`);

    const tool = path.join(ROOT, "scripts", "local-db-roles.cjs");
    const env = { FIT_ROLES_DESKTOP: desktop, ADMIN_DATABASE_URL: ADMIN, DATABASE_URL: "" };
    const before = run(process.execPath, [tool, "--verify"], { ...env, DATABASE_URL: url("fit", fitPw, "fitdb_test") }, [3]);
    assert.match(before, /NOT ISOLATED: fit can connect to fitdb_review/);
    step("--verify reports today's shape as not isolated (exit 3)");

    const applied = run(process.execPath, [tool, "--apply", "--confirm=A4"], env);
    assert.match(applied, /A4 APPLIED AND VERIFIED/);
    for (const s of [adminPw, fitPw]) assert.equal(applied.includes(s), false, "no password printed");
    const stateFile = path.join(desktop, "FitWorkoutFoodTracker-backups", fs.readdirSync(path.join(desktop, "FitWorkoutFoodTracker-backups"))[0], "state.json");
    step("--apply: roles, owners and env files changed, and verified by the tool itself; no password printed");

    // Independent checks, with the logins now in the env files.
    const login = (f, n) => require("node:util").parseEnv(fs.readFileSync(path.join(desktop, f, n), "utf8")).DATABASE_URL;
    const L = { fit: login("FitWorkoutFoodTracker", ".env"), test: login("FitWorkoutFoodTracker", ".env.test"), review: login("FitWorkoutFoodTracker-review", ".env.review") };
    assert.equal(new URL(L.test).username, "fit_test");
    assert.equal(new URL(L.review).username, "fit_review");
    assert.equal(decodeURIComponent(new URL(L.test).password).length, 32);
    assert.match(fs.readFileSync(path.join(desktop, "FitWorkoutFoodTracker", ".env.test"), "utf8"), /OTHER_SETTING=kept/);
    const swap = (u, db) => { const v = new URL(u); v.pathname = `/${db}`; return v.toString(); };
    const expect = { fit: ["fitdb"], review: ["fitdb_review"], test: ["fitdb_test", "fitdb_test_other", "fitdb_test_isolated"] };
    for (const [who, u] of Object.entries(L)) for (const db of DBS) assert.equal(await reaches(swap(u, db)), expect[who].includes(db), `${who} -> ${db}`);
    assert.equal(await reaches(url("fit", fitPw, "fitdb")), false, "the old password is refused");
    step("each login reaches only its own databases; the old password is refused");
    const [owners] = await q(ADMIN, "SELECT json_object_agg(datname, pg_get_userbyid(datdba)) AS o FROM pg_database WHERE datname LIKE 'fitdb%'");
    assert.deepEqual(owners.o, { fitdb: "fit", fitdb_review: "fit_review", fitdb_test: "fit_test", fitdb_test_other: "fit_test", fitdb_test_isolated: "fit_test" });
    const [t] = await q(swap(L.test, "fitdb_test_isolated"), `SELECT count(*)::int AS n, count(*) FILTER (WHERE pg_get_userbyid(relowner) <> 'fit_test')::int AS other FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','S')`);
    assert.ok(t.n > 10 && t.other === 0, `every table and sequence in fitdb_test_isolated is fit_test's (${t.n}, ${t.other} others)`);
    const status = run(process.execPath, [path.join(ROOT, "node_modules", "prisma", "build", "index.js"), "migrate", "status"], { DATABASE_URL: swap(L.test, "fitdb_test_isolated") });
    assert.match(status, /up to date/);
    await x(swap(L.test, "fitdb_test_isolated"), `CREATE TABLE "a4_probe" (id int); DROP TABLE "a4_probe";`).catch(async () => {
      await x(swap(L.test, "fitdb_test_isolated"), `CREATE TABLE "a4_probe" (id int)`); await x(swap(L.test, "fitdb_test_isolated"), `DROP TABLE "a4_probe"`);
    });
    step("databases owned per plan; fit_test owns every table and sequence, can create tables (migrations), and Prisma sees the schema up to date");
    const [cd] = await q(ADMIN, "SELECT json_object_agg(rolname, rolcreatedb) AS c FROM pg_roles WHERE rolname IN ('fit','fit_review','fit_test')");
    assert.deepEqual(cd.c, { fit: false, fit_review: false, fit_test: true });
    step("only fit_test may create databases");

    const verified = run(process.execPath, [tool, "--verify"], { ...env, DATABASE_URL: swap(L.test, "fitdb_test") });
    assert.match(verified, /^ISOLATED/m);
    step("--verify, as fit_test: isolated (exit 0)");

    const again = run(process.execPath, [tool, "--apply", "--confirm=A4"], env);
    assert.match(again, /A4 APPLIED AND VERIFIED/);
    step("--apply again: idempotent, still verified");

    const rolled = run(process.execPath, [tool, "--rollback", "--confirm=A4", `--state=${stateFile}`], env);
    assert.match(rolled, /A4 ROLLED BACK/);
    for (const [k, v] of Object.entries(original)) assert.equal(fs.readFileSync(path.join(desktop, ...k.split("/")), "utf8"), v, `${k} restored byte for byte`);
    for (const db of DBS) assert.equal(await reaches(url("fit", fitPw, db)), true, `fit reaches ${db} again`);
    const [back] = await q(ADMIN, "SELECT json_object_agg(datname, pg_get_userbyid(datdba)) AS o, (SELECT count(*)::int FROM pg_roles WHERE rolname IN ('fit_review','fit_test')) AS roles, (SELECT rolcreatedb FROM pg_roles WHERE rolname = 'fit') AS cd FROM pg_database WHERE datname LIKE 'fitdb%'");
    assert.deepEqual(back.o, Object.fromEntries(DBS.map((d) => [d, "fit"])));
    assert.equal(back.roles, 0);
    assert.equal(back.cd, true);
    const [t2] = await q(url("fit", fitPw, "fitdb_test_isolated"), `SELECT count(*) FILTER (WHERE pg_get_userbyid(relowner) <> 'fit')::int AS other FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','S')`);
    assert.equal(t2.other, 0);
    step("--rollback with the first state: env files byte for byte, fit's password and owners, objects back to fit, new roles dropped");

    // Why not REASSIGN OWNED, which the earlier plan used: run in one database, it moves shared objects too.
    await x(ADMIN, "CREATE ROLE a4_demo NOLOGIN");
    await x(url("postgres", adminPw, "fitdb_test"), "REASSIGN OWNED BY fit TO a4_demo");
    const [hazard] = await q(ADMIN, "SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = 'fitdb_review'");
    assert.equal(hazard.owner, "a4_demo");
    step("control: REASSIGN OWNED BY fit, run in fitdb_test, also gave fitdb_review away (why the plan alters each object instead)");
    console.log("A4 REHEARSAL PASSED");
  } finally {
    if (started) spawnSync(exe("pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"], { stdio: "ignore", windowsHide: true, timeout: 60_000 });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(`REHEARSAL FAILED: ${e.message}`); process.exit(1); });
