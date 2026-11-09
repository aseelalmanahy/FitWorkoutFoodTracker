import { z } from "@/lib/zod";
import { EQUIPMENT, MUSCLE_GROUPS } from "./labels";
import { implausibleNutrients, MAX_SERVING_AMOUNT, MIN_SERVING_AMOUNT, PLAUSIBLE_KCAL_PER_100, plausibleMassPer100 } from "./nutrition";

export { EQUIPMENT, MUSCLE_GROUPS };

// Shared between client forms and server routes. Server is authoritative.

const emailField = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email").max(254));
// NIST SP 800-63B: minimum 8, allow long passphrases.
const newPasswordField = z.string().min(8, "Password must be at least 8 characters").max(256);

export const credentialsSchema = z.object({ email: emailField, password: newPasswordField });

/** Sign-up and recovery start with an address alone. Anything else sent is dropped. */
export const emailRequestSchema = z.object({ email: emailField });
/** 32 random bytes, in base64url. The same message for any malformed one, as it says nothing about real tokens. */
export const redeemTokenSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "This link isn't valid or has expired. Request a new one."),
  password: newPasswordField,
});
/** Which notice version the page sent. Its own schema, as reset shares the one above. Compared with the server's, and never stored. */
export const completeSignupSchema = redeemTokenSchema.extend({ acceptedVersion: z.string().min(1, "Tick the box to continue.").max(64) });
// The current password is length-checked only, as a wrong one has to reach the rate-limited comparison.
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(256), newPassword: newPasswordField });

const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// Omitted leaves a stored value alone, and null clears it. Neither supplies a default, as a value here
// has to be one the person chose. Most of these are stored only, and nothing in the product reads them. The goal card
// reads goal and goalWeightKg.
const clearable = <T extends z.ZodType>(field: T) => field.nullable().optional();

export const profileSchema = z.object({
  name: z.string().trim().min(1, "Required").max(80),
  // Format only. Eligibility is decided in the route, by eligibilityOf, so no age rule lives here.
  birthDate: z.iso.date(),
  sex: clearable(z.enum(["MALE", "FEMALE"])),
  heightCm: clearable(z.number().min(100).max(250)),
  currentWeightKg: clearable(z.number().min(30).max(300)),
  goalWeightKg: clearable(z.number().min(30).max(300)),
  goal: clearable(z.enum(["FAT_LOSS", "MUSCLE_GAIN", "MAINTENANCE", "STRENGTH"])),
  activityLevel: clearable(z.enum(["SEDENTARY", "LIGHT", "MODERATE", "ACTIVE", "VERY_ACTIVE"])),
  experience: clearable(z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"])),
  workoutDaysPerWeek: clearable(z.number().int().min(0).max(7)),
  unitSystem: z.enum(["METRIC", "IMPERIAL"]),
  timezone: z.string().max(64).refine(isValidTimeZone, "Unknown time zone"),
});
export type ProfileInput = z.infer<typeof profileSchema>;

// A password check for this request. Length only: a wrong one has to reach the rate-limited comparison.
export const accountPasswordSchema = z.object({ password: z.string().min(1).max(256) });
export const deleteAccountSchema = accountPasswordSchema.extend({ confirmation: z.literal("DELETE") });

export const exerciseSchema = z.object({
  name: z.string().trim().min(2).max(80),
  primaryMuscle: z.enum(MUSCLE_GROUPS),
  equipment: z.enum(EQUIPMENT),
});

const id = z.string().min(1).max(40);
const notes = z.string().trim().max(1000).nullable().optional();
const weightKg = z.number().min(0).max(1000);
const restSeconds = z.number().int().min(0).max(1800).nullable().optional();

export const templateExerciseSchema = z
  .object({
    exerciseId: id,
    targetSets: z.number().int().min(1).max(20),
    targetRepsMin: z.number().int().min(1).max(100),
    targetRepsMax: z.number().int().min(1).max(100),
    targetWeightKg: weightKg.nullable().optional(),
    restSeconds,
    notes,
  })
  .refine((e) => e.targetRepsMax >= e.targetRepsMin, { message: "Max reps must be ≥ min reps", path: ["targetRepsMax"] });

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  notes,
  exercises: z.array(templateExerciseSchema).max(30),
});
export type TemplateInput = z.infer<typeof templateSchema>;

/** UI-01: a program's name and its workout days, in order (the person's own plans). */
const programName = z.string().trim().min(1).max(60);
const programDays = z.array(id).min(1).max(14).refine((ids) => new Set(ids).size === ids.length, "A plan can be in a program once");
export const createProgramSchema = z.strictObject({ name: programName, templateIds: programDays });
export const updateProgramSchema = z.strictObject({ name: programName.optional(), templateIds: programDays.optional() })
  .refine((p) => p.name !== undefined || p.templateIds !== undefined, "Nothing to change");

