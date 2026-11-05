/**
 * The rules for reviewing a scanned label before it's saved as a food. Pure functions, so every rule
 * can be tested without a browser. A person's confirmed values are what get saved. Nothing here fills
 * in a missing value, guesses a serving weight, or converts between grams and millilitres.
 */
import { checkLabelExtraction, isGramUnit, isKcalUnit, metricServing, type LabelColumn, type LabelExtraction, type LabelFlag } from "./label-extraction";
import { NUTRIENT_KEYS, scaleNutrients, type NutrientKey, type Nutrients } from "./nutrition";
import { customFoodSchema } from "./validation";

export type ColumnBasis = LabelColumn["basis"];
export type UsableBasis = Exclude<ColumnBasis, "other">;
export type BasisUnit = "G" | "ML";
export type FieldStatus = LabelExtraction["productName"]["status"] | "manual";

/** One value in the form. `value` is what the person sees and edits. `initial` is what the scan gave. */
export interface ReviewField {
  value: string;
  initial: string;
  status: FieldStatus;
  /** The exact text on the label, shown as evidence. */
  printed: string | null;
  /** Why a value printed on the label wasn't filled in, or why it can't be read. */
  note: string | null;
}

export interface ColumnDraft {
  basis: ColumnBasis;
  printedHeading: string | null;
  nutrients: Record<NutrientKey, ReviewField>;
}

export interface ReviewDraft {
  name: ReviewField;
  brand: ReviewField;
  servingLabel: string;
  servingAmount: ReviewField;
  servingUnit: BasisUnit | "";
  initialServingUnit: BasisUnit | "";
  /** Can be corrected, which also settles any warning about it, but the food API has nowhere to save it. */
  servingsPerContainer: ReviewField;
  /** One for each column on the label, in the same order, followed by one for manual entry. */
  columns: ColumnDraft[];
  active: number;
}

export const NUTRIENT_LABELS: Record<NutrientKey, string> = { kcal: "Calories", protein: "Protein", carbs: "Carbohydrate", fat: "Fat", fiber: "Fiber" };
export const NUTRIENT_UNITS: Record<NutrientKey, string> = { kcal: "kcal", protein: "g", carbs: "g", fat: "g", fiber: "g" };
export const BASIS_LABELS: Record<ColumnBasis, string> = { per_serving: "Per serving", per_100g: "Per 100 g", per_100ml: "Per 100 ml", other: "Other" };

const blankField = (): ReviewField => ({ value: "", initial: "", status: "manual", printed: null, note: null });

function textField(field: LabelExtraction["productName"]): ReviewField {
  const value = field.status === "read" ? (field.value ?? "") : "";
  return { value, initial: value, status: field.status, printed: field.printed, note: field.reason };
}

function nutrientField(key: NutrientKey, field: LabelColumn[NutrientKey]): ReviewField {
  const base = { status: field.status, printed: field.printed, note: field.reason };
  if (field.status !== "read") return { value: "", initial: "", ...base };
  const unit = field.unit;
  if (key === "kcal" ? !isKcalUnit(unit) : !isGramUnit(unit)) {
    const wanted = NUTRIENT_UNITS[key];
    return { value: "", initial: "", ...base, note: `Printed as "${field.printed}", not in ${wanted}. It wasn't converted, so enter the ${wanted} value if you can confirm it.` };
  }
  if (field.value === null) return { value: "", initial: "", ...base, note: `Printed as "${field.printed}", which isn't an exact number. Enter a value only if you can confirm one.` };
  if (field.value < 0) return { value: "", initial: "", ...base, note: `Read as ${field.value}, which can't be right.` };
  const value = String(field.value);
  return { value, initial: value, ...base };
}

function countField(field: LabelExtraction["servingsPerContainer"]): ReviewField {
  const base = { status: field.status, printed: field.printed, note: field.reason };
  if (field.status !== "read" || field.value === null || field.value < 0) return { value: "", initial: "", ...base };
  const value = String(field.value);
  return { value, initial: value, ...base };
}

function columnDraft(col: LabelColumn): ColumnDraft {
  const nutrients = {} as Record<NutrientKey, ReviewField>;
  for (const k of NUTRIENT_KEYS) nutrients[k] = nutrientField(k, col[k]);
  return { basis: col.basis, printedHeading: col.printedHeading, nutrients };
}

