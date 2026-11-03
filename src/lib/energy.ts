/**
 * Energy-requirement estimates.
 *
 * BMR: Mifflin-St Jeor (Mifflin et al., Am J Clin Nutr 1990;51:241–7).
 *   Men:   10·kg + 6.25·cm − 5·age + 5
 *   Women: 10·kg + 6.25·cm − 5·age − 161
 * In validation work (Frankenfield et al., J Am Diet Assoc 2005;105:775–89) it
 * predicted RMR within ±10 % of measured values in roughly 70–80 % of
 * non-obese and obese adults — i.e. a meaningful fraction of individuals fall
 * outside that band. Every output here is therefore an ESTIMATE and a starting
 * point to be corrected against observed body-weight trends.
 *
 * TDEE = BMR × physical-activity factor (conventional multipliers).
 */

export type Sex = "MALE" | "FEMALE";
export type ActivityLevel = "SEDENTARY" | "LIGHT" | "MODERATE" | "ACTIVE" | "VERY_ACTIVE";
export type FitnessGoal = "FAT_LOSS" | "MUSCLE_GAIN" | "MAINTENANCE" | "STRENGTH";

export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  SEDENTARY: 1.2,
  LIGHT: 1.375,
  MODERATE: 1.55,
  ACTIVE: 1.725,
  VERY_ACTIVE: 1.9,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  SEDENTARY: "Sedentary — desk job, little exercise",
  LIGHT: "Lightly active — exercise 1–3 days/week",
  MODERATE: "Moderately active — exercise 3–5 days/week",
  ACTIVE: "Very active — hard exercise 6–7 days/week",
  VERY_ACTIVE: "Extremely active — physical job plus training",
};

/** Commonly cited intake floors below which medical supervision is advised. */
export const MIN_INTAKE_KCAL: Record<Sex, number> = { FEMALE: 1200, MALE: 1500 };

export function ageFromBirthDate(birthDate: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const m = now.getUTCMonth() - birthDate.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birthDate.getUTCDate())) age--;
  return age;
}

export function mifflinStJeorBmr(input: { sex: Sex; weightKg: number; heightCm: number; age: number }): number {
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age;
  return base + (input.sex === "MALE" ? 5 : -161);
}

export function estimateTdee(bmr: number, activity: ActivityLevel): number {
  return bmr * ACTIVITY_MULTIPLIERS[activity];
}

export interface CalorieSuggestion {
  bmr: number;
  tdee: number;
  target: number;
  adjustment: number;
  floorApplied: boolean;
  rationale: string;
}

const round10 = (x: number) => Math.round(x / 10) * 10;

/**
 * Suggest a conservative starting calorie target.
 *  - Fat loss: −15 % of TDEE, deficit capped at 500 kcal/day. Never below
 *    max(BMR, sex-specific floor).
 *  - Muscle gain: +10 % of TDEE, surplus capped at 350 kcal/day.
 *  - Maintenance / strength: TDEE.
 */
export function suggestCalories(input: {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  age: number;
  activity: ActivityLevel;
  goal: FitnessGoal;
}): CalorieSuggestion {
  const bmr = mifflinStJeorBmr(input);
  const tdee = estimateTdee(bmr, input.activity);

  let adjustment = 0;
  let rationale: string;
  switch (input.goal) {
    case "FAT_LOSS":
      adjustment = -Math.min(0.15 * tdee, 500);
      rationale = "Moderate deficit (~15 % of estimated TDEE, max 500 kcal/day).";
      break;
    case "MUSCLE_GAIN":
      adjustment = Math.min(0.1 * tdee, 350);
      rationale = "Small surplus (~10 % of estimated TDEE, max 350 kcal/day) to limit fat gain.";
      break;
    default:
      rationale = "Estimated maintenance intake.";
  }

  let target = tdee + adjustment;
  const floor = Math.max(bmr, MIN_INTAKE_KCAL[input.sex]);
  let floorApplied = false;
  if (adjustment < 0 && target < floor) {
    target = floor;
    floorApplied = true;
    rationale += " Raised to a minimum safe floor.";
  }

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    target: round10(target),
    adjustment: Math.round(target - tdee),
    floorApplied,
    rationale,
  };
}

// ─── Macronutrient targets ──────────────────────────────────────────────────
/**
 * Protein: 1.6 g/kg/day for muscle gain, strength and maintenance. This is the
 * plateau estimate for resistance-trained adults in Morton et al.,
 * Br J Sports Med 2018;52:376–84 (upper 95 % CI ≈ 2.2 g/kg). Fat loss uses
 * 2.0 g/kg, because higher intakes help preserve lean mass in an energy
 * deficit (Helms et al., JISSN 2014;11:20). For fat loss with a lower goal
 * weight, the goal weight is the reference, so the target isn't inflated by
 * excess body fat.
 * Fat: 25 % of energy, with a floor of 0.5 g/kg.
 * Carbohydrate: the remaining energy at 4 kcal/g.
 * Energy is consistent by construction: 4P + 4C + 9F ≤ kcal, differing by
 * less than 4 kcal (rounding).
 */
export const PROTEIN_G_PER_KG: Record<FitnessGoal, number> = {
  FAT_LOSS: 2.0,
  MUSCLE_GAIN: 1.6,
  MAINTENANCE: 1.6,
  STRENGTH: 1.6,
};
export const FAT_ENERGY_FRACTION = 0.25;
export const FAT_MIN_G_PER_KG = 0.5;

export interface MacroTargets {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export function suggestMacros(input: { kcal: number; weightKg: number; goalWeightKg?: number | null; goal: FitnessGoal }): MacroTargets {
  const refWeight =
    input.goal === "FAT_LOSS" && input.goalWeightKg && input.goalWeightKg < input.weightKg ? input.goalWeightKg : input.weightKg;
  let proteinG = Math.round(PROTEIN_G_PER_KG[input.goal] * refWeight);
  let fatG = Math.round(Math.max((FAT_ENERGY_FRACTION * input.kcal) / 9, FAT_MIN_G_PER_KG * refWeight));
  // Guard against very low energy targets: protein and fat must fit inside kcal.
  if (proteinG * 4 + fatG * 9 > input.kcal) {
    fatG = Math.floor(Math.max(0, input.kcal - proteinG * 4) / 9);
    if (proteinG * 4 > input.kcal) proteinG = Math.floor(input.kcal / 4);
  }
  const carbsG = Math.floor((input.kcal - proteinG * 4 - fatG * 9) / 4);
  return { kcal: input.kcal, proteinG, carbsG: Math.max(0, carbsG), fatG };
}
