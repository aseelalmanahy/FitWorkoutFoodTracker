// The 10 QA fixture accounts, as data. No database, network or file access here, so it can be tested alone.
// Everything comes from a seeded generator and a given time, so the same inputs give the same rows.
//
// These values are SYNTHETIC. The foods are made up for testing, and aren't a nutrition reference. Nothing derived is
// stored: records, volume and weekly stats are left for the app to calculate. A food entry's totals are stored
// because the app stores them when it logs an entry, and a missing value stays null, never 0.
"use strict";

const KCAL_PER_G = { protein: 4, fat: 9, carbs: 4 }; // as src/lib/nutrition.ts
const day = (iso, delta) => new Date(Date.parse(`${iso}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (iso) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 is Monday, as ScheduleSlot
const round = (x, places) => Number(x.toFixed(places));

function seeded(seed) {
  let a = seed >>> 0;
  return () => { // mulberry32
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const localToday = (now, timeZone) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

// [name, sets, repsMin, repsMax, startingKg, kg gained per week]. Weight 0 means bodyweight.
const PUSH = [["Barbell Bench Press", 4, 5, 8, 70, 0.5], ["Overhead Press", 3, 6, 10, 40, 0.25], ["Dumbbell Lateral Raise", 3, 10, 15, 8, 0.05], ["Triceps Pushdown", 3, 10, 12, 25, 0.1]];
const PULL = [["Deadlift", 3, 3, 6, 120, 0.75], ["Barbell Row", 4, 6, 10, 65, 0.4], ["Lat Pulldown", 3, 8, 12, 55, 0.25], ["Barbell Curl", 3, 8, 12, 30, 0.1]];
const LEGS = [["Back Squat", 4, 4, 8, 100, 0.75], ["Romanian Deadlift", 3, 6, 10, 80, 0.5], ["Leg Press", 3, 10, 12, 160, 1], ["Standing Calf Raise", 3, 10, 15, 60, 0.25]];
const FULL = [["Dumbbell Bench Press", 3, 8, 12, 22, 0.1], ["Seated Cable Row", 3, 8, 12, 45, 0.2], ["Leg Press", 3, 10, 12, 100, 0.5], ["Plank", 2, 1, 1, 0, 0]];
const SHORT_A = [["Dumbbell Bench Press", 3, 8, 10, 28, 0.1], ["One-Arm Dumbbell Row", 3, 8, 10, 30, 0.1]];
const SHORT_B = [["Kettlebell Swing", 3, 15, 20, 24, 0]];
const HOME_A = [["Push-Up", 4, 10, 25, 0, 0], ["QA Band Pull-Apart", 3, 12, 20, 0, 0], ["Plank", 3, 1, 1, 0, 0]];
const HOME_B = [["Chin-Up", 3, 4, 10, 0, 0], ["QA Band Squat", 3, 12, 20, 0, 0], ["Hanging Leg Raise", 3, 8, 15, 0, 0]];
const BEGINNER = [["Machine Chest Press", 2, 10, 12, 20, 0.5], ["Lat Pulldown", 2, 10, 12, 25, 0.5], ["Leg Press", 2, 10, 12, 50, 1]];

// Weekdays use 0 for Monday. Each program's plans are `plans`, and `schedule` maps a weekday to a plan's index.
const FIXTURE_ACCOUNTS = Object.freeze([
  {
    n: 1, slug: "beginner", name: "Avery Stone (QA fixture)", timeZone: "UTC", utcOffset: 0, units: "METRIC",
    scenario: "Beginner, with minimal training experience. Incomplete profile, 3 workouts, no food entries, no targets",
    expected: "Profile with stored fields empty. Short history. Nutrition, targets and trends in their empty states",
    profile: { birthDate: "1999-03-14" }, // only what the form requires, so nothing else is invented
    plans: [["QA Beginner Full Body", BEGINNER]], schedule: { 1: 0, 4: 0 }, spans: [[12, 1]], attendance: 1, sessionsCap: 3, minutes: [35, 45],
  },
  {
    n: 2, slug: "intermediate", name: "Blake Rivera (QA fixture)", timeZone: "America/New_York", utcOffset: -5, units: "IMPERIAL",
    scenario: "Intermediate, with consistent workouts for 8 weeks. Food logged on some days, one full target",
    expected: "Regular history, a weekly schedule and early records. Partial nutrition history, with days not logged",
    profile: { birthDate: "1991-07-02", sex: "FEMALE", heightCm: 168, currentWeightKg: 66, goal: "STRENGTH", activityLevel: "MODERATE", experience: "INTERMEDIATE", workoutDaysPerWeek: 3 },
    plans: [["QA Intermediate Upper", PUSH.slice(0, 3)], ["QA Intermediate Lower", LEGS.slice(0, 3)]], schedule: { 0: 0, 2: 1, 4: 0 }, spans: [[56, 1]], attendance: 0.9, minutes: [50, 70],
    nutrition: { days: 56, rate: 0.5 }, targets: [{ daysAgo: 56, kcal: 2100, protein: 130, fat: 70 }],
  },
  {
    n: 3, slug: "advanced", name: "Casey Nguyen (QA fixture)", timeZone: "Europe/Berlin", utcOffset: 1, units: "METRIC",
    scenario: "Advanced, with 6 months of detailed strength training, warm-ups, RPE and rising weights",
    expected: "Many records, full exercise details, long pages of history. Light food logging, protein and fat targets",
    profile: { birthDate: "1988-11-23", sex: "MALE", heightCm: 183, currentWeightKg: 88, goalWeightKg: 90, goal: "STRENGTH", activityLevel: "ACTIVE", experience: "ADVANCED", workoutDaysPerWeek: 4 },
    plans: [["QA Advanced Push", PUSH], ["QA Advanced Pull", PULL], ["QA Advanced Legs", LEGS]], schedule: { 0: 0, 1: 1, 3: 2, 5: 0 }, spans: [[182, 1]], attendance: 0.92, minutes: [70, 100], rpe: true,
    nutrition: { days: 60, rate: 0.4 }, targets: [{ daysAgo: 60, kcal: 3000, protein: 190, fat: 90 }],
  },
  {
    n: 4, slug: "weight-loss", name: "Dana Okafor (QA fixture)", timeZone: "America/New_York", utcOffset: -5, units: "IMPERIAL",
    scenario: "Weight loss, with daily calorie tracking for 8 weeks and no workouts",
    expected: "Nutrition history, weekly averages and targets populated. Workouts, history and progress in their empty states",
    profile: { birthDate: "1985-05-30", sex: "FEMALE", heightCm: 165, currentWeightKg: 82, goalWeightKg: 70, goal: "FAT_LOSS", activityLevel: "LIGHT", experience: "BEGINNER", workoutDaysPerWeek: 0 },
    plans: [], schedule: {}, spans: [],
    nutrition: { days: 56, rate: 0.95, today: true }, targets: [{ daysAgo: 56, kcal: 1700, protein: 110, fat: 55 }, { daysAgo: 21, kcal: 1600, protein: 115, fat: 50 }],
  },
  {
    n: 5, slug: "muscle-building", name: "Elliot Marsh (QA fixture)", timeZone: "UTC", utcOffset: 0, units: "METRIC",
    scenario: "Muscle building, with 4 months of strength progress and food logging",
    expected: "Rising weights, overload badges, records, and a target raised over time",
    profile: { birthDate: "1996-01-09", sex: "MALE", heightCm: 178, currentWeightKg: 76, goalWeightKg: 82, goal: "MUSCLE_GAIN", activityLevel: "ACTIVE", experience: "INTERMEDIATE", workoutDaysPerWeek: 4 },
    plans: [["QA Muscle Push", PUSH], ["QA Muscle Pull", PULL], ["QA Muscle Legs", LEGS]], schedule: { 0: 0, 1: 1, 3: 2, 4: 0 }, spans: [[122, 1]], attendance: 0.9, minutes: [60, 85],
    nutrition: { days: 100, rate: 0.75, today: true }, targets: [{ daysAgo: 100, kcal: 2800, protein: 160, fat: 80 }, { daysAgo: 40, kcal: 3000, protein: 170, fat: 85 }],
  },
  {
    n: 6, slug: "maintenance", name: "Finley Park (QA fixture)", timeZone: "Europe/Berlin", utcOffset: 1, units: "METRIC",
    scenario: "Maintenance, with a stable routine for 12 weeks. A target stopped 3 weeks ago, with food still logged",
    expected: "Steady weights with no false progress. Targets page says none in use, and history shows Stopped",
    profile: { birthDate: "1979-09-17", sex: "FEMALE", heightCm: 171, currentWeightKg: 64, goal: "MAINTENANCE", activityLevel: "MODERATE", experience: "INTERMEDIATE", workoutDaysPerWeek: 2 },
    plans: [["QA Maintenance Full Body", FULL.map((e) => [...e.slice(0, 5), 0])]], schedule: { 1: 0, 4: 0 }, spans: [[84, 1]], attendance: 0.9, minutes: [45, 55],
    nutrition: { days: 70, rate: 0.6 }, targets: [{ daysAgo: 70, kcal: 2000, protein: 110, fat: 65 }, { daysAgo: 21, stop: true }],
  },
  {
    n: 7, slug: "busy-professional", name: "Gray Sato (QA fixture)", timeZone: "Pacific/Auckland", utcOffset: 13, units: "METRIC",
    scenario: "Busy professional, with short sessions of 1 or 2 exercises for 6 weeks, in a time zone far ahead of UTC. A calories-only target",
    expected: "Short sessions and durations. Macro targets shown as not set. Dates correct for the time zone",
    profile: { birthDate: "1983-12-05", sex: "MALE", heightCm: 175, goal: "MAINTENANCE", experience: "BEGINNER", workoutDaysPerWeek: 3 },
    plans: [["QA Quick Press And Row", SHORT_A], ["QA Quick Swing", SHORT_B]], schedule: { 0: 0, 2: 1, 4: 0 }, spans: [[42, 1]], attendance: 0.8, minutes: [15, 25],
    nutrition: { days: 42, rate: 0.35 }, targets: [{ daysAgo: 42, kcal: 2400 }],
  },
  {
    n: 8, slug: "home-workouts", name: "Harper Lind (QA fixture)", timeZone: "UTC", utcOffset: 0, units: "IMPERIAL",
    scenario: "Home workouts, with bodyweight and band exercises for 10 weeks, including custom exercises. No food entries",
    expected: "Weight 0 shown as bodyweight, and rep-based progress. Custom exercises visible only to this account. Nutrition empty",
    profile: { birthDate: "1994-04-21", sex: "FEMALE", heightCm: 160, currentWeightKg: 58, goal: "MAINTENANCE", activityLevel: "LIGHT", experience: "BEGINNER", workoutDaysPerWeek: 3 },
    custom: [["QA Band Pull-Apart", "SHOULDERS", "BAND"], ["QA Band Squat", "QUADS", "BAND"]],
    plans: [["QA Home Push And Core", HOME_A], ["QA Home Pull And Legs", HOME_B]], schedule: { 0: 0, 2: 1, 4: 0 }, spans: [[70, 1]], attendance: 0.85, minutes: [25, 40],
  },
  {
    n: 9, slug: "returning-user", name: "Indigo Vance (QA fixture)", timeZone: "America/New_York", utcOffset: -5, units: "IMPERIAL",
    scenario: "Returning user, who trained, stopped for about 10 weeks, and came back 3 weeks ago. A target stopped, then restarted",
    expected: "A clear gap in history, lower weights on return, no false records. Target history showing the stop and the restart",
    profile: { birthDate: "1990-08-11", sex: "MALE", heightCm: 180, currentWeightKg: 84, goal: "FAT_LOSS", activityLevel: "LIGHT", experience: "INTERMEDIATE", workoutDaysPerWeek: 3 },
    plans: [["QA Returning Full Body", FULL]], schedule: { 0: 0, 2: 0, 4: 0 }, spans: [[120, 70], [21, 1]], attendance: 0.9, minutes: [40, 55], detrain: 0.8,
    nutrition: { days: 120, rate: 0.5, gap: [70, 21] }, targets: [{ daysAgo: 120, kcal: 2300, protein: 140, fat: 70 }, { daysAgo: 70, stop: true }, { daysAgo: 21, kcal: 2200, protein: 150, fat: 65 }],
  },
  {
    n: 10, slug: "long-term", name: "Jordan Ellis (QA fixture)", timeZone: "Europe/Berlin", utcOffset: 1, units: "METRIC",
    scenario: "Long-term user, with 18 months of records, target changes, and a workout in progress",
    expected: "Large history across many pages, long exercise details and an in-progress workout. Pages stay usable",
    profile: { birthDate: "1981-02-26", sex: "FEMALE", heightCm: 170, currentWeightKg: 68, goalWeightKg: 65, goal: "STRENGTH", activityLevel: "VERY_ACTIVE", experience: "ADVANCED", workoutDaysPerWeek: 4 },
    plans: [["QA Long-Term Push", PUSH], ["QA Long-Term Pull", PULL], ["QA Long-Term Legs", LEGS], ["QA Long-Term Full Body", FULL]], schedule: { 0: 0, 1: 1, 3: 2, 5: 3 }, spans: [[548, 1]], attendance: 0.85, minutes: [60, 90], rpe: true, inProgress: true,
    nutrition: { days: 548, rate: 0.7, today: true },
    targets: [{ daysAgo: 548, kcal: 2200, protein: 120, fat: 70 }, { daysAgo: 450, kcal: 2100, protein: 125, fat: 65 }, { daysAgo: 360, kcal: 2300, protein: 130, fat: 70 }, { daysAgo: 270, kcal: 2200 }, { daysAgo: 200, stop: true }, { daysAgo: 150, kcal: 2250, protein: 135, fat: 70 }, { daysAgo: 60, kcal: 2200, protein: 140, fat: 65 }],
  },
].map((a) => Object.freeze({ ...a, email: `qa-fixture-${String(a.n).padStart(2, "0")}-${a.slug}@test.dev`, userId: `qafx${String(a.n).padStart(2, "0")}-user` })));

/** Frozen, so cleanup matches exact addresses, and never a pattern. */
const FIXTURE_EMAILS = Object.freeze(FIXTURE_ACCOUNTS.map((a) => a.email));

// Serving is [label, grams or ml]. Null means this value isn't known, and it stays null.
const FOODS = [
  { slug: "oats", name: "QA Oats", basis: "G", per100: [380, 13, 66, 7, 10], serving: ["1 bowl (60 g)", 60], meals: ["BREAKFAST"] },
  { slug: "milk", name: "QA Semi-Skimmed Milk", basis: "ML", per100: [47, 3.4, 4.8, 1.7, null], serving: ["1 glass (250 ml)", 250], meals: ["BREAKFAST", "SNACK"] },
  { slug: "eggs", name: "QA Eggs", basis: "G", per100: [143, 12.6, 0.7, 9.5, 0], serving: ["2 eggs (100 g)", 100], meals: ["BREAKFAST"] },
  { slug: "chicken", name: "QA Chicken Breast", basis: "G", per100: [165, 31, 0, 3.6, 0], serving: ["1 portion (150 g)", 150], meals: ["LUNCH", "DINNER"] },
  { slug: "rice", name: "QA Cooked Rice", basis: "G", per100: [130, 2.7, 28, 0.3, 0.4], serving: ["1 cup (160 g)", 160], meals: ["LUNCH", "DINNER"] },
  { slug: "salmon", name: "QA Salmon", basis: "G", per100: [208, 20, 0, 13, 0], serving: ["1 fillet (120 g)", 120], meals: ["DINNER"] },
  { slug: "broccoli", name: "QA Broccoli", basis: "G", per100: [35, 2.4, 7.2, 0.4, 3.3], serving: ["1 portion (90 g)", 90], meals: ["LUNCH", "DINNER"] },
  { slug: "yogurt", name: "QA Greek Yogurt", basis: "G", per100: [97, 9, 3.9, 5, null], serving: ["1 pot (170 g)", 170], meals: ["BREAKFAST", "SNACK"] },
  { slug: "banana", name: "QA Banana", basis: "G", per100: [89, 1.1, 23, 0.3, 2.6], serving: ["1 medium (118 g)", 118], meals: ["SNACK"] },
  { slug: "soup", name: "QA Homemade Soup", basis: "ML", per100: [45, null, null, null, null], serving: ["1 bowl (300 ml)", 300], meals: ["LUNCH"] }, // calories known, the rest missing
];

const dec = (x, places) => (x === null ? null : x.toFixed(places));

function buildFoods(a, nn) {
  const foods = [], servings = [];
  FOODS.forEach((f, i) => {
    const id = `qafx${nn}-food-${f.slug}`;
    const [kcal, protein, carbs, fat, fiber] = f.per100;
    foods.push({
      id, source: "CUSTOM", sourceId: `qa-fixture-${nn}-${f.slug}`, userId: a.userId, name: f.name, dataType: "Custom", basisUnit: f.basis,
      kcalPer100: dec(kcal, 3), proteinPer100: dec(protein, 3), carbsPer100: dec(carbs, 3), fatPer100: dec(fat, 3), fiberPer100: dec(fiber, 3),
    });
    servings.push({ id: `qafx${nn}-srv-${i}a`, foodId: id, label: f.serving[0], amount: dec(f.serving[1], 3), isDefault: true, position: 0 });
    if (f.serving[1] !== 100) servings.push({ id: `qafx${nn}-srv-${i}b`, foodId: id, label: `100 ${f.basis === "ML" ? "ml" : "g"}`, amount: "100.000", isDefault: false, position: 1 });
  });
  return { foods, servings };
}

function buildEntries(a, nn, today, rand) {
  const out = [];
  const nut = a.nutrition;
  if (!nut) return out;
  const mealChoices = { BREAKFAST: 1, LUNCH: 2, DINNER: 2, SNACK: 1 };
  for (let ago = nut.days - 1; ago >= (nut.today ? 0 : 1); ago--) {
    if (rand() > nut.rate) continue;
    if (nut.gap && ago < nut.gap[0] && ago > nut.gap[1]) continue;
    const date = day(today, -ago);
    for (const [meal, count] of Object.entries(mealChoices)) {
      if (meal === "SNACK" && rand() < 0.5) continue;
      if (ago === 0 && meal !== "BREAKFAST") continue; // today so far
      const options = FOODS.filter((f) => f.meals.includes(meal));
      for (let k = 0; k < count; k++) {
        const f = options[Math.floor(rand() * options.length)];
        // Most by serving, and some by raw amount, stored as the app stores it: a 1 g or 1 ml serving, with the amount as quantity.
        const raw = rand() < 0.12;
        const servingLabel = raw ? (f.basis === "ML" ? "ml" : "g") : f.serving[0];
        const servingAmount = raw ? 1 : f.serving[1];
        const quantity = raw ? Math.round(40 + rand() * 200) : [0.5, 1, 1, 1, 1.5, 2][Math.floor(rand() * 6)];
        const total = (per) => (per === null ? null : round((per * servingAmount * quantity) / 100, 2));
        const [kcal, protein, carbs, fat, fiber] = f.per100;
        out.push({
          id: `qafx${nn}-ent-${out.length}`, userId: a.userId, date: new Date(`${date}T00:00:00Z`), mealType: meal, foodId: `qafx${nn}-food-${f.slug}`, foodName: f.name, basisUnit: f.basis,
          kcalPer100: dec(kcal, 3), proteinPer100: dec(protein, 3), carbsPer100: dec(carbs, 3), fatPer100: dec(fat, 3), fiberPer100: dec(fiber, 3),
          servingLabel, servingAmount: dec(servingAmount, 3), quantity: dec(quantity, 3),
          kcal: dec(total(kcal), 2), protein: dec(total(protein), 2), carbs: dec(total(carbs), 2), fat: dec(total(fat), 2), fiber: dec(total(fiber), 2),
          createdAt: new Date(`${date}T12:00:00Z`),
        });
      }
    }
  }
  return out;
}

function buildTargets(a, nn, today) {
  return (a.targets ?? []).map((t, i) => {
    const base = { id: `qafx${nn}-tgt-${i}`, userId: a.userId, effectiveFrom: new Date(`${day(today, -t.daysAgo)}T00:00:00Z`), source: "MANUAL" };
    if (t.stop) return { ...base, kcal: null, proteinG: null, carbsG: null, fatG: null };
    if (t.protein === undefined) return { ...base, kcal: t.kcal, proteinG: null, carbsG: null, fatG: null };
    const rest = t.kcal - t.protein * KCAL_PER_G.protein - t.fat * KCAL_PER_G.fat;
    return { ...base, kcal: t.kcal, proteinG: t.protein, fatG: t.fat, carbsG: Math.floor(rest / KCAL_PER_G.carbs) };
  });
}

function buildAccount(a, { now, exerciseIdByName }) {
  const nn = String(a.n).padStart(2, "0");
  const rand = seeded(1000 + a.n);
  const today = localToday(now, a.timeZone);
  const atLocal = (date, hour) => new Date(Date.parse(`${date}T00:00:00Z`) + (hour - a.utcOffset) * 3_600_000);
  const oldestDay = Math.max(30, ...a.spans.map(([from]) => from), a.nutrition?.days ?? 0, ...(a.targets ?? []).map((t) => t.daysAgo));
  const joined = atLocal(day(today, -oldestDay - 1), 9);

  const customExercises = (a.custom ?? []).map(([name, primaryMuscle, equipment], i) => ({ id: `qafx${nn}-ex-${i}`, userId: a.userId, name, primaryMuscle, equipment, createdAt: joined }));
  const idOf = (name) => {
    const own = customExercises.find((e) => e.name === name);
    const id = own?.id ?? exerciseIdByName[name];
    if (!id) throw new Error(`no exercise named ${name}`);
    return id;
  };

  const templates = [], templateExercises = [];
  a.plans.forEach(([name, list], p) => {
    const templateId = `qafx${nn}-tpl-${p}`;
    templates.push({ id: templateId, userId: a.userId, name, createdAt: joined });
    list.forEach(([exercise, sets, min, max, kg], position) => templateExercises.push({
      id: `${templateId}-ex-${position}`, templateId, exerciseId: idOf(exercise), position, targetSets: sets, targetRepsMin: min, targetRepsMax: max, targetWeightKg: kg > 0 ? kg : null, restSeconds: kg > 50 ? 180 : 90,
    }));
  });

  // Positions count from 0 within a weekday. Each weekday here holds one plan.
  const slots = Object.entries(a.schedule).map(([weekday, plan], i) => ({ id: `qafx${nn}-slot-${i}`, userId: a.userId, weekday: Number(weekday), templateId: templates[plan].id, position: 0 }));

  const sessions = [], sessionExercises = [], sets = [];
  const addSession = (date, plan, { status = "COMPLETED", startedAt, weeksIn, factor = 1 }) => {
    const [name, list] = a.plans[plan];
    const id = `qafx${nn}-ses-${sessions.length}`;
    const start = startedAt ?? atLocal(date, 7 + Math.floor(rand() * 12));
    const [lo, hi] = a.minutes;
    const minutes = lo + Math.floor(rand() * (hi - lo + 1));
    sessions.push({ id, userId: a.userId, templateId: templates[plan].id, name, status, startedAt: start, endedAt: status === "COMPLETED" ? new Date(start.getTime() + minutes * 60_000) : null });
    const items = status === "COMPLETED" ? list : list.slice(0, 1);
    items.forEach(([exercise, setCount, min, max, kg, gain], position) => {
      const seId = `${id}-ex-${position}`;
      sessionExercises.push({ id: seId, sessionId: id, exerciseId: idOf(exercise), position, restSeconds: kg > 50 ? 180 : 90 });
      const working = kg > 0 ? Math.max(2.5, Math.round(((kg + gain * weeksIn) * factor) / 2.5) * 2.5) : 0;
      let number = 1;
      const stamp = () => new Date(start.getTime() + number * 150_000);
      if (position === 0 && kg > 40) sets.push({ id: `${seId}-s${number}`, sessionExerciseId: seId, setNumber: number, reps: 8, weightKg: Math.round((working * 0.5) / 2.5) * 2.5, isWarmup: true, rpe: null, createdAt: stamp() }), number++;
      for (let k = 0; k < (status === "COMPLETED" ? setCount : 1); k++) {
        // Hold time isn't a stored field, so a plank is logged as 1 rep. Reps fall a little across the sets.
        const reps = max === min ? max : Math.max(min, max - k - Math.floor(rand() * 3));
        sets.push({ id: `${seId}-s${number}`, sessionExerciseId: seId, setNumber: number, reps, weightKg: working, isWarmup: false, rpe: a.rpe ? 6 + Math.floor(rand() * 8) / 2 : null, createdAt: stamp() });
        number++;
      }
    });
  };

  if (a.plans.length) {
    const firstDay = Math.max(...a.spans.map(([from]) => from));
    for (const [spanIndex, [from, to]] of a.spans.entries()) {
      for (let ago = from; ago >= to; ago--) {
        const date = day(today, -ago);
        const plan = a.schedule[weekdayOf(date)];
        if (plan === undefined || rand() > a.attendance) continue;
        if (a.sessionsCap && sessions.length >= a.sessionsCap) continue;
        addSession(date, plan, { weeksIn: (firstDay - ago) / 7, factor: spanIndex > 0 ? (a.detrain ?? 1) : 1 });
      }
    }
    if (a.inProgress) addSession(today, 0, { status: "IN_PROGRESS", startedAt: new Date(now.getTime() - 40 * 60_000), weeksIn: firstDay / 7 });
  }

  const { foods, servings } = a.nutrition ? buildFoods(a, nn) : { foods: [], servings: [] };
  return {
    user: { id: a.userId, email: a.email, createdAt: joined },
    profile: { userId: a.userId, name: a.name, birthDate: new Date(`${a.profile.birthDate}T00:00:00Z`), sex: a.profile.sex ?? null, heightCm: a.profile.heightCm ?? null, currentWeightKg: a.profile.currentWeightKg ?? null, goalWeightKg: a.profile.goalWeightKg ?? null, goal: a.profile.goal ?? null, activityLevel: a.profile.activityLevel ?? null, experience: a.profile.experience ?? null, workoutDaysPerWeek: a.profile.workoutDaysPerWeek ?? null, unitSystem: a.units, timezone: a.timeZone },
    exercises: customExercises, templates, templateExercises, slots, sessions, sessionExercises, sets, foods, servings,
    entries: buildEntries(a, nn, today, rand), targets: buildTargets(a, nn, today),
  };
}

/** The order rows must be written in, so that each one's references exist. */
const WRITE_ORDER = [["exercise", "exercises"], ["workoutTemplate", "templates"], ["templateExercise", "templateExercises"], ["scheduleSlot", "slots"], ["workoutSession", "sessions"], ["sessionExercise", "sessionExercises"], ["setEntry", "sets"], ["food", "foods"], ["foodServing", "servings"], ["foodEntry", "entries"], ["nutritionTarget", "targets"]];

/** How many rows each account owns, in each model. A row that isn't owned by these accounts can't match. */
const OWNED_WHERE = (ids, emails) => ({
  User: { id: { in: ids } }, Session: { userId: { in: ids } }, AccountToken: { OR: [{ userId: { in: ids } }, { email: { in: emails } }] }, Profile: { userId: { in: ids } },
  Exercise: { userId: { in: ids } }, WorkoutTemplate: { userId: { in: ids } }, TemplateExercise: { template: { userId: { in: ids } } }, ScheduleSlot: { userId: { in: ids } },
  WorkoutSession: { userId: { in: ids } }, SessionExercise: { session: { userId: { in: ids } } }, SetEntry: { sessionExercise: { session: { userId: { in: ids } } } },
  Food: { userId: { in: ids } }, FoodServing: { food: { userId: { in: ids } } }, FoodEntry: { userId: { in: ids } }, NutritionTarget: { userId: { in: ids } },
});

module.exports = { FIXTURE_ACCOUNTS, FIXTURE_EMAILS, FOODS, WRITE_ORDER, OWNED_WHERE, buildAccount, localToday, KCAL_PER_G };
