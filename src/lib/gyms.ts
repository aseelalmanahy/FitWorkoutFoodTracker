/**
 * Multi-gym constants, shared by server and client. Kept free of zod: a page importing them doesn't ship the schema
 * library, whose eval probe a strict Content-Security-Policy reports as a violation. The schemas are in gym-schemas.ts.
 */

export const EQUIPMENT_KINDS = ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT", "KETTLEBELL", "BAND", "OTHER"] as const;
export const EQUIPMENT_LABELS: Record<(typeof EQUIPMENT_KINDS)[number], string> = {
  BARBELL: "Barbells", DUMBBELL: "Dumbbells", MACHINE: "Machines", CABLE: "Cables", BODYWEIGHT: "Bodyweight", KETTLEBELL: "Kettlebells", BAND: "Bands", OTHER: "Other",
};
export const MAX_GYMS = 20;
export const MAX_MACHINES_PER_GYM = 100;
