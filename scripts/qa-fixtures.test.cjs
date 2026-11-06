// The QA fixture's data rules and its refusals. No database: the refusals stop before connecting, and the one
// unreachable-database case uses a port nothing listens on.
//   node --test scripts/qa-fixtures.test.cjs
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { FIXTURE_ACCOUNTS, FIXTURE_EMAILS, FOODS, WRITE_ORDER, OWNED_WHERE, buildAccount, localToday, KCAL_PER_G } = require("./lib/qa-fixture-data.cjs");

const ROOT = path.join(__dirname, "..");
const NOW = new Date("2026-11-06T18:00:00Z");
const names = new Set(FIXTURE_ACCOUNTS.flatMap((a) => a.plans.flatMap(([, list]) => list.map(([n]) => n))));
const exerciseIdByName = Object.fromEntries([...names].map((n) => [n, `builtin-${n}`]));
const built = FIXTURE_ACCOUNTS.map((a) => ({ a, rows: buildAccount(a, { now: NOW, exerciseIdByName }) }));
const ofAccount = (n) => built.find(({ a }) => a.n === n).rows;

test("exactly 10 accounts, at fixed lowercase addresses under test.dev, each clearly a fixture", () => {
  assert.equal(FIXTURE_ACCOUNTS.length, 10);
  assert.equal(new Set(FIXTURE_EMAILS).size, 10);
  for (const a of FIXTURE_ACCOUNTS) {
    assert.match(a.email, /^qa-fixture-\d\d-[a-z-]+@test\.dev$/);
    assert.match(a.name, /\(QA fixture\)$/);
  }
});

test("the same inputs give the same rows, and ids can't collide between accounts", () => {
  const again = FIXTURE_ACCOUNTS.map((a) => buildAccount(a, { now: NOW, exerciseIdByName }));
  assert.deepEqual(again, built.map(({ rows }) => rows));
  for (const [, key] of WRITE_ORDER) {
    const ids = built.flatMap(({ rows }) => rows[key].map((r) => r.id));
    assert.equal(new Set(ids).size, ids.length, key);
  }
});

test("everyone is an adult, with a real time zone, and nothing but what the schema holds", () => {
  for (const { a, rows } of built) {
    const age = (NOW - rows.profile.birthDate) / (365.25 * 86_400_000);
    assert.ok(age >= 18 && age <= 110, a.slug);
    assert.doesNotThrow(() => localToday(NOW, a.timeZone));
  }
});

test("set and position numbers have no gaps, and a finished workout has its end", () => {
  for (const { a, rows } of built) {
    const inProgress = rows.sessions.filter((s) => s.status === "IN_PROGRESS");
    assert.ok(inProgress.length <= 1, a.slug);
    for (const s of rows.sessions) {
      if (s.status === "COMPLETED") assert.ok(s.endedAt > s.startedAt, s.id);
      else assert.equal(s.endedAt, null, s.id);
      const exercises = rows.sessionExercises.filter((e) => e.sessionId === s.id);
      assert.deepEqual(exercises.map((e) => e.position), exercises.map((_, i) => i), s.id);
      for (const e of exercises) {
        const list = rows.sets.filter((x) => x.sessionExerciseId === e.id);
        assert.ok(list.length > 0, e.id);
        assert.deepEqual(list.map((x) => x.setNumber), list.map((_, i) => i + 1), e.id);
        for (const x of list) {
          assert.ok(x.reps >= 0 && x.reps <= 1000 && x.weightKg >= 0 && x.weightKg <= 1000, x.id);
          if (x.rpe !== null) assert.ok(x.rpe >= 1 && x.rpe <= 10, x.id);
        }
      }
    }
    if (a.n !== 10) assert.equal(inProgress.length, 0, a.slug);
  }
});

test("plans and schedules hold what the app's own forms require", () => {
  for (const { rows } of built) {
    for (const t of rows.templateExercises) assert.ok(t.targetRepsMin <= t.targetRepsMax && t.targetSets >= 1 && t.targetSets <= 20, t.id);
    for (const s of rows.slots) {
      assert.ok(s.weekday >= 0 && s.weekday <= 6, s.id);
      assert.ok(rows.templates.some((t) => t.id === s.templateId), s.id);
    }
  }
});

