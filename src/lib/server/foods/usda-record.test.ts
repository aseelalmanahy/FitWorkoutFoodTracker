// WT-02 and WT-05: fetching one USDA record (slow answers, the timeout, what is requested) and its portion labels.
// No live calls: fetch is replaced, and fake timers stand in for slow upstream answers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetUsdaCache, extractPortions, getUsdaFood, searchUsda, USDA_FOOD_TIMEOUT_MS } from "./usda";
import { DEFAULT_TIMEOUT_MS } from "./http";
import { ExternalFoodError } from "./types";
import { _resetGuard } from "./guard";

// The live record that failed in the walkthrough (fdcId 330137), reduced to the fields the app reads.
const yogurt = {
  fdcId: 330137,
  description: "Yogurt, Greek, plain, nonfat",
  dataType: "Foundation",
  foodNutrients: [
    { nutrient: { id: 1008, number: "208", name: "Energy", unitName: "kcal" }, amount: 61 },
    { nutrient: { id: 1003, number: "203", name: "Protein", unitName: "g" }, amount: 10.3 },
    { nutrient: { id: 1005, number: "205", name: "Carbohydrate, by difference", unitName: "g" }, amount: 3.64 },
    { nutrient: { id: 1004, number: "204", name: "Total lipid (fat)", unitName: "g" }, amount: 0.37 },
  ],
  foodPortions: [{ gramWeight: 170, amount: 1, modifier: "container", measureUnit: { name: "undetermined" } }],
};
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

/** An upstream that answers after `ms`, and stops (as a real connection does) when the request is aborted. */
function slowUpstream(ms: number, body: unknown) {
  const aborted: string[] = [];
  const fn = vi.fn((url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const t = setTimeout(() => resolve(json(body)), ms);
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(t);
      aborted.push(url);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });
  }));
  vi.stubGlobal("fetch", fn);
  return { fn, aborted };
}

beforeEach(() => {
  vi.useFakeTimers();
  process.env.FDC_API_KEY = "test-key";
  process.env.FDC_BASE_URL = "https://fdc.test/v1";
  _resetUsdaCache();
  _resetGuard();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("one USDA record (WT-02)", () => {
  it("asks only for the nutrients the app reads, with the key in a header", async () => {
    const { fn } = slowUpstream(0, yogurt);
    const p = getUsdaFood("330137");
    await vi.advanceTimersByTimeAsync(0);
    await p;
    const url = new URL(fn.mock.calls[0][0]);
    expect(url.pathname).toBe("/v1/food/330137");
    expect(url.searchParams.getAll("nutrients").sort()).toEqual(["203", "204", "205", "205.2", "208", "291", "957", "958"]);
    expect(url.toString()).not.toContain("test-key");
  });

  it("loads a slow but valid record (8.4 s, as measured live), with its values as given", async () => {
    slowUpstream(8_400, yogurt);
    const p = getUsdaFood("330137");
    await vi.advanceTimersByTimeAsync(8_400);
    const food = await p;
    expect(food.name).toBe("Yogurt, Greek, plain, nonfat");
    expect(food.per100).toMatchObject({ kcal: 61, protein: 10.3, carbs: 3.64, fat: 0.37 });
    // Fiber wasn't in the answer, so it stays unknown: never 0, never guessed.
    expect(food.per100.fiber).toBeNull();
  });

  it("gives up at its own bounded limit, aborts the request, and says so plainly", async () => {
    const { aborted } = slowUpstream(60_000, yogurt);
    const p = getUsdaFood("330137");
    const settled = expect(p).rejects.toMatchObject({ kind: "timeout", message: "The food database took too long to respond." });
    await vi.advanceTimersByTimeAsync(USDA_FOOD_TIMEOUT_MS);
    await settled;
    await expect(p).rejects.toBeInstanceOf(ExternalFoodError);
    expect(aborted).toHaveLength(1); // the connection was closed, not left running
  });

  it("the record limit is bounded and only a few seconds longer than the search limit", () => {
    expect(USDA_FOOD_TIMEOUT_MS).toBeGreaterThan(DEFAULT_TIMEOUT_MS);
    expect(USDA_FOOD_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });

  it("searches keep the shorter limit, so typing stays responsive", async () => {
    const { aborted } = slowUpstream(10_000, { totalHits: 0, foods: [] });
    const p = searchUsda("yogurt");
    const settled = expect(p).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
    await settled;
    expect(aborted).toHaveLength(1);
  });
});

describe("USDA portion labels (WT-05)", () => {
  const portions = (list: Record<string, unknown>[]) => extractPortions({ foodPortions: list }).map((s) => s.label);

  it("leaves out an unspecified quantity, which FNDDS labels only with a code", () => {
    expect(portions([
      { portionDescription: "1 piece, medium pizza", modifier: "64369", measureUnit: { name: "undetermined" }, gramWeight: 100 },
      { portionDescription: "Quantity not specified", modifier: "90000", measureUnit: { name: "undetermined" }, gramWeight: 296 },
    ])).toEqual(["100 g", "1 piece, medium pizza (100 g)"]);
  });

  it("never shows a numeric code as words", () => {
    expect(portions([{ amount: 1, modifier: "90000", measureUnit: { name: "undetermined" }, gramWeight: 50 }])).toEqual(["100 g"]);
  });

  it("still uses a modifier that is words (SR Legacy)", () => {
    expect(portions([{ amount: 1, modifier: "medium (7\" to 7-7/8\" long)", measureUnit: { name: "undetermined" }, gramWeight: 118 }]))
      .toEqual(["100 g", "1 medium (7\" to 7-7/8\" long) (118 g)"]);
  });
});
