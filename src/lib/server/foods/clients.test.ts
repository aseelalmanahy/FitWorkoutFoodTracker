// Payloads follow the documented response shapes of the FDC and OFF APIs.
// Live network calls are not made in unit tests.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetUsdaCache, _resetUsdaConfigLog, extractNutrients, getUsdaFood, isUsdaFoodResponse, isUsdaSearchResponse, normalizeUsdaFood, searchUsda } from "./usda";
import { _resetOffCache, extractOffNutrients, getOffProduct, isOffProductResponse, isOffSearchResponse, normalizeOffProduct, searchOff } from "./openfoodfacts";
import { ExternalFoodError } from "./types";
import { _resetGuard } from "./guard";

const usdaSearchFood = {
  fdcId: 173944,
  description: "Bananas, raw",
  dataType: "SR Legacy",
  foodNutrients: [
    { nutrientId: 1003, nutrientNumber: "203", nutrientName: "Protein", unitName: "G", value: 1.09 },
    { nutrientId: 1004, nutrientNumber: "204", nutrientName: "Total lipid (fat)", unitName: "G", value: 0.33 },
    { nutrientId: 1005, nutrientNumber: "205", nutrientName: "Carbohydrate, by difference", unitName: "G", value: 22.84 },
    { nutrientId: 1062, nutrientNumber: "268", nutrientName: "Energy", unitName: "kJ", value: 371 },
    { nutrientId: 1008, nutrientNumber: "208", nutrientName: "Energy", unitName: "KCAL", value: 89 },
    { nutrientId: 1079, nutrientNumber: "291", nutrientName: "Fiber, total dietary", unitName: "G", value: 2.6 },
  ],
  foodMeasures: [{ disseminationText: "1 medium (7\" to 7-7/8\" long)", gramWeight: 118 }],
};

const usdaDetail = {
  fdcId: 2346396,
  description: "Chicken breast, roasted",
  dataType: "Foundation",
  foodNutrients: [
    { nutrient: { id: 2047, number: "957", name: "Energy (Atwater General Factors)", unitName: "kcal" }, amount: 165 },
    { nutrient: { id: 1003, number: "203", name: "Protein", unitName: "g" }, amount: 31 },
    { nutrient: { id: 1004, number: "204", name: "Total lipid (fat)", unitName: "g" }, amount: 3.6 },
  ],
  foodPortions: [{ gramWeight: 140, amount: 1, modifier: "breast, bone and skin removed", measureUnit: { name: "undetermined" } }],
};

const offProduct = {
  code: "3017624010966",
  product_name: "Nutella",
  brands: "Ferrero, Nutella",
  serving_size: "15 g",
  serving_quantity: 15,
  nutriments: { "energy-kcal_100g": 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9 },
};

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  process.env.FDC_API_KEY = "test-key";
  process.env.FDC_BASE_URL = "https://fdc.test/v1";
  process.env.OFF_BASE_URL = "https://off.test";
  _resetUsdaCache();
  _resetOffCache();
  _resetGuard();
});
afterEach(() => vi.unstubAllGlobals());

describe("USDA normalisation", () => {
  it("maps nutrients by id and ignores kJ energy", () => {
    expect(extractNutrients(usdaSearchFood.foodNutrients)).toEqual({ kcal: 89, protein: 1.09, carbs: 22.84, fat: 0.33, fiber: 2.6 });
  });
  it("handles nested detail nutrients, Atwater energy and missing values as null", () => {
    const f = normalizeUsdaFood(usdaDetail)!;
    expect(f.per100).toEqual({ kcal: 165, protein: 31, carbs: null, fat: 3.6, fiber: null });
    expect(f.servings[0]).toEqual({ label: "1 breast, bone and skin removed (140 g)", amount: 140 });
    expect(f.servings).toContainEqual({ label: "100 g", amount: 100 });
  });
  it("preserves id and source", () => {
    const f = normalizeUsdaFood(usdaSearchFood)!;
    expect(f).toMatchObject({ source: "USDA", sourceId: "173944", dataType: "SR Legacy", basisUnit: "G" });
  });
  it("drops records without id or name", () => {
    expect(normalizeUsdaFood({ description: "x" })).toBeNull();
  });
});

