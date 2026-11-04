// Focused tests: provider responses with MISSING nutrient fields must normalize to null,
// never to 0 or a fabricated value; a reported 0 must stay 0. (Phase 2.5 review, issue 2.)
import { describe, expect, it } from "vitest";
import { extractNutrients, normalizeUsdaFood } from "./usda";
import { extractOffNutrients, normalizeOffProduct } from "./openfoodfacts";

const flat = (id: number, unitName: string, value: unknown) => ({ nutrientId: id, unitName, value });
const nested = (id: number, unitName: string, amount: unknown) => ({ nutrient: { id, unitName }, amount });

describe("USDA: absent vs zero vs present", () => {
  it("a nutrient absent from the response is null (search shape)", () => {
    const n = extractNutrients([flat(1003, "G", 2.7)]);
    expect(n).toEqual({ kcal: null, protein: 2.7, carbs: null, fat: null, fiber: null });
  });

  it("a nutrient absent from the response is null (detail shape)", () => {
    const n = extractNutrients([nested(1003, "g", 2.7), nested(1004, "g", 0.3)]);
    expect(n).toEqual({ kcal: null, protein: 2.7, carbs: null, fat: 0.3, fiber: null });
  });

  it("a reported 0 stays 0 and is not treated as missing", () => {
    const n = extractNutrients([flat(1008, "KCAL", 165), flat(1003, "G", 31), flat(1005, "G", 0), flat(1004, "G", 3.6), flat(1079, "G", 0)]);
    expect(n.carbs).toBe(0);
    expect(n.fiber).toBe(0);
  });

  it("present but null / empty / non-numeric / negative values are null, not 0", () => {
    const n = extractNutrients([flat(1008, "KCAL", null), flat(1003, "G", ""), nested(1005, "g", undefined), flat(1004, "G", "abc"), flat(1079, "G", -1)]);
    expect(n).toEqual({ kcal: null, protein: null, carbs: null, fat: null, fiber: null });
  });

  it("energy reported only in kJ is not converted or guessed: kcal is null", () => {
    expect(extractNutrients([flat(1062, "kJ", 371), flat(1003, "G", 1)]).kcal).toBeNull();
  });

  it("energy reported only via Atwater ids (Foundation foods) is used", () => {
    expect(extractNutrients([flat(2047, "KCAL", 97)]).kcal).toBe(97);
    expect(extractNutrients([nested(2048, "kcal", 101)]).kcal).toBe(101);
  });

  it("an empty or missing foodNutrients list gives all nulls", () => {
    const all = { kcal: null, protein: null, carbs: null, fat: null, fiber: null };
    expect(extractNutrients([])).toEqual(all);
    expect(extractNutrients(undefined)).toEqual(all);
    expect(normalizeUsdaFood({ fdcId: 1, description: "x" })!.per100).toEqual(all);
  });

  it("search and detail shapes of the same food agree on which nutrients are missing", () => {
    const search = normalizeUsdaFood({ fdcId: 999001, description: "Rice", foodNutrients: [flat(1003, "G", 2.7)] })!;
    const detail = normalizeUsdaFood({ fdcId: 999001, description: "Rice", foodNutrients: [nested(1003, "g", 2.7)], foodPortions: [] })!;
    expect(detail.per100).toEqual(search.per100);
    expect(detail.per100.kcal).toBeNull();
  });
});

describe("Open Food Facts: absent vs zero vs present", () => {
  it("missing nutriment keys are null, reported 0 stays 0", () => {
    expect(extractOffNutrients({ "energy-kcal_100g": 0, proteins_100g: 0 })).toEqual({ kcal: 0, protein: 0, carbs: null, fat: null, fiber: null });
  });
  it("a product with no nutriments object at all has every nutrient null", () => {
    const f = normalizeOffProduct({ code: "1234567890128", product_name: "x" })!;
    expect(f.per100).toEqual({ kcal: null, protein: null, carbs: null, fat: null, fiber: null });
  });
});