test("a food entry's totals follow from its own values, and a missing value stays null, never 0", () => {
  let nulls = 0, entries = 0;
  for (const { rows } of built) {
    for (const e of rows.entries) {
      entries++;
      const food = FOODS.find((f) => e.foodName === f.name);
      const fields = [["kcal", "kcalPer100", 0], ["protein", "proteinPer100", 1], ["carbs", "carbsPer100", 2], ["fat", "fatPer100", 3], ["fiber", "fiberPer100", 4]];
      for (const [total, per, i] of fields) {
        if (food.per100[i] === null) {
          assert.equal(e[per], null);
          assert.equal(e[total], null, `${e.id} ${total}`);
          nulls++;
        } else {
          const expected = (food.per100[i] * Number(e.servingAmount) * Number(e.quantity)) / 100;
          assert.ok(Math.abs(Number(e[total]) - expected) < 0.006, `${e.id} ${total}`);
        }
      }
      assert.ok(Number(e.quantity) > 0 && Number(e.quantity) <= 5000, e.id);
    }
  }
  assert.ok(entries > 1000, "the fixture has entries to check");
  assert.ok(nulls > 100, "and some with missing values");
});

test("no date is in the account's future", () => {
  for (const { a, rows } of built) {
    const today = localToday(NOW, a.timeZone);
    for (const e of rows.entries) assert.ok(e.date.toISOString().slice(0, 10) <= today, e.id);
    for (const t of rows.targets) assert.ok(t.effectiveFrom.toISOString().slice(0, 10) <= today, t.id);
    for (const s of rows.sessions) assert.ok(s.startedAt <= NOW, s.id);
  }
});

test("targets obey the database's own rules: stopped rows are all null, and carbohydrate is derived", () => {
  for (const { rows } of built) {
    for (const t of rows.targets) {
      assert.equal(t.source, "MANUAL");
      if (t.kcal === null) assert.deepEqual([t.proteinG, t.carbsG, t.fatG], [null, null, null], t.id);
      else {
        assert.ok(t.kcal >= 800 && t.kcal <= 8000, t.id);
        if (t.proteinG === null) assert.equal(t.carbsG, null, t.id);
        else assert.equal(t.carbsG, Math.floor((t.kcal - t.proteinG * KCAL_PER_G.protein - t.fatG * KCAL_PER_G.fat) / KCAL_PER_G.carbs), t.id);
      }
    }
    const froms = rows.targets.map((t) => t.effectiveFrom.getTime());
    assert.equal(new Set(froms).size, froms.length);
  }
});

test("each required state exists, and history lengths vary", () => {
  assert.equal(ofAccount(1).profile.heightCm, null, "#1 has an incomplete profile");
  assert.equal(ofAccount(4).sessions.length, 0, "#4 has no workouts");
  assert.equal(ofAccount(1).entries.length, 0, "#1 has no food entries");
  assert.equal(ofAccount(8).entries.length, 0, "#8 has no food entries");
  assert.equal(ofAccount(6).targets.at(-1).kcal, null, "#6's target is stopped");
  const nine = ofAccount(9).targets;
  assert.deepEqual(nine.map((t) => t.kcal === null), [false, true, false], "#9 stopped, then restarted");
  assert.equal(ofAccount(7).targets[0].proteinG, null, "#7 is calories only");
  assert.ok(ofAccount(8).exercises.length > 0, "#8 has custom exercises");
  const sessions = built.map(({ rows }) => rows.sessions.length);
  assert.ok(ofAccount(1).sessions.length <= 3);
  assert.ok(ofAccount(10).sessions.length > 200, String(ofAccount(10).sessions.length));
  assert.equal(Math.max(...sessions), ofAccount(10).sessions.length);
});

