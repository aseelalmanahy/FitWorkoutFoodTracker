// FOOD-01 and FOOD-02 through the real clients and service: duplicate searches share one provider request,
// spacing and case don't make a second one, a failure isn't kept, and a ranked pool puts the plain food first.
// Mocked fetch and Prisma only: no network, no database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetGuard } from "./guard";
import { SingleFlight, searchKey } from "./http";
import { _resetUsdaCache, searchUsda } from "./usda";
import { _resetOffCache, searchOff } from "./openfoodfacts";
import { SEARCH_CANDIDATES, SEARCH_SHOWN, searchFoods } from "./service";

const db = vi.hoisted(() => ({ prisma: { food: { findMany: vi.fn() } } }));
vi.mock("@/lib/server/db", () => ({ prisma: db.prisma }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const usdaFood = (fdcId: number, description: string) => ({ fdcId, description, dataType: "SR Legacy", foodNutrients: [
  { nutrientId: 1008, nutrientNumber: "208", unitName: "KCAL", value: 60 }, { nutrientId: 1003, nutrientNumber: "203", unitName: "G", value: 3 },
  { nutrientId: 1005, nutrientNumber: "205", unitName: "G", value: 5 }, { nutrientId: 1004, nutrientNumber: "204", unitName: "G", value: 3 }] });
const offEmpty = { hits: [], count: 0, page: 1, page_size: 40, page_count: 0, took: 1, timed_out: false, is_count_exact: true, debug: { query: {} } };

let calls: { url: string; body: string | null }[];
let usdaFoods: ReturnType<typeof usdaFood>[];
let gate: Promise<void> | null;
beforeEach(() => {
  process.env.FDC_API_KEY = "test-key";
  process.env.FDC_BASE_URL = "https://fdc.test/v1";
  process.env.OFF_BASE_URL = "https://off.test";
  _resetUsdaCache(); _resetOffCache(); _resetGuard();
  db.prisma.food.findMany.mockReset().mockResolvedValue([]);
  calls = [];
  gate = null;
  usdaFoods = [usdaFood(1, "Milk, whole")];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: (init?.body as string) ?? null });
    if (gate) await gate;
    if (url.startsWith("https://fdc.test")) return json({ totalHits: usdaFoods.length, currentPage: 1, foods: usdaFoods });
    return json(offEmpty);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("one provider request per search (FOOD-01)", () => {
  it("identical searches at the same moment share one request", async () => {
    let open = () => {};
    gate = new Promise((r) => { open = r; });
    const all = Promise.all([searchUsda("milk", "u1"), searchUsda("milk", "u2"), searchUsda("milk", "u1")]);
    await new Promise((r) => setTimeout(r, 10));
    open();
    const [a, b, c] = await all;
    expect(calls).toHaveLength(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
  it("case and spacing don't make a second request, for USDA or Open Food Facts", async () => {
    await searchUsda("Large  Egg", "u1");
    await searchUsda(" large egg ", "u1");
    await searchOff("Greek   Yogurt", "u1");
    await searchOff("greek yogurt", "u1");
    expect(calls.filter((c) => c.url.startsWith("https://fdc.test"))).toHaveLength(1);
    expect(calls.filter((c) => c.url.startsWith("https://off.test"))).toHaveLength(1);
    expect(searchKey("  Large   EGG ", 50)).toBe("large egg|50");
  });
  it("a failure is shared by those waiting, and the next search asks again", async () => {
    const flight = new SingleFlight<number>();
    let n = 0;
    const failing = () => new Promise<number>((_, reject) => setTimeout(() => { n++; reject(new Error("down")); }, 5));
    const results = await Promise.allSettled([flight.run("k", failing), flight.run("k", failing)]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(n).toBe(1);
    expect(flight.size).toBe(0);
    await expect(flight.run("k", async () => 7)).resolves.toBe(7);
  });
});

describe("a ranked pool (FOOD-02)", () => {
  it("asks for a larger pool in one request, shows the most relevant first, and trims what's shown", async () => {
    // As USDA returned it for "milk": the plain milk records come after many others.
    usdaFoods = [
      usdaFood(10, "Coconut milk"), usdaFood(11, "Crackers, milk"),
      ...Array.from({ length: 40 }, (_, i) => usdaFood(100 + i, `Candy, milk chocolate, variety ${i}`)),
      usdaFood(20, "Milk, whole, 3.25% milkfat, with added vitamin D"), usdaFood(21, "Milk, reduced fat, fluid, 2% milkfat"),
    ];
    const r = await searchFoods("u1", "milk", ["USDA"]);
    const usdaCalls = calls.filter((c) => c.url.startsWith("https://fdc.test"));
    expect(usdaCalls).toHaveLength(1);
    expect(JSON.parse(usdaCalls[0].body!).pageSize).toBe(SEARCH_CANDIDATES.USDA);
    expect(r.results.USDA.slice(0, 2).map((i) => i.name)).toEqual(["Milk, reduced fat, fluid, 2% milkfat", "Milk, whole, 3.25% milkfat, with added vitamin D"]);
    expect(r.results.USDA).toHaveLength(SEARCH_SHOWN);
    // Only the order changed: each record is the provider's own.
    expect(r.results.USDA[0]).toMatchObject({ source: "USDA", sourceId: "21", per100: { kcal: 60, protein: 3, carbs: 5, fat: 3 } });
  });
  it("leaves a barcode answer in the provider's order", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ status: 1, code: "3017620422003", product: { code: "3017620422003", product_name: "Nutella", nutriments: { "energy-kcal_100g": 539 } } })));
    const r = await searchFoods("u1", "3017620422003", ["OPEN_FOOD_FACTS"]);
    expect(r.results.OPEN_FOOD_FACTS.map((i) => i.name)).toEqual(["Nutella"]);
  });
});
