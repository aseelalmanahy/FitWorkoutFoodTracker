// Open Food Facts text search through the real client: Search-a-licious request and response
// handling, plus retry behaviour. Mocked responses only: no network, no database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetGuard } from "./guard";
import { _setSearchRetryDelay } from "./http";
import { _resetOffCache, getOffProduct, normalizeOffProduct, plainSearchTerms, searchOff } from "./openfoodfacts";
import { resolveExternalFood, searchFoods } from "./service";
import { ExternalFoodError } from "./types";

// No database: every Prisma call the service makes goes to these in-memory fakes.
const db = vi.hoisted(() => {
  const tx = {
    food: { upsert: vi.fn(), findUniqueOrThrow: vi.fn() },
    foodServing: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  };
  return { tx, prisma: { food: { findMany: vi.fn(), findUnique: vi.fn() }, $transaction: vi.fn() } };
});
vi.mock("@/lib/server/db", () => ({ prisma: db.prisma }));

const hit = {
  code: "3017620422003",
  brands: ["Nutella", "Ferrero"],
  product_name: "Nutella",
  nutriments: { "energy-kcal_100g": 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9 },
};
const okBody = { hits: [hit], count: 1, page: 1, page_size: 20, page_count: 1, took: 5, timed_out: false, is_count_exact: true, debug: { query: {} } };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const page503 = (headers: Record<string, string> = {}) => new Response("<title>Page temporarily unavailable</title>", { status: 503, headers });
const networkError = () => Object.assign(new TypeError("fetch failed"), { name: "TypeError" });
const timeoutError = () => Object.assign(new Error("timed out"), { name: "TimeoutError" });

function mockFetch(...responses: (() => Response)[]) {
  let call = 0;
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => responses[Math.min(call++, responses.length - 1)]());
  vi.stubGlobal("fetch", fn);
  return fn;
}
const failure = (p: Promise<unknown>) => p.then(
  () => { throw new Error("expected a failure"); },
  (e: unknown) => e as ExternalFoodError,
);

