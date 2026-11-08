/**
 * Multi-gym: which built-in exercises can stand in for each other, by movement pattern, reviewed by hand against the
 * 47 built-in exercises. The same primary muscle isn't enough (a cable fly doesn't replace a bench press), so each
 * exercise belongs to one pattern of comparable joint actions, and an alternative must share it. Nothing here is
 * generated. An alternative is always shown and recorded as a substitution, never as the same exercise; the person's
 * own exercises have no pattern, so they're offered only when the person chose them as a swap before.
 */
import type { Equipment } from "@prisma/client";

export const PATTERNS = {
  horizontal_press: "Horizontal press",
  incline_press: "Incline press",
  chest_fly: "Chest fly",
  vertical_press: "Overhead press",
  dip: "Dip",
  vertical_pull: "Vertical pull",
  horizontal_pull: "Row",
  hip_hinge: "Hip hinge",
  squat: "Squat",
  single_leg: "Single-leg squat or lunge",
  knee_extension: "Knee extension",
  knee_flexion: "Knee flexion",
  hip_extension: "Hip extension",
  lateral_raise: "Lateral raise",
  rear_delt: "Rear delt",
  elbow_flexion: "Elbow flexion (curl)",
  elbow_extension: "Elbow extension (triceps)",
  calf_raise: "Calf raise",
  trunk_flexion: "Trunk flexion",
  anti_extension: "Anti-extension (plank)",
  hip_hinge_ballistic: "Ballistic hinge",
} as const;
export type Pattern = keyof typeof PATTERNS;

/** Built-in exercise name → its pattern. Every built-in exercise is listed; a test checks it against the seed. */
export const BUILT_IN_PATTERNS: Record<string, Pattern> = {
  "Barbell Bench Press": "horizontal_press", "Dumbbell Bench Press": "horizontal_press", "Machine Chest Press": "horizontal_press", "Push-Up": "horizontal_press",
  "Incline Barbell Bench Press": "incline_press", "Dumbbell Incline Press": "incline_press",
  "Cable Fly": "chest_fly",
  "Overhead Press": "vertical_press", "Seated Dumbbell Shoulder Press": "vertical_press",
  "Dip": "dip",
  "Pull-Up": "vertical_pull", "Chin-Up": "vertical_pull", "Lat Pulldown": "vertical_pull",
  "Seated Cable Row": "horizontal_pull", "Barbell Row": "horizontal_pull", "One-Arm Dumbbell Row": "horizontal_pull", "Chest-Supported Row": "horizontal_pull",
  "Deadlift": "hip_hinge", "Romanian Deadlift": "hip_hinge",
  "Back Squat": "squat", "Front Squat": "squat", "Leg Press": "squat", "Hack Squat": "squat",
  "Bulgarian Split Squat": "single_leg", "Walking Lunge": "single_leg",
  "Leg Extension": "knee_extension",
  "Seated Leg Curl": "knee_flexion", "Lying Leg Curl": "knee_flexion",
  "Hip Thrust": "hip_extension", "Cable Kickback": "hip_extension",
  "Dumbbell Lateral Raise": "lateral_raise", "Cable Lateral Raise": "lateral_raise",
  "Face Pull": "rear_delt", "Rear Delt Fly": "rear_delt",
  "Barbell Curl": "elbow_flexion", "Dumbbell Curl": "elbow_flexion", "Hammer Curl": "elbow_flexion", "Cable Curl": "elbow_flexion",
  "Triceps Pushdown": "elbow_extension", "Overhead Cable Triceps Extension": "elbow_extension", "Skull Crusher": "elbow_extension",
  "Standing Calf Raise": "calf_raise", "Seated Calf Raise": "calf_raise",
  "Cable Crunch": "trunk_flexion", "Hanging Leg Raise": "trunk_flexion",
  "Plank": "anti_extension",
  "Kettlebell Swing": "hip_hinge_ballistic",
};

export type CandidateExercise = { id: string; name: string; userId: string | null; equipment: Equipment };
export type Alternative = CandidateExercise & { reason: "same-pattern" | "used-before"; pattern: string | null; available: boolean };

/**
 * Alternatives for a planned exercise: built-in exercises of the same movement pattern, and any exercise the person
 * swapped in for it before. With a gym's equipment known, each is marked available or not (bodyweight always is);
 * available ones come first. Without equipment set up, all are shown as unknown availability (available: true).
 */
export function findAlternatives(planned: { id: string; name: string; userId: string | null }, library: CandidateExercise[], { equipment, usedBefore = [] }: { equipment: Equipment[] | null; usedBefore?: string[] }): Alternative[] {
  const pattern = planned.userId === null ? BUILT_IN_PATTERNS[planned.name] ?? null : null;
  const has = (e: Equipment) => equipment === null || e === "BODYWEIGHT" || equipment.includes(e);
  const out = new Map<string, Alternative>();
  for (const id of usedBefore) {
    const ex = library.find((x) => x.id === id);
    if (ex && ex.id !== planned.id) out.set(ex.id, { ...ex, reason: "used-before", pattern: ex.userId === null ? PATTERNS[BUILT_IN_PATTERNS[ex.name]] ?? null : null, available: has(ex.equipment) });
  }
  if (pattern) {
    for (const ex of library) {
      if (ex.id === planned.id || ex.userId !== null || out.has(ex.id)) continue;
      if (BUILT_IN_PATTERNS[ex.name] === pattern) out.set(ex.id, { ...ex, reason: "same-pattern", pattern: PATTERNS[pattern], available: has(ex.equipment) });
    }
  }
  return [...out.values()].sort((a, b) => Number(b.available) - Number(a.available) || Number(b.reason === "used-before") - Number(a.reason === "used-before") || a.name.localeCompare(b.name));
}

/** Where a set's history belongs: the exercise, and the specific machine if one was chosen (else the shared history). */
export const contextKey = (exerciseId: string, gymEquipmentId: string | null | undefined) => `${exerciseId}|${gymEquipmentId ?? ""}`;
