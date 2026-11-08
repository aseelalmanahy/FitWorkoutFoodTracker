// A throwaway PostgreSQL cluster for a branch whose schema is ahead of the shared test databases, so its suites never
// migrate fitdb_test_isolated or any other real database. It lives in a temporary folder, listens on 127.0.0.1 only,
// and holds fitdb_test_isolated and fitdb_test_isolated_other, migrated, seeded and marked like the real ones, so the
// guards apply to it unchanged. It never connects to this machine's PostgreSQL service.
//   node scripts/disposable-db.cjs --start [--port=55434]   creates it if needed, starts it, writes .env.isolated here
//   node scripts/disposable-db.cjs --stop                   stops it and deletes its folder, and .env.isolated
// .env.isolated here is Git-ignored, and points only at the throwaway cluster while it exists.
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const BIN = process.env.PG_BIN ?? (process.platform === "win32" ? "C:\\Program Files\\PostgreSQL\\18\\bin" : "/usr/lib/postgresql/18/bin");
const exe = (n) => path.join(BIN, process.platform === "win32" ? `${n}.exe` : n);
const DIR = path.join(os.tmpdir(), `fit-disposable-db-${path.basename(ROOT)}`);
const ENV = path.join(ROOT, ".env.isolated");
const MARK = "fitworkoutfoodtracker:test-database:v1:";
const DBS = ["fitdb_test_isolated", "fitdb_test_isolated_other"];
const refuse = (m) => { console.error(`REFUSED: ${m}`); process.exit(4); };
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const mode = process.argv[2];
if (!["--start", "--stop"].includes(mode)) refuse("use --start [--port=55434] or --stop.");
if (spawnSync("git", ["check-ignore", "-q", ".env.isolated"], { cwd: ROOT }).status !== 0) refuse(".env.isolated isn't ignored by Git here.");
const run = (file, args, env = {}) => {
  const r = spawnSync(file, args, { encoding: "utf8", env: { ...process.env, ...env }, windowsHide: true, cwd: ROOT });
  if (r.status !== 0) throw new Error(`${path.basename(file)} ${args[0] ?? ""} exited ${r.status}: ${`${r.stdout}${r.stderr}`.replace(/postgres(ql)?:\/\/\S+/g, "[address]").slice(-500)}`);
  return r.stdout;
};
const free = (port) => new Promise((resolve) => { const s = net.createServer().once("error", () => resolve(false)).listen(port, "127.0.0.1", () => s.close(() => resolve(true))); });

async function start() {
  const port = Number(arg("port") ?? 55434);
  const state = path.join(DIR, "state.json");
  if (!fs.existsSync(state)) {
    if (!(await free(port))) refuse(`port ${port} is in use.`);
    fs.mkdirSync(DIR, { recursive: true });
    const pw = randomBytes(18).toString("base64url");
    fs.writeFileSync(path.join(DIR, "pw"), pw);
    run(exe("initdb"), ["-D", path.join(DIR, "data"), "-U", "postgres", "--auth=scram-sha-256", `--pwfile=${path.join(DIR, "pw")}`, "-E", "UTF8"]);
    fs.rmSync(path.join(DIR, "pw"));
    fs.writeFileSync(state, JSON.stringify({ port, pw }), { mode: 0o600 });
  }
  const { port: p, pw } = JSON.parse(fs.readFileSync(state, "utf8"));
  if (await free(p)) {
    // The server inherits pg_ctl's streams, so they mustn't be pipes.
    const s = spawnSync(exe("pg_ctl"), ["-D", path.join(DIR, "data"), "-l", path.join(DIR, "log"), "-o", `-p ${p} -c listen_addresses=127.0.0.1`, "-w", "start"], { stdio: "ignore", windowsHide: true, timeout: 60_000 });
    if (s.status !== 0) throw new Error("pg_ctl start failed; see its log in the temporary folder.");
  }
  const url = (db) => `postgresql://postgres:${pw}@127.0.0.1:${p}/${db}`;
  const { PrismaClient } = require("@prisma/client");
  const admin = new PrismaClient({ datasources: { db: { url: url("postgres") } } });
  try {
    for (const db of DBS) {
      if (!(await admin.$queryRawUnsafe("SELECT 1 FROM pg_database WHERE datname = $1", db)).length) await admin.$executeRawUnsafe(`CREATE DATABASE "${db}"`);
      run(process.execPath, [path.join(ROOT, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { DATABASE_URL: url(db) });
      run(process.execPath, [path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "seed.ts")], { DATABASE_URL: url(db) });
      await admin.$executeRawUnsafe(`COMMENT ON DATABASE "${db}" IS '${MARK}${db}'`);
    }
  } finally { await admin.$disconnect(); }
  fs.writeFileSync(ENV, `# Throwaway cluster from scripts/disposable-db.cjs; deleted by --stop.\nDATABASE_URL=${url("fitdb_test_isolated")}\n`, { mode: 0o600 });
  console.log(`Disposable cluster on 127.0.0.1:${p}: ${DBS.join(", ")} migrated, seeded and marked. .env.isolated points at it.`);
}

function stop() {
  if (fs.existsSync(path.join(DIR, "data"))) spawnSync(exe("pg_ctl"), ["-D", path.join(DIR, "data"), "-m", "fast", "-w", "stop"], { stdio: "ignore", windowsHide: true, timeout: 60_000 });
  fs.rmSync(DIR, { recursive: true, force: true });
  if (fs.existsSync(ENV) && /disposable-db\.cjs/.test(fs.readFileSync(ENV, "utf8"))) fs.rmSync(ENV);
  console.log("Disposable cluster stopped and deleted.");
}

(mode === "--start" ? start() : Promise.resolve(stop())).catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