const manualColumn = (): ColumnDraft => {
  const nutrients = {} as Record<NutrientKey, ReviewField>;
  for (const k of NUTRIENT_KEYS) nutrients[k] = blankField();
  return { basis: "per_serving", printedHeading: null, nutrients };
};

export function buildReviewDraft(e: LabelExtraction): ReviewDraft {
  const serving = e.servingSize;
  const metric = metricServing(serving);
  const amount = metric ? String(metric.amount) : "";
  const servingUnit = metric?.basis ?? "";
  const columns = [...e.columns.map(columnDraft), manualColumn()];
  const firstUsable = columns.findIndex((c) => c.basis !== "other");
  return {
    name: textField(e.productName),
    brand: textField(e.brand),
    // A metric amount is shown separately, so naming it again would read "30 g (30 g)" once saved.
    servingLabel: serving.status === "read" && !metric && serving.printed ? serving.printed.slice(0, 80) : "1 serving",
    servingAmount: {
      value: amount,
      initial: amount,
      status: serving.status,
      printed: serving.printed,
      note: serving.status === "unreadable"
        ? serving.reason
        : serving.status === "read" && !metric
          ? `"${serving.printed}" isn't a gram or millilitre amount, so its weight or volume must be entered. It won't be guessed.`
          : null,
    },
    servingUnit,
    initialServingUnit: servingUnit,
    servingsPerContainer: countField(e.servingsPerContainer),
    columns,
    active: firstUsable,
  };
}

const MANUAL_BASES: UsableBasis[] = ["per_serving", "per_100g", "per_100ml"];
export const manualBases = () => MANUAL_BASES;
export const isManualColumn = (draft: ReviewDraft, index: number) => index === draft.columns.length - 1;

// ─── Numbers ────────────────────────────────────────────────────────────────

export type ParsedNumber = { kind: "empty" } | { kind: "number"; value: number } | { kind: "invalid"; message: string };

/**
 * Strict on purpose. An empty field is empty, never 0, and "1,200" is refused rather than read as
 * either 1.2 or 1200. A decimal comma such as "12,5" is accepted, because labels print them.
 */
export function parseReviewNumber(input: string): ParsedNumber {
  const text = input.trim();
  if (text === "") return { kind: "empty" };
  if (/^\d+,\d{3}$/.test(text)) return { kind: "invalid", message: "Write this without a comma, such as 1200 or 1.2" };
  if (!/^\d+(?:[.,]\d+)?$/.test(text) && !/^[.,]\d+$/.test(text)) return { kind: "invalid", message: "Enter a number, such as 12.5" };
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? { kind: "number", value } : { kind: "invalid", message: "Enter a number, such as 12.5" };
}

// ─── Where each value came from ─────────────────────────────────────────────

export type FieldOrigin =
  /** As the scan read it, not yet confirmed. */
  | "ai"
  /** The person changed what the scan read. */
  | "corrected"
  /** The scan had no value, and the person supplied one. */
  | "entered"
  /** The person removed what the scan read. */
  | "cleared"
  /** The label doesn't report it. */
  | "missing"
  /** It's on the label but couldn't be read. */
  | "unreadable"
  /** It's printed, but not as a usable value. */
  | "needs_value";

const sameText = (a: string, b: string) => a.trim() === b.trim();
function sameValue(a: string, b: string) {
  const [x, y] = [parseReviewNumber(a), parseReviewNumber(b)];
  return x.kind === "number" && y.kind === "number" ? x.value === y.value : sameText(a, b);
}

export function fieldOrigin(field: ReviewField): FieldOrigin {
  if (field.value.trim() === "") {
    if (field.initial.trim() !== "") return "cleared";
    if (field.status === "unreadable") return "unreadable";
    return field.status === "read" ? "needs_value" : "missing";
  }
  if (field.initial.trim() === "") return "entered";
  return sameValue(field.value, field.initial) ? "ai" : "corrected";
}

/** A serving is the amount and its unit together, so changing only the unit is a correction too. */
export function servingOrigin(draft: ReviewDraft): FieldOrigin {
  const origin = fieldOrigin(draft.servingAmount);
  return origin === "ai" && draft.servingUnit !== draft.initialServingUnit ? "corrected" : origin;
}

export const ORIGIN_LABELS: Record<FieldOrigin, string> = {
  ai: "Read by AI",
  corrected: "Corrected by you",
  entered: "Entered by you",
  cleared: "Removed by you",
  missing: "Not on label",
  unreadable: "Couldn't read",
  needs_value: "Needs a value",
};

