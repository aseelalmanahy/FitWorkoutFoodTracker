// AI-01: label text to a draft extraction. The OCR texts below are exactly what tesseract.js 6.0.1 read from rendered
// labels on 2026-11-07, misreadings included. No OCR runs here.
import { describe, expect, it } from "vitest";
import { amounts, labelNumber, mergeReadings, parseLabelText } from "./text-parse";
import { checkLabelExtraction, parseLabelExtraction } from "@/lib/label-extraction";

const US_OCR = `Nutrition Facts

8 servings per container

Serving size 2/3 cup (55g)
|
Amount per serving

Calories 230
Total Fat 8g

Saturated Fat 1g

Sodium 160mg

Total Carbohydrate 37g

Dietary Fiber 4g

Total Sugars 12g

Protein 3g`;

const US_OCR_MISREAD = US_OCR.replace("(55g)", "(559)");

const EU_OCR = `Nutrition information
Per100 g       Per 30 g portion
Energy         1580 kJ / 375 kcal 474 kJ / 113 kcal
Fat               6,59                   20g
Carbohydrate 62g                   1949
Fibre             90g                   2,79
Protein           129                    3649
Salt            0,02 ¢g              0,019`;

const EU_CLEAN = `Nutrition information
Per 100 g Per 30 g portion
Energy 1580 kJ / 375 kcal 474 kJ / 113 kcal
Fat 6,5 g 2,0 g
Carbohydrate 62 g 19 g
Fibre 9,0 g 2,7 g
Protein 12 g 3,6 g`;

describe("numbers", () => {
  it.each([["6,5", 6.5], ["6.5", 6.5], ["1,580", 1580], ["0,02", 0.02], ["230", 230], ["12a", null]])("%s → %s", (t, v) => expect(labelNumber(t)).toBe(v));
  it("ignores percentages of daily value, and keeps units", () => {
    expect(amounts("8g 10%").map((t) => [t.value, t.unit])).toEqual([[8, "g"]]);
    expect(amounts("1580 kJ / 375 kcal").map((t) => t.unit)).toEqual(["kJ", "kcal"]);
  });
  it("a '<' amount isn't exact", () => expect(amounts("<0.5 g")[0].value).toBeNull());
});

describe("a US label read cleanly", () => {
  const e = parseLabelText(US_OCR);
  it("is valid input for the review screen", () => expect(parseLabelExtraction(e).ok).toBe(true));
  it("reads each value with its unit and its exact printed text", () => {
    expect(e.isNutritionLabel).toBe(true);
    expect(e.columns).toHaveLength(1);
    const c = e.columns[0];
    expect(c.basis).toBe("per_serving");
    expect([c.kcal.value, c.kcal.unit, c.fat.value, c.carbs.value, c.fiber.value, c.protein.value]).toEqual([230, "kcal", 8, 37, 4, 3]);
    expect(c.fat.printed).toBe("8g");
    expect(e.servingSize).toMatchObject({ status: "read", amount: 55, unit: "g" });
    expect(e.servingsPerContainer).toMatchObject({ status: "read", value: 8 });
  });
  it("never takes saturated fat or sugars for fat or carbohydrate", () => {
    const c = parseLabelText("Saturated Fat 1g\nTotal Sugars 12g\nProtein 3g\nCalories 50").columns[0];
    expect(c.fat.status).toBe("absent");
    expect(c.carbs.status).toBe("absent");
  });
  it("doesn't guess a product name or brand", () => {
    expect(e.productName.status).toBe("absent");
    expect(e.brand.status).toBe("absent");
  });
  it("the review checks find nothing wrong with a consistent label", () => {
    expect(checkLabelExtraction(e).filter((f) => f.code !== "energy_macro_mismatch")).toEqual([]);
  });
});