test("the size stays practical", () => {
  const rows = built.reduce((sum, { rows: r }) => sum + WRITE_ORDER.reduce((s, [, key]) => s + r[key].length, 0), 0);
  assert.ok(rows < 40_000, String(rows));
});

test("the fixture's ownership rules cover exactly the schema's models", () => {
  const dataMap = require("../src/lib/account-data-map.json");
  assert.deepEqual(Object.keys(OWNED_WHERE([], [])).sort(), Object.keys(dataMap).sort());
});

test("the password hash uses the app's parameters", () => {
  const auth = fs.readFileSync(path.join(ROOT, "src/lib/server/auth.ts"), "utf8");
  const script = fs.readFileSync(path.join(ROOT, "scripts/qa-fixtures.cjs"), "utf8");
  const params = /memoryCost: 19456, timeCost: 2, parallelism: 1/;
  assert.match(auth, params);
  assert.match(script, params);
});

test("the credentials file is ignored by Git", () => {
  assert.equal(spawnSync("git", ["check-ignore", "-q", "qa-test-accounts.local.md"], { cwd: ROOT }).status, 0);
});

// ─── Refusals ───────────────────────────────────────────────────────────────

const GOOD_FLAGS = ["--status", "--confirm=fitdb_test"];
const NOWHERE = "postgresql://u:p@127.0.0.1:1/fitdb_test";
function run(flags, env) {
  const clean = { ...process.env };
  for (const k of ["DATABASE_URL", "NODE_ENV", "BASE_URL", "NODE_TEST_CONTEXT"]) delete clean[k];
  return spawnSync(process.execPath, [path.join(__dirname, "qa-fixtures.cjs"), ...flags], { cwd: ROOT, encoding: "utf8", timeout: 60_000, env: { ...clean, ...env } });
}

for (const [label, flags] of [
  ["no flags", []],
  ["no confirmation", ["--create"]],
  ["a wrong confirmation", ["--create", "--confirm=fitdb"]],
  ["another database's confirmation", ["--create", "--confirm=fitdb_test_other"]],
  ["an unknown flag", ["--destroy", "--confirm=fitdb_test"]],
  ["combined modes", ["--create", "--cleanup", "--confirm=fitdb_test"]],
  ["a confirmation first", ["--confirm=fitdb_test", "--create"]],
]) {
  test(`refuses ${label}, before connecting`, () => {
    const r = run(flags, { DATABASE_URL: NOWHERE });
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /REFUSED/);
  });
}

for (const [label, url] of [
  ["no database", undefined],
  ["the development database", "postgresql://u:p@localhost:5432/fitdb"],
  ["the other test database, which isn't authorized", "postgresql://u:p@localhost:5432/fitdb_test_other"],
  ["a production name", "postgresql://u:p@localhost:5432/fit_production"],
  ["a remote host", "postgresql://u:p@db.example.invalid:5432/fitdb_test"],
  ["a host= redirect", "postgresql://u:p@localhost:5432/fitdb_test?host=db.example.invalid"],
]) {
  test(`refuses ${label}, before connecting`, () => {
    const r = run(GOOD_FLAGS, url ? { DATABASE_URL: url } : {});
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /REFUSED/);
    assert.doesNotMatch(r.stderr, /u:p@/, "and prints no credential");
  });
}

test("refuses NODE_ENV=production, before connecting", () => {
  const r = run(GOOD_FLAGS, { DATABASE_URL: NOWHERE, NODE_ENV: "production" });
  assert.equal(r.status, 4, r.stderr);
});

test("an unreachable database fails, and writes no credentials file", () => {
  const file = path.join(ROOT, "qa-test-accounts.local.md");
  const existed = fs.existsSync(file);
  const r = run(existed ? GOOD_FLAGS : ["--create", "--confirm=fitdb_test"], { DATABASE_URL: NOWHERE });
  assert.notEqual(r.status, 0);
  assert.equal(fs.existsSync(file), existed);
  assert.doesNotMatch(r.stdout + r.stderr, /u:p@/, "and prints no credential");
});
