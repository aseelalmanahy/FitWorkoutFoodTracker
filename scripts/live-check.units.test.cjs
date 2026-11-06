// Unit tests (no network, no database) for the live-check building blocks:
//   scripts/lib/live-verdict.cjs, scripts/lib/usda-nutrient-oracle.cjs, and .gitignore hygiene.
//   node --test scripts/live-check.units.test.cjs
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { decideVerdict, decideProt1 } = require("./lib/live-verdict.cjs");
const { classifyRaw, compareWithApp } = require("./lib/usda-nutrient-oracle.cjs");

const pass = (id) => ({ id, status: "PASS" });
const realEvidence = () => ({ USDA: { origin: "real", count: 20 }, OPEN_FOOD_FACTS: { origin: "real", count: 24 } });

// ─── Verdict ─────────────────────────────────────────────────────────────────

test("verdict PASSED only with real evidence from BOTH providers and every check passing", () => {
  const v = decideVerdict({ results: [pass("a"), pass("b")], evidence: realEvidence() });
  assert.deepEqual([v.verdict, v.live, v.exitCode], ["PASSED", true, 0]);
});

test("verdict NOT LIVE on any contradiction, even if every check passed", () => {
  const cases = [
    [{ ...realEvidence(), USDA: { origin: "other", originHost: "localhost:4010", count: 20 } }, [], /localhost:4010/],
    [{ ...realEvidence(), OPEN_FOOD_FACTS: { origin: "real", count: 1 } }, [], /returned 1 results/],
    [realEvidence(), ["FDC_BASE_URL"], /FDC_BASE_URL is set/],
  ];
  for (const [evidence, envOverrides, re] of cases) {
    const v = decideVerdict({ results: [pass("a")], evidence, envOverrides });
    assert.deepEqual([v.verdict, v.live, v.exitCode], ["NOT LIVE", false, 3]);
    assert.match(v.contradictions.join("; "), re);
  }
});

test("a FAILED provider search is missing evidence (INCOMPLETE), not a false NOT LIVE", () => {
  // Before the fix, a failed OFF search counted as "0 results" and was reported NOT LIVE.
  const ev = { USDA: { origin: "real", count: 20 }, OPEN_FOOD_FACTS: { origin: "real", count: null } };
  const v = decideVerdict({ results: [pass("a"), { id: "OFF-1", status: "FAIL" }], evidence: ev });
  assert.deepEqual([v.verdict, v.live, v.exitCode], ["INCOMPLETE OR FAILED", null, 1]);
  assert.match(v.missing.join("; "), /no successful OPEN_FOOD_FACTS search/);
});

test("evidence from only ONE provider can never be PASSED", () => {
  for (const missingProvider of ["USDA", "OPEN_FOOD_FACTS"]) {
    const ev = realEvidence();
    ev[missingProvider] = { origin: "unknown", count: null };
    const v = decideVerdict({ results: [pass("a")], evidence: ev });
    assert.notEqual(v.verdict, "PASSED", missingProvider);
    assert.equal(v.exitCode, 1);
  }
});

test("any FAIL, any NOT RUN, or an early stop prevents PASSED even with full live evidence", () => {
  for (const extra of [{ results: [pass("a"), { id: "x", status: "FAIL" }] }, { results: [pass("a"), { id: "x", status: "NOT RUN" }] }, { results: [pass("a")], crashed: true }]) {
    const v = decideVerdict({ evidence: realEvidence(), ...extra });
    assert.deepEqual([v.verdict, v.live, v.exitCode], ["INCOMPLETE OR FAILED", true, 1]);
  }
});

// ─── PROT-1 (per-user Open Food Facts search limit) ──────────────────────────

const LIMITED = "user_rate_limited";

test("PROT-1 PASS: four searches pass the guard and the 5th is rejected by the per-user limit", () => {
  const r = decideProt1(["ok", "ok", "ok", "ok", LIMITED]);
  assert.equal(r.status, "PASS");
  assert.doesNotMatch(r.detail, /provider errors/);
});