describe("misreadings are never accepted as values", () => {
  it("a serving whose unit became a digit is unreadable, with the printed text kept", () => {
    const e = parseLabelText(US_OCR_MISREAD);
    expect(e.servingSize).toMatchObject({ status: "unreadable", amount: null });
    expect(e.servingSize.printed).toContain("(559)");
  });
  it("on the EU label, every amount whose unit was lost is unreadable, and only clean ones are read", () => {
    const e = parseLabelText(EU_OCR);
    expect(parseLabelExtraction(e).ok).toBe(true);
    expect(e.columns.map((c) => c.basis)).toEqual(["per_100g", "per_serving"]);
    const [per100, portion] = e.columns;
    expect([per100.kcal.value, per100.kcal.unit, portion.kcal.value]).toEqual([375, "kcal", 113]);
    expect(per100.fat).toMatchObject({ status: "unreadable", value: null, printed: "6,59" });
    expect(per100.carbs).toMatchObject({ status: "read", value: 62 });
    expect(portion.carbs).toMatchObject({ status: "unreadable", printed: "1949" });
    expect(per100.protein).toMatchObject({ status: "unreadable", printed: "129" });
    expect(portion.protein).toMatchObject({ status: "unreadable", printed: "3649" });
    expect(e.servingSize).toMatchObject({ status: "read", amount: 30, unit: "g" });
  });
  it("'9,0 g' read as '90g' looks clean, so the review checks must catch it", () => {
    const e = parseLabelText(EU_OCR);
    expect(e.columns[0].fiber).toMatchObject({ status: "read", value: 90 });
    // 90 g of fibre per 100 g against 2.7 g in a 30 g portion: the per-100 column is contradicted, and flagged.
    const flags = checkLabelExtraction({ ...e, columns: [e.columns[0], { ...e.columns[1], fiber: { status: "read", value: 2.7, unit: "g", printed: "2,7 g", reason: null } }] });
    expect(flags.some((f) => f.code === "contradictory_columns" && f.field === "columns[1].fiber")).toBe(true);
  });
  it("'37g' read as '379g' looks clean, but disagrees with energy, so it and the column's other '…9g' amounts are unreadable", () => {
    // Exactly what tesseract.js read from the US label enlarged to 1600 px, sharpened, on 2026-11-07.
    const c = parseLabelText(US_OCR.replace("37g", "379g").replace("Fiber 4g", "Fiber 49g").replace("12g", "129g")).columns[0];
    expect(c.carbs).toMatchObject({ status: "unreadable", value: null, printed: "379g" });
    expect(c.fiber).toMatchObject({ status: "unreadable", value: null, printed: "49g" });
    expect(c.carbs.reason).toMatch(/misread "g"/);
    // The amounts that agree stay read, unchanged.
    expect([c.kcal.value, c.fat.value, c.protein.value]).toEqual([230, 8, 3]);
  });
  it("a real amount ending in 9 is kept when the label adds up", () => {
    const c = parseLabelText("Nutrition Facts\nCalories 250\nTotal Fat 9g\nTotal Carbohydrate 29g\nDietary Fiber 3g\nProtein 19g").columns[0];
    expect([c.fat.value, c.carbs.value, c.protein.value]).toEqual([9, 29, 19]);
  });
  it("a disagreement no trailing 9 explains is left for the review checks, not hidden", () => {
    const e = parseLabelText("Nutrition Facts\nCalories 900\nTotal Fat 8g\nTotal Carbohydrate 37g\nProtein 3g");
    expect(e.columns[0].carbs).toMatchObject({ status: "read", value: 37 });
    expect(checkLabelExtraction(e).some((f) => f.code === "energy_macro_mismatch")).toBe(true);
  });
  it("fibre above carbohydrate with a '…9g' is unreadable", () => {
    const c = parseLabelText("Nutrition Facts\nCalories 230\nTotal Fat 8g\nTotal Carbohydrate 37g\nDietary Fiber 49g\nProtein 3g").columns[0];
    expect(c.fiber).toMatchObject({ status: "unreadable", printed: "49g" });
    expect(c.carbs).toMatchObject({ status: "read", value: 37 });
  });
  it("energy without a recognizable unit isn't assumed to be kcal", () => {
    expect(parseLabelText("Energy 1580\nFat 6 g\nProtein 12 g").columns[0].kcal).toMatchObject({ status: "unreadable" });
  });
  it("energy printed only in kJ is kept in kJ, and the review flags it unconverted", () => {
    const e = parseLabelText("Per 100 g\nEnergy 1580 kJ\nFat 6 g\nProtein 12 g");
    expect(e.columns[0].kcal).toMatchObject({ status: "read", value: 1580, unit: "kJ" });
    expect(checkLabelExtraction(e).some((f) => f.code === "energy_in_kilojoules")).toBe(true);
  });
});

