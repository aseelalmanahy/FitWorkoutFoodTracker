// Cross-platform helpers for tests that spawn the app, the stub and scripts
// (used by scripts/*.test.cjs). Windows-safe: no `npx`, no POSIX process groups on win32.
"use strict";
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const children = new Set();

/** Ask the OS for a free TCP port on localhost. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Resolve true if something accepts connections on the port. */
function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
  });
}

/** Spawn `node <args>` (cwd = repo root), tracked for cleanup. NODE_PATH is removed. */
function spawnNode(args, env = {}, { capture = false } = {}) {
  const e = { ...process.env, ...env };
  delete e.NODE_PATH;
  // Set by `node --test` for its workers. A nested `node --test` that inherits it runs in
  // child-reporter mode and exits 0 even when tests fail, so never pass it on.
  delete e.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, args, {
    cwd: ROOT, env: e,
    detached: process.platform !== "win32", // own process group on POSIX, so the whole tree can be killed
    stdio: capture ? ["ignore", "pipe", "pipe"] : "ignore",
    windowsHide: true,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

/** Kill a child and its whole process tree; resolves when it has exited (max 10 s). */
function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 10_000);
    child.once("exit", () => { clearTimeout(t); resolve(); });
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else process.kill(-child.pid, "SIGTERM");
    } catch { try { child.kill("SIGKILL"); } catch {} }
  });
}

/** Wait until `url` answers (< 500). Fails fast if `child` exits first (so a foreign server on the port can't be mistaken for ours). */
async function waitForChild(url, child, ms = 45_000) {
  const t0 = Date.now();
  for (;;) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error(`process for ${url} exited early (code ${child.exitCode})`);
    try { const r = await fetch(url); if (r.status < 500) return; } catch {}
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Start the production build (`next start`) on a free, verified-unused port. */
async function startApp(env) {
  const port = await freePort();
  if (await portInUse(port)) throw new Error(`port ${port} unexpectedly in use`);
  const child = spawnNode([NEXT_BIN, "start", "-p", String(port)], env);
  await waitForChild(`http://localhost:${port}/login`, child);
  return { child, port, url: `http://localhost:${port}` };
}

/** Start scripts/stub-food-apis.cjs on a free port. */
async function startStub(env = {}) {
  const port = await freePort();
  const child = spawnNode([path.join(ROOT, "scripts", "stub-food-apis.cjs"), String(port)], env);
  await waitForChild(`http://localhost:${port}/off/cgi/search.pl?search_terms=x`, child);
  return { child, port, url: `http://localhost:${port}` };
}

/** Run `node <script> <args>` to completion with a hard timeout; returns { code, out, timedOut }. */
function runNode(scriptArgs, env, timeoutMs = 300_000) {
  return new Promise((resolve) => {
    const child = spawnNode(scriptArgs, env, { capture: true });
    let out = "", timedOut = false;
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    child.on("close", (code) => { clearTimeout(t); resolve({ code, out, timedOut, child }); });
  });
}

/** Kill every tracked child (call from test `after`, and on process exit/signals). */
async function killAll() {
  await Promise.all([...children].map(killTree));
}
const syncKillAll = () => {
  for (const c of children) {
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else process.kill(-c.pid, "SIGKILL");
    } catch {}
  }
};
process.once("exit", syncKillAll);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  try { process.once(sig, () => { syncKillAll(); process.exit(130); }); } catch {}
}

module.exports = { ROOT, NEXT_BIN, freePort, portInUse, spawnNode, killTree, waitForChild, startApp, startStub, runNode, killAll, children };
