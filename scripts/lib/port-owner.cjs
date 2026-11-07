// RC-02: which process holds a local port, and whether it is provably one of this folder's own app servers. Used to
// explain a busy port, and to stop a server left running only after its identity is verified: never by port alone.
"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const WIN = process.platform === "win32";
const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 15_000 });

/** The process id listening on this TCP port, on any local address, or null. */
function listeningPid(port) {
  if (WIN) {
    const out = run("netstat", ["-ano", "-p", "TCP"]).stdout ?? "";
    for (const line of out.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      if (cols[0] === "TCP" && cols[3] === "LISTENING" && cols[1].endsWith(`:${port}`)) return Number(cols[4]);
    }
    const out6 = run("netstat", ["-ano", "-p", "TCPv6"]).stdout ?? "";
    for (const line of out6.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      if (cols[0] === "TCP" && cols[3] === "LISTENING" && cols[1].endsWith(`:${port}`)) return Number(cols[4]);
    }
    return null;
  }
  const out = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"]).stdout ?? "";
  const m = /^p(\d+)/m.exec(out);
  return m ? Number(m[1]) : null;
}

/** A process's full command line, or null if it can't be read (gone, or not ours to read). */
function commandLineOf(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (WIN) {
    const r = run("powershell", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`]);
    const line = (r.stdout ?? "").trim();
    return line || null;
  }
  const line = (run("ps", ["-o", "args=", "-p", String(pid)]).stdout ?? "").trim();
  return line || null;
}

const norm = (s) => (WIN ? s.replace(/\\/g, "/").toLowerCase() : s);

/**
 * Whether a command line is this folder's app server on this port: `node <bin> start ... -p <port>`, where <bin> is the
 * exact server entry point inside this folder. Another folder's server, or anything else, doesn't match.
 */
function isOwnServer(commandLine, { bin, port }) {
  if (!commandLine) return false;
  const c = ` ${norm(commandLine)} `;
  return c.includes(norm(path.resolve(bin))) && / start /.test(c) && new RegExp(`(?:-p|--port)[ =]${port} `).test(c);
}

/** Who holds the port, in words, and whether it's ours. */
function describePortOwner(port, { bin }) {
  const pid = listeningPid(port);
  if (pid === null) return { pid: null, own: false, text: `Port ${port} is held, but the process holding it couldn't be identified.` };
  const commandLine = commandLineOf(pid);
  const own = isOwnServer(commandLine, { bin, port });
  const text = own
    ? `Port ${port} is held by process ${pid}, an app server started earlier from this folder, which is still running.`
    : `Port ${port} is held by process ${pid}${commandLine ? ` (${commandLine.slice(0, 160)})` : ""}, which isn't an app server from this folder.`;
  return { pid, own, commandLine, text };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Stops the process on this port only if it's provably this folder's server; waits until the port is free. */
async function stopOwnServer(port, { bin, waitMs = 15_000 }) {
  const owner = describePortOwner(port, { bin });
  if (owner.pid === null) return { stopped: false, reason: listeningPid(port) === null ? `nothing is listening on port ${port}.` : owner.text };
  if (!owner.own) return { stopped: false, reason: `${owner.text} Nothing was stopped.` };
  try { process.kill(owner.pid); } catch (e) { return { stopped: false, reason: `process ${owner.pid} couldn't be stopped: ${e.code ?? e.message}.` }; }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (listeningPid(port) === null) return { stopped: true, pid: owner.pid };
    await sleep(250);
  }
  return { stopped: false, reason: `process ${owner.pid} was asked to stop, but port ${port} is still held.` };
}

module.exports = { listeningPid, commandLineOf, isOwnServer, describePortOwner, stopOwnServer };
