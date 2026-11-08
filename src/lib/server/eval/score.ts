/**
 * D0: how label reading and meal suggestions are scored on recorded evaluation sets, the same way whichever reader
 * produced them (on-device, a local model through Ollama, or the provider). Pure functions over a reader's raw output
 * and a person's reference answers; nothing here reads a photo, calls a reader or changes a value.
 *
 * Label reading transcribes printed values. A value is right when it matches the reference for the same basis within
 * rounding, wrong when it doesn't, and unchecked when there's no reference. Unreadable values stay empty; a reading
 * that isn't accepted by the schema counts as a failure, never as values.
 * Meal recognition only suggests foods, for the person to confirm: it's scored on which foods it names, never on
 * amounts, which the schema refuses outright.
 */
import { parseLabelExtraction } from "@/lib/label-extraction";
import { parseMealIdentification } from "@/lib/meal-identification";

export const LABEL_KEYS = ["kcal", "protein", "carbs", "fat", "fiber"] as const;
type LabelKey = (typeof LABEL_KEYS)[number];
export type LabelReference = Record<LabelKey, number | null>;
export type LabelExpectation = { per100g: LabelReference | null; perServing: LabelReference | null };

export type LabelScore = {
  schemaOk: boolean;
  recognized: boolean;
  /** Values the label has (reference not null) and the reader read, for the matching basis. */
  right: number;
  wrong: number;
  /** Values the label has that were left empty: unreadable or reported absent. */
  leftEmpty: number;
  /** Values read for which the reference has nothing to compare with. */
  unchecked: number;
  /** Values the label has, for the bases the reference covers. */
  expected: number;
  wrongDetails: string[];
};

/** Within rounding: half a unit, or 2%. The same rule as the earlier baseline. */
export const agrees = (got: number, ref: number) => Math.abs(got - ref) <= Math.max(0.5, Math.abs(ref) * 0.02);

export function scoreLabel(raw: unknown, ref: LabelExpectation): LabelScore {
  const s: LabelScore = { schemaOk: false, recognized: false, right: 0, wrong: 0, leftEmpty: 0, unchecked: 0, expected: 0, wrongDetails: [] };
  for (const r of [ref.per100g, ref.perServing]) if (r) for (const k of LABEL_KEYS) if (r[k] !== null) s.expected++;
  const parsed = parseLabelExtraction(raw);
  if (!parsed.ok) return s;
  s.schemaOk = true;
  const e = parsed.extraction;
  if (!e.isNutritionLabel) { s.leftEmpty = s.expected; return s; }
  s.recognized = true;
  const seen = new Set<string>();
  for (const c of e.columns) {
    const basis = c.basis === "per_100g" || c.basis === "per_100ml" ? "per100g" : c.basis === "per_serving" ? "perServing" : null;
    const r = basis ? ref[basis] : null;
    for (const k of LABEL_KEYS) {
      const f = c[k];
      const want = r?.[k] ?? null;
      if (f.status !== "read" || f.value === null) continue;
      if (want === null || (k === "kcal" && f.unit !== "kcal")) { s.unchecked++; continue; }
      seen.add(`${basis}:${k}`);
      if (agrees(f.value, want)) s.right++;
      else { s.wrong++; s.wrongDetails.push(`${basis} ${k}: read ${f.value} ${f.unit ?? ""} from "${f.printed}", label ${want}`); }
    }
  }
  s.leftEmpty = s.expected - seen.size;
  return s;
}

export type MealFood = { name: string; accept: string[] };
export type MealExpectation = { kind: "single" | "multi" | "mixed" | "none"; foods: MealFood[] };
export type MealScore = {
  schemaOk: boolean;
  containsFood: boolean | null;
  names: string[];
  /** single: the first suggestion is a food in the photo; top3: one of the first three is. */
  first: boolean;
  top3: boolean;
  /** The foods in the photo that some suggestion names. */
  found: number;
  /** Named suggestions that are none of the foods in the photo. */
  wrongSuggestions: number;
  /** Of those, the ones marked "likely": confidently wrong. */
  confidentlyWrong: number;
  /** none: correctly said there's no food. */
  noFoodRight: boolean;
};

