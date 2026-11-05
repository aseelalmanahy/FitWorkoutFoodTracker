// A valid label reading, and helpers to change one thing at a time. These stand in for provider output.
import type { LabelColumn, LabelExtraction } from "@/lib/label-extraction";

export const absentText = { status: "absent", value: null, printed: null, reason: null } as const;
export const absentNutrient = { status: "absent", value: null, unit: null, printed: null, reason: null } as const;
export const absentServing = { status: "absent", amount: null, unit: null, printed: null, reason: null } as const;
export const unreadableNutrient = { status: "unreadable", value: null, unit: null, printed: null, reason: "Blurred" } as const;

export const text = (value: string, printed = value) => ({ status: "read", value, printed, reason: null }) as const;
export const count = (value: number, printed = String(value)) => ({ status: "read", value, printed, reason: null }) as const;
export const nutrient = (value: number | null, printed: string, unit: string | null = "g") => ({ status: "read", value, unit, printed, reason: null }) as const;
export const serving = (amount: number | null, unit: string | null, printed: string) => ({ status: "read", amount, unit, printed, reason: null }) as const;

/** 30 g serving, consistent per serving and per 100 g: oats-like, 120 kcal per serving. */
export const perServing = (over: Partial<LabelColumn> = {}): LabelColumn => ({
  basis: "per_serving",
  printedHeading: "Per serving (30 g)",
  kcal: nutrient(120, "120 kcal", "kcal"),
  protein: nutrient(4, "4 g"),
  carbs: nutrient(20, "20 g"),
  fat: nutrient(2.5, "2.5 g"),
  fiber: nutrient(3, "3 g"),
  ...over,
});
export const per100g = (over: Partial<LabelColumn> = {}): LabelColumn => ({
  basis: "per_100g",
  printedHeading: "Per 100 g",
  kcal: nutrient(400, "400 kcal", "kcal"),
  protein: nutrient(13.3, "13.3 g"),
  carbs: nutrient(66.7, "66.7 g"),
  fat: nutrient(8.3, "8.3 g"),
  fiber: nutrient(10, "10 g"),
  ...over,
});

export const goodLabel = (over: Partial<LabelExtraction> = {}): LabelExtraction => ({
  isNutritionLabel: true,
  productName: text("Rolled Oats"),
  brand: text("Hearth"),
  servingSize: serving(30, "g", "30 g"),
  servingsPerContainer: count(16, "about 16"),
  columns: [perServing(), per100g()],
  ...over,
});

export const notALabel = (): LabelExtraction => ({
  isNutritionLabel: false,
  productName: absentText,
  brand: absentText,
  servingSize: absentServing,
  servingsPerContainer: absentText,
  columns: [],
});
