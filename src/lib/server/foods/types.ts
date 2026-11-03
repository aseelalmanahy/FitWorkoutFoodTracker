import type { Nutrients } from "@/lib/nutrition";

export type ExternalSource = "USDA" | "OPEN_FOOD_FACTS";

export interface ServingOption {
  label: string;
  /** Amount in the food's basis unit (g or ml). */
  amount: number;
}

/** Source-independent shape of a food from an external database. */
export interface NormalizedFood {
  source: ExternalSource;
  sourceId: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  dataType: string | null;
  basisUnit: "G" | "ML";
  per100: Nutrients;
  /** First entry is the default serving. */
  servings: ServingOption[];
}

export type ExternalErrorKind = "not_configured" | "timeout" | "http" | "rate_limited" | "invalid_response" | "network" | "not_found";

export class ExternalFoodError extends Error {
  constructor(public source: ExternalSource, public kind: ExternalErrorKind, message: string) {
    super(message);
  }
}

export const SOURCE_LABELS: Record<ExternalSource | "CUSTOM", string> = {
  USDA: "USDA FoodData Central",
  OPEN_FOOD_FACTS: "Open Food Facts",
  CUSTOM: "My food",
};

/** Parse a nutrient value; anything non-finite or negative is treated as not reported. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const hasAnyNutrient = (n: Nutrients) => Object.values(n).some((v) => v != null);
