// Custom-food search: which of a person's own foods a query matches. No database: the Prisma filter the
// service builds is evaluated here against in-memory foods, using Prisma's documented meaning of each
// operator in it (case-insensitive `contains`, AND, OR, relation `some`). The real query runs in the
// guarded API suites, on the test database only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { CUSTOM_SEARCH_MAX_WORDS, customFoodWhere, localTestSources, searchFoods } from "./service";

const db = vi.hoisted(() => ({ prisma: { food: { findMany: vi.fn() } } }));
vi.mock("@/lib/server/db", () => ({ prisma: db.prisma }));

interface MemFood { id: string; userId: string | null; source: string; name: string; brand: string | null; barcode: string | null; servings: { label: string }[] }

type Where = Record<string, unknown>;
const contains = (value: string | null, f: { contains: string; mode?: string }) =>
  value !== null && (f.mode === "insensitive" ? value.toLowerCase().includes(f.contains.toLowerCase()) : value.includes(f.contains));

/** Evaluates exactly the operators customFoodWhere uses, and refuses anything else, so a new operator can't pass unnoticed. */
function matches(food: MemFood, where: Where): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return (cond as Where[]).every((w) => matches(food, w));
    if (key === "OR") return (cond as Where[]).some((w) => matches(food, w));
    if (key === "userId" || key === "source" || key === "barcode") return food[key] === cond;
    if (key === "name" || key === "brand") return contains(food[key], cond as { contains: string; mode?: string });
    if (key === "servings") {
      const some = (cond as { some: { label: { contains: string; mode?: string } } }).some;
      return food.servings.some((s) => contains(s.label, some.label));
    }
    throw new Error(`The test evaluator doesn't know "${key}"`);
  });
}

const me = "user-me";
const other = "user-other";
const foods: MemFood[] = [
  { id: "egg", userId: me, source: "CUSTOM", name: "Whole egg (demo)", brand: null, barcode: null, servings: [{ label: "1 large" }] },
  { id: "banana", userId: me, source: "CUSTOM", name: "Banana (demo)", brand: null, barcode: null, servings: [{ label: "1 medium" }] },
  { id: "yogurt", userId: me, source: "CUSTOM", name: "Plain Greek yogurt (demo)", brand: null, barcode: null, servings: [{ label: "1 container" }] },
  { id: "chicken", userId: me, source: "CUSTOM", name: "Chicken breast, cooked (demo)", brand: null, barcode: null, servings: [{ label: "1 portion" }] },
  { id: "bar", userId: me, source: "CUSTOM", name: "Protein bar", brand: "Hillside", barcode: "5012345678900", servings: [{ label: "1 bar" }] },
  { id: "their-egg", userId: other, source: "CUSTOM", name: "Large egg", brand: null, barcode: "5012345678900", servings: [{ label: "1 large" }] },
  { id: "usda-egg", userId: null, source: "USDA", name: "Egg, whole, raw", brand: null, barcode: null, servings: [{ label: "1 large" }] },
];
const search = (userId: string, q: string) => foods.filter((f) => matches(f, customFoodWhere(userId, q) as Where)).map((f) => f.id);

describe("custom-food matching", () => {
  it.each([
    ["large egg", ["egg"]],
    ["egg", ["egg"]],
    ["EGG Large", ["egg"]],
    ["greek yogurt", ["yogurt"]],
    ["yogurt greek", ["yogurt"]],
    ["chicken breast", ["chicken"]],
    ["banana", ["banana"]],
    ["medium banana", ["banana"]],
    ["hillside", ["bar"]],
    ["container", ["yogurt"]],
  ])("%j finds %j", (q, expected) => expect(search(me, q)).toEqual(expected));

  it.each(["pizza", "large banana", "egg banana", "medium egg", "eggs", "oatmeal"])("%j finds nothing", (q) => {
    // "large banana": the words are in two different foods, and must never combine into a match.
    // "eggs" and "oatmeal": no word is dropped or stemmed, so these still need their own records.
    expect(search(me, q)).toEqual([]);
  });

  it("returns only the signed-in person's own custom foods", () => {
    expect(search(me, "large")).toEqual(["egg"]); // not their egg, nor the USDA one, though both are served "1 large"
    expect(search(other, "large egg")).toEqual(["their-egg"]);
    const w = customFoodWhere(me, "large egg");
    expect([w.userId, w.source]).toEqual([me, "CUSTOM"]); // at the top level, so no OR inside can widen it
  });

  it("a barcode still matches the barcode only, for this person only", () => {
    expect(customFoodWhere(me, "5012345678900")).toEqual({ userId: me, source: "CUSTOM", barcode: "5012345678900" });
    expect(search(me, "5012345678900")).toEqual(["bar"]);
  });

  it("is bounded: at most 8 words become conditions", () => {
    const w = customFoodWhere(me, "a b c d e f g h i j k l");
    expect((w.AND as Prisma.FoodWhereInput[]).length).toBe(CUSTOM_SEARCH_MAX_WORDS);
  });
});

describe("searchFoods uses that query, unchanged", () => {
  beforeEach(() => db.prisma.food.findMany.mockReset());
  it("sends the same filter, a limit of 20, and includes servings", async () => {
    db.prisma.food.findMany.mockResolvedValue([]);
    const r = await searchFoods(me, "  large egg ", ["CUSTOM"]);
    const args = db.prisma.food.findMany.mock.calls[0][0];
    expect(args.where).toEqual(customFoodWhere(me, "large egg"));
    expect([args.take, args.include]).toEqual([20, { servings: true }]);
    expect(r.query).toBe("large egg");
  });
});

describe("local test sources", () => {
  const saved = { fdc: process.env.FDC_BASE_URL, off: process.env.OFF_BASE_URL };
  afterEach(() => {
    for (const [k, v] of [["FDC_BASE_URL", saved.fdc], ["OFF_BASE_URL", saved.off]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  it("names a provider only when it points at this machine", () => {
    delete process.env.FDC_BASE_URL;
    delete process.env.OFF_BASE_URL;
    expect(localTestSources()).toEqual([]);
    process.env.FDC_BASE_URL = "http://127.0.0.1:4010/fdc/v1";
    process.env.OFF_BASE_URL = "http://localhost:4010/off";
    expect(localTestSources()).toEqual(["USDA", "OPEN_FOOD_FACTS"]);
    process.env.OFF_BASE_URL = "https://world.openfoodfacts.org";
    expect(localTestSources()).toEqual(["USDA"]);
    process.env.FDC_BASE_URL = "http://[::1]:4010/fdc/v1";
    expect(localTestSources()).toEqual(["USDA"]);
  });
});
