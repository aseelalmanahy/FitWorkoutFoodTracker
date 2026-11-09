/**
 * Phase 3: what may be saved from an import, once the person has checked and completed the draft. Every value is
 * required where the app needs it (sets and repetitions), so nothing missing from the plan can be saved as if it were
 * there; the person fills it in or removes the exercise. Bounded like the plan editor.
 */
import { z } from "@/lib/zod";

export const MUSCLE_GROUPS = ["CHEST", "BACK", "SHOULDERS", "BICEPS", "TRICEPS", "FOREARMS", "QUADS", "HAMSTRINGS", "GLUTES", "CALVES", "CORE", "FULL_BODY", "OTHER"] as const;
export const EQUIPMENT = ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT", "KETTLEBELL", "BAND", "OTHER"] as const;
export const SAVE_LIMITS = { maxDays: 14, maxExercisesPerDay: 30 } as const;
export const LB_TO_KG = 0.45359237;

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const importExerciseSchema = z.strictObject({
  exerciseId: z.string().min(1).max(40).optional(),
  newExercise: z.strictObject({ name: z.string().trim().min(1).max(80), primaryMuscle: z.enum(MUSCLE_GROUPS), equipment: z.enum(EQUIPMENT) }).optional(),
  targetSets: z.number().int().min(1).max(20),
  targetRepsMin: z.number().int().min(1).max(100),
  targetRepsMax: z.number().int().min(1).max(100),
  targetWeightKg: z.number().min(0).max(1000).nullable().optional(),
  restSeconds: z.number().int().min(0).max(1800).nullable().optional(),
  notes: optionalText(1000),
})
  .refine((e) => Boolean(e.exerciseId) !== Boolean(e.newExercise), { message: "Choose an exercise from the library, or name a new one", path: ["exerciseId"] })
  .refine((e) => e.targetRepsMax >= e.targetRepsMin, { message: "Max reps must be ≥ min reps", path: ["targetRepsMax"] });

export const importDaySchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  weekday: z.number().int().min(0).max(6).nullable(),
  notes: optionalText(1000),
  exercises: z.array(importExerciseSchema).min(1).max(SAVE_LIMITS.maxExercisesPerDay),
});

export const importSaveSchema = z.strictObject({
  programName: z.string().trim().min(1).max(60),
  days: z.array(importDaySchema).min(1).max(SAVE_LIMITS.maxDays),
  /** UI-01: put the days on the weekly schedule. Off unless the person asks: importing alone never changes the schedule. */
  schedule: z.boolean().default(false),
});
export type ImportSave = z.infer<typeof importSaveSchema>;

/** How imported days were named before programs (UI-01). Plans saved then keep these names. */
export const planName = (program: string, day: string) => `${program} – ${day}`.slice(0, 80).trim();

/** A stated weight in pounds, as kilograms, to two decimals. Only ever applied to a weight the plan states in pounds. */
export const poundsToKg = (lb: number) => Math.round(lb * LB_TO_KG * 100) / 100;
