// RC-02: a server left running is explained and stopped only once it's proven to be this folder's own; and the app a
// script starts never outlives that script, however it ends.
//
// What happened: stopping the shell that ran the review server ended only the shell. The script and its app kept
// running with no window, holding the port, as nothing told them the shell had gone. The remedy for that is the
// explanation and the identity-checked stop below. Separately, Node on Windows normally ends a child with its parent
// through a job object, but not for a child outside that job (detached, or under a launcher whose job forbids it); the
// pipe watched by exit-with-parent.cjs covers those too, and the first two tests show that, using `detached` to take
// the stand-in app out of the job. No database, and no real app server: every process
// here is a small stand-in this test writes and starts itself, on free loopback ports.
//   node --test scripts/server-lifecycle.test.cjs
"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { EXIT_WITH_PARENT } = require("./lib/test-servers.cjs");
const { describePortOwner, stopOwnServer, commandLineOf, isOwnServer } = require("./lib/port-owner.cjs");

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fit-lifecycle-"));
const started = new Set();
after(() => {
  // Anything this test started and left running is ended here, by the process id this test itself recorded.
  for (const pid of started) { try { process.kill(pid); } catch { /* already gone */ } }
  fs.rmSync(DIR, { recursive: true, force: true });
});

const write = (name, source) => { const file = path.join(DIR, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source); return file; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect({ port, host: "127.0.0.1" });
  s.once("connect", () => { s.destroy(); resolve(true); });
  s.once("error", () => resolve(false));
});
async function until(check, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await check()) return true; await sleep(100); }
  return check();
}
/** First line a process prints, as "<child pid> <port>". */
const firstLine = (child) => new Promise((resolve, reject) => {
  let buf = "";
  child.stdout.on("data", (d) => { buf += d; const i = buf.indexOf("\n"); if (i >= 0) resolve(buf.slice(0, i).trim()); });
  child.once("exit", (code) => reject(new Error(`exited early (${code}): ${buf}`)));
});

// A stand-in app: listens on a free loopback port and prints it.
const APP = write("app.cjs", `require("node:http").createServer((q, s) => s.end("ok")).listen(0, "127.0.0.1", function () { console.log(this.address().port); });\n`);

// A stand-in launcher: starts the app the way the scripts do (with the fix) or as before (without), and reports.
const LAUNCHER = write("launcher.cjs", `"use strict";
const { spawn } = require("node:child_process");
const withFix = process.argv[2] === "with-fix";
const child = withFix
  ? spawn(process.execPath, ["-r", ${JSON.stringify(EXIT_WITH_PARENT)}, ${JSON.stringify(APP)}], { env: { ...process.env, FIT_EXIT_WITH_PARENT: "1" }, stdio: ["pipe", "pipe", "ignore"], windowsHide: true, detached: true })
  : spawn(process.execPath, [${JSON.stringify(APP)}], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true, detached: true });
child.stdout.once("data", (d) => console.log(child.pid + " " + String(d).trim()));
setInterval(() => {}, 1000);
`);

