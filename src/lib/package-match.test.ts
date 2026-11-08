import { describe, expect, it } from "vitest";
import { MAX_CANDIDATES, packageQuery, rankCandidates } from "./package-match";
import type { SearchItem } from "@/lib/server/foods/service";

const item = (source: SearchItem["source"], id: string, name: string, brand: string | null = null, kcal: number | null = 100): SearchItem => ({
  key: `${source}:${id}`, foodId: null, source, sourceId: id, name, brand, dataType: null, basisUnit: "G",
  per100: { kcal, protein: null, carbs: null, fat: null, fiber: null }, servings: [], complete: false, hasNutrition: kcal !== null,
});
const response = (r: Partial<Record<SearchItem["source"], SearchItem[]>>) => ({ results: { USDA: [], OPEN_FOOD_FACTS: [], CUSTOM: [], ...r } });

describe("packageQuery", () => {
  it("uses the first two lines, trimmed to the search box's length", () => {
    expect(packageQuery(["Acme", "Crunchy Oat Granola", "Honey"])).toBe("Acme Crunchy Oat Granola");
    expect(packageQuery([])).toBe("");
    expect(packageQuery(["x".repeat(50), "y".repeat(50)]).length).toBeLessThanOrEqual(60);
  });
});

describe("rankCandidates", () => {
  const lines = ["Acme", "Crunchy Oat Granola"];
  it("puts the record sharing the most words first, and packaged products first on a tie", () => {
    const r = rankCandidates(response({
      USDA: [item("USDA", "1", "Granola, oat")],
      OPEN_FOOD_FACTS: [item("OPEN_FOOD_FACTS", "2", "Muesli", "Other"), item("OPEN_FOOD_FACTS", "3", "Crunchy Oat Granola", "Acme")],
    }), lines);
    expect(r.map((c) => [c.sourceId, c.shared])).toEqual([["3", 4], ["1", 2], ["2", 0]]);
  });
  it("returns at most five, and each record once", () => {
    const many = Array.from({ length: 9 }, (_, i) => item("OPEN_FOOD_FACTS", String(i), `Granola ${i}`));
    const r = rankCandidates(response({ OPEN_FOOD_FACTS: [...many, many[0]] }), lines);
    expect(r).toHaveLength(MAX_CANDIDATES);
    expect(new Set(r.map((c) => c.key)).size).toBe(MAX_CANDIDATES);
  });
  it("never changes a record's values, including a missing one", () => {
    const missing = item("OPEN_FOOD_FACTS", "9", "Acme Granola", "Acme", null);
    const [c] = rankCandidates(response({ OPEN_FOOD_FACTS: [missing] }), lines);
    expect(c.per100).toEqual(missing.per100);
    expect(c.per100.kcal).toBeNull();
    expect(c.hasNutrition).toBe(false);
  });
  it("makes nothing up when nothing was found", () => {
    expect(rankCandidates(response({}), lines)).toEqual([]);
  });
});
