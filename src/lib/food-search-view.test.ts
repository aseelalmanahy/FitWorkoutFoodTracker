// The add-food search's view: which sources are requested, stale answers, filters, and how empty or failed
// searches are explained. No browser.
import { describe, expect, it } from "vitest";
import { FILTERS, covers, isCurrent, localTestNotice, requestKey, searchPath, searchView, sourcesFor, type Filter } from "./food-search-view";
import type { SearchItem, SearchResponse, SearchSource } from "@/lib/server/foods/service";

const ALL_SOURCES: SearchSource[] = ["CUSTOM", "USDA", "OPEN_FOOD_FACTS"];
const item = (source: SearchSource, name: string): SearchItem => ({
  key: `${source}:${name}`, foodId: null, source, sourceId: name, name, brand: null, dataType: null, basisUnit: "G",
  per100: { kcal: 100, protein: 1, carbs: 1, fat: 1, fiber: null }, servings: [{ label: "100 g", amount: 100 }], complete: true, hasNutrition: true,
});
const answer = (query: string, results: Partial<Record<SearchSource, SearchItem[]>>, opts: { errors?: SearchResponse["errors"]; sources?: SearchSource[] } = {}): SearchResponse => ({
  query, barcode: /^\d{8,14}$/.test(query), results: { CUSTOM: [], USDA: [], OPEN_FOOD_FACTS: [], ...results }, errors: opts.errors ?? [],
  localTestSources: [], sources: opts.sources ?? ALL_SOURCES,
});
const egg = answer("egg", { CUSTOM: [item("CUSTOM", "Whole egg (demo)")] });
const view = (query: string, filter: Filter, data: SearchResponse | null, failure: { key: string; message: string } | null = null) =>
  searchView({ query, filter, data, failure });
const sourcesInPath = (path: string) => new URL(path, "http://x").searchParams.get("sources")!.split(",").sort();

describe("labels", () => {
  it("names each source plainly, with what it means", () => {
    expect(FILTERS.map((f) => f.label)).toEqual(["All sources", "USDA foods", "Packaged foods", "My foods"]);
    expect(FILTERS.find((f) => f.v === "USDA")!.description).toBe("Foods supplied by USDA FoodData Central.");
    expect(FILTERS.find((f) => f.v === "OPEN_FOOD_FACTS")!.description).toBe("Products supplied by Open Food Facts.");
    expect(FILTERS.find((f) => f.v === "CUSTOM")!.description).toBe("Foods you created.");
  });
});

describe("which sources each filter requests", () => {
  it.each([
    ["ALL", ["CUSTOM", "OPEN_FOOD_FACTS", "USDA"]],
    ["USDA", ["CUSTOM", "USDA"]], // never Open Food Facts
    ["OPEN_FOOD_FACTS", ["CUSTOM", "OPEN_FOOD_FACTS"]], // never USDA
    ["CUSTOM", ["CUSTOM"]], // no external provider at all
  ] as const)("%s asks for %j, named in the request", (filter, expected) => {
    expect([...sourcesFor(filter)].sort()).toEqual(expected);
    expect(sourcesInPath(searchPath(" large egg ", filter))).toEqual(expected);
    expect(new URL(searchPath(" large egg ", filter), "http://x").searchParams.get("q")).toBe("large egg");
  });

  it("an answer is reused only when it searched everything the filter needs", () => {
    expect(covers(egg, "egg", "USDA")).toBe(true); // All sources narrowed: no new request
    expect(covers(egg, "egg", "CUSTOM")).toBe(true);
    const usdaOnly = answer("egg", {}, { sources: ["CUSTOM", "USDA"] });
    expect(covers(usdaOnly, "egg", "USDA")).toBe(true);
    expect(covers(usdaOnly, "egg", "CUSTOM")).toBe(true);
    expect(covers(usdaOnly, "egg", "OPEN_FOOD_FACTS")).toBe(false); // must ask Open Food Facts
    expect(covers(usdaOnly, "egg", "ALL")).toBe(false);
    expect(covers(answer("egg", {}, { sources: ["CUSTOM"] }), "egg", "USDA")).toBe(false);
    expect(covers(egg, "eggs", "ALL")).toBe(false); // another query is never covered
  });
});

describe("before a search", () => {
  it.each(["", " ", "e", " e "])("%j is idle, whatever the filter, and keeps no earlier answer or failure", (query) => {
    for (const filter of ["ALL", "USDA", "OPEN_FOOD_FACTS", "CUSTOM"] as const) {
      expect(view(query, filter, egg, { key: requestKey("egg", filter), message: "x" })).toEqual({ state: "idle" });
    }
  });
});

