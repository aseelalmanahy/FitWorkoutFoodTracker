// The account-facts report: what it can return and do, and what it refuses. No database.
//   node --test scripts/account-facts.test.cjs
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { reportAccountFacts, SMALL, MIN_ADULT_AGE } = require("./lib/account-facts.cjs");

const NOW = new Date("2026-11-06T12:00:00Z");
const readerGiving = (fn) => { const calls = []; return { calls, count: async (model, where) => { calls.push({ model, where }); return fn(model, where); } }; };

test("returns only counts, labels and a note", async () => {
  const report = await reportAccountFacts(readerGiving(() => 1234), NOW);
  const values = report.rows.flatMap((r) => Object.values(r));
  assert.ok(values.every((v) => typeof v === "number" || /^[a-z0-9 ]+$/i.test(v)), "no other kind of value");
  assert.equal(report.rows.length, 4);
  assert.doesNotMatch(JSON.stringify(report), /@|qafx|cuid/);
  assert.match(report.note, /aren't classifications/);
});

test("makes no judgement: no label says abandoned, refused or eligible for removal", async () => {
  const text = JSON.stringify(await reportAccountFacts(readerGiving(() => 100), NOW));
  assert.doesNotMatch(text, /abandon|refused|delete|remove|expired account|candidate|retention period/i);
});

test("hides small counts, zero included, as 0 beside under 5 would show someone is there", async () => {
  const report = await reportAccountFacts(readerGiving((_m, where) => (where.profile?.is?.birthDate ? 1 : where.profile ? 0 : 100)), NOW);
  assert.equal(report.rows[0]["stored date under the minimum today"], `under ${SMALL}`);
  assert.equal(report.rows[0]["no profile row"], `under ${SMALL}`);
  assert.equal(report.rows[0].accounts, 100);
});

test("a row too small to hide both sides says only that it's small", async () => {
  for (const total of [0, 1, 5, 6, 9]) {
    const report = await reportAccountFacts(readerGiving((_m, where) => (where.sessions?.some ? Math.min(1, total) : total)), NOW);
    for (const [label, value] of Object.entries(report.rows[0])) if (label !== "account age") assert.equal(value, `under ${2 * SMALL}`, `${total}: ${label}`);
  }
  const big = await reportAccountFacts(readerGiving(() => 2 * SMALL), NOW);
  assert.equal(big.rows[0].accounts, 2 * SMALL);
});

test("hides a complement, as a total minus a hidden count would recover it", async () => {
  const report = await reportAccountFacts(readerGiving((_m, where) => (where.sessions?.some ? 98 : where.sessions?.none ? 2 : 100)), NOW);
  assert.equal(report.rows[0]["an unexpired session"], `all but under ${SMALL}`);
  assert.equal(report.rows[0]["no unexpired session"], `under ${SMALL}`);
});

test("reads only through count, and asks for no field values", async () => {
  const reader = readerGiving(() => 0);
  await reportAccountFacts(reader, NOW);
  assert.ok(reader.calls.length > 10);
  for (const c of reader.calls) assert.ok(["user", "accountToken"].includes(c.model), c.model);
});

test("a live session means an unexpired one, not any row", async () => {
  const reader = readerGiving(() => 0);
  await reportAccountFacts(reader, NOW);
  const session = reader.calls.find((c) => c.where.sessions?.some);
  assert.deepEqual(session.where.sessions.some.expiresAt.gt, NOW);
});

test("the minimum age is the app's, and takes no period from a caller", () => {
  assert.equal(reportAccountFacts.length, 2, "only a reader and a time");
  const eligibility = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "eligibility.ts"), "utf8");
  assert.match(eligibility, new RegExp(`MIN_ADULT_AGE = ${MIN_ADULT_AGE}\\b`));
});

test("no write or delete exists in the report or its script, and it imports no deletion code", () => {
  const code = (f) => fs.readFileSync(path.join(__dirname, f), "utf8").split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join("\n");
  for (const f of ["lib/account-facts.cjs", "account-facts.cjs"]) {
    const source = code(f);
    assert.doesNotMatch(source, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/, f);
    assert.doesNotMatch(source, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/, f);
    assert.doesNotMatch(source, /require\([^)]*(delete|qa-fixtures|account\/)/, f);
  }
  assert.match(code("account-facts.cjs"), /SET TRANSACTION READ ONLY/);
  const raw = code("account-facts.cjs").match(/\$(?:execute|query)Raw\w*\(/g);
  assert.equal(raw.length, 1, "the one raw statement makes the transaction read-only");
});

test("no route or page imports it", () => {
  const walk = (dir, out = []) => { for (const n of fs.readdirSync(dir)) { const f = path.join(dir, n); if (fs.statSync(f).isDirectory()) walk(f, out); else out.push(f); } return out; };
  for (const f of walk(path.join(__dirname, "..", "src"))) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /account-facts/, f);
});

const run = (flags, env) => {
  const clean = { ...process.env };
  for (const k of ["DATABASE_URL", "NODE_ENV", "BASE_URL", "NODE_TEST_CONTEXT"]) delete clean[k];
  return spawnSync(process.execPath, [path.join(__dirname, "account-facts.cjs"), ...flags], { encoding: "utf8", timeout: 60_000, env: { ...clean, ...env } });
};
for (const [label, flags, env] of [
  ["no confirmation", [], { DATABASE_URL: "postgresql://u:p@127.0.0.1:1/fitdb_test" }],
  ["a wrong confirmation", ["--confirm=fitdb"], { DATABASE_URL: "postgresql://u:p@127.0.0.1:1/fitdb_test" }],
  ["a confirmation for the other test database", ["--confirm=fitdb_test_isolated"], { DATABASE_URL: "postgresql://u:p@127.0.0.1:1/fitdb_test" }],
  ["the review database", ["--confirm=fitdb_review"], { DATABASE_URL: "postgresql://u:p@localhost:5432/fitdb_review" }],
  ["the development database", ["--confirm=fitdb_test"], { DATABASE_URL: "postgresql://u:p@localhost:5432/fitdb" }],
  ["the other test database", ["--confirm=fitdb_test"], { DATABASE_URL: "postgresql://u:p@localhost:5432/fitdb_test_other" }],
  ["a remote host", ["--confirm=fitdb_test"], { DATABASE_URL: "postgresql://u:p@db.example.invalid:5432/fitdb_test" }],
  ["production mode", ["--confirm=fitdb_test"], { DATABASE_URL: "postgresql://u:p@127.0.0.1:1/fitdb_test", NODE_ENV: "production" }],
]) {
  test(`refuses ${label}, before connecting`, () => {
    const r = run(flags, env);
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /REFUSED/);
    assert.doesNotMatch(r.stderr, /u:p@/);
  });
}
