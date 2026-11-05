import { describe, expect, it } from "vitest";
import { hasNoNutrition, missingNutrients, missingText, recordOrigin, SOURCE_NOT_AVAILABLE } from "./food-provenance";

const none = { kcal: null, protein: null, carbs: null, fat: null, fiber: null };
const full = { kcal: 100, protein: 1, carbs: 2, fat: 3, fiber: 4 };

describe("where a record came from", () => {
  it("keeps the three sources distinct", () => {
    const badges = (["USDA", "OPEN_FOOD_FACTS", "CUSTOM"] as const).map((source) => recordOrigin({ source }).badge);
    expect(new Set(badges).size).toBe(3);
  });

  it("names USDA's data type when it's known, and doesn't invent one", () => {
    expect(recordOrigin({ source: "USDA", dataType: "SR Legacy" }).badge).toBe("USDA · SR Legacy");
    expect(recordOrigin({ source: "USDA", dataType: null }).badge).toBe("USDA");
  });

  it.each(["USDA", "OPEN_FOOD_FACTS", "CUSTOM"] as const)("never calls a %s record verified, accurate or lab-tested", (source) => {
    const { badge, detail } = recordOrigin({ source });
    expect(`${badge} ${detail}`).not.toMatch(/verified|accurate|laborator|lab-tested|guarantee/i);
  });

  it("never says a custom food came from a label or scan, as that isn't stored", () => {
    for (const dataType of [null, "Custom", "Label"]) {
      const { badge, detail } = recordOrigin({ source: "CUSTOM", dataType });
      expect(`${badge} ${detail}`).not.toMatch(/label|scan|AI\b/i);
    }
  });

  it("says when the record is gone, rather than guessing what it was", () => {
    expect(SOURCE_NOT_AVAILABLE).toMatch(/no longer available/);
  });
});

describe("incomplete records", () => {
  it("a complete record has nothing to say", () => {
    expect(missingNutrients(full)).toEqual([]);
    expect(missingText(full)).toBeNull();
  });

  it("names exactly what's missing, and doesn't treat it as 0", () => {
    const values = { ...full, protein: null, fat: null };
    expect(missingNutrients(values)).toEqual(["protein", "fat"]);
    expect(missingText(values)).toBe("Missing: protein, fat. Not counted as 0.");
  });

  it("a reported 0 isn't missing", () => {
    expect(missingNutrients({ ...full, fat: 0, kcal: 0 })).toEqual([]);
  });

  it("missing fiber alone doesn't make a record incomplete", () => {
    expect(missingText({ ...full, fiber: null })).toBeNull();
  });

  it("knows a record with no nutrition at all", () => {
    expect(hasNoNutrition(none)).toBe(true);
    expect(hasNoNutrition({ ...none, fiber: 0 })).toBe(false);
    expect(missingText(none)).toBe("Missing: calories, protein, carbs, fat. Not counted as 0.");
  });
});
