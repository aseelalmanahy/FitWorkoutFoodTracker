/**
 * What can be read from a nutrition label, and how that output is judged. Pure functions, shared by
 * server and client. Extractor output is untrusted input: it must pass `parseLabelExtraction`, and
 * `checkLabelExtraction` then flags problems. Nothing here changes a value or fills one in.
 *
 * Conventions
 *  - read: the text is on the label and legible. `printed` holds it exactly.
 *  - absent: the label doesn't report it. Its value is null, never 0.
 *  - unreadable: it's there but can't be read reliably. Its value is null, never a guess.
 *  - Columns stay separate. Grams and millilitres are never converted into each other.
 */
import { z } from "@/lib/zod";
import { implausibleNutrients, macroKcal, MAX_SERVING_AMOUNT, MIN_SERVING_AMOUNT, NUTRIENT_KEYS, scaleNutrients, type NutrientKey, type Nutrients } from "./nutrition";

/** A full label is far smaller than this, so anything larger isn't a label reading. */
export const MAX_EXTRACTION_CHARS = 64_000;
const MAX_TEXT = 200;
const MAX_COLUMNS = 4;

const text = (max = MAX_TEXT) => z.string().max(max);
const STATUS = z.enum(["read", "absent", "unreadable"]);

type Fieldish = { status: string; printed: string | null; reason: string | null };
/** Rules every field shares. `value` is null whenever a field isn't read, so missing can't become 0. */
function coherent(field: Fieldish, values: unknown[], ctx: z.RefinementCtx) {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (field.status === "read") {
    if (field.printed === null || field.printed.trim() === "") issue("A read field needs its printed text");
    if (field.reason !== null) issue("A read field has no reason");
    return;
  }
  if (values.some((v) => v !== null)) issue(`An ${field.status} field can't have a value`);
  if (field.status === "absent" && (field.printed !== null || field.reason !== null)) issue("An absent field has no text");
  if (field.status === "unreadable" && (field.reason === null || field.reason.trim() === "")) issue("An unreadable field needs a reason");
}

const textField = z.strictObject({ status: STATUS, value: text().nullable(), printed: text().nullable(), reason: text().nullable() })
  .superRefine((f, ctx) => {
    coherent(f, [f.value], ctx);
    if (f.status === "read" && (f.value === null || f.value.trim() === "")) ctx.addIssue({ code: "custom", message: "A read text field needs its value" });
  });

const number = z.number().refine(Number.isFinite);
const countField = z.strictObject({ status: STATUS, value: number.nullable(), printed: text().nullable(), reason: text().nullable() })
  .superRefine((f, ctx) => coherent(f, [f.value], ctx));

const nutrientField = z.strictObject({ status: STATUS, value: number.nullable(), unit: text(30).nullable(), printed: text().nullable(), reason: text().nullable() })
  .superRefine((f, ctx) => coherent(f, [f.value, f.unit], ctx));

const servingField = z.strictObject({ status: STATUS, amount: number.nullable(), unit: text(30).nullable(), printed: text().nullable(), reason: text().nullable() })
  .superRefine((f, ctx) => coherent(f, [f.amount, f.unit], ctx));

const column = z.strictObject({
  basis: z.enum(["per_serving", "per_100g", "per_100ml", "other"]),
  printedHeading: text().nullable(),
  kcal: nutrientField,
  protein: nutrientField,
  carbs: nutrientField,
  fat: nutrientField,
  fiber: nutrientField,
});

export const labelExtractionSchema = z.strictObject({
  isNutritionLabel: z.boolean(),
  productName: textField,
  brand: textField,
  servingSize: servingField,
  servingsPerContainer: countField,
  columns: z.array(column).max(MAX_COLUMNS),
});

export type LabelExtraction = z.infer<typeof labelExtractionSchema>;
export type LabelColumn = LabelExtraction["columns"][number];
export type NutrientField = LabelColumn[NutrientKey];

export type ExtractionParse = { ok: true; extraction: LabelExtraction } | { ok: false; reason: "too_large" | "not_json" | "schema" };

