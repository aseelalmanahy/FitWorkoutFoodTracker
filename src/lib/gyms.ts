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

// Characters a name never keeps, by code point (written as numbers, so no invisible character sits in this file):
// controls; bidi marks, embeddings, overrides and isolates (they reorder what's shown); and characters that show
// nothing (zero width space, word joiner and invisible operators, BOM, soft hyphen, grapheme joiner, Hangul and
// Khmer fillers, Mongolian vowel separator). Kept, as real text needs them: ZWNJ and ZWJ (Persian, Indic scripts,
// emoji sequences), variation selectors, Mongolian free variation selectors, and tag characters (subdivision flags).
const NEVER_KEPT: [number, number][] = [
  [0x00ad, 0x00ad], [0x034f, 0x034f], [0x061c, 0x061c], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180e, 0x180e],
  [0x200b, 0x200b], [0x200e, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x206f], [0x3164, 0x3164], [0xfeff, 0xfeff], [0xffa0, 0xffa0],
];
const HIDDEN = new RegExp(`[\\p{Cc}${NEVER_KEPT.map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join("")}]`, "gu");

/**
 * A gym or machine name as stored: Unicode NFKC, without the characters above, runs of spaces made one, trimmed.
 * What's left is shown as typed, so names in scripts that need joiners stay correct.
 */
export const cleanName = (s: string) => s.normalize("NFKC").replace(HIDDEN, "").replace(/\s+/g, " ").trim();

/**
 * What two names are compared by: the cleaned name without any default-ignorable character (so a joiner, selector or
 * tag can't make a second "Caf" + "e" name), case-folded, so "Cafe" with an acute accent, upper-case or composed
 * any way, is one name. Empty when nothing visible is left, which the schema refuses.
 */
export const nameKey = (s: string) =>
  cleanName(s).replace(/\p{Default_Ignorable_Code_Point}/gu, "").replace(/\s+/g, " ").trim().toUpperCase().toLowerCase();
