// G1: builds the production image and checks it end to end on this PC, with disposable data only, then removes what it
// started. Needs Docker running, which is the owner's G1 approval (start Docker Desktop; base images are downloaded):
//   node scripts/g1-image-check.cjs --approval=G1
// Steps, each recorded with its result and timing in Desktop\FitWorkoutFoodTracker-backups\diagnostics\g1\<time>\:
//   1. build the runner (with the meal model) and migrate targets
//   2. scan every layer: no env file, local account file, Git folder, evaluation photo or dump, and none of this
//      machine's secret values (found by value, never printed)
//   3. a throwaway PostgreSQL 18 container on a private network, with TLS (the preflight requires it off-host)
//   4. the startup preflight refuses weak settings: a weak database password, and an http origin
//   5. migrations with the migrate image; then the app, read-only, no capabilities, 1536 MB, as in Compose
//   6. /api/health; sign-in; one label scan and one meal photo, read on-device
//   7. memory (cgroup, current and peak) after each step, and during an export of 249,000 seeded rows
//   8. docker stop: a clean exit within its grace period
// Nothing touches this machine's PostgreSQL service, its databases or its env files; every container, network and
// image it makes is named fit-g1-* and removed at the end (the built images are kept only with --keep-images).
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { localSecrets, scanTree } = require("./lib/image-scan.cjs");

const ROOT = path.join(__dirname, "..");
const DESKTOP = path.resolve(ROOT, "..");
const refuse = (m) => { console.error(`REFUSED (nothing was started): ${m}`); process.exit(4); };
const args = process.argv.slice(2);
if (!args.includes("--approval=G1") || args.some((a) => !["--approval=G1", "--keep-images", "--disposable-migrations"].includes(a))) refuse("use --approval=G1 (the owner's recorded G1 approval), optionally --keep-images and --disposable-migrations.");
// --disposable-migrations: for a G1 run while migrations are still unapproved. Step 5 then requires the guarded migrate
// image to REFUSE (exit 4, nothing applied), and only after that applies the migrations to the throwaway container
// database with Prisma from the same image. It never changes prisma/approved-migrations.json, touches nothing outside
// the fit-g1-* containers, and the result says the guarded path must be run again once the migrations are approved.
const DISPOSABLE_MIGRATIONS = args.includes("--disposable-migrations");

// Windows' own tar (bsdtar). Run from Git Bash, a bare "tar" is GNU tar, which reads "C:\..." as a remote host:path
// ("Cannot connect to C: resolve failed"), so G1 failed at step 2 there.
const TAR = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
const docker = (a, opts = {}) => spawnSync("docker", a, { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 2 ** 20, ...opts });
if (docker(["version", "--format", "{{.Server.Version}}"]).status !== 0) refuse("Docker isn't running. Starting Docker Desktop is part of the G1 approval.");
const sha = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
if (spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()) refuse("the working tree has uncommitted changes, so the image wouldn't match a commit.");

