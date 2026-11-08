import { describe, expect, it } from "vitest";
import { MAX_CANDIDATES, isSameRecord, packageQuery, rankCandidates } from "./package-match";
import type { SearchItem } from "@/lib/server/foods/service";

type N = SearchItem["per100"];
const full: N = { kcal: 100, protein: 5, carbs: 10, fat: 2, fiber: 1 };
const item = (source: SearchItem["source"], id: string, name: string, brand: string | null = null, per100: N = full): SearchItem => {
  const values = Object.values(per100);
  return { key: `${source}:${id}`, foodId: source === "CUSTOM" ? `food-${id}` : null, source, sourceId: id, name, brand, dataType: null, basisUnit: "G", per100, servings: [], complete: values.every((v) => v !== null), hasNutrition: values.some((v) => v !== null) };
};
const response = (r: Partial<Record<SearchItem["source"], SearchItem[]>>) => ({ results: { USDA: [], OPEN_FOOD_FACTS: [], CUSTOM: [], ...r } });
const lines = ["Acme", "Crunchy Oat Granola"];

describe("packageQuery", () => {
  it("uses the first two lines, trimmed to the search box's length", () => {
    expect(packageQuery(["Acme", "Crunchy Oat Granola", "Honey"])).toBe("Acme Crunchy Oat Granola");
    expect(packageQuery([])).toBe("");
    expect(packageQuery(["x".repeat(50), "y".repeat(50)]).length).toBeLessThanOrEqual(60);
  });
});

describe("rankCandidates", () => {
  it("puts the record sharing the most words first, and says which words matched", () => {
    const r = rankCandidates(response({
      USDA: [item("USDA", "1", "Granola, oat")],
      OPEN_FOOD_FACTS: [item("OPEN_FOOD_FACTS", "3", "Crunchy Oat Granola", "Acme")],
    }), lines);
    expect(r.map((c) => [c.sourceId, c.shared, c.partial])).toEqual([["3", 4, false], ["1", 2, false]]);
    expect(r[0].matched.sort()).toEqual(["acme", "crunchy", "granola", "oat"]);
  });
  it("doesn't offer a record sharing no word, or only the brand (the same maker's other products)", () => {
    const r = rankCandidates(response({ OPEN_FOOD_FACTS: [item("OPEN_FOOD_FACTS", "2", "Muesli", "Other"), item("OPEN_FOOD_FACTS", "4", "Peanut Butter", "Acme")] }), lines);
    expect(r).toEqual([]);
  });
  it("marks a record matching under half the searched words as partial", () => {
    const [c] = rankCandidates(response({ USDA: [item("USDA", "5", "Granola bar, chewy")] }), ["Acme", "Crunchy Oat Granola"]);
    expect([c.shared, c.partial]).toEqual([1, true]);
  });
  it("shows records that would look the same once, and each record once", () => {
    const a = item("OPEN_FOOD_FACTS", "6", "Crunchy Oat Granola", "Acme");
    const r = rankCandidates(response({ OPEN_FOOD_FACTS: [a, a, { ...a, key: "OPEN_FOOD_FACTS:7", sourceId: "7" }], CUSTOM: [{ ...a, key: "CUSTOM:8", source: "CUSTOM", sourceId: "8", foodId: "f8" }] }), lines);
    expect(r.map((c) => c.key)).toEqual(["OPEN_FOOD_FACTS:6"]);
    const different = rankCandidates(response({ OPEN_FOOD_FACTS: [a, { ...a, key: "OPEN_FOOD_FACTS:9", sourceId: "9", per100: { ...full, kcal: 450 } }] }), lines);
    expect(different).toHaveLength(2);
  });
  it("puts complete records before ones missing some nutrients, and those before ones with none, on a tie", () => {
    const none = item("OPEN_FOOD_FACTS", "10", "Crunchy Oat Granola", "Acme", { kcal: null, protein: null, carbs: null, fat: null, fiber: null });
    const some = item("OPEN_FOOD_FACTS", "11", "Crunchy Oat Granola", "Acme", { ...full, fiber: null, kcal: 300 });
    const all = item("OPEN_FOOD_FACTS", "12", "Crunchy Oat Granola", "Acme", { ...full, kcal: 400 });
    expect(rankCandidates(response({ OPEN_FOOD_FACTS: [none, some, all] }), lines).map((c) => c.sourceId)).toEqual(["12", "11", "10"]);
  });
  it("returns at most five", () => {
    const many = Array.from({ length: 9 }, (_, i) => item("OPEN_FOOD_FACTS", String(i), `Granola ${i}`, null, { ...full, kcal: 100 + i }));
    expect(rankCandidates(response({ OPEN_FOOD_FACTS: many }), lines)).toHaveLength(MAX_CANDIDATES);
  });
  it("never changes a record's values, including a missing one", () => {
    const missing = item("OPEN_FOOD_FACTS", "13", "Acme Granola", "Acme", { kcal: null, protein: 4, carbs: null, fat: null, fiber: null });
    const [c] = rankCandidates(response({ OPEN_FOOD_FACTS: [missing] }), lines);
    expect(c.per100).toEqual(missing.per100);
    expect(c.per100.kcal).toBeNull();
  });
  it("makes nothing up when nothing was found", () => {
    expect(rankCandidates(response({}), lines)).toEqual([]);
  });
});

describe("words the person typed", () => {
  it("count as the package's, so correcting a misread word still finds the product", () => {
    const [c] = rankCandidates(response({ OPEN_FOOD_FACTS: [item("OPEN_FOOD_FACTS", "20", "Greek Yoghurt", "Hillside")] }), ["HILLSIDE", "Greek Yoqhurt"], "Hillside Greek Yoghurt");
    expect([c.sourceId, c.partial]).toEqual(["20", false]);
  });
});

describe("isSameRecord", () => {
  it("accepts only the record chosen", () => {
    const off = item("OPEN_FOOD_FACTS", "123", "X");
    expect(isSameRecord(off, { id: "any", source: "OPEN_FOOD_FACTS", sourceId: "123" })).toBe(true);
    expect(isSameRecord(off, { id: "any", source: "OPEN_FOOD_FACTS", sourceId: "124" })).toBe(false);
    expect(isSameRecord(off, { id: "any", source: "USDA", sourceId: "123" })).toBe(false);
    const mine = item("CUSTOM", "c1", "Mine");
    expect(isSameRecord(mine, { id: "food-c1", source: "CUSTOM", sourceId: "whatever" })).toBe(true);
    expect(isSameRecord(mine, { id: "food-c2", source: "CUSTOM", sourceId: "whatever" })).toBe(false);
  });
});
