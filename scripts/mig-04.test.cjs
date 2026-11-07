// What scripts/mig-04.cjs must refuse, and what it pins. No database: refused addresses are never contacted, and the one
// address it does try is a closed port on this machine, so it can't reach anything.
//   node --test scripts/mig-04.test.cjs
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "mig-04.cjs");
const SOURCE = fs.readFileSync(SCRIPT, "utf8");
const MIGRATION = path.join(__dirname, "..", "prisma", "migrations", "20261106150000_body_metrics", "migration.sql");
const CLOSED = "postgresql://none:none@127.0.0.1:1/fitdb_test";

function run(args, databaseUrl) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(DATABASE_URL|BASE_URL|NODE_TEST_CONTEXT|FDC_|ANTHROPIC_|LABEL_|MAIL_)/.test(k)) delete env[k];
  if (databaseUrl !== undefined) env.DATABASE_URL = databaseUrl;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env, timeout: 60_000 });
  return { code: r.status, text: `${r.stdout}${r.stderr}` };
}

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