const RUN = `fit-g1-${randomBytes(3).toString("hex")}`;
const IMAGE = `fitworkoutfoodtracker:g1-${sha}`, MIGRATE = `fitworkoutfoodtracker:g1-${sha}-migrate`;
const NET = `${RUN}-net`, DB = `${RUN}-db`, APP = `${RUN}-app`;
const DB_PW = randomBytes(24).toString("base64url"), USER_PW = randomBytes(18).toString("base64url");
const DB_NAME = "fit_g1_rehearsal";
const ORIGIN = "https://g1.example.invalid";
const PORT = 3990;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = path.join(DESKTOP, "FitWorkoutFoodTracker-backups", "diagnostics", "g1", stamp);
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const secrets = new Set([DB_PW, USER_PW]);
const scrub = (s) => { let o = String(s); for (const x of secrets) o = o.split(x).join("[redacted]"); return o; };
const record = (step, ok, detail = {}) => { results.push({ step, ok, ...detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail.note ? `: ${detail.note}` : ""}`); fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ sha, image: IMAGE, results }, null, 2)); };
const must = (r, what) => { if (r.status !== 0) throw new Error(`${what} failed: ${scrub((r.stderr || r.stdout || "").slice(-800))}`); return r.stdout; };
const timed = (fn) => { const t0 = Date.now(); const v = fn(); return [v, Math.round((Date.now() - t0) / 1000)]; };
const memory = () => {
  const r = docker(["exec", APP, "sh", "-c", "cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.peak 2>/dev/null || cat /sys/fs/cgroup/memory/memory.usage_in_bytes /sys/fs/cgroup/memory/memory.max_usage_in_bytes"]);
  const [cur, peak] = r.stdout.trim().split(/\s+/).map(Number);
  return { currentMB: Math.round(cur / 2 ** 20), peakMB: Math.round(peak / 2 ** 20) };
};
const appEnv = (over = {}) => Object.entries({ NODE_ENV: "production", APP_ORIGIN: ORIGIN, DATABASE_URL: `postgresql://postgres:${DB_PW}@${DB}:5432/${DB_NAME}?sslmode=require`, TRUST_PROXY_HOPS: "1", LABEL_OCR: "local", MEAL_RECOGNITION: "local", ...over }).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
const HARDENED = ["--read-only", "--tmpfs", "/tmp", "--tmpfs", "/app/.next/cache", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--memory", "1536m", "--cpus", "1.5", "--pids-limit", "256"];
const psql = (sql) => must(docker(["exec", "-e", `PGPASSWORD=${DB_PW}`, DB, "psql", "-U", "postgres", "-d", DB_NAME, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql]), "psql");
const BASE = `http://127.0.0.1:${PORT}`;
const headers = (cookie) => ({ Origin: ORIGIN, "X-Forwarded-For": "203.0.113.10", "X-Forwarded-Proto": "https", ...(cookie ? { Cookie: cookie } : {}) });

async function waitHealthy(name, seconds) {
  for (let i = 0; i < seconds; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return true; } catch { /* not yet */ }
    if (docker(["inspect", "-f", "{{.State.Running}}", name]).stdout.trim() !== "true") return false;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

(async () => {
  try {
    // 1. Build.
    const [, buildS] = timed(() => must(docker(["build", "--build-arg", "WITH_MEAL_MODEL=1", "--target", "runner", "-t", IMAGE, "."], { cwd: ROOT }), "build (runner)"));
    must(docker(["build", "--target", "migrate", "-t", MIGRATE, "."], { cwd: ROOT }), "build (migrate)");
    const size = Math.round(Number(docker(["image", "inspect", "-f", "{{.Size}}", IMAGE]).stdout.trim()) / 2 ** 20);
    record("1. production image builds", true, { note: `${IMAGE}, ${size} MB, ${buildS} s` });

    // 2. Layers.
    const scanDir = fs.mkdtempSync(path.join(os.tmpdir(), "fit-g1-layers-"));
    try {
      const tar = path.join(scanDir, "image.tar");
      must(docker(["save", "-o", tar, IMAGE]), "docker save");
      const outer = path.join(scanDir, "outer");
      fs.mkdirSync(outer);
      must(spawnSync(TAR, ["-xf", tar, "-C", outer], { encoding: "utf8" }), "unpack the image");
      fs.rmSync(tar);
      const files = [];
      const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else files.push(f); } };
      walk(outer);
      const envFiles = ["FitWorkoutFoodTracker", "FitWorkoutFoodTracker-review", "FitWorkoutFoodTracker-release", "FitWorkoutFoodTracker-ux"].flatMap((f) => [".env", ".env.test", ".env.review", ".env.isolated", "demo-account.local.md", "review-account.local.md", "review-tester-1.local.md", "review-tester-2.local.md"].map((n) => path.join(DESKTOP, f, n)));
      const values = localSecrets(envFiles);
      const findings = [];
      let layers = 0;
      for (const f of files) {
        const head = Buffer.alloc(262);
        const fd = fs.openSync(f, "r"); fs.readSync(fd, head, 0, 262, 0); fs.closeSync(fd);
        const isTar = head.subarray(257, 262).toString("latin1") === "ustar" || (head[0] === 0x1f && head[1] === 0x8b);
        if (!isTar) continue;
        layers++;
        const dir = path.join(scanDir, `layer-${layers}`);
        fs.mkdirSync(dir);
        spawnSync(TAR, ["-xf", f, "-C", dir], { encoding: "utf8" }); // whiteouts and device files may warn; files are what's scanned
        findings.push(...scanTree(dir, values).map((x) => ({ layer: layers, ...x })));
        fs.rmSync(dir, { recursive: true, force: true });
      }
      fs.writeFileSync(path.join(OUT, "layer-findings.json"), JSON.stringify(findings, null, 2));
      record("2. no credentials or local files in any layer", findings.length === 0 && layers > 0, { note: `${layers} layers, ${values.length} local secret values searched for, ${findings.length} findings` });
    } finally { fs.rmSync(scanDir, { recursive: true, force: true }); }

    // 3. A throwaway database, with TLS.
    // A private network: the database is never published, and only the app gets a port, on 127.0.0.1.
    must(docker(["network", "create", NET]), "network");
    must(docker(["run", "-d", "--name", DB, "--network", NET, "-e", `POSTGRES_PASSWORD=${DB_PW}`, "-e", `POSTGRES_DB=${DB_NAME}`, "postgres:18-bookworm",
      "-c", "ssl=on", "-c", "ssl_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem", "-c", "ssl_key_file=/etc/ssl/private/ssl-cert-snakeoil.key"]), "database container");
    for (let i = 0; i < 60 && docker(["exec", DB, "pg_isready", "-U", "postgres", "-d", DB_NAME]).status !== 0; i++) await new Promise((r) => setTimeout(r, 1000));
    record("3. throwaway database with TLS", psql("SHOW ssl") === "on\n" || psql("SHOW ssl").trim() === "on");

    // 4. The preflight refuses weak settings.
    for (const [label, over] of [["a weak database password", { DATABASE_URL: `postgresql://postgres:password@${DB}:5432/${DB_NAME}?sslmode=require` }], ["an http origin", { APP_ORIGIN: "http://g1.example.invalid" }]]) {
      const name = `${RUN}-refuse`;
      docker(["run", "-d", "--name", name, "--network", NET, ...HARDENED, ...appEnv(over), IMAGE]);
      let state = "";
      for (let i = 0; i < 60; i++) { state = docker(["inspect", "-f", "{{.State.Status}} {{.State.ExitCode}}", name]).stdout.trim(); if (state.startsWith("exited")) break; await new Promise((r) => setTimeout(r, 1000)); }
      const logs = scrub(docker(["logs", name]).stderr + docker(["logs", name]).stdout).slice(-600);
      docker(["rm", "-f", name]);
      record(`4. startup refuses ${label}`, state.startsWith("exited") && !state.endsWith(" 0"), { note: state, logs });
    }

    // 5. Migrations, then the app as Compose runs it.
    const migEnv = ["--network", NET, "-e", "NODE_ENV=production", "-e", `DATABASE_URL=postgresql://postgres:${DB_PW}@${DB}:5432/${DB_NAME}?sslmode=require`];
    if (DISPOSABLE_MIGRATIONS) {
      const guarded = docker(["run", "--rm", ...migEnv, MIGRATE]);
      const applied = psql("SELECT to_regclass('public._prisma_migrations') IS NOT NULL").trim();
      record("5a. the guarded migrate image refuses unapproved migrations, applying nothing", guarded.status === 4 && applied === "f", { note: `exit ${guarded.status}; history table present: ${applied}`, logs: scrub(guarded.stderr).slice(-400) });
      const [, migS] = timed(() => must(docker(["run", "--rm", ...migEnv, MIGRATE, "node", "node_modules/prisma/build/index.js", "migrate", "deploy"]), "migrations (disposable)"));
      record("5a2. migrations applied to the throwaway database only, without the guard (G1 rehearsal)", true, { note: `${migS} s` });
    } else {
      const [, migS] = timed(() => must(docker(["run", "--rm", ...migEnv, MIGRATE]), "migrations"));
      record("5a. migrations applied with the migrate image", true, { note: `${migS} s` });
    }
    must(docker(["run", "-d", "--name", APP, "--network", NET, "-p", `127.0.0.1:${PORT}:3000`, ...HARDENED, ...appEnv(), IMAGE]), "app container");
    const healthy = await waitHealthy(APP, 90);
    record("5b. app starts, read-only, no capabilities, 1536 MB", healthy, { memory: healthy ? memory() : null });
    if (!healthy) throw new Error(`the app didn't become healthy: ${scrub(docker(["logs", "--tail", "40", APP]).stdout + docker(["logs", "--tail", "40", APP]).stderr).slice(-800)}`);

    // 6. Health, sign-in, label, meal.
    const h = await fetch(`${BASE}/api/health`);
    record("6a. /api/health", h.ok, { note: String(h.status) });
    const { hash } = require("@node-rs/argon2");
    const pwHash = await hash(USER_PW, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    psql(`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ('g1user', 'g1@example.invalid', '${pwHash}', now())`);
    let cookie = "";
    const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify({ email: "g1@example.invalid", password: USER_PW }), redirect: "manual" });
    for (const c of login.headers.getSetCookie()) if (c.startsWith("fit_session=")) cookie = c.split(";")[0];
    record("6b. sign-in", login.status === 200 && Boolean(cookie), { note: String(login.status) });
    const sharp = require("sharp");
    const lines = ["Nutrition Facts", "Serving size 1 bar (40g)", "Calories 190", "Total Fat 7g", "Total Carbohydrate 26g", "Protein 6g"];
    const label = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${60 + lines.length * 44}"><rect width="100%" height="100%" fill="#fff"/>${lines.map((l, i) => `<text x="24" y="${56 + i * 44}" font-family="Arial" font-size="30">${l}</text>`).join("")}</svg>`)).png().toBuffer();
    const mealImg = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#d9a441" } }).jpeg().toBuffer();
    for (const [step, route, body, type] of [["6c. label scan, on-device", "/api/nutrition/label-scans", label, "image/png"], ["6d. meal photo, on-device", "/api/nutrition/meal-identifications", mealImg, "image/jpeg"]]) {
      const t0 = Date.now();
      const r = await fetch(`${BASE}${route}`, { method: "POST", headers: { ...headers(cookie), "Content-Type": type }, body });
      const json = await r.json().catch(() => ({}));
      record(step, r.status === 200 && json.processing === "server", { note: `${r.status}, ${Date.now() - t0} ms, processing ${json.processing}`, memory: memory() });
    }

    // 7. Export of a large account, within the limit.
    psql(`INSERT INTO "FoodEntry" (id, "userId", date, "mealType", "foodName", "basisUnit", "kcalPer100", "proteinPer100", "servingLabel", "servingAmount", quantity, kcal, protein, "updatedAt")
      SELECT 'g1-' || g, 'g1user', date '2020-01-01' + (g % 2400), (ARRAY['BREAKFAST','LUNCH','DINNER','SNACK']::"MealType"[])[1 + g % 4], 'Rehearsal food ' || g, 'G', 250, 10, '100 g', 100, 1, 250, 10, now()
      FROM generate_series(1, 249000) g`);
    const t0 = Date.now();
    const ex = await fetch(`${BASE}/api/account/export`, { method: "POST", headers: { ...headers(cookie), "Content-Type": "application/json" }, body: JSON.stringify({ password: USER_PW }) });
    const bytes = ex.ok ? (await ex.arrayBuffer()).byteLength : 0;
    const m = memory();
    record("7. export of 249,000 rows within 1536 MB", ex.status === 200 && m.peakMB < 1536 && docker(["inspect", "-f", "{{.State.OOMKilled}}", APP]).stdout.trim() === "false", { note: `${ex.status}, ${Math.round(bytes / 2 ** 20)} MiB in ${Math.round((Date.now() - t0) / 1000)} s`, memory: m });

    // 8. Shutdown.
    const [, stopS] = timed(() => docker(["stop", "-t", "30", APP]));
    const exit = docker(["inspect", "-f", "{{.State.ExitCode}}", APP]).stdout.trim();
    record("8. stops cleanly within its grace period", stopS < 30 && ["0", "143"].includes(exit), { note: `exit ${exit} after ${stopS} s` });
  } catch (e) {
    record("run", false, { note: scrub(e.message).slice(0, 600) });
  } finally {
    for (const c of [APP, DB, `${RUN}-refuse`]) docker(["rm", "-f", "-v", c]);
    docker(["network", "rm", NET]);
    if (!args.includes("--keep-images")) docker(["image", "rm", IMAGE, MIGRATE]);
    const failed = results.filter((r) => !r.ok).length;
    const qualifier = DISPOSABLE_MIGRATIONS ? " (disposable migrations: run again without --disposable-migrations once MIG-FB and MIG-GYM are approved)" : "";
    console.log(`${failed ? "G1 CHECK FAILED" : "G1 CHECK PASSED"}${qualifier}: ${results.length - failed} of ${results.length} steps. Evidence: ${OUT}`);
    process.exitCode = failed ? 1 : 0;
  }
})();
