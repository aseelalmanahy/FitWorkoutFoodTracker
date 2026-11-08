// The demo account's data, and what its scripts must refuse. No database: refused addresses are never contacted, and every
// run uses an .env.test in a temporary folder, so the real one is never read.
//   node --test scripts/demo-account.test.cjs
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const data = require("./lib/demo-account-data.cjs");

const SOURCE = fs.readFileSync(path.join(__dirname, "demo-account.cjs"), "utf8");
const ROOT = path.join(__dirname, "..");
const exerciseIdByName = Object.fromEntries(data.PLANS.flatMap((p) => p.exercises.map((e) => [e[0], `ex-${e[0]}`])));
const build = (iso) => data.buildDemoRows({ now: new Date(`${iso}T17:00:00Z`), exerciseIdByName });
const NOW = build("2026-11-07");
const iso = (d) => d.toISOString().slice(0, 10);

test("building twice gives the same rows", () => {
  assert.deepEqual(build("2026-11-07"), NOW);
});

test("later days only add rows, and every earlier row stays exactly as it was", () => {
  const later = build("2026-11-21");
  for (const [model, rows] of Object.entries(NOW.rows)) {
    const byId = new Map(later.rows[model].map((r) => [r.id ?? r.userId, r]));
    for (const row of rows) {
      const lateRow = byId.get(row.id ?? row.userId);
      if (row.id?.startsWith("demo-fe-2026-11-07")) continue; // Today grows as its later meals arrive.
      assert.deepEqual(lateRow, row, `${model} ${row.id}`);
    }
    assert.ok(later.rows[model].length >= rows.length, model);
  }
  assert.ok(later.rows.workoutSession.length > NOW.rows.workoutSession.length);
  assert.ok(later.rows.bodyMetric.length > NOW.rows.bodyMetric.length);
});

