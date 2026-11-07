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
const LIB_FILE = path.join(__dirname, "lib", "mig-04-verify.cjs");
const LIB = fs.readFileSync(LIB_FILE, "utf8");
const verifying = require(LIB_FILE);
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
  fs.mkdirSync(path.join(dir, "FitWorkoutFoodTracker-backups"));
  fs.writeFileSync(path.join(dir, name), databaseUrl === undefined ? "SOMETHING_ELSE=1\n" : `DATABASE_URL=${databaseUrl}\n`);
  return dir;
}
/** The script's record and backups live in this folder for the test, and so never the real ones. */
const isolated = (env, dir) => ({ ...env, TEMP: dir, TMP: dir, USERPROFILE: dir, HOME: dir });
function runNode(nodeArgs, args, inherited, dir) {
  const env = isolated(cleanEnv(), dir);
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
  assert.equal(LIB.match(/EXPECTED_BLOB = "([0-9a-f]{40})"/)[1], blob);
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
  const applying = SOURCE.slice(SOURCE.indexOf("async function apply()"), SOURCE.indexOf("async function verify()"));
  assert.match(applying, /prismaCli\("migrate", "deploy"\)/);
  const elsewhere = SOURCE.replace(applying, "");
  assert.doesNotMatch(elsewhere, /"deploy"/);
  for (const code of [SOURCE, LIB]) assert.doesNotMatch(code, /migrate", "(reset|dev|resolve)|db", "(push|execute)|force-reset|accept-data-loss|\$executeRaw/);
  assert.doesNotMatch(LIB, /require\("@prisma|child_process|node:fs/, "the decisions touch nothing themselves");
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
  const code = SOURCE + LIB;
  for (const safeguard of ["TEST_DB_MARKER_PREFIX + TARGET", "current_database()", "onDisk !== r.checksum", "me.checksum !== EXPECTED_SHA256", "pg_dump", "archiveRowCounts(file)", "facts.sha256 !== backup.sha256", '"migrate", "status"', "markerVersion !== state.markerVersion", "process.env.DATABASE_URL !== fromFile", "the database doesn't equal the schema before MIG-04", "the database doesn't equal this branch's schema"]) {
    assert.ok(code.includes(safeguard), safeguard);
  }
  assert.equal(SOURCE.match(/"--exit-code"/g).length, 2, "drift is checked before and after");
  assert.ok(SOURCE.indexOf("if (urlProblem) refuse(urlProblem)") < SOURCE.indexOf("@prisma/client"), "before Prisma is even loaded");
  assert.ok(SOURCE.indexOf("if (urlProblem) refuse(urlProblem)") < SOURCE.indexOf("databaseUrlProblem(DB)"));
  assert.ok(SOURCE.indexOf("if (urlProblem) refuse(urlProblem)") > 0);
});

// ─── A stale or invalid record, against the real script ──────────────────────

const RECORD = "fit-mig-04-state.json";
const DUMP = "fitdb_test-pre-mig-04-20261106T000000Z.dump";
const hashOf = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
/** A sound record and backup file in this folder, with no database behind them. A change to it is what each case tests. */
function writeRecord(dir, change = (r) => r) {
  const bytes = Buffer.from("not a real archive");
  const file = path.join(dir, "FitWorkoutFoodTracker-backups", DUMP);
  fs.writeFileSync(file, bytes);
  const record = change({
    takenAt: Date.now(), blob: verifying.EXPECTED_BLOB, fingerprint: "fingerprint", markerVersion: "1", counts: { User: 1, _prisma_migrations: 7 },
    checksums: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`m${i}`, "x"])),
    backup: { file, size: bytes.length, sha256: hashOf(bytes) },
  }, file);
  fs.writeFileSync(path.join(dir, RECORD), typeof record === "string" ? record : JSON.stringify(record));
}
const applyWith = (change, step = ["apply", "--owner-authorized=MIG-04"]) => {
  const dir = folderWith(CLOSED);
  writeRecord(dir, change);
  return runNode(["--env-file=.env.test"], step, undefined, dir);
};
const HOUR = 3_600_000;

