// Independent oracle for USDA "missing nutrients stay null" (live check USDA-6).
// Pure functions; unit-tested. Given a RAW USDA FoodData Central /food/{id} response, it
// decides per nutrient whether the value is genuinely ABSENT, a reported ZERO, or PRESENT,
// then compares that with the per-100 values the app returned:
//   absent  → the app must return null (never 0, never a fabricated value)
//   zero    → the app must return 0 (zero is a real value, not "missing")
//   present → the app must return the same number (±0.001), unless the value is physically
//             implausible (then the app nulls it on purpose; reported separately).
// Nutrient identification mirrors the documented FDC nutrient ids and units, and is
// re-implemented here on purpose instead of importing app code.
"use strict";

const SPEC = {
  // Priority order matters: the first id with a usable value wins (same as the app).
  kcal: { ids: [1008, 2047, 2048], numbers: ["208", "957", "958"], unit: "KCAL" },
  protein: { ids: [1003], numbers: ["203"], unit: "G" },
  carbs: { ids: [1005, 1050], numbers: ["205", "205.2"], unit: "G" },
  fat: { ids: [1004], numbers: ["204"], unit: "G" },
  fiber: { ids: [1079], numbers: ["291"], unit: "G" },
};
const LIMITS = { kcal: 950, protein: 100, carbs: 100, fat: 100, fiber: 100 };

function rawNutrients(food) {
  const list = Array.isArray(food && food.foodNutrients) ? food.foodNutrients : [];
  return list.map((n) => {
    const nested = n.nutrient || {};
    const value = n.amount !== undefined ? n.amount : n.value;
    return {
      id: n.nutrientId !== undefined ? n.nutrientId : nested.id,
      number: n.nutrientNumber !== undefined ? n.nutrientNumber : nested.number,
      unit: String(n.unitName !== undefined ? n.unitName : nested.unitName || "").toUpperCase(),
      value: typeof value === "number" && Number.isFinite(value) ? value : null,
    };
  });
}

/** Per nutrient: { state: "absent" | "zero" | "present", value } from the raw provider response. */
function classifyRaw(food) {
  const flat = rawNutrients(food);
  const out = {};
  for (const [key, spec] of Object.entries(SPEC)) {
    let found = null;
    for (let i = 0; i < spec.ids.length && found === null; i++) {
      const hit = flat.find((n) => (n.id === spec.ids[i] || n.number === spec.numbers[i]) && n.unit === spec.unit && n.value !== null);
      if (hit) found = hit.value;
    }
    out[key] = found === null ? { state: "absent", value: null } : { state: found === 0 ? "zero" : "present", value: found };
  }
  return out;
}

/**
 * Compare raw provider truth with the app's per-100 values.
 * Returns { absent: [keys], zero: [keys], mismatches: [messages], sanitized: [keys] }.
 */
function compareWithApp(rawFood, appPer100) {
  const raw = classifyRaw(rawFood);
  const res = { absent: [], zero: [], mismatches: [], sanitized: [] };
  // The app also nulls protein/carbs/fat together when their (individually plausible) sum
  // exceeds 100 g per 100 g, since it can't tell which one is wrong. Mirror that rule.
  const macros = ["protein", "carbs", "fat"].filter((k) => raw[k].state !== "absent" && raw[k].value <= LIMITS[k] && raw[k].value >= 0);
  const impossibleSum = macros.reduce((s, k) => s + raw[k].value, 0) > 100;
  for (const key of Object.keys(SPEC)) {
    const r = raw[key];
    const a = appPer100 ? appPer100[key] : undefined;
    if (r.state === "absent") {
      res.absent.push(key);
      if (a !== null) res.mismatches.push(`${key}: absent in the USDA response but the app returned ${JSON.stringify(a)} (must be null)`);
    } else if (r.value > LIMITS[key] || r.value < 0 || (impossibleSum && macros.includes(key))) {
      res.sanitized.push(key);
      if (a !== null) res.mismatches.push(`${key}: implausible USDA value ${r.value} should have been nulled, app returned ${JSON.stringify(a)}`);
    } else if (r.state === "zero") {
      res.zero.push(key);
      if (a !== 0) res.mismatches.push(`${key}: USDA reports 0 but the app returned ${JSON.stringify(a)} (zero is not missing)`);
    } else if (typeof a !== "number" || Math.abs(a - r.value) > 0.001) {
      res.mismatches.push(`${key}: USDA reports ${r.value} but the app returned ${JSON.stringify(a)}`);
    }
  }
  return res;
}

module.exports = { classifyRaw, compareWithApp, SPEC };
