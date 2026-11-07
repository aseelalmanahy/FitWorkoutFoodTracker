// Which external providers a search actually calls, for each filter the add-food screen can send.
// Mocked fetch and Prisma only: no network, no database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { foodSearchQuerySchema } from "@/lib/validation";
import { searchPath, sourcesFor, type Filter } from "@/lib/food-search-view";
import { _resetGuard } from "./guard";
import { _resetUsdaCache } from "./usda";
import { _resetOffCache } from "./openfoodfacts";
import { searchFoods, type SearchSource } from "./service";

const db = vi.hoisted(() => ({ prisma: { food: { findMany: vi.fn() } } }));
vi.mock("@/lib/server/db", () => ({ prisma: db.prisma }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const offEmpty = { hits: [], count: 0, page: 1, page_size: 20, page_count: 0, took: 1, timed_out: false, is_count_exact: true, debug: { query: {} } };

let calls: string[];
beforeEach(() => {
  process.env.FDC_API_KEY = "test-key";
  process.env.FDC_BASE_URL = "https://fdc.test/v1";
  process.env.OFF_BASE_URL = "https://off.test";
  _resetUsdaCache();
  _resetOffCache();
  _resetGuard();
  db.prisma.food.findMany.mockReset().mockResolvedValue([]);
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = new URL(url);
    calls.push(`${u.host}${u.pathname}`);
    if (u.host === "fdc.test") return json({ totalHits: 0, currentPage: 1, foods: [] });
    if (u.pathname.startsWith("/api/v2/product/")) return json({ status: 0, status_verbose: "product not found" });
    return json(offEmpty);
  }));
});
afterEach(() => vi.unstubAllGlobals());

/** The sources the server would search for the request the client sends under this filter. */
const serverSourcesFor = (filter: Filter, q: string) => {
  const url = new URL(searchPath(q, filter), "http://x");
  return foodSearchQuerySchema.parse({ q: url.searchParams.get("q"), sources: url.searchParams.get("sources") ?? undefined }).sources as SearchSource[];
};
const hosts = () => [...new Set(calls.map((c) => c.split("/")[0]))].sort();

describe("text search: only the filter's providers are called", () => {
  it.each([
    ["ALL", ["fdc.test", "off.test"]],
    ["USDA", ["fdc.test"]],
    ["OPEN_FOOD_FACTS", ["off.test"]],
    ["CUSTOM", []],
  ] as const)("%s calls %j", async (filter, expected) => {
    const sources = serverSourcesFor(filter, "large egg");
    expect([...sources].sort()).toEqual([...sourcesFor(filter)].sort());
    const r = await searchFoods("u1", "large egg", sources);
    expect(hosts()).toEqual(expected);
    expect(calls.filter((c) => c.startsWith("fdc.test")).length).toBe(expected.includes("fdc.test" as never) ? 1 : 0);
    expect(r.sources).toEqual(["CUSTOM", "USDA", "OPEN_FOOD_FACTS"].filter((s) => sources.includes(s as SearchSource)));
    // My foods is always a query on the person's own rows, never a provider call.
    expect(db.prisma.food.findMany.mock.calls[0][0].where.userId).toBe("u1");
  });
});

describe("barcode: unchanged", () => {
  it("USDA is never asked about a barcode, and Open Food Facts only when its source is chosen", async () => {
    await searchFoods("u1", "3017624010966", serverSourcesFor("USDA", "3017624010966"));
    expect(calls).toEqual([]);
    await searchFoods("u1", "3017624010966", serverSourcesFor("OPEN_FOOD_FACTS", "3017624010966"));
    expect(calls).toEqual(["off.test/api/v2/product/3017624010966.json"]);
    calls = [];
    await searchFoods("u1", "3017624010966", serverSourcesFor("CUSTOM", "3017624010966"));
    expect(calls).toEqual([]);
    expect(db.prisma.food.findMany.mock.calls.at(-1)![0].where).toEqual({ userId: "u1", source: "CUSTOM", barcode: "3017624010966" });
  });
});