describe("USDA client", () => {
  it("sends the key in a header (not the URL), restricts to generic types, caches results", async () => {
    const f = mockFetch(() => json({ totalHits: 1, foods: [usdaSearchFood] }));
    const r1 = await searchUsda("banana");
    const r2 = await searchUsda("Banana");
    expect(r1).toHaveLength(1);
    expect(r2).toBe(r1);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).not.toContain("test-key");
    expect(url).toContain("dataType=Foundation%2CSR+Legacy%2CSurvey+%28FNDDS%29");
    expect((init!.headers as Record<string, string>)["X-Api-Key"]).toBe("test-key");
  });
  it("returns an empty list for no results", async () => {
    mockFetch(() => json({ totalHits: 0, foods: [] }));
    expect(await searchUsda("zzzz")).toEqual([]);
  });
  it("reports missing configuration without calling the network", async () => {
    delete process.env.FDC_API_KEY;
    const f = mockFetch(() => json({}));
    await expect(searchUsda("banana")).rejects.toMatchObject({ kind: "not_configured" });
    expect(f).not.toHaveBeenCalled();
  });
  it("maps timeouts", async () => {
    mockFetch(() => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); });
    await expect(searchUsda("banana")).rejects.toMatchObject({ kind: "timeout" });
  });
  it("maps HTTP errors, rate limits and invalid bodies", async () => {
    mockFetch(() => new Response("oops", { status: 500 }));
    await expect(searchUsda("a")).rejects.toMatchObject({ kind: "http" });
    mockFetch(() => new Response("slow down", { status: 429 }));
    await expect(searchUsda("b")).rejects.toMatchObject({ kind: "rate_limited" });
    _resetGuard(); // the 429 opened the circuit (tested separately in guard.test.ts); keep checking mapping
    mockFetch(() => new Response("<html>", { status: 200 }));
    await expect(searchUsda("c")).rejects.toMatchObject({ kind: "invalid_response" });
    mockFetch(() => json({ unexpected: true }));
    await expect(searchUsda("d")).rejects.toMatchObject({ kind: "invalid_response" });
  });
  it("maps network failure", async () => {
    mockFetch(() => { throw new TypeError("fetch failed"); });
    await expect(searchUsda("e")).rejects.toBeInstanceOf(ExternalFoodError);
  });
  it("fetches detail and rejects malformed ids", async () => {
    mockFetch(() => json(usdaDetail));
    expect((await getUsdaFood("2346396")).name).toBe("Chicken breast, roasted");
    await expect(getUsdaFood("../etc")).rejects.toMatchObject({ kind: "not_found" });
  });
});