beforeEach(() => {
  delete process.env.OFF_BASE_URL;
  delete process.env.OFF_USER_AGENT;
  delete process.env.OFF_CONTACT;
  _resetGuard();
  _resetOffCache();
  _setSearchRetryDelay(() => 0);
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.prisma.food.findMany.mockResolvedValue([]);
  db.prisma.food.findUnique.mockResolvedValue(null);
  db.prisma.$transaction.mockImplementation(async (run: (tx: typeof db.tx) => unknown) => run(db.tx));
  db.tx.food.upsert.mockReset().mockResolvedValue({ id: "food-1" });
  db.tx.food.findUniqueOrThrow.mockResolvedValue({ id: "food-1" });
  db.tx.foodServing.findMany.mockResolvedValue([]);
  db.tx.foodServing.create.mockReset().mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("search request", () => {
  it("calls Search-a-licious with the documented parameters, an identifying User-Agent and no credentials", async () => {
    const f = mockFetch(() => json(okBody));
    await searchOff("nutella", "u1");
    expect(f).toHaveBeenCalledTimes(1);
    const url = new URL(f.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://search.openfoodfacts.org/search");
    expect([...url.searchParams.keys()].sort()).toEqual(["fields", "langs", "page_size", "q"]);
    expect(url.searchParams.get("q")).toBe("nutella");
    expect(url.searchParams.get("page_size")).toBe("20");
    expect(url.searchParams.get("fields")).toContain("nutriments");
    const headers = f.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/^FitWorkoutFoodTracker\/[\d.]+ \(.+\)$/);
    expect(Object.keys(headers).sort()).toEqual(["Accept", "User-Agent"]);
  });

  it("follows an OFF_BASE_URL override, so a stub-based run can't reach the real service", async () => {
    process.env.OFF_BASE_URL = "http://localhost:4010/off";
    const f = mockFetch(() => json(okBody));
    await searchOff("nutella");
    expect(f.mock.calls[0][0]).toMatch(/^http:\/\/localhost:4010\/off\/search\?/);
  });

  it("treats an explicit production OFF_BASE_URL like the default", async () => {
    process.env.OFF_BASE_URL = "https://world.openfoodfacts.org";
    const f = mockFetch(() => json(okBody));
    await searchOff("nutella");
    expect(f.mock.calls[0][0]).toMatch(/^https:\/\/search\.openfoodfacts\.org\/search\?/);
  });

  it("reduces Lucene syntax in user input to plain words", () => {
    expect(plainSearchTerms(`m&m's (peanut)`)).toBe("m m's peanut");
    expect(plainSearchTerms(`brands:ferrero "nutella" AND NOT oil*`)).toBe("brands ferrero nutella and not oil");
    expect(plainSearchTerms("coca-cola")).toBe("coca cola");
  });

  it("makes no request when nothing searchable is left", async () => {
    const f = mockFetch(() => json(okBody));
    expect(await searchOff("()*")).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("200 responses", () => {
  it("normalizes hits into the existing food shape, including array brands and nutrients per 100 g", async () => {
    mockFetch(() => json(okBody));
    expect(await searchOff("nutella", "u1")).toEqual([{
      source: "OPEN_FOOD_FACTS",
      sourceId: "3017620422003",
      name: "Nutella",
      brand: "Nutella",
      barcode: "3017620422003",
      dataType: "Packaged",
      basisUnit: "G",
      per100: { kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9, fiber: null },
      servings: [{ label: "100 g", amount: 100 }],
    }]);
  });

  it("keeps missing nutrients null when a hit has no nutriments", async () => {
    mockFetch(() => json({ ...okBody, hits: [{ code: "1234567890123", product_name: "No data", brands: [] }] }));
    const [food] = await searchOff("nodata");
    expect(food.brand).toBeNull();
    expect(food.per100).toEqual({ kcal: null, protein: null, carbs: null, fat: null, fiber: null });
  });

  it("returns an empty list for no hits, and caches results", async () => {
    const f = mockFetch(() => json({ ...okBody, hits: [], count: 0 }));
    expect(await searchOff("zzz")).toEqual([]);
    expect(await searchOff("ZZZ")).toEqual([]);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("search hit mapping", () => {
  it("never turns a non-text name into a display name", () => {
    expect(normalizeOffProduct({ code: "1234567", product_name: { en: "x" }, generic_name: "Spread" })?.name).toBe("Spread");
    expect(normalizeOffProduct({ code: "1234567", product_name: { en: "x" }, generic_name: 12 })).toBeNull();
    expect(normalizeOffProduct({ code: { value: "1" }, product_name: "Spread" })).toBeNull();
  });

  it("reads the first brand from an array and tolerates unusable brand values", () => {
    const brandOf = (brands: unknown) => normalizeOffProduct({ code: "1234567", product_name: "x", brands })?.brand;
    expect(brandOf(["Ferrero", "Nutella"])).toBe("Ferrero");
    expect(brandOf("Ferrero, Nutella")).toBe("Ferrero");
    for (const unusable of [[], [1], {}, 5, null, undefined]) expect(brandOf(unusable)).toBeNull();
  });

  it("never invents nutrients: absent, blank, negative and non-numeric stay null, a reported 0 stays 0", () => {
    const food = normalizeOffProduct({ code: "1234567", product_name: "x", nutriments: {
      "energy-kcal_100g": 0, proteins_100g: "", carbohydrates_100g: -4, fat_100g: "n/a",
    } })!;
    expect(food.per100).toEqual({ kcal: 0, protein: null, carbs: null, fat: null, fiber: null });
  });

  it("drops hits that could never be opened through the product API", async () => {
    mockFetch(() => json({ ...okBody, hits: [hit, { ...hit, code: "abc-123" }, { ...hit, code: "12" }, { product_name: "No code" }] }));
    expect((await searchOff("nutella", "u1")).map((f) => f.sourceId)).toEqual(["3017620422003"]);
  });
});

describe("selecting a search hit", () => {
  it("loads the full product from the product API, not the preview", async () => {
    const f = mockFetch(() => json({ ...okBody, hits: [{ code: hit.code, product_name: "Nutella", brands: ["Nutella"] }] }));
    const [item] = (await searchFoods("u1", "nutella", ["OPEN_FOOD_FACTS"])).results.OPEN_FOOD_FACTS;
    expect([item.hasNutrition, item.complete, item.foodId]).toEqual([false, false, null]);
    expect(item.per100.kcal).toBeNull();
    expect(new URL(f.mock.calls[0][0]).host).toBe("search.openfoodfacts.org");

    const product = mockFetch(() => json({ status: 1, product: { ...hit, brands: "Nutella, Ferrero", serving_quantity: 15, serving_size: "15 g" } }));
    await resolveExternalFood("OPEN_FOOD_FACTS", item.sourceId, "u1");
    expect(new URL(product.mock.calls[0][0]).host).toBe("world.openfoodfacts.org");
    expect(new URL(product.mock.calls[0][0]).pathname).toBe(`/api/v2/product/${hit.code}.json`);
    const { create } = db.tx.food.upsert.mock.calls[0][0];
    expect([create.source, create.sourceId, create.origin, Number(create.kcalPer100), Number(create.proteinPer100)])
      .toEqual(["OPEN_FOOD_FACTS", hit.code, "world.openfoodfacts.org", 539, 6.3]);
    expect(db.tx.foodServing.create.mock.calls.map((c) => Number(c[0].data.amount))).toEqual([15, 100]);
  });
});

describe("temporary provider errors aren't empty results", () => {
  const offSearch = (q: string) => searchFoods("u1", q, ["OPEN_FOOD_FACTS"]);

  it("a failed search reports an error, and the failure isn't cached as empty", async () => {
    mockFetch(() => page503());
    const failed = await offSearch("nutella");
    expect(failed.results.OPEN_FOOD_FACTS).toEqual([]);
    expect(failed.errors).toEqual([{ source: "OPEN_FOOD_FACTS", kind: "http", message: "The food database returned an error (503)." }]);

    const f = mockFetch(() => json(okBody));
    const recovered = await offSearch("nutella");
    expect(f).toHaveBeenCalledTimes(1);
    expect(recovered.errors).toEqual([]);
    expect(recovered.results.OPEN_FOOD_FACTS).toHaveLength(1);
  });

  it("a timed-out search with no hits is an error, not 'no foods found'", async () => {
    const f = mockFetch(() => json({ ...okBody, hits: [], count: 0, timed_out: true }));
    const r = await offSearch("nutella");
    expect(r.errors.map((e) => e.kind)).toEqual(["invalid_response"]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("partial results from a timed-out search are returned but not cached", async () => {
    const f = mockFetch(() => json({ ...okBody, timed_out: true }));
    expect(await searchOff("nutella", "u1")).toHaveLength(1);
    expect(await searchOff("nutella", "u1")).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("a genuine empty result has no error", async () => {
    mockFetch(() => json({ ...okBody, hits: [], count: 0 }));
    expect(await offSearch("zzzz")).toMatchObject({ errors: [], results: { OPEN_FOOD_FACTS: [] } });
  });
});

describe("failures", () => {
  it("503: retries once and returns the results when the retry succeeds", async () => {
    const f = mockFetch(() => page503(), () => json(okBody));
    expect(await searchOff("nutella", "u1")).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("503 twice: stops after one retry with the same generic client error", async () => {
    const f = mockFetch(() => page503());
    const e = await failure(searchOff("nutella", "u1"));
    expect([e.kind, e.message]).toEqual(["http", "The food database returned an error (503)."]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("503 with Retry-After: doesn't retry", async () => {
    const f = mockFetch(() => page503({ "Retry-After": "120" }));
    expect((await failure(searchOff("nutella", "u1"))).kind).toBe("http");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("500: doesn't retry", async () => {
    const f = mockFetch(() => new Response("oops", { status: 500 }));
    expect((await failure(searchOff("nutella", "u1"))).kind).toBe("http");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("network error: retries once", async () => {
    let call = 0;
    const f = vi.fn(async () => {
      if (call++ === 0) throw networkError();
      return json(okBody);
    });
    vi.stubGlobal("fetch", f);
    expect(await searchOff("nutella", "u1")).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("429: doesn't retry, keeps Retry-After, and stops further requests", async () => {
    const f = mockFetch(() => json({}, 429, { "Retry-After": "120" }));
    const e = await failure(searchOff("first", "u1"));
    expect([e.kind, e.retryAfterMs]).toEqual(["rate_limited", 120_000]);
    expect((await failure(searchOff("second", "u1"))).kind).toBe("unavailable");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("timeout: doesn't retry, since waiting again would double an already slow search", async () => {
    const f = vi.fn(async () => { throw timeoutError(); });
    vi.stubGlobal("fetch", f);
    expect((await failure(searchOff("nutella", "u1"))).kind).toBe("timeout");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("malformed 200 and the service's own error body: invalid_response, no retry", async () => {
    for (const [q, body] of [["one", { hits: "nope" }], ["two", { errors: [{ title: "Query failed" }], debug: { query: {} } }], ["three", { products: [] }]] as const) {
      const f = mockFetch(() => json(body));
      expect((await failure(searchOff(q, "u1"))).kind).toBe("invalid_response");
      expect(f).toHaveBeenCalledTimes(1);
      _resetGuard();
    }
  });

  it("authentication failure (401/403): no retry, generic error, no credentials sent", async () => {
    for (const status of [401, 403]) {
      const f = mockFetch(() => json({ error: "auth required" }, status));
      const e = await failure(searchOff(`auth${status}`, "u1"));
      expect([e.kind, e.message]).toEqual(["not_configured", "This food database is currently unavailable. Try again later."]);
      expect(f).toHaveBeenCalledTimes(1);
      _resetGuard();
    }
  });
});

describe("retry respects the provider guard", () => {
  it("a retry doesn't use the user's budget, so a provider fault can't lock them out early", async () => {
    const f = mockFetch(() => page503(), () => json(okBody));
    for (const q of ["a1", "a2", "a3", "a4"]) await searchOff(q, "u1").catch(() => {});
    expect((await failure(searchOff("a5", "u1"))).kind).toBe("user_rate_limited");
    expect(f).toHaveBeenCalledTimes(5); // 4 allowed searches plus the one retry
  });

  it("a retry counts toward the global budget", async () => {
    let call = 0;
    const f = vi.fn(async () => (call++ % 2 === 0 ? page503() : json(okBody)));
    vi.stubGlobal("fetch", f);
    for (let i = 0; i < 5; i++) await searchOff(`g${i}`, `user-g${i}`); // each search: one failure, one retry = 10 slots
    expect(f).toHaveBeenCalledTimes(10);
    expect((await failure(searchOff("g5", "user-g5"))).kind).toBe("unavailable");
    expect(f).toHaveBeenCalledTimes(10);
  });

  it("a search that fails its retry counts once toward the circuit", async () => {
    const f = mockFetch(() => page503());
    for (const q of ["c1", "c2"]) await failure(searchOff(q, `user-${q}`));
    expect(f).toHaveBeenCalledTimes(4);
    await failure(searchOff("c3", "user-c3")); // the 3rd failed search opens the circuit
    expect(f).toHaveBeenCalledTimes(6);
    expect((await failure(searchOff("c4", "user-c4"))).kind).toBe("unavailable");
    expect(f).toHaveBeenCalledTimes(6);
  });

  it("skips the retry and reports the original failure when the global budget is used up", async () => {
    // 10 searches per minute globally: 9 fresh users use 9 slots, then the 10th search has no room to retry.
    const ok = mockFetch(() => json(okBody));
    for (let i = 0; i < 9; i++) await searchOff(`fill${i}`, `user${i}`);
    expect(ok).toHaveBeenCalledTimes(9);
    const f = mockFetch(() => page503());
    const e = await failure(searchOff("last", "user-last"));
    expect([e.kind, e.message]).toEqual(["http", "The food database returned an error (503)."]);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("barcode lookup is unchanged", () => {
  it("still uses the product API on the main host, with a comma-separated brand string", async () => {
    const f = mockFetch(() => json({ status: 1, product: { ...hit, brands: "Nutella, Ferrero", serving_quantity: 15, serving_size: "15 g" } }));
    const food = await getOffProduct("3017620422003", "u1");
    expect(new URL(f.mock.calls[0][0]).origin + new URL(f.mock.calls[0][0]).pathname).toBe("https://world.openfoodfacts.org/api/v2/product/3017620422003.json");
    expect(food.brand).toBe("Nutella");
    expect(food.per100.kcal).toBe(539);
    expect(food.servings.map((s) => s.amount)).toEqual([15, 100]);
  });

  it("doesn't retry a product lookup", async () => {
    const f = mockFetch(() => page503());
    expect((await failure(getOffProduct("3017620422003", "u1"))).kind).toBe("http");
    expect(f).toHaveBeenCalledTimes(1);
  });
});
