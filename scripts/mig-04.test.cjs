// What scripts/mig-04.cjs must refuse, what it pins, and that the runbook's PowerShell blocks work as written. No database:
// refused addresses are never contacted, and the addresses it does try are closed ports on this machine. Every run uses an
// .env.test in a temporary folder, so the real one is never read.
//   node --test scripts/mig-04.test.cjs
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "mig-04.cjs");
const SOURCE = fs.readFileSync(SCRIPT, "utf8");
const MIGRATION = path.join(__dirname, "..", "prisma", "migrations", "20261106150000_body_metrics", "migration.sql");
const CLOSED = "postgresql://none:none@127.0.0.1:1/fitdb_test";
const INHERITED = "postgresql://inherited:inheritedsecret@127.0.0.1:2/fitdb_test";
const RUNBOOK = fs.readFileSync(path.join(__dirname, "..", "docs", "MIG_04_RUNBOOK.md"), "utf8").replace(/\r\n/g, "\n");

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(DATABASE_URL|BASE_URL|NODE_TEST_CONTEXT|FDC_|ANTHROPIC_|LABEL_|MAIL_)/.test(k)) delete env[k];
  return env;
}
/** A temporary folder, with an env file of this name holding this address. */
function folderWith(databaseUrl, name = ".env.test") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fit-mig-04-test-"));
  fs.writeFileSync(path.join(dir, name), databaseUrl === undefined ? "SOMETHING_ELSE=1\n" : `DATABASE_URL=${databaseUrl}\n`);
  return dir;
}
function runNode(nodeArgs, args, inherited, dir) {
  const env = cleanEnv();
  if (inherited !== undefined) env.DATABASE_URL = inherited;
  try {
    const r = spawnSync(process.execPath, [...nodeArgs, SCRIPT, ...args], { encoding: "utf8", env, cwd: dir, timeout: 60_000 });
    return { code: r.status, text: `${r.stdout}${r.stderr}` };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const run = (args, databaseUrl) => runNode(["--env-file=.env.test"], args, undefined, folderWith(databaseUrl));

test("refuses a missing database setting", () => {
  const r = run(["preflight"]);
  assert.equal(r.code, 4);
  assert.match(r.text, /REFUSED/);
});

for (const [label, url] of [
  ["the development database", "postgresql://none:none@127.0.0.1:1/fitdb"],
  ["the other test database", "postgresql://none:none@127.0.0.1:1/fitdb_test_other"],
  ["a database of any other name", "postgresql://none:none@127.0.0.1:1/somewhere"],
  ["fitdb_test on another machine", "postgresql://none:none@db.invalid:5432/fitdb_test"],
]) {
  for (const step of ["preflight", "backup", "verify"]) {
    test(`${step} refuses ${label}, before connecting`, () => {
      const r = run([step], url);
      assert.equal(r.code, 4, r.text);
      assert.match(r.text, /REFUSED/);
      assert.doesNotMatch(r.text, /none:none/, "and doesn't print the credentials");
    });
  }
  test(`apply refuses ${label}, even when marked as authorized`, () => {
    const r = run(["apply", "--owner-authorized=MIG-04"], url);
    assert.equal(r.code, 4, r.text);
  });
}

test("apply refuses with no authorization, or the wrong one, before anything else", () => {
  for (const args of [["apply"], ["apply", "--owner-authorized=yes"], ["apply", "--owner-authorized=MIG-03"], ["apply", "--force"], ["apply", "--owner-authorized=MIG-04", "--extra"]]) {
    const r = run(args, CLOSED);
    assert.equal(r.code, 4, args.join(" "));
    assert.match(r.text, /owner-authorized=MIG-04/);
  }
});

test("refuses an unknown step, and any other step given the authorization", () => {
  assert.equal(run(["reset"], CLOSED).code, 4);
  assert.equal(run([], CLOSED).code, 4);
  assert.equal(run(["verify", "--owner-authorized=MIG-04"], CLOSED).code, 4);
});

test("a database it can't reach is a failure, not a pass, and doesn't print the address", () => {
  const r = run(["preflight"], CLOSED);
  assert.notEqual(r.code, 0, r.text);
  assert.doesNotMatch(r.text, /PREFLIGHT PASSED/);
  assert.doesNotMatch(r.text, /none:none/);
});

test("what it pins is the committed migration", () => {
  const bytes = fs.readFileSync(MIGRATION);
  assert.equal(SOURCE.match(/EXPECTED_SHA256 = "([0-9a-f]{64})"/)[1], crypto.createHash("sha256").update(bytes).digest("hex"));
  assert.equal(bytes.includes(13), false, "LF only, so the recorded checksum doesn't depend on the machine");
  const blob = spawnSync("git", ["hash-object", "--no-filters", MIGRATION], { encoding: "utf8" }).stdout.trim();
  assert.equal(SOURCE.match(/EXPECTED_BLOB = "([0-9a-f]{40})"/)[1], blob);
});

test("the migration is additive, and touches nothing MIG-03 made", () => {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const statements = sql.split("\n").filter((l) => /^[A-Z]/.test(l)).map((l) => l.split(" ").slice(0, 2).join(" "));
  assert.deepEqual(statements, ["CREATE TYPE", "CREATE TABLE", "CREATE UNIQUE", "ALTER TABLE"]);
  assert.match(sql, /ALTER TABLE "BodyMetric" ADD CONSTRAINT "BodyMetric_userId_fkey" FOREIGN KEY \("userId"\) REFERENCES "User"\("id"\) ON DELETE CASCADE/);
  assert.doesNotMatch(sql, /AccountToken|termsVersion|termsAcceptedAt/);
});

test("it comes after every other migration, and none is named between", () => {
  const names = fs.readdirSync(path.dirname(path.dirname(MIGRATION))).filter((d) => /^\d{14}_/.test(d)).sort();
  assert.equal(names.at(-1), "20261106150000_body_metrics");
  assert.equal(names.at(-2), "20261106140000_account_tokens");
});

test("only apply can change the schema, by migrate deploy alone", () => {
  assert.equal(SOURCE.match(/"deploy"/g).length, 1);
  const applyStep = SOURCE.slice(SOURCE.indexOf("async function apply()"), SOURCE.indexOf("async function verify()"));
  assert.match(applyStep, /prismaCli\("migrate", "deploy"\)/);
  const elsewhere = SOURCE.replace(applyStep, "");
  assert.doesNotMatch(elsewhere, /"deploy"/);
  assert.doesNotMatch(SOURCE, /migrate", "(reset|dev|resolve)|db", "(push|execute)|force-reset|accept-data-loss|\$executeRaw/);
});

// ─── An inherited DATABASE_URL ───────────────────────────────────────────────

const OVERRIDING = /already in this shell is overriding \.env\.test/;

test("refuses a DATABASE_URL in the shell that differs from .env.test, before connecting", () => {
  for (const step of ["preflight", "backup", "verify"]) {
    const r = runNode(["--env-file=.env.test"], [step], INHERITED, folderWith(CLOSED));
    assert.equal(r.code, 4, r.text);
    assert.match(r.text, OVERRIDING);
    assert.doesNotMatch(r.text, /inheritedsecret|none:none/, "and prints neither");
  }
  const applying = runNode(["--env-file=.env.test"], ["apply", "--owner-authorized=MIG-04"], INHERITED, folderWith(CLOSED));
  assert.equal(applying.code, 4, applying.text);
  assert.match(applying.text, OVERRIDING);
});

test("an inherited value that names the right database is refused all the same", () => {
  const r = runNode(["--env-file=.env.test"], ["preflight"], "postgresql://none:other@127.0.0.1:1/fitdb_test", folderWith(CLOSED));
  assert.equal(r.code, 4);
  assert.match(r.text, OVERRIDING);
});

test("an inherited value with a file that doesn't set one is refused", () => {
  const r = runNode(["--env-file=.env.test"], ["preflight"], CLOSED, folderWith(undefined));
  assert.equal(r.code, 4);
  assert.match(r.text, /doesn't set DATABASE_URL/);
});

test("the same value in both is allowed through to the connection, which fails here", () => {
  const r = runNode(["--env-file=.env.test"], ["preflight"], CLOSED, folderWith(CLOSED));
  assert.notEqual(r.code, 0);
  assert.doesNotMatch(r.text, /REFUSED|PREFLIGHT PASSED/);
  assert.match(r.text, /FAILED/);
});

test("refuses to run without exactly one env file, named .env.test", () => {
  for (const [nodeArgs, name] of [[[], ".env.test"], [["--env-file=.env"], ".env"], [["--env-file=.env.local"], ".env.local"], [["--env-file-if-exists=.env.test"], ".env.test"], [["--env-file=.env.test", "--env-file=.env.test"], ".env.test"]]) {
    const r = runNode(nodeArgs, ["preflight"], CLOSED, folderWith(CLOSED, name));
    assert.equal(r.code, 4, nodeArgs.join(" "));
    assert.match(r.text, /exactly --env-file=\.env\.test/);
  }
});

test("the safeguards are all still there, and this check comes before any connection", () => {
  for (const safeguard of ["TEST_DB_MARKER_PREFIX + TARGET", "current_database()", "sha256(fs.readFileSync(file)) !== r.checksum", "me.checksum !== EXPECTED_SHA256", "pg_dump", "archiveRowCounts(file)", "state.backup.sha256", '"migrate", "status"', "markerVersion !== state.markerVersion", "process.env.DATABASE_URL !== fromFile", "the database doesn't equal the schema before MIG-04", "the database doesn't equal this branch's schema"]) {
    assert.ok(SOURCE.includes(safeguard), safeguard);
  }
  assert.equal(SOURCE.match(/"--exit-code"/g).length, 2, "drift is checked before and after");
  assert.ok(SOURCE.indexOf("process.env.DATABASE_URL !== fromFile") < SOURCE.indexOf("@prisma/client"), "before Prisma is even loaded");
  assert.ok(SOURCE.indexOf("process.env.DATABASE_URL !== fromFile") < SOURCE.indexOf("databaseUrlProblem(DB)"));
});

// ─── The runbook's PowerShell, as written ────────────────────────────────────

const STEPS = ["preflight", "backup", "apply", "verify"];
const blockFor = (step) => {
  const block = [...RUNBOOK.matchAll(/```powershell\n([\s\S]*?)```/g)].map((m) => m[1]).find((b) => b.includes(`scripts/mig-04.cjs ${step}`));
  assert.ok(block, `the runbook has a block for ${step}`);
  return block;
};
const shells = ["pwsh", "powershell.exe"].filter((s) => process.platform === "win32" && spawnSync(s, ["-NoProfile", "-Command", "exit 0"], { timeout: 30_000 }).status === 0);

/** Runs a block in its own PowerShell, from a folder whose .env.test holds a closed port, with a different DATABASE_URL inherited. */
function runBlock(shell, block) {
  const dir = folderWith(CLOSED);
  const file = path.join(dir, "block.ps1");
  fs.writeFileSync(file, block.replace(/scripts\/mig-04\.cjs/g, `"${SCRIPT.replace(/\\/g, "/")}"`));
  try {
    const r = spawnSync(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], { encoding: "utf8", env: { ...cleanEnv(), DATABASE_URL: INHERITED }, cwd: dir, timeout: 90_000 });
    return { code: r.status, text: `${r.stdout}${r.stderr}` };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("the runbook's steps are PowerShell, each clearing the variable and stopping on failure", () => {
  assert.doesNotMatch(RUNBOOK, /env -u|npx /, "no Unix-only command, and no npx");
  for (const step of STEPS) {
    const lines = blockFor(step).split("\n").filter((l) => l && !l.startsWith("#"));
    assert.equal(lines[0], "Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue", step);
    assert.match(lines[1], /^if \(Test-Path Env:DATABASE_URL\) \{ throw /, step);
    assert.match(lines[2], new RegExp(`^node --env-file=\\.env\\.test scripts/mig-04\\.cjs ${step}`), step);
    assert.match(lines[3], /^if \(\$LASTEXITCODE -ne 0\) \{ throw /, step);
  }
});

test("PowerShell is available here, so the next tests really ran", () => {
  assert.ok(process.platform !== "win32" || shells.length === 2, `found: ${shells.join(", ")}`);
});

for (const shell of shells) {
  for (const [step, reached] of [["preflight", /ok {3}MIG-04's file/], ["apply", /ok {3}MIG-04's file/]]) {
    test(`${shell}: the ${step} block clears an inherited value, uses .env.test, and reports the unreachable database as a failure`, () => {
      const r = runBlock(shell, blockFor(step));
      assert.match(r.text, reached, "it got past the refusals, and so the value in use was the file's");
      assert.doesNotMatch(r.text, /REFUSED/);
      assert.match(r.text, /FAILED/);
      assert.match(r.text, new RegExp(`${step} stopped with exit code 1`), "the block stops");
      assert.notEqual(r.code, 0);
      assert.doesNotMatch(r.text, /PREFLIGHT PASSED|APPLIED|inheritedsecret|none:none/);
    });
  }
  for (const step of ["backup", "verify"]) {
    test(`${shell}: the ${step} block clears an inherited value, and stops with nothing to work from`, () => {
      const r = runBlock(shell, blockFor(step));
      assert.doesNotMatch(r.text, /REFUSED|BACKUP VERIFIED|VERIFY PASSED|inheritedsecret|none:none/);
      assert.match(r.text, new RegExp(`${step} stopped with exit code [13]`), "the block stops");
      assert.notEqual(r.code, 0);
    });
  }
  test(`${shell}: without clearing it, the inherited value is refused, and the block stops`, () => {
    const r = runBlock(shell, blockFor("preflight").split("\n").filter((l) => !l.includes("Env:DATABASE_URL")).join("\n"));
    assert.match(r.text, OVERRIDING);
    assert.match(r.text, /preflight stopped with exit code 4/);
    assert.notEqual(r.code, 0);
    assert.doesNotMatch(r.text, /inheritedsecret|none:none|MIG-04's file/);
  });
}
