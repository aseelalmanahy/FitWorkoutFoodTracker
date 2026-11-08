// A3's PostgreSQL listener procedure, rehearsed on a sample postgresql.conf in a temporary folder (its -ConfPath and
// -NoRestart mode: no elevation, no service, never the real file), in every PowerShell edition on this machine.
// It caught a real defect: in PowerShell 7, `-split "\r?\n", -1` returned the whole file as one piece, so -Apply
// refused ("found 0") and A3 couldn't be applied from PowerShell 7.
//   node --test scripts/local-security.test.cjs
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "deploy", "local-security", "A3-postgres-listen.ps1");
const EDITIONS = [["PowerShell 7", "pwsh"], ["Windows PowerShell 5.1", "powershell.exe"]]
  .filter(([, exe]) => process.platform === "win32" && spawnSync(exe, ["-NoProfile", "-Command", "1"], { encoding: "utf8" }).status === 0);
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const SAMPLE = ["# sample postgresql.conf", "#listen_addresses = 'localhost'", "", "listen_addresses = '*'\t\t# what to listen on", "port = 5432", "max_connections = 100", ""].join("\r\n");

test("A3 rehearsed on a copy changes exactly the one line, keeps CRLF and the final newline, and rolls back byte for byte", { skip: EDITIONS.length ? false : "needs Windows PowerShell" }, () => {
  for (const [name, exe] of EDITIONS) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fit-a3-"));
    try {
      const conf = path.join(dir, "postgresql.conf");
      fs.writeFileSync(conf, SAMPLE);
      const before = sha(conf);
      const run = (args) => spawnSync(exe, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, ...args, "-ConfPath", conf, "-NoRestart", "-BackupDir", dir], { encoding: "utf8" });
      const applied = run(["-Apply"]);
      assert.equal(applied.status, 0, `${name}: ${applied.stdout}${applied.stderr}`);
      assert.match(applied.stdout, /Change, line 4: listen_addresses = '\*'.*->\s+listen_addresses = 'localhost'/, name);
      const after = fs.readFileSync(conf, "utf8");
      const was = SAMPLE.split("\r\n"), now = after.split("\r\n");
      assert.equal(now.length, was.length, `${name}: same number of lines`);
      assert.deepEqual(now.map((l, i) => (l === was[i] ? null : i)).filter((i) => i !== null), [3], `${name}: only line 4 changed`);
      assert.match(now[3], /^listen_addresses = 'localhost'\t\t# what to listen on$/, `${name}: its comment kept`);
      assert.ok(after.endsWith("\r\n") && !/[^\r]\n/.test(after), `${name}: CRLF and the final newline kept`);
      const backup = fs.readdirSync(dir).find((f) => f.startsWith("postgresql.conf.before-A3-"));
      assert.ok(backup, `${name}: a backup was made`);
      assert.equal(sha(path.join(dir, backup)), before, `${name}: the backup is the original`);
      const rolled = run(["-Rollback", "-Backup", path.join(dir, backup)]);
      assert.equal(rolled.status, 0, `${name}: ${rolled.stdout}${rolled.stderr}`);
      assert.equal(sha(conf), before, `${name}: rolled back byte for byte`);
      const again = run(["-Apply"]);
      assert.equal(again.status, 0, name);
      assert.equal(run(["-Apply"]).stdout.includes("Already loopback only: nothing to change."), true, `${name}: applying twice changes nothing`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test("A3 refuses, changing nothing, when there isn't exactly one active listen_addresses line", { skip: EDITIONS.length ? false : "needs Windows PowerShell" }, () => {
  for (const [name, exe] of EDITIONS) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fit-a3-"));
    try {
      const conf = path.join(dir, "postgresql.conf");
      fs.writeFileSync(conf, ["listen_addresses = '*'", "listen_addresses = '*'", ""].join("\r\n"));
      const before = sha(conf);
      const r = spawnSync(exe, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-Apply", "-ConfPath", conf, "-NoRestart", "-BackupDir", dir], { encoding: "utf8" });
      assert.notEqual(r.status, 0, name);
      assert.match(`${r.stdout}${r.stderr}`, /REFUSED \(nothing was changed\): expected exactly one active listen_addresses line, found 2/, name);
      assert.equal(sha(conf), before, `${name}: unchanged`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
