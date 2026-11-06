/**
 * Profile vocabulary and calendar age.
 *
 * This module used to estimate energy needs and suggest calorie and macro targets. Those were removed
 * in Phase 4.0.1 (Decision 9): the app sets no target and gives no estimate. Reintroducing either
 * needs its own product, professional and owner review. See docs/PHASE_4_0_1_IMPLEMENTATION_PLAN.md.
 */

export type ActivityLevel = "SEDENTARY" | "LIGHT" | "MODERATE" | "ACTIVE" | "VERY_ACTIVE";
export type FitnessGoal = "FAT_LOSS" | "MUSCLE_GAIN" | "MAINTENANCE" | "STRENGTH";

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  SEDENTARY: "Sedentary — desk job, little exercise",
  LIGHT: "Lightly active — exercise 1–3 days/week",
  MODERATE: "Moderately active — exercise 3–5 days/week",
  ACTIVE: "Very active — hard exercise 6–7 days/week",
  VERY_ACTIVE: "Extremely active — physical job plus training",
};

/** Whole years on UTC calendar dates. The only age calculation in the app. */
export function ageFromBirthDate(birthDate: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const m = now.getUTCMonth() - birthDate.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birthDate.getUTCDate())) age--;
  return age;
}