async function launchAndForceEndLauncher(mode) {
  const launcher = spawn(process.execPath, [LAUNCHER, mode], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  started.add(launcher.pid);
  const [childPid, port] = (await firstLine(launcher)).split(" ").map(Number);
  started.add(childPid);
  assert.equal(await portOpen(port), true, "the stand-in app is serving");
  // Ended without warning: on Windows this is TerminateProcess, so the launcher runs no exit or signal handler.
  process.kill(launcher.pid, "SIGKILL");
  await until(() => !alive(launcher.pid), 5000);
  return { childPid, port };
}

test("control: an app outside the parent's job, without the fix, outlives its force-ended launcher and keeps the port", async () => {
  const { childPid, port } = await launchAndForceEndLauncher("without-fix");
  await sleep(2000);
  assert.equal(alive(childPid), true, "the app outlived its launcher: the case the fix exists for");
  assert.equal(await portOpen(port), true, "and still holds its port");
  process.kill(childPid); // the orphan this control made, by the id it recorded
  assert.equal(await until(() => !alive(childPid), 5000), true);
});

test("with the fix, the same app ends with its force-ended launcher, and frees its port", async () => {
  const { childPid, port } = await launchAndForceEndLauncher("with-fix");
  assert.equal(await until(() => !alive(childPid), 5000), true, "the app ended with its launcher");
  assert.equal(await until(async () => !(await portOpen(port)), 5000), true, "the port is free");
});

test("with the fix, a child that finishes its work exits by itself, and doesn't pass the setting on", async () => {
  const child = spawn(process.execPath, ["-r", EXIT_WITH_PARENT, "-e", "console.log(String(process.env.FIT_EXIT_WITH_PARENT))"],
    { env: { ...process.env, FIT_EXIT_WITH_PARENT: "1" }, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  started.add(child.pid);
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  const code = await Promise.race([new Promise((r) => child.once("exit", r)), sleep(10_000).then(() => "still running")]);
  assert.equal(code, 0, "it exits normally, not held open by the watched pipe");
  assert.equal(out.trim(), "undefined", "processes it starts don't inherit the setting");
});

test("without the setting, the preload changes nothing", async () => {
  const child = spawn(process.execPath, ["-r", EXIT_WITH_PARENT, "-e", "setTimeout(() => console.log('done'), 300)"], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  started.add(child.pid);
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  assert.equal(await new Promise((r) => child.once("exit", r)), 0);
  assert.equal(out.trim(), "done", "a closed input didn't end it early");
});

// A stand-in for a folder's own server: `node <folder>/node_modules/next/dist/bin/next start -H 127.0.0.1 -p <port>`.
const OWN_BIN = write(path.join("folder-a", "node_modules", "next", "dist", "bin", "next"), `"use strict";
const port = Number(process.argv[process.argv.indexOf("-p") + 1]);
require("node:http").createServer((q, s) => s.end("ok")).listen(port, "127.0.0.1", () => console.log("ready"));
`);
const OTHER_BIN = path.join(DIR, "folder-b", "node_modules", "next", "dist", "bin", "next");
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

async function startOwnServer() {
  const port = await freePort();
  const server = spawn(process.execPath, [OWN_BIN, "start", "-H", "127.0.0.1", "-p", String(port)], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  started.add(server.pid);
  await firstLine(server);
  return { server, port };
}

test("a busy port is explained: which process, and whether it's this folder's own server", async () => {
  const { server, port } = await startOwnServer();
  const own = describePortOwner(port, { bin: OWN_BIN });
  assert.equal(own.pid, server.pid);
  assert.equal(own.own, true);
  assert.match(own.text, new RegExp(`process ${server.pid}, an app server started earlier from this folder`));
  const other = describePortOwner(port, { bin: OTHER_BIN });
  assert.equal(other.own, false, "another folder's server is not ours");
  assert.match(other.text, /isn't an app server from this folder/);
  process.kill(server.pid);
});

test("stopping refuses anything not proven to be this folder's server, and leaves it running", async () => {
  const { server, port } = await startOwnServer();
  const r = await stopOwnServer(port, { bin: OTHER_BIN });
  assert.equal(r.stopped, false);
  assert.match(r.reason, /Nothing was stopped/);
  assert.equal(alive(server.pid), true, "the other server is untouched");
  assert.equal(await portOpen(port), true);
  process.kill(server.pid);
});

test("stopping this folder's own server ends exactly that process and frees the port", async () => {
  const { server, port } = await startOwnServer();
  const r = await stopOwnServer(port, { bin: OWN_BIN });
  assert.equal(r.stopped, true, r.reason);
  assert.equal(r.pid, server.pid);
  assert.equal(await portOpen(port), false);
});

test("identity is by the exact entry point and port, not by a similar-looking command line", () => {
  const cmd = `"node.exe" ${OWN_BIN} start -H 127.0.0.1 -p 3003`;
  assert.equal(isOwnServer(cmd, { bin: OWN_BIN, port: 3003 }), true);
  assert.equal(isOwnServer(cmd, { bin: OWN_BIN, port: 3002 }), false, "another port");
  assert.equal(isOwnServer(`"node.exe" ${OWN_BIN} start -H 127.0.0.1 -p 30031`, { bin: OWN_BIN, port: 3003 }), false, "a port that only starts the same");
  assert.equal(isOwnServer(cmd, { bin: OTHER_BIN, port: 3003 }), false, "another folder");
  assert.equal(isOwnServer(`"node.exe" ${OWN_BIN} build`, { bin: OWN_BIN, port: 3003 }), false, "not a server");
  assert.equal(isOwnServer(null, { bin: OWN_BIN, port: 3003 }), false);
  assert.equal(commandLineOf(-1), null);
});
