/**
 * What a food record can honestly say about itself. Pure functions, using only what's stored. Where
 * something came from is a different claim from whether it's accurate, and from whether it's the food
 * on the plate, so nothing here says "verified". A saved label is stored like any custom food, so
 * nothing here can say a custom food came from a label either.
 */
import { NUTRIENT_LABELS_SHORT, type NutrientKey, type Nutrients } from "./nutrition";

export type RecordSource = "USDA" | "OPEN_FOOD_FACTS" | "CUSTOM";

export interface RecordOrigin {
  /** A short name for a list. */
  badge: string;
  /** What the record is, in a sentence. */
  detail: string;
}

export function recordOrigin(food: { source: RecordSource; dataType?: string | null }): RecordOrigin {
  if (food.source === "USDA") return { badge: food.dataType ? `USDA · ${food.dataType}` : "USDA", detail: "A public USDA FoodData Central record." };
  if (food.source === "OPEN_FOOD_FACTS") return { badge: "Open Food Facts", detail: "A community-contributed product record. Compare it with the package if you have it." };
  return { badge: "My food", detail: "Values entered or confirmed in your account. No one has independently checked them." };
}

/** For a diary entry whose record has since been deleted. Its own saved values remain. */
export const SOURCE_NOT_AVAILABLE = "The source record is no longer available. These are the values saved when this was logged.";

const MAIN: NutrientKey[] = ["kcal", "protein", "carbs", "fat"];

/** The main values a record doesn't report. Fiber is often absent, so it doesn't make a record incomplete. */
export const missingNutrients = (values: Nutrients): NutrientKey[] => MAIN.filter((key) => values[key] == null);

export const hasNoNutrition = (values: Nutrients) => Object.values(values).every((value) => value == null);

/** Null when nothing is missing. Never suggests a value, or that a missing value is 0. */
export function missingText(values: Nutrients): string | null {
  const missing = missingNutrients(values);
  return missing.length ? `Missing: ${missing.map((key) => NUTRIENT_LABELS_SHORT[key]).join(", ")}. Not counted as 0.` : null;
}