// ─── Validation ─────────────────────────────────────────────────────────────

export type FoodPayload = ReturnType<typeof customFoodSchema.parse>;

export interface ReviewProblem { field: string; message: string }

export interface ReviewValidation {
  problems: ReviewProblem[];
  /** What would be sent to POST /api/foods, or null while anything is unresolved. */
  payload: FoodPayload | null;
  /** What the server would store, or null while anything is unresolved. */
  per100: Nutrients | null;
}

const REQUIRED: NutrientKey[] = ["kcal", "protein", "carbs", "fat"];

function missingMessage(key: NutrientKey, field: ReviewField): string {
  const name = NUTRIENT_LABELS[key];
  switch (fieldOrigin(field)) {
    case "unreadable": return `${name} couldn't be read. Enter it from the package, or this food can't be saved.`;
    case "needs_value": return `${name} needs a value in ${NUTRIENT_UNITS[key]}. Enter it from the package, or this food can't be saved.`;
    case "cleared": return `${name} is empty. Enter a value, using 0 only if the label says 0.`;
    default: return field.status === "manual"
      ? `Enter ${name.toLowerCase()} from the label, using 0 only if the label says 0.`
      : `${name} isn't on the label. Enter it from the package if you can confirm it, or this food can't be saved. Don't enter 0 unless the label says 0.`;
  }
}

const requiredBasisUnit = (basis: ColumnBasis): BasisUnit | null => (basis === "per_100g" ? "G" : basis === "per_100ml" ? "ML" : null);

export function validateReview(draft: ReviewDraft): ReviewValidation {
  const problems: ReviewProblem[] = [];
  const problem = (field: string, message: string) => problems.push({ field, message });
  const column = draft.columns[draft.active];

  if (!column) problem("column", "Choose the nutrition column to save, or enter the values yourself.");
  else if (column.basis === "other") problem("column", "This column isn't per serving, per 100 g or per 100 ml, so it can't be saved. Choose another, or enter the values yourself.");

  if (draft.name.value.trim() === "") problem("name", "Enter the product name.");

  const amount = parseReviewNumber(draft.servingAmount.value);
  if (amount.kind === "empty") {
    problem("servingAmount", draft.servingAmount.status === "read"
      ? `Enter how many grams or millilitres a serving ("${draft.servingAmount.printed}") is. It won't be guessed.`
      : "Enter the size of a serving in grams or millilitres. It isn't on the label, so it won't be guessed.");
  } else if (amount.kind === "invalid") {
    problem("servingAmount", `Serving size: ${amount.message}.`);
  } else if (amount.value <= 0) {
    problem("servingAmount", "A serving must be more than 0.");
  }
  if (draft.servingUnit === "") problem("servingUnit", "Choose whether the serving is measured in grams or millilitres.");
  if (draft.servingLabel.trim() === "") problem("servingLabel", "Enter a name for the serving, such as 1 cup.");
  const servings = parseReviewNumber(draft.servingsPerContainer.value);
  if (servings.kind === "invalid") problem("servingsPerContainer", `Servings per container: ${servings.message}.`);

  // A per-100 g value can't apply to a serving in ml, or the reverse, as density isn't known.
  const needed = column ? requiredBasisUnit(column.basis) : null;
  if (needed && draft.servingUnit !== "" && draft.servingUnit !== needed) {
    const [have, want] = needed === "G" ? ["ml", "g"] : ["g", "ml"];
    problem("servingUnit", `This column is per 100 ${want}, but the serving is in ${have}. They can't be converted without knowing the density. Enter the serving in ${want}, or use another column.`);
  }

  const values = {} as Nutrients;
  if (column) {
    for (const key of NUTRIENT_KEYS) {
      const field = column.nutrients[key];
      const parsed = parseReviewNumber(field.value);
      values[key] = parsed.kind === "number" ? parsed.value : null;
      if (parsed.kind === "invalid") problem(key, `${NUTRIENT_LABELS[key]}: ${parsed.message}.`);
      else if (parsed.kind === "empty" && REQUIRED.includes(key)) problem(key, missingMessage(key, field));
    }
  }

  if (problems.length > 0 || amount.kind !== "number" || !column || draft.servingUnit === "") return { problems, payload: null, per100: null };

  // The API takes per-serving values and stores per-100. More decimals are kept here so that a
  // small serving doesn't lose accuracy on the way back: 0.08 g in 1 g would store 8, not 8.3.
  const perServing = needed ? scaleNutrients(values, amount.value, 6) : values;
  const candidate = {
    name: draft.name.value.trim(),
    brand: draft.brand.value.trim() || null,
    basisUnit: draft.servingUnit,
    servingLabel: draft.servingLabel.trim(),
    servingAmount: amount.value,
    perServing: { kcal: perServing.kcal, protein: perServing.protein, carbs: perServing.carbs, fat: perServing.fat, fiber: perServing.fiber },
  };

  // The same rules the server enforces, so an answer here is the answer there.
  const parsed = customFoodSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      const key = path.startsWith("perServing.") ? path.slice("perServing.".length) : path;
      problems.push({ field: key, message: issue.message });
    }
    return { problems, payload: null, per100: null };
  }
  return { problems, payload: parsed.data, per100: needed ? values : scaleNutrients(values, 10_000 / amount.value, 6) };
}