describe("Open Food Facts", () => {
  it("normalises products with serving and brand", () => {
    const f = normalizeOffProduct(offProduct)!;
    expect(f).toMatchObject({ source: "OPEN_FOOD_FACTS", sourceId: "3017624010966", barcode: "3017624010966", brand: "Ferrero", basisUnit: "G" });
    expect(f.per100).toEqual({ kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9, fiber: null });
    expect(f.servings[0]).toEqual({ label: "1 serving · 15 g", amount: 15 });
  });
  it("converts kJ to kcal only when kcal is absent", () => {
    expect(extractOffNutrients({ "energy-kj_100g": 418.4 }).kcal).toBe(100);
    expect(extractOffNutrients({ "energy-kcal_100g": 50, "energy-kj_100g": 999 }).kcal).toBe(50);
  });
  it("treats missing, empty, negative and non-numeric values as not reported", () => {
    expect(extractOffNutrients({ proteins_100g: "", fat_100g: -1, carbohydrates_100g: "abc" })).toEqual({ kcal: null, protein: null, carbs: null, fat: null, fiber: null });
    expect(extractOffNutrients(undefined).kcal).toBeNull();
  });
  it("uses ml basis for liquids", () => {
    const f = normalizeOffProduct({ code: "5449000000996", product_name: "Cola", serving_quantity: 330, serving_quantity_unit: "ml", nutriments: { "energy-kcal_100g": 42 } })!;
    expect(f.basisUnit).toBe("ML");
    expect(f.servings.at(-1)).toEqual({ label: "100 ml", amount: 100 });
  });
  it("skips unnamed products in search and sends a User-Agent", async () => {
    const f = mockFetch(() => json({ count: 2, products: [offProduct, { code: "1", nutriments: {} }] }));
    const r = await searchOff("nutella");
    expect(r).toHaveLength(1);
    expect((f.mock.calls[0][1]!.headers as Record<string, string>)["User-Agent"]).toMatch(/FitWorkoutFoodTracker/);
  });
  it("barcode lookup: found, not found, invalid", async () => {
    mockFetch(() => json({ status: 1, product: offProduct }));
    expect((await getOffProduct("3017624010966")).name).toBe("Nutella");
    mockFetch(() => json({ status: 0, status_verbose: "product not found" }));
    await expect(getOffProduct("0000000000000")).rejects.toMatchObject({ kind: "not_found" });
    await expect(getOffProduct("12ab")).rejects.toMatchObject({ kind: "not_found" });
  });
});

describe("implausible provider data is not persisted as real values (D1)", () => {
  it("OFF: reproduced 54,000,000 kcal/100 g becomes null; other values kept", () => {
    const f = normalizeOffProduct({ code: "1234567890123", product_name: "Data-entry error product",
      nutriments: { "energy-kcal_100g": 54000000, proteins_100g: 6, carbohydrates_100g: 50, fat_100g: 30 } })!;
    expect(f.per100).toEqual({ kcal: null, protein: 6, carbs: 50, fat: 30, fiber: null });
  });
  it("USDA: implausible protein becomes null", () => {
    const f = normalizeUsdaFood({ fdcId: 1, description: "Bad", foodNutrients: [
      { nutrientId: 1008, unitName: "KCAL", value: 120 }, { nutrientId: 1003, unitName: "G", value: 250 }] })!;
    expect(f.per100.kcal).toBe(120);
    expect(f.per100.protein).toBeNull();
  });
  it("serving sizes above 5000 g/ml are dropped", () => {
    const off = normalizeOffProduct({ code: "1234567890124", product_name: "Huge", serving_quantity: 9_000_000, serving_size: "9000 kg", nutriments: {} })!;
    expect(off.servings).toEqual([{ label: "100 g", amount: 100 }]);
    const usda = normalizeUsdaFood({ fdcId: 2, description: "x", foodNutrients: [], foodPortions: [{ gramWeight: 1e9, amount: 1, modifier: "silo" }] })!;
    expect(usda.servings).toEqual([{ label: "100 g", amount: 100 }]);
  });
});

describe("S2: configuration errors are generic for clients and logged server-side without secrets", () => {
  it("missing FDC_API_KEY: generic message, detail logged, no network call", async () => {
    delete process.env.FDC_API_KEY;
    _resetUsdaConfigLog();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = mockFetch(() => json({}));
    const e = await searchUsda("banana").catch((x) => x);
    expect(e.kind).toBe("not_configured");
    expect(e.message).toBe("This food database is currently unavailable. Try again later.");
    expect(e.message).not.toMatch(/FDC_API_KEY|key|configur/i);
    expect(f).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join(" ")).toMatch(/FDC_API_KEY is not set/);
    log.mockRestore();
  });
  it("detail is logged at most once a minute (no log flooding)", async () => {
    delete process.env.FDC_API_KEY;
    _resetUsdaConfigLog();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 5; i++) await searchUsda(`q${i}`).catch(() => {});
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
  it("credentials rejected (401/403): generic message; the key value never appears in logs or errors", async () => {
    process.env.FDC_API_KEY = "secret-key-value-123";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const status of [401, 403]) {
      _resetUsdaCache();
      mockFetch(() => new Response("forbidden", { status }));
      const e = await searchUsda(`cred${status}`).catch((x) => x);
      expect(e.kind).toBe("not_configured");
      expect(e.message).not.toContain("secret-key-value-123");
      expect(e.message).not.toMatch(/credential|key/i);
    }
    const logged = log.mock.calls.flat().map(String).join(" ");
    expect(logged).toMatch(/HTTP 401/);
    expect(logged).not.toContain("secret-key-value-123");
    log.mockRestore();
  });
});