/** Accepts JSON text or an already-parsed value. A value that fails in any way is rejected whole. */
export function parseLabelExtraction(raw: unknown): ExtractionParse {
  let value = raw;
  if (typeof raw === "string") {
    if (raw.length > MAX_EXTRACTION_CHARS) return { ok: false, reason: "too_large" };
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "not_json" };
    }
  } else {
    let size: number | undefined;
    try {
      size = JSON.stringify(raw)?.length;
    } catch {
      return { ok: false, reason: "schema" };
    }
    if (size !== undefined && size > MAX_EXTRACTION_CHARS) return { ok: false, reason: "too_large" };
  }
  const parsed = labelExtractionSchema.safeParse(value);
  return parsed.success ? { ok: true, extraction: parsed.data } : { ok: false, reason: "schema" };
}

// ─── Checks ─────────────────────────────────────────────────────────────────

export type LabelFlagCode =
  | "no_nutrition_values"
  | "printed_value_mismatch"
  | "value_not_parsed"
  | "invalid_number"
  | "implausible_value"
  | "energy_macro_mismatch"
  | "contradictory_columns"
  | "columns_not_comparable"
  | "energy_in_kilojoules"
  | "unexpected_unit"
  | "serving_unit_needs_input"
  | "serving_amount_out_of_range"
  | "unknown_column_basis";

export interface LabelFlag {
  code: LabelFlagCode;
  /** Which field this is about, such as `columns[0].kcal`, or null for the whole label. */
  field: string | null;
  message: string;
}