// ─── Warnings ───────────────────────────────────────────────────────────────

function readValue(field: ReviewField, unit: string, original?: LabelColumn[NutrientKey]) {
  const parsed = parseReviewNumber(field.value);
  if (parsed.kind !== "number") return { status: "absent", value: null, unit: null, printed: null, reason: null } as const;
  // A value left as scanned is judged against the label text. A corrected one is the person's own.
  const printed = fieldOrigin(field) === "ai" && field.printed ? field.printed : String(parsed.value);
  return { status: "read", value: parsed.value, unit: fieldOrigin(field) === "ai" && original ? original.unit : unit, printed, reason: null } as const;
}

/**
 * The scan's checks, run again on the values as they stand now, so a correction can clear a warning
 * and create one. Columns other than the one being edited are judged as the scan read them.
 */
export function reviewFlags(draft: ReviewDraft, e: LabelExtraction): LabelFlag[] {
  const column = draft.columns[draft.active];
  const columns = [...e.columns];
  if (column) {
    const original = e.columns[draft.active];
    const edited = { basis: column.basis, printedHeading: column.printedHeading } as LabelColumn;
    for (const k of NUTRIENT_KEYS) {
      const field = column.nutrients[k];
      // Left empty, it's judged as the scan read it. Removed by the person, it has nothing to judge.
      if (field.value.trim() === "" && field.initial.trim() === "" && original) edited[k] = original[k];
      else edited[k] = readValue(field, NUTRIENT_UNITS[k], original?.[k]);
    }
    columns[draft.active] = edited;
  }

  const amount = parseReviewNumber(draft.servingAmount.value);
  const servingEdited = amount.kind === "number" && draft.servingUnit !== "" && (!sameValue(draft.servingAmount.value, draft.servingAmount.initial) || draft.servingUnit !== draft.initialServingUnit);
  const servingSize: LabelExtraction["servingSize"] = servingEdited
    ? { status: "read", amount: amount.value, unit: draft.servingUnit === "ML" ? "ml" : "g", printed: `${amount.value} ${draft.servingUnit === "ML" ? "ml" : "g"}`, reason: null }
    : e.servingSize;

  const count = draft.servingsPerContainer;
  const countValue = parseReviewNumber(count.value);
  const servingsPerContainer: LabelExtraction["servingsPerContainer"] = fieldOrigin(count) === "ai" || (count.value.trim() === "" && count.initial.trim() === "")
    ? e.servingsPerContainer
    : countValue.kind === "number"
      ? { status: "read", value: countValue.value, printed: String(countValue.value), reason: null }
      : { status: "absent", value: null, printed: null, reason: null };

  return checkLabelExtraction({ ...e, servingSize, servingsPerContainer, columns });
}

/** Whether a warning is about the given field of the column being edited. */
export const flagTargets = (flag: LabelFlag, active: number, key: NutrientKey) => flag.field === `columns[${active}].${key}`;

export interface SavePreview {
  serving: Nutrients;
  per100: Nutrients;
  unit: "g" | "ml";
  amount: number;
  label: string;
}

/** Exactly what will be saved, in both forms, for the person to confirm. */
export function savePreview(validation: ReviewValidation): SavePreview | null {
  const { payload, per100 } = validation;
  if (!payload || !per100) return null;
  return {
    serving: scaleNutrients(per100, payload.servingAmount),
    per100: scaleNutrients(per100, 100),
    unit: payload.basisUnit === "ML" ? "ml" : "g",
    amount: payload.servingAmount,
    label: payload.servingLabel,
  };
}