describe("stale answers", () => {
  it("an answer for an earlier query is never shown for a new one", () => {
    expect(view("eggs", "ALL", egg)).toEqual({ state: "loading" });
    expect(view("banana", "CUSTOM", egg)).toEqual({ state: "loading" });
  });
  it("an answer that didn't search the filter's source isn't shown as that source's result", () => {
    expect(view("egg", "USDA", answer("egg", { CUSTOM: [item("CUSTOM", "Whole egg (demo)")] }, { sources: ["CUSTOM"] }))).toEqual({ state: "loading" });
  });
  it("surrounding spaces don't make an answer stale", () => {
    expect(view("  egg ", "ALL", egg).state).toBe("results");
    expect(isCurrent(egg, " egg")).toBe(true);
    expect(isCurrent(egg, "eg")).toBe(false);
    expect(isCurrent(null, "egg")).toBe(false);
  });
  it("a failure is shown only for its own query and sources, and hides any results", () => {
    const failure = { key: requestKey("egg", "ALL"), message: "Network error." };
    expect(view("egg", "ALL", egg, failure)).toEqual({ state: "failed", message: "Network error." });
    expect(view("eggs", "ALL", egg, failure).state).toBe("loading");
    expect(view("egg", "CUSTOM", egg, failure).state).toBe("results"); // a different request
  });
});

describe("filters", () => {
  const mixed = answer("banana", { CUSTOM: [item("CUSTOM", "Banana (demo)")], USDA: [item("USDA", "Bananas, raw")] });
  it("All sources shows every source, in a fixed order, with counts", () => {
    expect(view("banana", "ALL", mixed)).toMatchObject({ state: "results", sections: ["CUSTOM", "USDA", "OPEN_FOOD_FACTS"], total: 2, counts: { CUSTOM: 1, USDA: 1, OPEN_FOOD_FACTS: 0 } });
  });
  it.each([["USDA", 1], ["CUSTOM", 1]] as const)("%s shows only that source", (filter, total) => {
    expect(view("banana", filter, mixed)).toMatchObject({ state: "results", sections: [filter], total });
  });
  it("no count is invented for a source that wasn't searched", () => {
    const v = view("banana", "USDA", answer("banana", { USDA: [item("USDA", "Bananas, raw")] }, { sources: ["CUSTOM", "USDA"] }));
    expect(v).toMatchObject({ state: "results", counts: { CUSTOM: 0, USDA: 1 } });
    expect((v as { counts: object }).counts).not.toHaveProperty("OPEN_FOOD_FACTS");
  });
  it("a filter with nothing names the source, points to My foods, and says what wasn't searched", () => {
    const v = view("egg", "USDA", answer("egg", { CUSTOM: [item("CUSTOM", "Whole egg (demo)")] }, { sources: ["CUSTOM", "USDA"] }));
    expect(v).toMatchObject({ state: "empty", kind: "no_match", title: 'No USDA results for "egg"', elsewhere: [{ source: "CUSTOM", count: 1 }], unsearched: ["OPEN_FOOD_FACTS"] });
  });
  it("narrowing an all-sources answer reports matches elsewhere, and nothing unsearched", () => {
    expect(view("egg", "USDA", egg)).toMatchObject({ state: "empty", elsewhere: [{ source: "CUSTOM", count: 1 }], unsearched: [] });
  });
  it("names each empty source in its own words", () => {
    const none = answer("pizza", {});
    expect((view("pizza", "ALL", none) as { title: string }).title).toBe('No results for "pizza"');
    expect((view("pizza", "OPEN_FOOD_FACTS", none) as { title: string }).title).toBe('No packaged-food results for "pizza"');
    expect((view("pizza", "CUSTOM", none) as { title: string }).title).toBe('None of your foods match "pizza"');
    expect(view("pizza", "ALL", none)).toMatchObject({ elsewhere: [], unsearched: [] });
  });
  it("a barcode with no product says so", () => {
    expect(view("12345678", "ALL", answer("12345678", {}))).toMatchObject({ title: "No product matches barcode 12345678" });
  });
});

describe("unavailable sources aren't 'no results'", () => {
  const usdaDown = { source: "USDA" as const, kind: "unavailable", message: "Food database unavailable." };
  it("the only source in view failed: unavailable, not empty", () => {
    expect(view("egg", "USDA", answer("egg", {}, { errors: [usdaDown], sources: ["CUSTOM", "USDA"] })))
      .toMatchObject({ state: "empty", kind: "unavailable", title: "USDA foods couldn't be searched right now" });
  });
  it("some failed and the rest had nothing: partly unavailable", () => {
    expect(view("egg", "ALL", answer("egg", {}, { errors: [usdaDown] }))).toMatchObject({ state: "empty", kind: "partly", unavailable: [usdaDown] });
  });
  it("a failure hidden by the filter isn't reported against the visible source", () => {
    expect(view("egg", "CUSTOM", answer("egg", {}, { errors: [usdaDown] }))).toMatchObject({ state: "empty", kind: "no_match", unavailable: [] });
  });
  it("results still show, with the failed source named", () => {
    expect(view("egg", "ALL", { ...egg, errors: [usdaDown] })).toMatchObject({ state: "results", total: 1, unavailable: [usdaDown] });
  });
});

describe("local test data is disclosed", () => {
  it("names the providers answered by the stand-in", () => {
    expect(localTestNotice([])).toBeNull();
    expect(localTestNotice(["USDA", "OPEN_FOOD_FACTS"])).toMatch(/^Test data: USDA and Open Food Facts results come from a small local test sample, not the full catalogs\./);
    expect(localTestNotice(["USDA"])).toMatch(/not the full catalog\./);
  });
});