test("PROT-1 PASS: a provider error among the first four is context, not a failure of the limit", () => {
  // The real run that motivated this: http,ok,ok,ok was reported as FAIL without judging the 5th.
  for (const kind of ["http", "timeout", "network", "invalid_response", "not_found"]) {
    const r = decideProt1([kind, "ok", "ok", "ok", LIMITED]);
    assert.equal(r.status, "PASS", kind);
    assert.match(r.detail, new RegExp(`provider errors among the first 4 \\(${kind}\\)`));
  }
});

test("PROT-1 FAIL: the 5th search passes the guard, whether the provider then succeeds or errors", () => {
  for (const fifth of ["ok", "http", "timeout", "network", "invalid_response", "not_found"]) {
    const r = decideProt1(["ok", "ok", "ok", "ok", fifth]);
    assert.equal(r.status, "FAIL", fifth);
    assert.match(r.detail, /5th search passed the per-user limit/);
  }
});

test("PROT-1 FAIL: the limit fires before the allowed four searches are used", () => {
  const r = decideProt1(["ok", "ok", LIMITED, LIMITED, LIMITED]);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /stopped search 3 of the allowed 4/);
});

test("PROT-1 NOT RUN: an outcome that can't separate the local limit from an upstream or app failure", () => {
  const cases = [
    ["ok", "ok", "ok", "ok", "unavailable"], // circuit open, app-wide budget or provider 429
    ["unavailable", "ok", "ok", "ok", LIMITED], // that search may not have used budget
    ["http", "http", "http", "unavailable", "unavailable"], // the first real run
    ["ok", "ok", "ok", "ok", "unknown"], // unexpected server error in the search route
    ["no_app_response", "ok", "ok", "ok", LIMITED], // the app itself didn't answer
    ["ok", "ok", "ok", "ok", "no_app_response"],
    ["ok", "ok", "ok", LIMITED], // too few outcomes
  ];
  for (const kinds of cases) {
    const r = decideProt1(kinds);
    assert.equal(r.status, "NOT RUN", kinds.join(","));
    assert.match(r.detail, /inconclusive/);
  }
});

// ─── Suites that query the database directly must never fall back to .env ────

