// The permanent demo account, as data. No database, network or file access here, so it can be tested alone.
//
// Every row's id comes from what it is and its calendar date, and values come from a hash of that date. So populating again
// adds only the days since the last run, and changes nothing already there. These values are SYNTHETIC: the foods are made up
// for showing the app, and aren't a nutrition reference. Nothing derived is stored, except a food entry's totals, which the app
// stores when it logs an entry. A value a food doesn't report stays null, never 0.
"use strict";

const DEMO_NAME = "FitWorkoutFoodTracker Demo";
const DEMO_EMAIL = "fitworkoutfoodtracker-demo@test.dev";
const DEMO_USER_ID = "demo-user";
const TIME_ZONE = "America/New_York";
const HISTORY_FROM = "2026-09-12"; // Workouts and weight.
const NUTRITION_FROM = "2026-10-24";
const LB = 0.45359237;

const DAY_MS = 86_400_000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const weekdayOf = (iso) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 is Monday, as ScheduleSlot.
const localToday = (now, timeZone = TIME_ZONE) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const dbDate = (iso) => new Date(`${iso}T00:00:00Z`);
const round = (x, places) => Number(x.toFixed(places));

/** 0 up to 1, the same for the same text, so a date always gives the same values. */
function hash01(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ─── Plans ───────────────────────────────────────────────────────────────────

const FARMERS_CARRY = "Farmer's Carry (demo)";
// [name, sets, repsMin, repsMax, starting pounds, pounds added at each step]. Weight 0 means bodyweight.
const PLANS = [
  { key: "ua", name: "Upper Body A", notes: "Heavier pressing and rowing.", exercises: [["Barbell Bench Press", 4, 6, 8, 155, 5], ["Barbell Row", 4, 6, 10, 135, 5], ["Overhead Press", 3, 6, 10, 85, 5], ["Lat Pulldown", 3, 8, 12, 120, 5], ["Triceps Pushdown", 3, 10, 12, 50, 5]] },
  { key: "la", name: "Lower Body A", notes: "Squat focus.", exercises: [["Back Squat", 4, 5, 8, 205, 5], ["Romanian Deadlift", 3, 8, 10, 155, 5], ["Leg Press", 3, 10, 12, 270, 10], ["Seated Leg Curl", 3, 10, 12, 90, 5], ["Standing Calf Raise", 3, 12, 15, 110, 5]] },
  { key: "ub", name: "Upper Body B", notes: "More volume, with dumbbells.", exercises: [["Dumbbell Incline Press", 4, 8, 10, 50, 5], ["Seated Cable Row", 4, 8, 12, 120, 5], ["Seated Dumbbell Shoulder Press", 3, 8, 10, 40, 5], ["Pull-Up", 3, 6, 10, 0, 0], ["Dumbbell Curl", 3, 10, 12, 25, 5]] },
  { key: "lb", name: "Lower Body B", notes: "Deadlift focus, and a carry.", exercises: [["Deadlift", 3, 4, 6, 245, 10], ["Bulgarian Split Squat", 3, 8, 10, 35, 5], ["Leg Extension", 3, 10, 12, 90, 5], ["Lying Leg Curl", 3, 10, 12, 80, 5], [FARMERS_CARRY, 3, 1, 1, 60, 5]] },
];
// Monday, Tuesday, Thursday and Saturday. Wednesday, Friday and Sunday are recovery days.
const SCHEDULE = { 0: "ua", 1: "la", 3: "ub", 5: "lb" };

// ─── Foods ───────────────────────────────────────────────────────────────────

// [slug, name, basis, serving label, serving amount, kcal, protein, carbs, fat, fiber] per 100 g or ml. null means not reported.
const FOODS = [
  ["oats", "Rolled oats (demo)", "G", "1/2 cup dry", 40, 379, 13, 68, 6.5, 10],
  ["whey", "Whey protein powder (demo)", "G", "1 scoop", 30, 400, 80, 7, 6, 0],
  ["banana", "Banana (demo)", "G", "1 medium", 118, 89, 1.1, 22.8, 0.3, 2.6],
  ["yogurt", "Plain Greek yogurt (demo)", "G", "1 container", 170, 59, 10, 3.6, 0.4, 0],
  ["egg", "Whole egg (demo)", "G", "1 large", 50, 143, 12.6, 0.7, 9.5, 0],
  ["toast", "Whole wheat toast (demo)", "G", "1 slice", 40, 265, 13, 43, 4, 6],
  ["chicken", "Chicken breast, cooked (demo)", "G", "1 portion", 150, 165, 31, 0, 3.6, 0],
  ["rice", "White rice, cooked (demo)", "G", "1 cup", 158, 130, 2.7, 28, 0.3, 0.4],
  ["broccoli", "Broccoli, cooked (demo)", "G", "1 cup", 100, 35, 2.4, 7, 0.4, 3.3],
  ["salmon", "Salmon, cooked (demo)", "G", "1 fillet", 150, 208, 20, 0, 13, 0],
  ["potato", "Sweet potato, baked (demo)", "G", "1 medium", 130, 90, 2, 20.7, 0.2, 3.3],
  ["oil", "Olive oil (demo)", "G", "1 tablespoon", 14, 884, 0, 0, 100, 0],
  ["almonds", "Almonds (demo)", "G", "1 handful", 28, 579, 21, 22, 50, 12.5],
  ["apple", "Apple (demo)", "G", "1 medium", 180, 52, 0.3, 14, 0.2, 2.4],
  ["milk", "Whole milk (demo)", "ML", "1 cup", 240, 64, 3.3, 4.8, 3.6, 0],
  // Reports only calories and protein, so a day with it is partly known.
  ["bar", "Cafe protein bar, label partly known (demo)", "G", "1 bar", 60, 380, 30, null, null, null],
  // Reports nothing, so its amounts are unknown, and never 0.
  ["chili", "Homemade chili, not measured (demo)", "G", "1 bowl", 350, null, null, null, null, null],
];
const BREAKFASTS = [[["oats", 1], ["whey", 1], ["banana", 1], ["milk", 1]], [["egg", 3], ["toast", 2], ["yogurt", 1]], [["yogurt", 1], ["oats", 1], ["apple", 1], ["whey", 1]]];
const LUNCHES = [[["chicken", 1], ["rice", 1], ["broccoli", 1]], [["chicken", 1.5], ["potato", 1], ["broccoli", 1], ["oil", 1]]];
const DINNERS = [[["salmon", 1], ["potato", 1], ["broccoli", 1], ["oil", 1]], [["chicken", 1], ["rice", 1.5], ["broccoli", 1]]];
const SNACKS = [[["almonds", 1], ["apple", 1]], [["banana", 1], ["yogurt", 1]]];

// ─── Gyms (multi-gym) ────────────────────────────────────────────────────────

// Only on a database with the multi-gym migration. Workouts from this date are at a gym: Upper Body B at home, the rest
// at City Gym, where the lat pulldown and leg press are named machines with their own history. Earlier workouts have no
// gym, as real ones from before gyms existed don't. The first Upper Body A from this date has a swap partway: two bench
// sets, then dumbbell bench press for the rest.
const GYMS_FROM = "2026-10-19";
const GYMS = [
  { id: "demo-gym-city", name: "City Gym", kinds: ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT"] },
  { id: "demo-gym-home", name: "Home gym", kinds: ["DUMBBELL", "CABLE", "BODYWEIGHT", "BAND"] },
];
const MACHINES = [
  { id: "demo-machine-pulldown", gymId: "demo-gym-city", kind: "CABLE", name: "Lat pulldown station", exercise: "Lat Pulldown" },
  { id: "demo-machine-legpress", gymId: "demo-gym-city", kind: "MACHINE", name: "Plate-loaded leg press", exercise: "Leg Press" },
];
const SWAP = { plan: "demo-plan-ua", planned: "Barbell Bench Press", actual: "Dumbbell Bench Press", keptWorkingSets: 2 };

function gymRows(workouts, exerciseIdByName) {
  const missing = [SWAP.actual, ...MACHINES.map((m) => m.exercise)].filter((n) => !exerciseIdByName[n]);
  if (missing.length) throw new Error(`these exercises aren't on this database: ${missing.join(", ")}`);
  const gymLocation = GYMS.map((g) => ({ id: g.id, userId: DEMO_USER_ID, name: g.name }));
  const gymEquipment = [
    ...GYMS.flatMap((g) => g.kinds.map((kind) => ({ id: `${g.id}-kind-${kind}`, userId: DEMO_USER_ID, gymId: g.id, kind, name: null, exerciseId: null }))),
    ...MACHINES.map((m) => ({ id: m.id, userId: DEMO_USER_ID, gymId: m.gymId, kind: m.kind, name: m.name, exerciseId: exerciseIdByName[m.exercise] })),
  ];
  const dateOf = (sessionId) => sessionId.slice("demo-s-".length);
  const sessions = workouts.sessions.map((s) => (dateOf(s.id) < GYMS_FROM ? { ...s, gymLocationId: null } : { ...s, gymLocationId: s.templateId === "demo-plan-ub" ? "demo-gym-home" : "demo-gym-city" }));
  const gymOf = new Map(sessions.map((s) => [s.id, s.gymLocationId]));
  const machineFor = (se) => MACHINES.find((m) => exerciseIdByName[m.exercise] === se.exerciseId && m.gymId === gymOf.get(se.sessionId))?.id ?? null;
  let sessionExercises = workouts.sessionExercises.map((se) => ({ ...se, gymEquipmentId: machineFor(se), substitutesId: null, plannedExerciseId: null }));
  let sets = workouts.sets;

  const swapped = sessions.find((s) => s.gymLocationId && s.templateId === SWAP.plan);
  if (swapped) {
    const date = dateOf(swapped.id);
    const planned = sessionExercises.find((se) => se.sessionId === swapped.id && se.exerciseId === exerciseIdByName[SWAP.planned]);
    const own = sets.filter((x) => x.sessionExerciseId === planned.id);
    const working = own.filter((x) => !x.isWarmup);
    const moved = working.slice(SWAP.keptWorkingSets);
    const replacementId = `demo-se-${date}-swap`;
    sessionExercises = sessionExercises.flatMap((se) => {
      if (se.sessionId !== swapped.id) return [se];
      if (se.id !== planned.id) return [se.position > planned.position ? { ...se, position: se.position + 1 } : se];
      return [se, { id: replacementId, sessionId: swapped.id, exerciseId: exerciseIdByName[SWAP.actual], position: planned.position + 1, restSeconds: se.restSeconds, gymEquipmentId: null, substitutesId: planned.id, plannedExerciseId: planned.exerciseId }];
    });
    // Dumbbells per hand, rounded to a rack's 5 lb steps. Synthetic, for showing the app.
    const perHand = (kg) => toKg(Math.max(5, Math.round((kg / LB) * 0.35 / 5) * 5));
    sets = [
      ...sets.filter((x) => !moved.includes(x)),
      ...moved.map((x, i) => ({ ...x, id: `demo-set-${date}-swap-${i + 1}`, sessionExerciseId: replacementId, setNumber: i + 1, weightKg: perHand(x.weightKg), reps: Math.min(12, x.reps + 2) })),
    ];
  }
  return { gymLocation, gymEquipment, sessions, sessionExercises, sets };
}

// ─── Building the rows ───────────────────────────────────────────────────────

const pick = (list, key) => list[Math.floor(hash01(key) * list.length)];
const toKg = (lb) => round(lb * LB, 4);
const decimal = (v) => (v === null ? null : String(v));
const scaled = (per100, amount) => (per100 === null ? null : String(round((per100 * amount) / 100, 2)));

function profileRow() {
  return {
    userId: DEMO_USER_ID, name: DEMO_NAME, birthDate: dbDate("1992-04-18"), sex: "MALE", heightCm: 177.8, currentWeightKg: toKg(182),
    goalWeightKg: toKg(172), goal: "FAT_LOSS", activityLevel: "MODERATE", experience: "INTERMEDIATE", workoutDaysPerWeek: 4, unitSystem: "IMPERIAL", timezone: TIME_ZONE,
  };
}

function workoutRows(today, exerciseIdByName) {
  const out = { sessions: [], sessionExercises: [], sets: [] };
  const state = new Map();
  for (let date = HISTORY_FROM; date < today; date = addDays(date, 1)) {
    const key = SCHEDULE[weekdayOf(date)];
    if (!key || hash01(`missed ${date}`) < 0.08) continue; // A rest day, or a session someone missed.
    const plan = PLANS.find((p) => p.key === key);
    const startedAt = new Date(`${date}T23:00:00Z`); // About 6 or 7 in the evening, in the account's time zone.
    const minutes = 50 + Math.floor(hash01(`length ${date}`) * 25);
    const sessionId = `demo-s-${date}`;
    out.sessions.push({ id: sessionId, userId: DEMO_USER_ID, templateId: `demo-plan-${key}`, name: plan.name, status: "COMPLETED", startedAt, endedAt: new Date(startedAt.getTime() + minutes * 60_000), notes: hash01(`note ${date}`) < 0.15 ? "Felt strong today." : null });
    plan.exercises.forEach(([name, setCount, repsMin, repsMax, startLb, step], position) => {
      const s = state.get(name) ?? { lb: startLb, reps: repsMin + 1, seen: 0 };
      // Cycles through a heavier weight, more reps, the same, fewer reps, and more reps, so comparisons show each result.
      const phase = (s.seen + position) % 5;
      if (s.seen > 0) {
        if (phase === 0 && step > 0) { s.lb += step; s.reps = repsMin + 1; }
        else if (phase === 1 || phase === 4) s.reps = Math.min(repsMax, s.reps + 1);
        else if (phase === 3) s.reps = Math.max(repsMin, s.reps - 1);
      }
      s.seen++;
      state.set(name, s);
      const seId = `demo-se-${date}-${position}`;
      out.sessionExercises.push({ id: seId, sessionId, exerciseId: exerciseIdByName[name], position, restSeconds: position === 0 ? 150 : 90 });
      let setNumber = 0;
      if (position === 0 && s.lb > 0) {
        setNumber++;
        out.sets.push({ id: `demo-set-${date}-${position}-${setNumber}`, sessionExerciseId: seId, setNumber, reps: 8, weightKg: toKg(Math.round(s.lb * 0.5 / 5) * 5), isWarmup: true, rpe: null, createdAt: startedAt });
      }
      for (let i = 0; i < setCount; i++) {
        setNumber++;
        const last = i === setCount - 1;
        out.sets.push({ id: `demo-set-${date}-${position}-${setNumber}`, sessionExerciseId: seId, setNumber, reps: last ? Math.max(repsMin, s.reps - (repsMax > repsMin ? 1 : 0)) : s.reps, weightKg: toKg(s.lb), isWarmup: false, rpe: last ? 8.5 : 7.5, createdAt: startedAt });
      }
    });
  }
  return out;
}

function weightRows(today) {
  const out = [];
  for (let date = HISTORY_FROM; date <= today; date = addDays(date, 1)) {
    if (hash01(`weigh ${date}`) < 0.15 && date !== today) continue; // Someone doesn't weigh in every day.
    const drift = -0.065 * daysBetween(HISTORY_FROM, date);
    const noise = (hash01(`noise ${date}`) - 0.5) * 0.9;
    out.push({ id: `demo-w-${date}`, userId: DEMO_USER_ID, kind: "WEIGHT", date: dbDate(date), value: round(86.4 + drift + noise, 2) });
  }
  return out;
}

function foodRows() {
  const foods = [], servings = [];
  for (const [slug, name, basisUnit, label, amount, kcal, protein, carbs, fat, fiber] of FOODS) {
    const id = `demo-food-${slug}`;
    foods.push({ id, source: "CUSTOM", sourceId: id, userId: DEMO_USER_ID, name, basisUnit, kcalPer100: decimal(kcal), proteinPer100: decimal(protein), carbsPer100: decimal(carbs), fatPer100: decimal(fat), fiberPer100: decimal(fiber) });
    servings.push({ id: `demo-sv-${slug}`, foodId: id, label, amount: String(amount), isDefault: true, position: 0 });
  }
  return { foods, servings };
}

function entryRows(today) {
  const bySlug = new Map(FOODS.map((f) => [f[0], f]));
  const out = [];
  for (let date = NUTRITION_FROM; date <= today; date = addDays(date, 1)) {
    if (hash01(`no food ${date}`) < 0.07 && date !== today) continue; // Some days aren't logged.
    const unmeasured = hash01(`unknown day ${date}`) < 0.08 && date !== today; // A day logged only as something unmeasured.
    const meals = unmeasured
      ? [["DINNER", [["chili", 1]]]]
      : [
        ["BREAKFAST", pick(BREAKFASTS, `breakfast ${date}`)],
        ["LUNCH", pick(LUNCHES, `lunch ${date}`)],
        ...(date === today ? [] : [
          ["DINNER", hash01(`chili ${date}`) < 0.15 ? [["chili", 1], ["toast", 2]] : pick(DINNERS, `dinner ${date}`)],
          ["SNACK", hash01(`bar ${date}`) < 0.25 ? [["bar", 1]] : pick(SNACKS, `snack ${date}`)],
        ]),
      ];
    let n = 0;
    for (const [mealType, items] of meals) {
      for (const [slug, quantity] of items) {
        const [, name, basisUnit, label, amount, kcal, protein, carbs, fat, fiber] = bySlug.get(slug);
        const consumed = amount * quantity;
        n++;
        out.push({
          id: `demo-fe-${date}-${n}`, userId: DEMO_USER_ID, date: dbDate(date), mealType, foodId: `demo-food-${slug}`, foodName: name, basisUnit,
          kcalPer100: decimal(kcal), proteinPer100: decimal(protein), carbsPer100: decimal(carbs), fatPer100: decimal(fat), fiberPer100: decimal(fiber),
          servingLabel: label, servingAmount: String(amount), quantity: String(quantity),
          kcal: scaled(kcal, consumed), protein: scaled(protein, consumed), carbs: scaled(carbs, consumed), fat: scaled(fat, consumed), fiber: scaled(fiber, consumed),
        });
      }
    }
  }
  return out;
}

const TARGETS = [
  { id: "demo-target-1", userId: DEMO_USER_ID, effectiveFrom: dbDate(HISTORY_FROM), kcal: 2300, proteinG: 170, carbsG: 248, fatG: 70, source: "MANUAL" },
  { id: "demo-target-2", userId: DEMO_USER_ID, effectiveFrom: dbDate(NUTRITION_FROM), kcal: 2150, proteinG: 170, carbsG: 221, fatG: 65, source: "MANUAL" },
];

/**
 * Every row the account should hold as of `now`. `exerciseIdByName` maps the built-in exercises. `gyms` adds the
 * multi-gym rows, for a database whose schema has them.
 */
function buildDemoRows({ now, exerciseIdByName: builtIn, gyms = false }) {
  const today = localToday(now);
  const exerciseIdByName = { ...builtIn, [FARMERS_CARRY]: "demo-ex-carry" };
  const missing = PLANS.flatMap((p) => p.exercises.map((e) => e[0])).filter((name) => !exerciseIdByName[name]);
  if (missing.length) throw new Error(`these exercises aren't on this database: ${missing.join(", ")}`);
  const templates = PLANS.map((p) => ({ id: `demo-plan-${p.key}`, userId: DEMO_USER_ID, name: p.name, notes: p.notes }));
  const templateExercises = PLANS.flatMap((p) => p.exercises.map(([name, targetSets, targetRepsMin, targetRepsMax, lb], position) => ({
    id: `demo-te-${p.key}-${position}`, templateId: `demo-plan-${p.key}`, exerciseId: exerciseIdByName[name], position, targetSets, targetRepsMin, targetRepsMax, targetWeightKg: lb > 0 ? toKg(lb) : null, restSeconds: position === 0 ? 150 : 90,
  })));
  const scheduleSlots = Object.entries(SCHEDULE).map(([weekday, key]) => ({ id: `demo-slot-${weekday}`, userId: DEMO_USER_ID, weekday: Number(weekday), templateId: `demo-plan-${key}`, position: 0 }));
  const workouts = workoutRows(today, exerciseIdByName);
  const { sessions, sessionExercises, sets, gymLocation, gymEquipment } = gyms ? gymRows(workouts, exerciseIdByName) : workouts;
  const { foods, servings } = foodRows();
  return {
    today,
    rows: {
      profile: [profileRow()],
      exercise: [{ id: "demo-ex-carry", userId: DEMO_USER_ID, name: FARMERS_CARRY, primaryMuscle: "FULL_BODY", equipment: "DUMBBELL" }],
      workoutTemplate: templates,
      templateExercise: templateExercises,
      scheduleSlot: scheduleSlots,
      nutritionTarget: TARGETS,
      food: foods,
      foodServing: servings,
      foodEntry: entryRows(today),
      ...(gyms ? { gymLocation, gymEquipment } : {}),
      workoutSession: sessions,
      sessionExercise: sessionExercises,
      setEntry: sets,
      bodyMetric: weightRows(today),
    },
  };
}

module.exports = { DEMO_NAME, DEMO_EMAIL, DEMO_USER_ID, TIME_ZONE, HISTORY_FROM, NUTRITION_FROM, GYMS_FROM, GYMS, MACHINES, SWAP, PLANS, SCHEDULE, FOODS, FARMERS_CARRY, addDays, localToday, buildDemoRows };