const norm = (s: string) => ` ${s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim()} `;
/** A suggestion names a food when one of its accepted words appears in it as whole words. */
export const names = (suggestion: string, food: MealFood) => food.accept.some((a) => norm(suggestion).includes(norm(a)));

export function scoreMeal(raw: unknown, ref: MealExpectation): MealScore {
  const s: MealScore = { schemaOk: false, containsFood: null, names: [], first: false, top3: false, found: 0, wrongSuggestions: 0, confidentlyWrong: 0, noFoodRight: false };
  const parsed = parseMealIdentification(raw);
  if (!parsed.ok) return s;
  s.schemaOk = true;
  const id = parsed.identification;
  s.containsFood = id.containsFood;
  const named = id.items.filter((i) => i.name !== null) as { name: string; certainty: string }[];
  s.names = named.map((i) => i.name);
  if (ref.kind === "none") { s.noFoodRight = !id.containsFood || named.length === 0; s.wrongSuggestions = named.length; s.confidentlyWrong = named.filter((i) => i.certainty === "likely").length; return s; }
  const matches = (n: string) => ref.foods.some((f) => names(n, f));
  // The on-device model names one dish and gives its runners-up in the observation, as the earlier baseline counted.
  const ranked = named.flatMap((i, k) => [i.name, ...(k === 0 ? (id.items.find((x) => x.name === i.name)?.observation.match(/close alternatives are (.+?) and (.+?)\. /)?.slice(1, 3) ?? []) : [])]);
  s.first = named.length > 0 && matches(named[0].name);
  s.top3 = ranked.slice(0, 3).some(matches);
  s.found = ref.foods.filter((f) => named.some((i) => names(i.name, f))).length;
  for (const i of named) if (!matches(i.name)) { s.wrongSuggestions++; if (i.certainty === "likely") s.confidentlyWrong++; }
  return s;
}

export type LabelTotals = { photos: number; schemaFailures: number; recognized: number; expected: number; right: number; wrong: number; leftEmpty: number; unchecked: number };
export function totalLabels(scores: LabelScore[]): LabelTotals {
  const t: LabelTotals = { photos: scores.length, schemaFailures: 0, recognized: 0, expected: 0, right: 0, wrong: 0, leftEmpty: 0, unchecked: 0 };
  for (const s of scores) { if (!s.schemaOk) t.schemaFailures++; if (s.recognized) t.recognized++; t.expected += s.expected; t.right += s.right; t.wrong += s.wrong; t.leftEmpty += s.leftEmpty; t.unchecked += s.unchecked; }
  return t;
}
export type MealTotals = { photos: number; schemaFailures: number; first: number; top3: number; foods: number; found: number; suggestions: number; wrongSuggestions: number; confidentlyWrong: number; noFood: number; noFoodRight: number };
export function totalMeals(scores: { ref: MealExpectation; score: MealScore }[]): MealTotals {
  const t: MealTotals = { photos: scores.length, schemaFailures: 0, first: 0, top3: 0, foods: 0, found: 0, suggestions: 0, wrongSuggestions: 0, confidentlyWrong: 0, noFood: 0, noFoodRight: 0 };
  for (const { ref, score: s } of scores) {
    if (!s.schemaOk) t.schemaFailures++;
    if (s.first) t.first++;
    if (s.top3) t.top3++;
    t.foods += ref.foods.length; t.found += s.found; t.suggestions += s.names.length; t.wrongSuggestions += s.wrongSuggestions; t.confidentlyWrong += s.confidentlyWrong;
    if (ref.kind === "none") { t.noFood++; if (s.noFoodRight) t.noFoodRight++; }
  }
  return t;
}