test("suites using Prisma directly refuse, before connecting, unless DATABASE_URL is a local test database", () => {
  const root = path.resolve(__dirname, "..");
  const env = { ...process.env, BASE_URL: "http://127.0.0.1:9" }; // a valid target, so only the database check can refuse. Never contacted.
  delete env.DATABASE_URL;
  delete env.NODE_TEST_CONTEXT;
  const cases = [
    [undefined, /DATABASE_URL must be set/],
    ["postgresql://u:SECRETPW@localhost:1/fitdb", /doesn't contain "test"/],
    ["postgresql://u:SECRETPW@db.example.invalid:1/fitdb_test", /not local/],
    ["postgresql://u:SECRETPW@localhost:1/fitdb_test?host=db.example.invalid", /host=/],
  ];
  for (const file of ["nutrition-api.test.cjs", "release-workflow.test.cjs"]) {
    for (const [url, re] of cases) {
      const r = spawnSync(process.execPath, [path.join("scripts", file)], { cwd: root, encoding: "utf8", timeout: 20_000, env: url ? { ...env, DATABASE_URL: url } : env });
      assert.equal(r.status, 4, `${file} / ${url}`);
      assert.match(r.stderr, /REFUSING to run \(no database was touched\)/);
      assert.match(r.stderr, re);
      assert.doesNotMatch(r.stderr + r.stdout, /SECRETPW/);
    }
  }
});

test("no script opens a default Prisma client, except the marking tool, which validates its target first", () => {
  const dir = path.resolve(__dirname);
  const files = [...fs.readdirSync(dir), ...fs.readdirSync(path.join(dir, "lib")).map((f) => path.join("lib", f))].filter((f) => f.endsWith(".cjs"));
  const bare = files.filter((f) => /new PrismaClient\(\s*\)/.test(fs.readFileSync(path.join(dir, f), "utf8")));
  assert.deepEqual(bare, ["mark-test-database.cjs"]);
});

// ─── USDA nutrient oracle (USDA-6) ───────────────────────────────────────────

const raw =(...nutrients) => ({ fdcId: 1, description: "x", foodNutrients: nutrients });
const n = (id, unitName, amount) => ({ nutrient: { id, unitName }, amount });

test("oracle: absent nutrients must be null in the app; present values must match", () => {
  const r = raw(n(1003, "g", 2.7)); // only protein reported
  const ok = compareWithApp(r, { kcal: null, protein: 2.7, carbs: null, fat: null, fiber: null });
  assert.deepEqual(ok.absent, ["kcal", "carbs", "fat", "fiber"]);
  assert.deepEqual(ok.mismatches, []);
});

test("oracle catches an absent nutrient fabricated as 0 by the app", () => {
  const r = raw(n(1003, "g", 2.7));
  const bad = compareWithApp(r, { kcal: 0, protein: 2.7, carbs: null, fat: null, fiber: null });
  assert.match(bad.mismatches.join("; "), /kcal: absent in the USDA response but the app returned 0 \(must be null\)/);
});

test("oracle catches a reported zero turned into null (zero is not missing)", () => {
  const r = raw(n(1008, "kcal", 165), n(1003, "g", 31), n(1005, "g", 0), n(1004, "g", 3.6));
  const bad = compareWithApp(r, { kcal: 165, protein: 31, carbs: null, fat: 3.6, fiber: null });
  assert.match(bad.mismatches.join("; "), /carbs: USDA reports 0 but the app returned null/);
  assert.deepEqual(bad.zero, ["carbs"]);
});

test("oracle catches a wrong present value and a dropped present value", () => {
  const r = raw(n(1008, "kcal", 89), n(1003, "g", 1.09));
  assert.match(compareWithApp(r, { kcal: 90, protein: 1.09, carbs: null, fat: null, fiber: null }).mismatches.join(";"), /kcal: USDA reports 89 but the app returned 90/);
  assert.match(compareWithApp(r, { kcal: null, protein: 1.09, carbs: null, fat: null, fiber: null }).mismatches.join(";"), /kcal: USDA reports 89/);
});

test("oracle classification: unit matters (kJ energy is absent kcal), Atwater fallback, priority order", () => {
  assert.equal(classifyRaw(raw(n(1062, "kJ", 371))).kcal.state, "absent");
  assert.deepEqual(classifyRaw(raw(n(2047, "kcal", 97))).kcal, { state: "present", value: 97 });
  assert.deepEqual(classifyRaw(raw(n(2047, "kcal", 97), n(1008, "kcal", 95))).kcal, { state: "present", value: 95 });
  assert.equal(classifyRaw(raw({ nutrient: { id: 1003, unitName: "g" } })).protein.state, "absent"); // amount missing
  assert.equal(classifyRaw(raw({ nutrientId: 1003, unitName: "G", value: 0 })).protein.state, "zero"); // search shape
  assert.equal(classifyRaw({}).fat.state, "absent");
});

test("oracle mirrors the app's plausibility rules (implausible values are expected to be nulled)", () => {
  const r = raw(n(1008, "kcal", 54000000), n(1003, "g", 60), n(1005, "g", 60), n(1004, "g", 10));
  const res = compareWithApp(r, { kcal: null, protein: null, carbs: null, fat: null, fiber: null });
  assert.deepEqual(res.mismatches, []);
  assert.deepEqual(res.sanitized.sort(), ["carbs", "fat", "kcal", "protein"]);
});

// ─── Repository hygiene ──────────────────────────────────────────────────────

test(".gitignore ignores every .env variant (they hold secrets) but keeps .env.example tracked", () => {
  const root = path.resolve(__dirname, "..");
  const ignored = (f) => spawnSync("git", ["check-ignore", "-q", f], { cwd: root }).status === 0;
  for (const f of [".env", ".env.local", ".env.test", ".env.production", ".env.development.local", ".env.live", "live-provider-report.json"]) {
    assert.ok(ignored(f), `${f} must be git-ignored`);
  }
  assert.equal(ignored(".env.example"), false, ".env.example must stay tracked");
});