export const scheduleSchema = z.object({
  days: z
    .array(z.array(id).max(3))
    .length(7, "Provide all 7 weekdays (Monday first)"),
});

// Multi-gym: any way of starting may name the gym; it can also be chosen or changed during the workout.
const startAt = { gymLocationId: id.nullable().optional() };
export const startSessionSchema = z.union([
  z.object({ templateId: id, ...startAt }),
  z.object({ fromSessionId: id, ...startAt }),
  z.object({ name: z.string().trim().min(1).max(80), ...startAt }),
]);

export const updateSessionSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  notes,
  finish: z.boolean().optional(),
});

export const addSessionExerciseSchema = z.object({ exerciseId: id, restSeconds });
export const updateSessionExerciseSchema = z.object({
  notes,
  restSeconds,
  move: z.enum(["up", "down"]).optional(),
});

export const setSchema = z.object({
  reps: z.number().int().min(0).max(1000),
  weightKg,
  isWarmup: z.boolean().optional(),
  rpe: z.number().min(1).max(10).nullable().optional(),
});
export const updateSetSchema = setSchema.partial();

// ─── Nutrition (Phase 2) ────────────────────────────────────────────────────

export const isoDateSchema = z.iso.date();

/** The same range as the profile's weight, which is about data entry, and isn't a health limit. */
export const weightEntrySchema = z.object({ date: isoDateSchema, weightKg: z.number().min(30).max(300) });
export const mealTypeSchema = z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACK"]);
export const externalSourceSchema = z.enum(["USDA", "OPEN_FOOD_FACTS"]);

export const foodSearchQuerySchema = z.object({
  q: z.string().trim().min(2, "Enter at least 2 characters").max(100),
  sources: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",") : ["CUSTOM", "USDA", "OPEN_FOOD_FACTS"]))
    .pipe(z.array(z.enum(["CUSTOM", "USDA", "OPEN_FOOD_FACTS"])).min(1)),
});

export const resolveFoodSchema = z.object({
  source: externalSourceSchema,
  sourceId: z.string().trim().min(1).max(40).regex(/^[0-9A-Za-z_-]+$/),
});

const nutrientValue = z.number().min(0).max(10000);

/** Custom foods are entered as printed on a label: per serving. */
export const customFoodSchema = z
  .object({
  name: z.string().trim().min(1).max(120),
  brand: z.string().trim().max(80).nullable().optional(),
  barcode: z.string().trim().regex(/^\d{6,14}$/, "Barcode must be 6–14 digits").nullable().optional(),
  basisUnit: z.enum(["G", "ML"]),
  servingLabel: z.string().trim().min(1).max(80),
  servingAmount: z.number().min(MIN_SERVING_AMOUNT, `Serving size must be at least ${MIN_SERVING_AMOUNT}`).max(MAX_SERVING_AMOUNT),
  perServing: z.object({
    kcal: nutrientValue,
    protein: nutrientValue,
    carbs: nutrientValue,
    fat: nutrientValue,
    fiber: nutrientValue.nullable().optional(),
  }),
})
  // Same physical limits as provider data, applied to the derived per-100 values.
  .superRefine((v, ctx) => {
    const k = 100 / v.servingAmount;
    const ps = v.perServing;
    const per100 = { kcal: ps.kcal * k, protein: ps.protein * k, carbs: ps.carbs * k, fat: ps.fat * k, fiber: ps.fiber == null ? null : ps.fiber * k };
    const bad = implausibleNutrients(per100, v.basisUnit);
    if (bad.length) {
      const u = v.basisUnit === "ML" ? "ml" : "g";
      ctx.addIssue({
        code: "custom",
        path: ["perServing", bad[0]],
        message: `Values are not physically possible for a ${v.servingAmount} ${u} serving (max ${PLAUSIBLE_KCAL_PER_100} kcal and ${plausibleMassPer100(v.basisUnit)} g of nutrients per 100 ${u}). Check the serving size and label values.`,
      });
    }
  });

export type CustomFoodInput = z.infer<typeof customFoodSchema>;

export const createFoodEntrySchema = z.object({
  date: isoDateSchema,
  mealType: mealTypeSchema,
  foodId: z.string().min(1).max(40),
  /** A FoodServing id, or null to log by raw grams/ml (quantity = amount). */
  servingId: z.string().min(1).max(40).nullable(),
  quantity: z.number().positive().max(5000),
});

export const updateFoodEntrySchema = z
  .object({
    mealType: mealTypeSchema.optional(),
    date: isoDateSchema.optional(),
    servingId: z.string().min(1).max(40).nullable().optional(),
    quantity: z.number().positive().max(5000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const nutritionTargetSchema = z.object({
  kcal: z.number().int().min(800).max(8000),
  // Each key is required, and null means "not set", so a missing value can never become 0 by accident.
  proteinG: z.number().int().min(0).max(600).nullable(),
  fatG: z.number().int().min(0).max(400).nullable(),
});