describe("a clean EU label", () => {
  it("reads both columns, with decimal commas", () => {
    const [per100, portion] = parseLabelText(EU_CLEAN).columns;
    expect([per100.fat.value, per100.fiber.value, per100.protein.value]).toEqual([6.5, 9, 12]);
    expect([portion.fat.value, portion.fiber.value, portion.protein.value]).toEqual([2, 2.7, 3.6]);
  });
  it("and its columns agree, so nothing is flagged as contradictory", () => {
    expect(checkLabelExtraction(parseLabelText(EU_CLEAN)).filter((f) => f.code === "contradictory_columns")).toEqual([]);
  });
});

describe("not a label", () => {
  it("text without nutrition lines is no label, with no columns", () => {
    const e = parseLabelText("Dear customer, thank you for shopping\nTotal 12.50");
    expect(e.isNutritionLabel).toBe(false);
    expect(e.columns).toEqual([]);
    expect(parseLabelExtraction(e).ok).toBe(true);
  });
  it("empty text too", () => expect(parseLabelText("").isNutritionLabel).toBe(false));
});

describe("two readings: only values both agree on are kept", () => {
  const a = parseLabelText(US_OCR);
  it("agreement keeps every value read", () => {
    const m = mergeReadings(a, parseLabelText(US_OCR));
    expect(m).toEqual(a);
  });
  it("'55g' read as '559g' once: the serving is unreadable, with both texts, never either number", () => {
    const m = mergeReadings(parseLabelText(US_OCR.replace("(55g)", "(559g)")), a);
    expect(m.servingSize).toMatchObject({ status: "unreadable", amount: null });
    expect(m.servingSize.reason).toMatch(/"2\/3 cup \(559g\)".*"2\/3 cup \(55g\)"/);
  });
  it("a nutrient read differently is unreadable; the ones that agree stay read", () => {
    const m = mergeReadings(a, parseLabelText(US_OCR.replace("Protein 3g", "Protein 8g")));
    expect(m.columns[0].protein).toMatchObject({ status: "unreadable", value: null, printed: "3g" });
    expect(m.columns[0].protein.reason).toMatch(/"3g".*"8g"/);
    expect([m.columns[0].kcal.value, m.columns[0].fat.value, m.columns[0].carbs.value]).toEqual([230, 8, 37]);
  });
  it("a value seen clearly only once is unreadable too", () => {
    const m = mergeReadings(a, parseLabelText(US_OCR.replace("Total Fat 8g", "Total Fat 89")));
    expect(m.columns[0].fat).toMatchObject({ status: "unreadable", value: null });
    expect(m.columns[0].fat.reason).toMatch(/"8g".*"89"/);
  });
  it("a column the second reading doesn't find is unconfirmed, so nothing in it is kept", () => {
    const m = mergeReadings(parseLabelText(EU_CLEAN), parseLabelText(EU_CLEAN.replace("Per 100 g Per 30 g portion", "Per 100 g")));
    expect(m.columns[1].basis).toBe("per_serving");
    expect(["kcal", "fat", "carbs", "protein"].every((k) => m.columns[1][k as "kcal"].status !== "read")).toBe(true);
  });
  it("absent and unreadable values stay as they were; the same unit is required", () => {
    const m = mergeReadings(parseLabelText("Per 100 g\nEnergy 1580 kJ\nFat 6 g\nProtein 12 g"), parseLabelText("Per 100 g\nEnergy 1580 kcal\nFat 6 g\nProtein 12 g"));
    expect(m.columns[0].kcal).toMatchObject({ status: "unreadable" });
    expect(m.columns[0].fiber.status).toBe("absent");
  });
  it("not a label: the first reading stands", () => {
    const none = parseLabelText("thank you");
    expect(mergeReadings(none, a)).toBe(none);
  });
});