/** Numbers a printed string can honestly mean, including both readings of "1,200" and "1.200". */
export function printedNumbers(printed: string): number[] {
  const out: number[] = [];
  const VULGAR: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
  // Fractions come out first, so the digits of "1/2" can't also be read as 1 and 2.
  const rest = printed
    .replace(/(\d+)?\s*([½¼¾⅓⅔⅛])/g, (_m, whole, part) => { out.push((whole ? Number(whole) : 0) + VULGAR[part]); return " "; })
    .replace(/(?:(\d+)\s+)?(\d+)\/(\d+)/g, (_m, whole, top, bottom) => {
      if (Number(bottom) > 0) out.push((whole ? Number(whole) : 0) + Number(top) / Number(bottom));
      return " ";
    });
  for (const [token] of rest.matchAll(/\d{1,3}(?:[ \u00a0]\d{3})+|\d+(?:[.,]\d+)*/g)) {
    if (/^\d+$/.test(token)) out.push(Number(token));
    if (/^\d{1,3}(?:[., \u00a0]\d{3})+$/.test(token)) out.push(Number(token.replace(/[., \u00a0]/g, ""))); // thousands
    if (/^\d+[.,]\d+$/.test(token)) out.push(Number(token.replace(",", "."))); // decimals
  }
  return out;
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const printedHasValue = (printed: string, value: number) => printedNumbers(printed).some((n) => close(n, value));

const norm = (s: string | null) => (s ?? "").trim().toLowerCase().replace(/\.$/, "");
export const isKcalUnit = (unit: string | null) => unit === null || /^(k?cal|kcals|calories?|cals?)$/i.test(unit.trim().replace(/\.$/, ""));
const isKj = (unit: string | null) => /^kj$/.test(norm(unit));
export const isGramUnit = (unit: string | null) => unit === null || /^(g|gr|grams?)$/.test(norm(unit));

const METRIC_SERVING: Record<string, { basis: "G" | "ML"; factor: number }> = {
  g: { basis: "G", factor: 1 }, gr: { basis: "G", factor: 1 }, gram: { basis: "G", factor: 1 }, grams: { basis: "G", factor: 1 },
  mg: { basis: "G", factor: 0.001 }, kg: { basis: "G", factor: 1000 },
  ml: { basis: "ML", factor: 1 }, milliliter: { basis: "ML", factor: 1 }, milliliters: { basis: "ML", factor: 1 }, millilitre: { basis: "ML", factor: 1 }, millilitres: { basis: "ML", factor: 1 },
  cl: { basis: "ML", factor: 10 }, dl: { basis: "ML", factor: 100 }, l: { basis: "ML", factor: 1000 }, liter: { basis: "ML", factor: 1000 }, litre: { basis: "ML", factor: 1000 },
};

/** A serving's size in g or ml, only when the label states it in that same dimension. */
export function metricServing(serving: LabelExtraction["servingSize"]): { amount: number; basis: "G" | "ML" } | null {
  if (serving.status !== "read" || serving.amount === null || serving.amount <= 0) return null;
  const unit = METRIC_SERVING[norm(serving.unit)];
  return unit ? { amount: serving.amount * unit.factor, basis: unit.basis } : null;
}

const FIELD_NAMES: Record<NutrientKey, string> = { kcal: "Calories", protein: "Protein", carbs: "Carbohydrate", fat: "Fat", fiber: "Fiber" };

/** A column's usable numbers: read, non-negative, in the unit each check needs. Anything else is null. */
function usableNutrients(col: LabelColumn): Nutrients {
  const out = {} as Nutrients;
  for (const k of NUTRIENT_KEYS) {
    const f = col[k];
    const unitOk = k === "kcal" ? isKcalUnit(f.unit) : isGramUnit(f.unit);
    out[k] = f.status === "read" && f.value !== null && f.value >= 0 && unitOk ? f.value : null;
  }
  return out;
}

/** Rounding on labels makes small gaps normal. These are checks to prompt a person, not proofs. */
const differs = (k: NutrientKey, a: number, b: number) => {
  const [ratio, floor] = k === "kcal" ? [0.1, 5] : [0.15, 1];
  return Math.abs(a - b) > Math.max(floor, ratio * Math.max(a, b));
};

const ENERGY_GAP = 0.2;
const ENERGY_GAP_FLOOR_KCAL = 10;

/** Flags everything a person should look at. Values are never changed. */
export function checkLabelExtraction(e: LabelExtraction): LabelFlag[] {
  const flags: LabelFlag[] = [];
  const flag = (code: LabelFlagCode, field: string | null, message: string) => flags.push({ code, field, message });

  // Printed text is the evidence, so a number must be traceable to it.
  const checkNumber = (field: string, name: string, value: number | null, printed: string | null, status: string) => {
    if (status !== "read") return;
    if (value === null) {
      flag("value_not_parsed", field, `${name} is printed as "${printed}", which isn't an exact number. Nothing was assumed.`);
      return;
    }
    if (value < 0) flag("invalid_number", field, `${name} can't be negative (${value}).`);
    if (printed !== null && !printedHasValue(printed, value)) flag("printed_value_mismatch", field, `${name} was read as ${value}, but the label text says "${printed}".`);
  };

  const serving = e.servingSize;
  checkNumber("servingSize", "Serving size", serving.amount, serving.printed, serving.status);
  checkNumber("servingsPerContainer", "Servings per container", e.servingsPerContainer.value, e.servingsPerContainer.printed, e.servingsPerContainer.status);
  if (e.servingsPerContainer.value !== null && e.servingsPerContainer.value === 0) flag("invalid_number", "servingsPerContainer", "Servings per container can't be 0.");

  const metric = metricServing(serving);
  if (serving.status === "read" && serving.amount !== null) {
    if (!metric) {
      flag("serving_unit_needs_input", "servingSize", `"${serving.unit ?? "No unit"}" isn't a gram or millilitre amount, so the weight or volume of a serving must be entered. It won't be converted.`);
    } else if (metric.amount < MIN_SERVING_AMOUNT || metric.amount > MAX_SERVING_AMOUNT) {
      flag("serving_amount_out_of_range", "servingSize", `A serving of ${metric.amount} ${metric.basis === "ML" ? "ml" : "g"} is outside the supported range.`);
    }
  }

  e.columns.forEach((col, i) => {
    const path = (k: NutrientKey) => `columns[${i}].${k}`;
    if (col.basis === "other") flag("unknown_column_basis", `columns[${i}]`, `The column "${col.printedHeading ?? "without a heading"}" isn't per serving, per 100 g or per 100 ml, so it can't be used directly.`);

    for (const k of NUTRIENT_KEYS) {
      const f = col[k];
      checkNumber(path(k), FIELD_NAMES[k], f.value, f.printed, f.status);
      if (f.status !== "read") continue;
      if (k === "kcal" && isKj(f.unit)) flag("energy_in_kilojoules", path(k), `Energy is printed in kJ (${f.printed}). It wasn't converted to kcal.`);
      else if (k === "kcal" ? !isKcalUnit(f.unit) : !isGramUnit(f.unit)) flag("unexpected_unit", path(k), `${FIELD_NAMES[k]} has the unit "${f.unit}", which was not expected. It wasn't converted.`);
    }

    const values = usableNutrients(col);
    const { kcal, protein, carbs, fat } = values;
    if (kcal !== null && protein !== null && carbs !== null && fat !== null) {
      const fromMacros = macroKcal(protein, carbs, fat);
      if (Math.abs(kcal - fromMacros) > Math.max(ENERGY_GAP_FLOOR_KCAL, ENERGY_GAP * Math.max(kcal, fromMacros))) {
        flag("energy_macro_mismatch", path("kcal"), `Calories (${kcal}) differ from what protein, carbohydrate and fat suggest (about ${Math.round(fromMacros)}). Fiber and sugar alcohols can explain some of this.`);
      }
    }

    const per100 = per100Of(col, values, metric);
    if (per100) {
      for (const k of implausibleNutrients(per100.values, per100.basis)) {
        flag("implausible_value", path(k), `${FIELD_NAMES[k]} isn't physically possible at this amount per 100 ${per100.basis === "ML" ? "ml" : "g"}.`);
      }
    }
  });

  compareColumns(e, metric, flag);

  const anyValue = e.columns.some((c) => NUTRIENT_KEYS.some((k) => c[k].status === "read"));
  if (!anyValue) flag("no_nutrition_values", null, "No nutrition values could be read from this label.");
  return flags;
}

function per100Of(col: LabelColumn, values: Nutrients, metric: ReturnType<typeof metricServing>): { values: Nutrients; basis: "G" | "ML" } | null {
  if (col.basis === "per_100g") return { values, basis: "G" };
  if (col.basis === "per_100ml") return { values, basis: "ML" };
  if (col.basis === "per_serving" && metric) return { values: scaleNutrients(values, (100 * 100) / metric.amount), basis: metric.basis };
  return null;
}

function compareColumns(e: LabelExtraction, metric: ReturnType<typeof metricServing>, flag: (code: LabelFlagCode, field: string | null, message: string) => void) {
  const columns = e.columns.map((col, i) => ({ col, i, values: usableNutrients(col) }));

  // Two columns claiming the same basis must agree.
  for (const a of columns) {
    for (const b of columns) {
      if (b.i <= a.i || a.col.basis !== b.col.basis || a.col.basis === "other") continue;
      for (const k of NUTRIENT_KEYS) {
        const [x, y] = [a.values[k], b.values[k]];
        if (x !== null && y !== null && differs(k, x, y)) flag("contradictory_columns", `columns[${b.i}].${k}`, `${FIELD_NAMES[k]} is ${x} in one column and ${y} in another with the same basis.`);
      }
    }
  }

  // Per-serving must match per-100 at the printed serving size, only in the same dimension.
  const perServing = columns.filter((c) => c.col.basis === "per_serving");
  for (const hundred of columns.filter((c) => c.col.basis === "per_100g" || c.col.basis === "per_100ml")) {
    const basis = hundred.col.basis === "per_100g" ? "G" : "ML";
    for (const serving of perServing) {
      if (!metric) continue;
      if (metric.basis !== basis) {
        flag("columns_not_comparable", `columns[${hundred.i}]`, `The serving is measured in ${metric.basis === "ML" ? "ml" : "g"} but this column is per 100 ${basis === "ML" ? "ml" : "g"}. These aren't compared or converted, as density is unknown.`);
        continue;
      }
      const expected = scaleNutrients(hundred.values, metric.amount);
      for (const k of NUTRIENT_KEYS) {
        const [actual, want] = [serving.values[k], expected[k]];
        if (actual !== null && want !== null && differs(k, actual, want)) {
          flag("contradictory_columns", `columns[${serving.i}].${k}`, `${FIELD_NAMES[k]} per serving is ${actual}, but the per-100 column suggests about ${want} for this serving size.`);
        }
      }
    }
  }
}