test("apply with a sound record gets as far as the connection, which fails here, so nothing below refuses for another reason", () => {
  const r = applyWith((s) => s);
  assert.match(r.text, /ok {3}backup still intact/);
  assert.match(r.text, /ok {3}MIG-04's file/);
  assert.match(r.text, /FAILED/);
  assert.notEqual(r.code, 0);
  assert.doesNotMatch(r.text, /STOP|REFUSED|APPLIED/);
});

test("apply with no record stops, with no connection", () => {
  const r = runNode(["--env-file=.env.test"], ["apply", "--owner-authorized=MIG-04"], undefined, folderWith(CLOSED));
  assert.equal(r.code, 3, r.text);
  assert.match(r.text, /no preflight record/);
});

for (const [name, change, reason] of [
  ["a record over an hour old", (s) => ({ ...s, takenAt: Date.now() - 2 * HOUR }), /too old/],
  ["a record dated in the future", (s) => ({ ...s, takenAt: Date.now() + 2 * HOUR }), /in the future/],
  ["a record with no time", ({ takenAt, ...s }) => s, /no time/],
  ["a record that isn't JSON", () => "{ not json", /can't be read/],
  ["a record that's a list", () => "[]", /isn't valid/],
  ["a record for another migration", (s) => ({ ...s, blob: "0".repeat(40) }), /another version/],
  ["a record with no database named", ({ fingerprint, ...s }) => s, /which database/],
  ["a record with no marker row", ({ markerVersion, ...s }) => s, /which database/],
  ["a record with no row counts", ({ counts, ...s }) => s, /row counts/],
  ["a record with a bad row count", (s) => ({ ...s, counts: { ...s.counts, User: -1 } }), /row counts/],
  ["a record with too few migrations", (s) => ({ ...s, checksums: { only: "x" } }), /migrations aren't valid/],
  ["a record with no backup", ({ backup, ...s }) => s, /no verified backup/],
  ["a backup that's gone", (s, file) => { fs.rmSync(file); return s; }, /backup is missing/],
  ["a backup whose bytes changed", (s, file) => { fs.writeFileSync(file, "not a real archivE"); return s; }, /backup has changed/],
  ["a backup of a different size", (s, file) => { fs.appendFileSync(file, "x"); return s; }, /backup has changed/],
  ["a backup outside the backups folder", (s) => ({ ...s, backup: { ...s.backup, file: path.join(os.tmpdir(), DUMP) } }), /isn't one this procedure took/],
  ["a backup with another name", (s, file) => { const other = path.join(path.dirname(file), "other.dump"); fs.copyFileSync(file, other); return { ...s, backup: { ...s.backup, file: other } }; }, /isn't one this procedure took/],
]) {
  test(`apply stops on ${name}, with no connection`, () => {
    const r = applyWith(change);
    assert.equal(r.code, 3, r.text);
    assert.match(r.text, /STOP:/);
    assert.match(r.text, reason);
    assert.doesNotMatch(r.text, /FAILED|APPLIED|ok {3}MIG-04's file/, "it never reached the database");
  });
}

test("the backup and verify steps refuse a stale record too", () => {
  const backingUp = applyWith((s) => ({ ...s, takenAt: Date.now() - 2 * HOUR }), ["backup"]);
  assert.equal(backingUp.code, 3, backingUp.text);
  assert.match(backingUp.text, /too old/);
  const verifyingIt = applyWith((s) => ({ ...s, takenAt: Date.now() - 25 * HOUR }), ["verify"]);
  assert.equal(verifyingIt.code, 3, verifyingIt.text);
  assert.match(verifyingIt.text, /too old/);
});

// ─── Each check straight before the deploy, with stand-ins for the database ──

const NOW = 1_800_000_000_000;
const NAMES = ["m1", "m2", "m3", "m4", "m5", "m6", "20261106140000_account_tokens"];
const MIG_NAME = "20261106150000_body_metrics";
const COUNTS = { User: 3, Profile: 2, _prisma_migrations: 7 };
const BACKUP = { file: path.join("backups", DUMP), size: 10, sha256: "backuphash" };

/** A world in which everything is right. A case changes one thing, and the deploy mustn't be reached. */
function world(change = {}) {
  const calls = [];
  const rows = NAMES.map((name) => ({ name, checksum: `sum-${name}`, finished: new Date(0), rolledBack: null }));
  const io = {
    calls,
    ok: () => {},
    backupsFolder: "backups",
    readState: () => ({ takenAt: NOW - 1000, blob: verifying.EXPECTED_BLOB, fingerprint: "fp", markerVersion: "7", counts: COUNTS, checksums: Object.fromEntries(NAMES.map((n) => [n, `sum-${n}`])), backup: BACKUP }),
    fileFacts: () => { calls.push("fileFacts"); return { size: BACKUP.size, sha256: BACKUP.sha256 }; },
    effectiveUrlProblem: () => { calls.push("effectiveUrl"); return null; },
    fileProblem: () => { calls.push("file"); return null; },
    identity: async () => { calls.push("identity"); return { db: "fitdb_test", schema: "public", addr: "127.0.0.1/32", port: 5432, marker: "fitworkoutfoodtracker:test-database:v1:fitdb_test", markerVersion: "7", fingerprint: "fp" }; },
    applied: async () => { calls.push("applied"); return rows; },
    checksumOnDisk: (name) => (NAMES.includes(name) ? `sum-${name}` : null),
    migrationsOnDisk: () => [...NAMES, MIG_NAME],
    prismaTarget: () => { calls.push("prismaTarget"); return { db: "fitdb_test", schema: "public", host: "localhost:5432", listsMig: true }; },
    driftFromBefore: () => { calls.push("drift"); return { code: 0, out: "" }; },
    bodyMetricObjects: async () => { calls.push("objects"); return { tbl: null, kinds: 0 }; },
    archiveRowCounts: () => { calls.push("archive"); return { ...COUNTS }; },
    rowCounts: async () => { calls.push("rowCounts"); return { ...COUNTS }; },
    deploy: () => { calls.push("deploy"); return { code: 0, out: "" }; },
    ...change,
  };
  return io;
}
const stopsBeforeDeploy = async (io, reason) => {
  await assert.rejects(() => verifying.applyStep(io, NOW), (e) => {
    assert.ok(e instanceof verifying.Stop, `a refusal, and not a crash: ${e.message}`);
    assert.match(e.message, reason);
    return true;
  });
  assert.equal(io.calls.includes("deploy"), false, "the deploy wasn't reached");
};
const rowsWith = (edit) => async () => {
  const rows = NAMES.map((name) => ({ name, checksum: `sum-${name}`, finished: new Date(0), rolledBack: null }));
  return edit(rows) ?? rows;
};
const liveIdentity = { db: "fitdb_test", schema: "public", addr: "127.0.0.1/32", port: 5432, marker: "fitworkoutfoodtracker:test-database:v1:fitdb_test", markerVersion: "7", fingerprint: "fp" };

test("with everything right, every check runs, the deploy comes last, and once", async () => {
  const io = world();
  const result = await verifying.applyStep(io, NOW);
  assert.equal(result.code, 0);
  assert.deepEqual(io.calls, ["fileFacts", "effectiveUrl", "file", "identity", "applied", "prismaTarget", "drift", "objects", "archive", "fileFacts", "rowCounts", "deploy"]);
});

test("preflight runs the very same checks as apply, and the script keeps no second copy", async () => {
  const io = world();
  const { identity, rows } = await verifying.verifyBeforeMigration(io);
  assert.equal(identity.db, "fitdb_test");
  assert.equal(rows.length, 7);
  assert.deepEqual(io.calls, ["effectiveUrl", "file", "identity", "applied", "prismaTarget", "drift", "objects"]);
  assert.match(SOURCE, /async function preflight\(\) \{\n?\r?\n? *const \{ identity, rows \} = await verifyBeforeMigration\(io\);/);
  assert.match(SOURCE, /await applyStep\(\{ \.\.\.io, deploy: /);
  assert.doesNotMatch(SOURCE, /failed or unfinished|pending isn't exactly|MIG-03 isn't the latest/, "those decisions live in one place");
});

for (const [name, change, reason] of [
  ["the DATABASE_URL in use stops matching .env.test", { effectiveUrlProblem: () => "a DATABASE_URL already in this shell is overriding .env.test" }, /overriding/],
  ["MIG-04's file changes", { fileProblem: () => "the working file isn't the reviewed one." }, /reviewed one/],
  ["the database is another one", { identity: async () => ({ ...liveIdentity, db: "fitdb" }) }, /isn't fitdb_test/],
  ["the other test database answers", { identity: async () => ({ ...liveIdentity, db: "fitdb_test_other" }) }, /isn't fitdb_test/],
  ["the schema is another one", { identity: async () => ({ ...liveIdentity, schema: "other" }) }, /isn't public/],
  ["the server is on another machine", { identity: async () => ({ ...liveIdentity, addr: "10.0.0.5/32" }) }, /isn't on this machine/],
  ["the marker has gone", { identity: async () => ({ ...liveIdentity, marker: null }) }, /test marker/],
  ["the marker names another database", { identity: async () => ({ ...liveIdentity, marker: "fitworkoutfoodtracker:test-database:v1:fitdb_test_other" }) }, /test marker/],
  ["the marker's row was rewritten", { identity: async () => ({ ...liveIdentity, markerVersion: "8" }) }, /marker's row changed/],
  ["the database's fingerprint differs from preflight's", { identity: async () => ({ ...liveIdentity, fingerprint: "other" }) }, /different database/],
  ["a migration has failed", { applied: rowsWith((r) => { r[3].finished = null; }) }, /failed or unfinished/],
  ["a migration was rolled back", { applied: rowsWith((r) => { r[2].rolledBack = new Date(0); }) }, /failed or unfinished/],
  ["an unexpected migration is applied", { applied: rowsWith((r) => [{ name: "m0", checksum: "sum-m0", finished: new Date(0), rolledBack: null }, ...r.slice(1)]) }, /isn't on disk/],
  ["an extra migration is applied", { applied: rowsWith((r) => [{ name: "extra", checksum: "x", finished: new Date(0), rolledBack: null }, ...r]) }, /expected 7/],
  ["one fewer is applied", { applied: rowsWith((r) => r.slice(1)) }, /expected 7/],
  ["MIG-03 isn't last", { applied: rowsWith((r) => [...r].reverse()) }, /isn't the latest/],
  ["an applied checksum differs from its file", { checksumOnDisk: (n) => (n === "m2" ? "edited" : `sum-${n}`) }, /differs from its file: m2/],
  ["a checksum on the database and its file both changed since preflight", { applied: rowsWith((r) => { r[1].checksum = "both"; }), checksumOnDisk: (n) => (n === "m2" ? "both" : `sum-${n}`) }, /record changed since preflight: m2/],
  ["MIG-04 is already applied", { applied: rowsWith((r) => [...r.slice(1), { name: MIG_NAME, checksum: "x", finished: new Date(0), rolledBack: null }]), checksumOnDisk: (n) => `sum-${n}`.replace(`sum-${MIG_NAME}`, "x") }, /isn't the latest/],
  ["nothing is pending", { migrationsOnDisk: () => [...NAMES] }, /pending isn't exactly MIG-04: none/],
  ["two are pending", { migrationsOnDisk: () => [...NAMES, MIG_NAME, "20261106160000_another"] }, /pending isn't exactly/],
  ["another migration is what's pending", { migrationsOnDisk: () => [...NAMES, "20261106160000_another"] }, /pending isn't exactly/],
  ["Prisma's tool names no target", { prismaTarget: () => null }, /verified target/],
  ["Prisma's tool names another database", { prismaTarget: () => ({ db: "fitdb", schema: "public", host: "localhost:5432", listsMig: true }) }, /verified target/],
  ["Prisma's tool is on another host", { prismaTarget: () => ({ db: "fitdb_test", schema: "public", host: "db.example:5432", listsMig: true }) }, /verified target/],
  ["Prisma's tool doesn't list MIG-04", { prismaTarget: () => ({ db: "fitdb_test", schema: "public", host: "localhost:5432", listsMig: false }) }, /doesn't list MIG-04/],
  ["the schema has drifted", { driftFromBefore: () => ({ code: 2, out: "a difference" }) }, /doesn't equal the schema before MIG-04/],
  ["the drift check can't run", { driftFromBefore: () => ({ code: 1, out: "error" }) }, /doesn't equal the schema before MIG-04/],
  ["MIG-04's table exists", { bodyMetricObjects: async () => ({ tbl: "BodyMetric", kinds: 0 }) }, /already exist/],
  ["MIG-04's enum exists", { bodyMetricObjects: async () => ({ tbl: null, kinds: 1 }) }, /already exist/],
  ["the backup's data no longer matches the record", { archiveRowCounts: () => ({ ...COUNTS, User: 2 }) }, /backup doesn't match the record/],
  ["the backup is missing a table", { archiveRowCounts: () => ({ User: 3, _prisma_migrations: 7 }) }, /backup doesn't match the record/],
  ["a row was added since the backup", { rowCounts: async () => ({ ...COUNTS, User: 4 }) }, /changed since the backup: User/],
  ["a row was removed since the backup", { rowCounts: async () => ({ ...COUNTS, Profile: 1 }) }, /changed since the backup: Profile/],
  ["a table was added since the backup", { rowCounts: async () => ({ ...COUNTS, New: 0 }) }, /changed since the backup: New/],
  ["a table was removed since the backup", { rowCounts: async () => ({ User: 3, _prisma_migrations: 7 }) }, /changed since the backup: Profile/],
]) {
  test(`no deploy when ${name}`, () => stopsBeforeDeploy(world(change), reason));
}

test("no deploy when the backup changes between the first look and the last", async () => {
  let looks = 0;
  const io = world({ fileFacts: () => { looks++; return looks === 1 ? { size: BACKUP.size, sha256: BACKUP.sha256 } : { size: BACKUP.size, sha256: "changed" }; } });
  await stopsBeforeDeploy(io, /backup has changed/);
  assert.equal(looks, 2);
});

test("no deploy when the row counts can't be read, and the error isn't swallowed", async () => {
  const io = world({ rowCounts: async () => { throw new Error("connection lost"); } });
  await assert.rejects(() => verifying.applyStep(io, NOW), /connection lost/);
  assert.equal(io.calls.includes("deploy"), false);
});

test("nothing that reads changes anything: the deploy is the one writer the step is given", () => {
  assert.equal(LIB.match(/io\.deploy\(\)/g).length, 1);
  assert.match(LIB, /return io\.deploy\(\);\n?\r?\n?\}/, "and it's the step's last line");
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
function runBlock(shell, block, withRecord = false) {
  const dir = folderWith(CLOSED);
  if (withRecord) writeRecord(dir);
  const file = path.join(dir, "block.ps1");
  fs.writeFileSync(file, block.replace(/scripts\/mig-04\.cjs/g, `"${SCRIPT.replace(/\\/g, "/")}"`));
  try {
    const r = spawnSync(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], { encoding: "utf8", env: { ...isolated(cleanEnv(), dir), DATABASE_URL: INHERITED }, cwd: dir, timeout: 90_000 });
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
      const r = runBlock(shell, blockFor(step), step === "apply");
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
