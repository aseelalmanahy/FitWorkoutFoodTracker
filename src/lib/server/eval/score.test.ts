// D0: the scoring every evaluation uses. Synthetic readings with known answers, so the arithmetic itself is checked;
// these aren't evaluation results.
import { describe, expect, it } from "vitest";
import { absentNutrient, goodLabel, notALabel, nutrient, perServing, unreadableNutrient } from "@/test/label-fixtures";
import { names, scoreLabel, scoreMeal, totalLabels, totalMeals, type LabelExpectation, type MealExpectation } from "./score";

const ref = (r: Partial<Record<"kcal" | "protein" | "carbs" | "fat" | "fiber", number | null>>): LabelExpectation => ({
  per100g: null, perServing: { kcal: 120, protein: 4, carbs: 20, fat: 2.5, fiber: 3, ...r },
});

describe("label scoring", () => {
  it("counts each printed value read right, read wrong, or left empty, for the basis it was printed for", () => {
    const s = scoreLabel(goodLabel({ columns: [perServing({ protein: nutrient(7, "7 g"), fiber: unreadableNutrient })] }), ref({}));
    expect(s).toMatchObject({ schemaOk: true, recognized: true, expected: 5, right: 3, wrong: 1, leftEmpty: 1, unchecked: 0 });
    expect(s.wrongDetails).toEqual(['perServing protein: read 7 g from "7 g", label 4']);
  });
  it("accepts rounding within half a unit or 2%, and no more", () => {
    expect(scoreLabel(goodLabel({ columns: [perServing({ kcal: nutrient(122, "122 kcal", "kcal") })] }), ref({})).wrong).toBe(0);
    expect(scoreLabel(goodLabel({ columns: [perServing({ kcal: nutrient(124, "124 kcal", "kcal") })] }), ref({})).wrong).toBe(1);
  });
  it("a value with nothing to compare with is unchecked, never right; a value the label lacks isn't expected", () => {
    const s = scoreLabel(goodLabel({ columns: [perServing()] }), ref({ fiber: null }));
    expect(s).toMatchObject({ expected: 4, right: 4, unchecked: 1, leftEmpty: 0 });
  });
  it("kilojoules aren't compared with kilocalories", () => {
    expect(scoreLabel(goodLabel({ columns: [perServing({ kcal: nutrient(502, "502 kJ", "kJ") })] }), ref({})).unchecked).toBe(1);
  });
  it("values for a basis the reference doesn't cover are unchecked", () => {
    const s = scoreLabel(goodLabel({ columns: [perServing()] }), { per100g: { kcal: 400, protein: 13, carbs: 67, fat: 8, fiber: 10 }, perServing: null });
    expect(s).toMatchObject({ expected: 5, right: 0, wrong: 0, unchecked: 5, leftEmpty: 5 });
  });
  it("not recognized as a label leaves every value empty; an output the schema refuses counts as a failure, not as values", () => {
    expect(scoreLabel(notALabel(), ref({}))).toMatchObject({ schemaOk: true, recognized: false, leftEmpty: 5, right: 0 });
    const invented = goodLabel({ columns: [perServing({ fiber: { ...absentNutrient, value: 0 } as never })] }); // an absent value that isn't null
    expect(scoreLabel(invented, ref({}))).toMatchObject({ schemaOk: false, right: 0, wrong: 0 });
    expect(scoreLabel("not json", ref({})).schemaOk).toBe(false);
  });
  it("totals add up", () => {
    const t = totalLabels([scoreLabel(goodLabel({ columns: [perServing()] }), ref({})), scoreLabel(notALabel(), ref({})), scoreLabel("x", ref({}))]);
    expect(t).toEqual({ photos: 3, schemaFailures: 1, recognized: 1, expected: 15, right: 5, wrong: 0, leftEmpty: 5, unchecked: 0 });
  });
});

const item = (name: string | null, certainty: "likely" | "possible" | "unknown" = "possible") => ({ name, category: "mixed_dish", certainty, observation: "On a plate", possibleIngredients: [], preparation: null });
const meal = (...items: ReturnType<typeof item>[]) => ({ containsFood: items.length > 0, items });
const plate: MealExpectation = { kind: "multi", foods: [{ name: "rice", accept: ["rice"] }, { name: "chicken", accept: ["chicken"] }, { name: "salad", accept: ["salad", "lettuce"] }] };

describe("meal scoring", () => {
  it("names match by whole words, ignoring case and accents", () => {
    expect(names("Fried Rice", plate.foods[0])).toBe(true);
    expect(names("Licorice", plate.foods[0])).toBe(false);
    expect(names("Crème brûlée", { name: "creme brulee", accept: ["creme brulee"] })).toBe(true);
  });
  it("a single dish: right first, or among the first three", () => {
    const single: MealExpectation = { kind: "single", foods: [{ name: "pizza", accept: ["pizza"] }] };
    expect(scoreMeal(meal(item("Pizza", "likely")), single)).toMatchObject({ first: true, top3: true, wrongSuggestions: 0 });
    expect(scoreMeal(meal(item("Flatbread"), item("Quiche"), item("Pizza")), single)).toMatchObject({ first: false, top3: true, wrongSuggestions: 2 });
  });
  it("a single suggestion's stated runners-up count among the first three, as the on-device baseline counted them", () => {
    const single: MealExpectation = { kind: "single", foods: [{ name: "lasagna", accept: ["lasagna"] }] };
    const one = { ...item("Pizza", "possible"), observation: "Looks most like pizza; close alternatives are quiche and lasagna. Check it." };
    expect(scoreMeal(meal(one), single)).toMatchObject({ first: false, top3: true, wrongSuggestions: 1 });
  });
  it("a plate: which of its foods are found, and how many suggestions are wrong, confidently or not", () => {
    const s = scoreMeal(meal(item("Rice", "likely"), item("Beef", "likely"), item("Green salad"), item(null, "unknown")), plate);
    expect(s).toMatchObject({ found: 2, wrongSuggestions: 1, confidentlyWrong: 1, names: ["Rice", "Beef", "Green salad"] });
  });
  it("no food: right only when nothing is suggested", () => {
    const none: MealExpectation = { kind: "none", foods: [] };
    expect(scoreMeal({ containsFood: false, items: [] }, none).noFoodRight).toBe(true);
    expect(scoreMeal(meal(item("Bread", "likely")), none)).toMatchObject({ noFoodRight: false, confidentlyWrong: 1 });
  });
  it("an output with an amount or a nutrient is refused by the schema, and scores nothing", () => {
    expect(scoreMeal(meal(item("200 g rice")), plate)).toMatchObject({ schemaOk: false, found: 0 });
    expect(scoreMeal(meal({ ...item("Rice"), observation: "High in protein" }), plate).schemaOk).toBe(false);
  });
  it("totals add up", () => {
    const rows = [{ ref: plate, score: scoreMeal(meal(item("Rice")), plate) }, { ref: { kind: "none", foods: [] } as MealExpectation, score: scoreMeal({ containsFood: false, items: [] }, { kind: "none", foods: [] }) }];
    expect(totalMeals(rows)).toEqual({ photos: 2, schemaFailures: 0, first: 1, top3: 1, foods: 3, found: 1, suggestions: 1, wrongSuggestions: 0, confidentlyWrong: 0, noFood: 1, noFoodRight: 1 });
  });
});