test("every row belongs to the demo account, with an id of its own", () => {
  for (const [model, rows] of Object.entries(NOW.rows)) {
    for (const row of rows) {
      if ("userId" in row) assert.equal(row.userId, data.DEMO_USER_ID, model);
      if ("id" in row) assert.match(row.id, /^demo-[0-9A-Za-z-]+$/, model);
      if ("id" in row) assert.ok(row.id.length <= 40, `${row.id} fits what the API accepts`);
    }
  }
  const ids = Object.values(NOW.rows).flat().map((r) => r.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
});

test("the profile is complete, for an adult", () => {
  const [p] = NOW.rows.profile;
  assert.equal(p.name, "FitWorkoutFoodTracker Demo");
  for (const field of ["birthDate", "sex", "heightCm", "currentWeightKg", "goalWeightKg", "goal", "activityLevel", "experience", "workoutDaysPerWeek", "unitSystem", "timezone"]) assert.ok(p[field], field);
  assert.ok(new Date("2026-11-07").getUTCFullYear() - p.birthDate.getUTCFullYear() >= 18);
});

test("four plans, on four training days, with three recovery days", () => {
  assert.deepEqual(NOW.rows.workoutTemplate.map((t) => t.name), ["Upper Body A", "Lower Body A", "Upper Body B", "Lower Body B"]);
  assert.deepEqual(NOW.rows.scheduleSlot.map((s) => s.weekday).sort(), [0, 1, 3, 5]);
  for (const te of NOW.rows.templateExercise) {
    assert.ok(te.targetSets >= 1 && te.targetRepsMin <= te.targetRepsMax);
    assert.ok(te.exerciseId);
  }
});

test("workouts are finished, in the past, on scheduled days, and show progress", () => {
  const sessions = NOW.rows.workoutSession;
  assert.ok(sessions.length >= 25);
  for (const s of sessions) {
    assert.equal(s.status, "COMPLETED");
    assert.ok(iso(s.startedAt) < NOW.today);
    assert.ok(s.endedAt > s.startedAt);
    assert.ok([0, 1, 3, 5].includes((s.startedAt.getUTCDay() + 6) % 7), iso(s.startedAt));
  }
  const bench = NOW.rows.sessionExercise.filter((se) => se.exerciseId === "ex-Barbell Bench Press");
  const top = (se) => Math.max(...NOW.rows.setEntry.filter((x) => x.sessionExerciseId === se.id && !x.isWarmup).map((x) => x.weightKg));
  assert.ok(top(bench.at(-1)) > top(bench[0]), "the weight goes up over time");
  const repsOf = (se) => NOW.rows.setEntry.filter((x) => x.sessionExerciseId === se.id && !x.isWarmup)[0].reps;
  const changes = new Set();
  for (let i = 1; i < bench.length; i++) {
    if (top(bench[i]) > top(bench[i - 1])) changes.add("heavier");
    else if (repsOf(bench[i]) > repsOf(bench[i - 1])) changes.add("more");
    else if (repsOf(bench[i]) < repsOf(bench[i - 1])) changes.add("fewer");
    else changes.add("same");
  }
  assert.deepEqual([...changes].sort(), ["fewer", "heavier", "more", "same"], "improved, matched and decreased all appear");
  assert.ok(NOW.rows.setEntry.some((x) => x.isWarmup), "warm-ups too");
});

test("a value a food doesn't report stays null in entries, never 0", () => {
  const chili = NOW.rows.foodEntry.filter((e) => e.foodId === "demo-food-chili");
  const bar = NOW.rows.foodEntry.filter((e) => e.foodId === "demo-food-bar");
  assert.ok(chili.length && bar.length, "both appear");
  for (const e of chili) assert.deepEqual([e.kcal, e.protein, e.carbs, e.fat, e.fiber], [null, null, null, null, null]);
  for (const e of bar) {
    assert.ok(Number(e.kcal) > 0 && Number(e.protein) > 0);
    assert.deepEqual([e.carbs, e.fat, e.fiber], [null, null, null]);
  }
});

test("an entry's totals follow from its snapshot, as the app works them out", () => {
  for (const e of NOW.rows.foodEntry) {
    const consumed = Number(e.servingAmount) * Number(e.quantity);
    for (const [total, per100] of [[e.kcal, e.kcalPer100], [e.protein, e.proteinPer100], [e.fat, e.fatPer100]]) {
      if (per100 === null) assert.equal(total, null);
      else assert.ok(Math.abs(Number(total) - (Number(per100) * consumed) / 100) < 0.006, e.id);
    }
  }
});

test("nutrition targets are consistent: carbs are what the calories leave", () => {
  for (const t of NOW.rows.nutritionTarget) assert.ok(Math.abs(t.carbsG - (t.kcal - 4 * t.proteinG - 9 * t.fatG) / 4) <= 0.5, t.id);
});

test("weight stays in range, trends down, and has gaps", () => {
  const w = NOW.rows.bodyMetric;
  assert.ok(w.every((r) => r.value >= 30 && r.value <= 300 && r.kind === "WEIGHT"));
  assert.ok(w[0].value > w.at(-1).value);
  assert.ok(w.at(-1).value > NOW.rows.profile[0].goalWeightKg, "the goal is still ahead");
  assert.equal(iso(w.at(-1).date), NOW.today);
  assert.ok(w.length < 57 && w.length > 40, "not every day");
});

test("multi-gym rows: only when asked, at the account's own gyms, from their start date, with one swap that keeps its sets", () => {
  const ids = { ...exerciseIdByName, "Dumbbell Bench Press": "ex-Dumbbell Bench Press", "Lat Pulldown": "ex-Lat Pulldown", "Leg Press": "ex-Leg Press" };
  const plain = data.buildDemoRows({ now: new Date("2026-11-07T17:00:00Z"), exerciseIdByName: ids });
  assert.equal(plain.rows.gymLocation, undefined, "none without the migration");
  assert.ok(plain.rows.workoutSession.every((s) => !("gymLocationId" in s)), "and no column the database doesn't have");
  const g = data.buildDemoRows({ now: new Date("2026-11-07T17:00:00Z"), exerciseIdByName: ids, gyms: true });
  assert.deepEqual(g, data.buildDemoRows({ now: new Date("2026-11-07T17:00:00Z"), exerciseIdByName: ids, gyms: true }), "the same every time");
  assert.deepEqual(g.rows.gymLocation.map((r) => r.name), ["City Gym", "Home gym"]);
  assert.ok([...g.rows.gymLocation, ...g.rows.gymEquipment].every((r) => r.userId === data.DEMO_USER_ID));
  for (const s of g.rows.workoutSession) assert.equal(s.gymLocationId === null, iso(s.startedAt) < data.GYMS_FROM, `${s.id}: a gym only from ${data.GYMS_FROM}`);
  const machines = g.rows.sessionExercise.filter((e) => e.gymEquipmentId);
  assert.ok(machines.length > 0 && machines.every((e) => g.rows.workoutSession.find((s) => s.id === e.sessionId).gymLocationId === "demo-gym-city"), "machines only at their own gym");
  const swaps = g.rows.sessionExercise.filter((e) => e.substitutesId);
  assert.equal(swaps.length, 1);
  const [swap] = swaps;
  const planned = g.rows.sessionExercise.find((e) => e.id === swap.substitutesId);
  assert.deepEqual([planned.exerciseId, swap.exerciseId, swap.plannedExerciseId, swap.position], [ids["Barbell Bench Press"], ids["Dumbbell Bench Press"], ids["Barbell Bench Press"], planned.position + 1]);
  const setsOf = (id) => g.rows.setEntry.filter((x) => x.sessionExerciseId === id);
  assert.equal(setsOf(planned.id).filter((x) => !x.isWarmup).length, data.SWAP.keptWorkingSets, "the planned exercise keeps the sets done before the swap");
  assert.ok(setsOf(swap.id).length > 0);
  const positions = g.rows.sessionExercise.filter((e) => e.sessionId === swap.sessionId).map((e) => e.position);
  assert.equal(new Set(positions).size, positions.length, "positions stay distinct");
  assert.equal(new Set(g.rows.setEntry.map((x) => x.id)).size, g.rows.setEntry.length, "every set has its own id");
  const later = data.buildDemoRows({ now: new Date("2026-11-21T17:00:00Z"), exerciseIdByName: ids, gyms: true });
  for (const model of ["gymLocation", "gymEquipment", "workoutSession", "sessionExercise", "setEntry"]) {
    const byId = new Map(later.rows[model].map((r) => [r.id, r]));
    for (const row of g.rows[model]) assert.deepEqual(byId.get(row.id), row, `${model} ${row.id} stays as it was`);
  }
  assert.throws(() => data.buildDemoRows({ now: new Date("2026-11-07T17:00:00Z"), exerciseIdByName, gyms: true }), /aren't on this database: Dumbbell Bench Press/);
});

test("an exercise missing from the database stops it, rather than inventing one", () => {
  const { ["Back Squat"]: _gone, ...rest } = exerciseIdByName;
  assert.throws(() => data.buildDemoRows({ now: new Date(), exerciseIdByName: rest }), /Back Squat/);
});

test("the script only adds rows, and only keeps or generates a password", () => {
  const code = SOURCE.replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\.(update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\.\$queryRawUnsafe\(`\s*(UPDATE|DELETE|DROP|TRUNCATE)/);
  assert.match(code, /createMany\(\{ data: list\.slice\(i, i \+ 1000\), skipDuplicates: true \}\)/);
  assert.match(code, /tx\.user\.create\(/);
  for (const line of code.split("\n").filter((l) => /console\.(log|error)/.test(l))) assert.doesNotMatch(line, /\$\{\s*password\b|,\s*password\b/, "the password is never printed");
  assert.equal(spawnSync("git", ["check-ignore", "-q", "demo-account.local.md"], { cwd: ROOT }).status, 0, "the credentials file is ignored by Git");
});

// ─── Refusals ────────────────────────────────────────────────────────────────

const CLOSED = "postgresql://none:none@127.0.0.1:1/fitdb_test";
function run(scriptName, args, fileUrl, { inherited, nodeArgs = ["--env-file=.env.test"] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fit-demo-test-"));
  fs.writeFileSync(path.join(dir, ".env.test"), fileUrl === undefined ? "OTHER=1\n" : `DATABASE_URL=${fileUrl}\n`);
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(DATABASE_URL|BASE_URL|NODE_TEST_CONTEXT|FDC_|ANTHROPIC_|LABEL_|MAIL_)/.test(k)) delete env[k];
  if (inherited) env.DATABASE_URL = inherited;
  try {
    const r = spawnSync(process.execPath, [...nodeArgs, path.join(__dirname, scriptName), ...args], { encoding: "utf8", env, cwd: dir, timeout: 60_000 });
    return { code: r.status, text: `${r.stdout}${r.stderr}` };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const POPULATE = ["--populate", "--confirm=fitdb_test"];
const SERVE = ["--confirm=fitdb_test", "--port=3999"];

for (const [scriptName, good] of [["demo-account.cjs", POPULATE], ["demo-server.cjs", SERVE]]) {
  for (const [label, url] of [["the development database", "postgresql://none:none@127.0.0.1:1/fitdb"], ["the other test database", "postgresql://none:none@127.0.0.1:1/fitdb_test_other"], ["another name", "postgresql://none:none@127.0.0.1:1/somewhere"], ["fitdb_test on another machine", "postgresql://none:none@db.invalid:5432/fitdb_test"]]) {
    test(`${scriptName} refuses ${label}, before connecting`, () => {
      const r = run(scriptName, good, url);
      assert.equal(r.code, 4, r.text);
      assert.match(r.text, /REFUSED/);
      assert.doesNotMatch(r.text, /none:none/);
    });
  }
  test(`${scriptName} refuses a DATABASE_URL in the shell that differs from .env.test`, () => {
    const r = run(scriptName, good, CLOSED, { inherited: "postgresql://x:y@127.0.0.1:2/fitdb_test" });
    assert.equal(r.code, 4, r.text);
    assert.match(r.text, /differs from \.env\.test/);
  });
  test(`${scriptName} refuses to run without exactly --env-file=.env.test`, () => {
    assert.equal(run(scriptName, good, CLOSED, { nodeArgs: [] }).code, 4);
  });
  test(`${scriptName} refuses without its confirmation`, () => {
    const r = run(scriptName, [], CLOSED);
    assert.equal(r.code, 4, r.text);
    assert.match(r.text, /--confirm=fitdb_test/);
  });
}

test("the manual guide holds no secret, and its commands are the ones that work on Windows", () => {
  const guide = fs.readFileSync(path.join(ROOT, "docs", "MANUAL_UI_TESTING_GUIDE.md"), "utf8");
  assert.doesNotMatch(guide, /^\| Password \|/m);
  assert.doesNotMatch(guide, /env -u|npx /);
  assert.match(guide, /scripts\/demo-server\.cjs --confirm=fitdb_test/);
  assert.match(guide, /Remove-Item Env:DATABASE_URL/);
  const local = path.join(ROOT, "demo-account.local.md");
  if (fs.existsSync(local)) {
    const password = /^\| Password \| (\S+) \|$/m.exec(fs.readFileSync(local, "utf8").replace(/\r\n/g, "\n"))?.[1];
    assert.ok(password);
    for (const file of ["docs/MANUAL_UI_TESTING_GUIDE.md", "docs/DEVELOPMENT_WORKFLOW.md", "docs/PROJECT_COMPLETION_TRACKER.md", "CLAUDE.md", "scripts/demo-account.cjs", "scripts/lib/demo-account-data.cjs", "scripts/e2e-demo-account.cjs"]) {
      assert.equal(fs.readFileSync(path.join(ROOT, file), "utf8").includes(password), false, `${file} doesn't hold the password`);
    }
  }
});

test("demo-account.cjs refuses other modes, including any that would remove or reset", () => {
  for (const args of [["--cleanup", "--confirm=fitdb_test"], ["--reset-password", "--confirm=fitdb_test"], ["--populate"], ["--populate", "--confirm=fitdb"]]) {
    assert.equal(run("demo-account.cjs", args, CLOSED).code, 4, args.join(" "));
  }
});

test("demo-account.cjs treats an unreachable database as a failure, and leaves no credentials behind", () => {
  const r = run("demo-account.cjs", ["--status", "--confirm=fitdb_test"], CLOSED);
  assert.notEqual(r.code, 0);
  assert.doesNotMatch(r.text, /READY|none:none/);
});

// A1: serving another folder's build (the UX-01 worktree, the demo copy) without replacing its code.
test("demo-server.cjs --app-dir refuses a folder that isn't this application, or has no Next.js, before connecting", () => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "fit-appdir-"));
  try {
    fs.writeFileSync(path.join(other, "package.json"), JSON.stringify({ name: "something-else" }));
    let r = run("demo-server.cjs", [...SERVE, `--app-dir=${other}`], CLOSED);
    assert.equal(r.code, 4, r.text);
    assert.match(r.text, /--app-dir must be a folder of this application/);
    fs.writeFileSync(path.join(other, "package.json"), JSON.stringify({ name: "fit-workout-food-tracker" }));
    r = run("demo-server.cjs", [...SERVE, `--app-dir=${other}`], CLOSED);
    assert.equal(r.code, 4, r.text);
    assert.match(r.text, /--app-dir has no installed Next\.js/);
    const bin = path.join(other, "node_modules", "next", "dist", "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "next"), "");
    r = run("demo-server.cjs", [...SERVE, `--app-dir=${other}`], CLOSED);
    assert.equal(r.code, 4, r.text);
    assert.match(r.text, /there's no production build/, "the build is looked for in that folder, not this one");
    assert.equal(run("demo-server.cjs", [...SERVE, `--app-dir=${other}`, "--extra"], CLOSED).code, 4, "other arguments are still refused");
  } finally { fs.rmSync(other, { recursive: true, force: true }); }
});

test("demo-server.cjs starts the chosen folder's own Next.js, from that folder, on loopback", () => {
  const code = fs.readFileSync(path.join(__dirname, "demo-server.cjs"), "utf8");
  assert.match(code, /spawnNode\(\[APP_NEXT_BIN, "start", "-H", LOOPBACK_HOST,/);
  assert.match(code, /\}, \{ cwd: APP_DIR \}\);/);
  assert.match(code, /path\.join\(APP_DIR, "\.next", "BUILD_ID"\)/);
});

test("demo-server.cjs keeps registration closed, AI off and providers stubbed", () => {
  const code = fs.readFileSync(path.join(__dirname, "demo-server.cjs"), "utf8");
  assert.doesNotMatch(code, /FIT_TEST_OPEN_REGISTRATION/, "registration isn't opened");
  assert.match(code, /ANTHROPIC_API_KEY: ""/);
  assert.match(code, /FDC_BASE_URL: `\$\{stub\.url\}/);
  assert.match(code, /OFF_BASE_URL: `\$\{stub\.url\}/);
  assert.match(code, /MAIL_STUB_DIR: mailDir/);
});
