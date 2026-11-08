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

/**
 * A gym or machine name as stored: Unicode NFKC; every control, format and default-ignorable character removed (zero
 * widths, joiners, bidi embeddings, overrides and isolates, the soft hyphen, variation selectors, tags, Hangul fillers:
 * they make two different names look the same, or reorder what's shown); runs of spaces made one; trimmed.
 */
export const cleanName = (s: string) =>
  s.normalize("NFKC").replace(/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "").replace(/\s+/g, " ").trim();

/** What two names are compared by: the cleaned name, case-folded, so "Café", "CAFÉ" and "Cafe\u0301" are one name. */
export const nameKey = (s: string) => cleanName(s).toUpperCase().toLowerCase();