describe("D3: provider backoff through the real clients", () => {
  it("a provider 429 with Retry-After stops further calls until it expires", async () => {
    const f = mockFetch(() => new Response("slow down", { status: 429, headers: { "Retry-After": "120" } }));
    const first = await searchOff("rl1").catch((x) => x);
    expect(first).toMatchObject({ kind: "rate_limited", retryAfterMs: 120_000 });
    const second = await searchOff("rl2").catch((x) => x);
    expect(second.kind).toBe("unavailable");
    expect(f).toHaveBeenCalledTimes(1); // fail fast: provider not contacted again
  });
  it("3 consecutive failures stop further calls", async () => {
    const f = mockFetch(() => new Response("oops", { status: 503 }));
    for (let i = 0; i < 3; i++) await getOffProduct(`300000000000${i}`).catch(() => {});
    const e = await getOffProduct("3000000000009").catch((x) => x);
    expect(e.kind).toBe("unavailable");
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("cached results don't consume budget", async () => {
    const f = mockFetch(() => json({ count: 1, products: [offProduct] }));
    for (let i = 0; i < 10; i++) await searchOff("nutella", "user-x");
    expect(f).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) await searchOff(`other${i}`, "user-x");
    await expect(searchOff("one-too-many", "user-x")).rejects.toMatchObject({ kind: "user_rate_limited" });
  });
});

describe("D7: Open Food Facts energy normalisation (current, conservative behaviour)", () => {
  it("energy-kcal_100g is used directly when present, whatever energy_unit says", () => {
    expect(extractOffNutrients({ "energy-kcal_100g": 250, energy_unit: "kJ", energy_100g: 1046 }).kcal).toBe(250);
    expect(extractOffNutrients({ "energy-kcal_100g": 250, energy_unit: "kcal" }).kcal).toBe(250);
  });
  it("energy-kj_100g is converted exactly (÷ 4.184) when kcal is absent", () => {
    expect(extractOffNutrients({ "energy-kj_100g": 1046 }).kcal).toBe(250);
    expect(extractOffNutrients({ "energy-kj_100g": 1046, energy_unit: "kcal" }).kcal).toBe(250);
  });
  it('energy_100g is converted from kJ when energy_unit is "kJ" or absent', () => {
    expect(extractOffNutrients({ energy_100g: 1046, energy_unit: "kJ" }).kcal).toBe(250);
    expect(extractOffNutrients({ energy_100g: 1046 }).kcal).toBe(250);
  });
  it('energy_100g with energy_unit "kcal" (or any other unit) is NOT guessed: kcal stays missing', () => {
    // Whether OFF normalises energy_100g to kJ in this case is unconfirmed without live data.
    // Treating it as kJ could understate energy 4.184×; treating it as kcal could overstate it.
    expect(extractOffNutrients({ energy_100g: 250, energy_unit: "kcal" }).kcal).toBeNull();
    expect(extractOffNutrients({ energy_100g: 250, energy_unit: "kj" }).kcal).toBeNull();
    expect(extractOffNutrients({ energy_100g: 250, energy_unit: "Cal" }).kcal).toBeNull();
  });
  it("no energy fields → missing", () => {
    expect(extractOffNutrients({ proteins_100g: 5 }).kcal).toBeNull();
  });
});

describe("circuit breaker counts malformed (valid JSON, wrong structure) responses", () => {
  let n = 0;
  const uniq = () => `m${++n}`;
  // [name, call, malformed body, valid body]
  const ops: [string, () => Promise<unknown>, unknown, unknown][] = [
    ["USDA search", () => searchUsda(uniq()), { unexpected: true }, { totalHits: 0, foods: [] }],
    ["USDA detail", () => getUsdaFood(String(100000 + ++n)), { foo: 1 }, usdaDetail],
    ["OFF search", () => searchOff(uniq()), { count: 1, products: "nope" }, { count: 0, products: [] }],
    ["OFF product", () => getOffProduct(String(4000000000000 + ++n)), { status: 1 }, { status: 1, product: offProduct }],
  ];

  for (const [name, call, malformed, valid] of ops) {
    it(`${name}: 3 malformed responses open the circuit and stop provider requests`, async () => {
      const f = mockFetch(() => json(malformed));
      for (let i = 0; i < 3; i++) await expect(call()).rejects.toMatchObject({ kind: "invalid_response" });
      await expect(call()).rejects.toMatchObject({ kind: "unavailable" });
      await expect(call()).rejects.toMatchObject({ kind: "unavailable" });
      expect(f).toHaveBeenCalledTimes(3); // 4th and 5th never reached the provider
    });
    it(`${name}: a successful response resets the failure count`, async () => {
      let body: unknown = malformed;
      const f = mockFetch(() => json(body));
      for (let i = 0; i < 2; i++) await call().catch(() => {});
      body = valid;
      await call().catch(() => {}); // success (or a valid not-found) resets
      body = malformed;
      for (let i = 0; i < 2; i++) await expect(call()).rejects.toMatchObject({ kind: "invalid_response" });
      expect(f).toHaveBeenCalledTimes(5); // still closed: every call reached the provider
      await expect(call()).rejects.toMatchObject({ kind: "invalid_response" }); // 3rd consecutive
      await expect(call()).rejects.toMatchObject({ kind: "unavailable" });
      expect(f).toHaveBeenCalledTimes(6);
    });
  }

  it("validators: accepted and rejected structures", () => {
    expect(isUsdaSearchResponse({ foods: [] })).toBe(true);
    for (const bad of [null, [], "x", 1, {}, { foods: {} }]) expect(isUsdaSearchResponse(bad)).toBe(false);
    expect(isUsdaFoodResponse(usdaDetail)).toBe(true);
    for (const bad of [null, [], {}, { fdcId: 1 }, { description: "x" }, { fdcId: 1, description: "  " }]) expect(isUsdaFoodResponse(bad)).toBe(false);
    expect(isOffSearchResponse({ products: [] })).toBe(true);
    for (const bad of [null, [], {}, { products: {} }]) expect(isOffSearchResponse(bad)).toBe(false);
    expect(isOffProductResponse({ status: 0 })).toBe(true);
    expect(isOffProductResponse({ status: 1, product: {} })).toBe(true);
    for (const bad of [null, [], {}, { status: 1 }, { status: 1, product: [] }, { status: "1", product: {} }, { status: 2 }]) expect(isOffProductResponse(bad)).toBe(false);
  });

  it("OFF product not found (status 0) is a healthy answer and doesn't count", async () => {
    const f = mockFetch(() => json({ status: 0, status_verbose: "product not found" }));
    for (let i = 0; i < 5; i++) await expect(getOffProduct(String(5000000000000 + i))).rejects.toMatchObject({ kind: "not_found" });
    expect(f).toHaveBeenCalledTimes(5);
  });

  it("a well-formed product without a name is reported but doesn't trip the circuit", async () => {
    const f = mockFetch(() => json({ status: 1, product: { code: "1", nutriments: {} } }));
    for (let i = 0; i < 5; i++) await expect(getOffProduct(String(6000000000000 + i))).rejects.toMatchObject({ kind: "invalid_response" });
    expect(f).toHaveBeenCalledTimes(5);
  });
});
