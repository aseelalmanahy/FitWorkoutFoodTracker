// The add-food search's view: stale answers, filters, and how empty or failed searches are explained. No browser.
import { describe, expect, it } from "vitest";
import { FILTERS, isCurrent, localTestNotice, searchView } from "./food-search-view";
import type { SearchItem, SearchResponse, SearchSource } from "@/lib/server/foods/service";

const item = (source: SearchSource, name: string, per100 = { kcal: 100, protein: 1, carbs: 1, fat: 1, fiber: null }): SearchItem => ({
  key: `${source}:${name}`, foodId: null, source, sourceId: name, name, brand: null, dataType: null, basisUnit: "G", per100,
  servings: [{ label: "100 g", amount: 100 }], complete: true, hasNutrition: true,
});
const answer = (query: string, results: Partial<Record<SearchSource, SearchItem[]>>, errors: SearchResponse["errors"] = []): SearchResponse => ({
  query, barcode: /^\d{8,14}$/.test(query), results: { CUSTOM: [], USDA: [], OPEN_FOOD_FACTS: [], ...results }, errors, localTestSources: [],
});
const egg = answer("egg", { CUSTOM: [item("CUSTOM", "Whole egg (demo)")] });

describe("labels", () => {
  it("names each source plainly, with what it means", () => {
    expect(FILTERS.map((f) => f.label)).toEqual(["All sources", "USDA foods", "Packaged foods", "My foods"]);
    expect(FILTERS.find((f) => f.v === "USDA")!.description).toBe("Foods supplied by USDA FoodData Central.");
    expect(FILTERS.find((f) => f.v === "OPEN_FOOD_FACTS")!.description).toBe("Products supplied by Open Food Facts.");
    expect(FILTERS.find((f) => f.v === "CUSTOM")!.description).toBe("Foods you created.");
  });
});

describe("before a search", () => {
  it.each(["", " ", "e", " e "])("%j is idle, whatever the filter, and keeps no earlier answer or failure", (query) => {
    for (const filter of ["ALL", "USDA", "OPEN_FOOD_FACTS", "CUSTOM"] as const) {
      expect(searchView({ query, filter, data: egg, failure: { query: "egg", message: "x" } })).toEqual({ state: "idle" });
    }
  });
});

describe("stale answers", () => {
  it("an answer for an earlier query is never shown for a new one", () => {
    expect(searchView({ query: "eggs", filter: "ALL", data: egg, failure: null })).toEqual({ state: "loading" });
    expect(searchView({ query: "banana", filter: "CUSTOM", data: egg, failure: null })).toEqual({ state: "loading" });
  });
  it("surrounding spaces don't make an answer stale", () => {
    expect(searchView({ query: "  egg ", filter: "ALL", data: egg, failure: null }).state).toBe("results");
    expect(isCurrent(egg, " egg")).toBe(true);
    expect(isCurrent(egg, "eg")).toBe(false);
    expect(isCurrent(null, "egg")).toBe(false);
  });
  it("a failure is shown only for its own query, and hides any results", () => {
    const failure = { query: "egg", message: "Network error." };
    expect(searchView({ query: "egg", filter: "ALL", data: egg, failure })).toEqual({ state: "failed", message: "Network error." });
    expect(searchView({ query: "eggs", filter: "ALL", data: egg, failure }).state).toBe("loading");
  });
});

describe("filters", () => {
  const mixed = answer("banana", { CUSTOM: [item("CUSTOM", "Banana (demo)")], USDA: [item("USDA", "Bananas, raw")] });
  it("All sources shows every source, in a fixed order, with counts", () => {
    const v = searchView({ query: "banana", filter: "ALL", data: mixed, failure: null });
    expect(v).toMatchObject({ state: "results", sections: ["CUSTOM", "USDA", "OPEN_FOOD_FACTS"], total: 2, counts: { CUSTOM: 1, USDA: 1, OPEN_FOOD_FACTS: 0 } });
  });
  it.each([["USDA", 1], ["CUSTOM", 1]] as const)("%s shows only that source", (filter, total) => {
    expect(searchView({ query: "banana", filter, data: mixed, failure: null })).toMatchObject({ state: "results", sections: [filter], total });
  });
  it("a filter with nothing says so, names the source, and points to matches elsewhere", () => {
    const v = searchView({ query: "egg", filter: "USDA", data: egg, failure: null });
    expect(v).toMatchObject({ state: "empty", kind: "no_match", title: 'No USDA results for "egg"', elsewhere: [{ source: "CUSTOM", count: 1 }] });
  });
  it("names each empty source in its own words", () => {
    const none = answer("pizza", {});
    expect((searchView({ query: "pizza", filter: "ALL", data: none, failure: null }) as { title: string }).title).toBe('No results for "pizza"');
    expect((searchView({ query: "pizza", filter: "OPEN_FOOD_FACTS", data: none, failure: null }) as { title: string }).title).toBe('No packaged-food results for "pizza"');
    expect((searchView({ query: "pizza", filter: "CUSTOM", data: none, failure: null }) as { title: string }).title).toBe('None of your foods match "pizza"');
    expect(searchView({ query: "pizza", filter: "ALL", data: none, failure: null })).toMatchObject({ elsewhere: [] });
  });
  it("a barcode with no product says so", () => {
    const none = answer("12345678", {});
    expect(searchView({ query: "12345678", filter: "ALL", data: none, failure: null })).toMatchObject({ title: "No product matches barcode 12345678" });
  });
});

describe("unavailable sources aren't 'no results'", () => {
  const usdaDown = { source: "USDA" as const, kind: "unavailable", message: "Food database unavailable." };
  it("the only source in view failed: unavailable, not empty", () => {
    const v = searchView({ query: "egg", filter: "USDA", data: answer("egg", {}, [usdaDown]), failure: null });
    expect(v).toMatchObject({ state: "empty", kind: "unavailable", title: "USDA foods couldn't be searched right now" });
  });
  it("some failed and the rest had nothing: partly unavailable", () => {
    const v = searchView({ query: "egg", filter: "ALL", data: answer("egg", {}, [usdaDown]), failure: null });
    expect(v).toMatchObject({ state: "empty", kind: "partly", unavailable: [usdaDown] });
  });
  it("a failure hidden by the filter isn't reported against the visible source", () => {
    const v = searchView({ query: "egg", filter: "CUSTOM", data: answer("egg", {}, [usdaDown]), failure: null });
    expect(v).toMatchObject({ state: "empty", kind: "no_match", unavailable: [] });
  });
  it("results still show, with the failed source named", () => {
    const v = searchView({ query: "egg", filter: "ALL", data: { ...egg, errors: [usdaDown] }, failure: null });
    expect(v).toMatchObject({ state: "results", total: 1, unavailable: [usdaDown] });
  });
});

describe("local test data is disclosed", () => {
  it("names the providers answered by the stand-in", () => {
    expect(localTestNotice([])).toBeNull();
    expect(localTestNotice(["USDA", "OPEN_FOOD_FACTS"])).toMatch(/^Test data: USDA and Open Food Facts results come from a small local test sample, not the full catalogs\./);
    expect(localTestNotice(["USDA"])).toMatch(/not the full catalog\./);
  });
});
