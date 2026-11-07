/**
 * Open Food Facts client (https://openfoodfacts.github.io/openfoodfacts-server/api/).
 * Used for packaged foods and barcode lookup. OFF data is licensed under ODbL.
 * Attribution is shown in the UI, and requests carry an identifying User-Agent.
 * `*_100g` nutriment fields are normalised per 100 g (or 100 ml for liquids).
 *
 * Text search uses Search-a-licious (search.openfoodfacts.org). The legacy /cgi/search.pl
 * returns intermittent 503s, and /api/v2/search has no full-text search. Search hits are
 * previews: selecting one resolves the full product through the product API.
 */
import "server-only";
import { MAX_SERVING_AMOUNT, sanitizePer100, type Nutrients } from "@/lib/nutrition";
import { guardedFetchJson, isObject, searchKey, SingleFlight, TtlCache } from "./http";

/**
 * /search must return an object with a `hits` array. Its own errors arrive as HTTP 200 with
 * `errors` instead. A timed-out search with no hits is a failure, not "no products found".
 */
export const isOffSearchResponse = (d: unknown) => isObject(d) && Array.isArray(d.hits) && !(d.timed_out === true && d.hits.length === 0);
/**
 * /api/v2/product/{code} must return an object with status 0 (not found) or 1
 * (found), and when found, a `product` object.
 */
export const isOffProductResponse = (d: unknown) =>
  isObject(d) && (d.status === 0 || (d.status === 1 && isObject(d.product)));
import { ExternalFoodError, num, type NormalizedFood, type ServingOption } from "./types";

const base = () => (process.env.OFF_BASE_URL ?? "https://world.openfoodfacts.org").replace(/\/$/, "");
/** Host of the configured endpoint; recorded with cached foods (see Food.origin). */
export const offOrigin = () => new URL(base()).host;
/** Follows any OFF_BASE_URL override, so stub-based tests can never reach the real search service. */
const searchBase = () => (offOrigin() === "world.openfoodfacts.org" ? "https://search.openfoodfacts.org" : base());

/**
 * `q` is parsed as Lucene query syntax, so a food name like `m&m's (peanut)` could be
 * rejected or read as an operator. Reduce user input to plain words.
 */
export const plainSearchTerms = (query: string) =>
  query
    .replace(/[+\-=&|><!(){}[\]^"~*?:\\/]/g, " ")
    .replace(/\b(AND|OR|NOT)\b/g, (operator) => operator.toLowerCase())
    .replace(/\s+/g, " ")
    .trim();
const userAgent = () =>
  process.env.OFF_USER_AGENT ?? `FitWorkoutFoodTracker/0.2 (${process.env.OFF_CONTACT ?? "https://github.com/aseelalmanahy/fitworkoutfoodtracker"})`;

export const OFF_FIELDS = [
  "code", "product_name", "product_name_en", "generic_name", "brands", "serving_size", "serving_quantity",
  "serving_quantity_unit", "product_quantity_unit", "nutriments",
].join(",");

const KJ_PER_KCAL = 4.184;

export function extractOffNutrients(nutriments: unknown): Nutrients {
  const n = (nutriments && typeof nutriments === "object" ? nutriments : {}) as Record<string, unknown>;
  let kcal = num(n["energy-kcal_100g"]);
  // Exact unit conversion when only kJ is reported (common for EU labels).
  if (kcal == null) {
    const kj = num(n["energy-kj_100g"]) ?? (n["energy_unit"] === "kJ" || n["energy_unit"] === undefined ? num(n["energy_100g"]) : null);
    if (kj != null) kcal = Math.round((kj / KJ_PER_KCAL) * 10) / 10;
  }
  return {
    kcal,
    protein: num(n["proteins_100g"]),
    carbs: num(n["carbohydrates_100g"]),
    fat: num(n["fat_100g"]),
    fiber: num(n["fiber_100g"]),
  };
}

/** First non-blank string. A provider value of another type must never become a display name. */
const firstText = (...values: unknown[]) => values.find((v): v is string => typeof v === "string" && v.trim() !== "")?.trim() ?? "";

export function normalizeOffProduct(p: Record<string, unknown>): NormalizedFood | null {
  const code = typeof p.code === "string" ? p.code.trim() : typeof p.code === "number" ? String(p.code) : "";
  const name = firstText(p.product_name, p.product_name_en, p.generic_name);
  if (!code || !name) return null;
  const unitHint = String(p.serving_quantity_unit || p.product_quantity_unit || "").toLowerCase();
  const basisUnit = unitHint === "ml" ? "ML" : "G";
  const u = basisUnit === "ML" ? "ml" : "g";
  const servings: ServingOption[] = [];
  const sq = num(p.serving_quantity);
  if (sq && sq > 0 && sq <= MAX_SERVING_AMOUNT) {
    const label = typeof p.serving_size === "string" && p.serving_size.trim() ? p.serving_size.trim() : `${sq} ${u}`;
    servings.push({ label: label.includes(String(sq)) ? `1 serving · ${label}` : `1 serving · ${label} (${sq} ${u})`, amount: sq });
  }
  servings.push({ label: `100 ${u}`, amount: 100 });
  // The product API returns a comma-separated string; the search service returns an array.
  const brands = Array.isArray(p.brands) ? p.brands[0] : p.brands;
  const brand = typeof brands === "string" ? brands.split(",")[0].trim() || null : null;
  return {
    source: "OPEN_FOOD_FACTS",
    sourceId: code,
    name,
    brand,
    barcode: /^\d{6,14}$/.test(code) ? code : null,
    dataType: "Packaged",
    basisUnit,
    // OFF is crowd-sourced; implausible values (data-entry errors) are treated as not reported.
    per100: sanitizePer100(extractOffNutrients(p.nutriments), basisUnit).per100,
    servings,
  };
}

const OFF_PRODUCT_CODE = /^\d{6,14}$/;
const headers = () => ({ "User-Agent": userAgent(), Accept: "application/json" });
// Open Food Facts changes continually, so a search is kept for an hour (FOOD-01), bounded in size.
const searchCache = new TtlCache<NormalizedFood[]>(60 * 60 * 1000, 500);
const inFlight = new SingleFlight<NormalizedFood[]>();
export const _resetOffCache = () => searchCache.clear();

export async function searchOff(query: string, userId?: string, pageSize = 20): Promise<NormalizedFood[]> {
  const cacheKey = searchKey(query, pageSize);
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;
  return inFlight.run(cacheKey, () => fetchOffSearch(query, userId, pageSize, cacheKey));
}

async function fetchOffSearch(query: string, userId: string | undefined, pageSize: number, cacheKey: string): Promise<NormalizedFood[]> {
  const q = plainSearchTerms(query);
  if (!q) return [];
  const params = new URLSearchParams({ q, page_size: String(pageSize), langs: "en", fields: OFF_FIELDS });
  const data = (await guardedFetchJson("OFF_SEARCH", userId, `${searchBase()}/search?${params}`, { headers: headers() }, isOffSearchResponse)) as Record<string, unknown>;
  // A hit without a valid product code could never be opened through the product API.
  const foods = (data.hits as Record<string, unknown>[]).map(normalizeOffProduct)
    .filter((f): f is NormalizedFood => f !== null && OFF_PRODUCT_CODE.test(f.sourceId));
  // Results from a timed-out search may be partial, so they aren't kept for later searches.
  if (data.timed_out !== true) searchCache.set(cacheKey, foods);
  return foods;
}

/** Product by barcode (also the entry point for future camera barcode scanning). */
export async function getOffProduct(code: string, userId?: string): Promise<NormalizedFood> {
  if (!OFF_PRODUCT_CODE.test(code)) throw new ExternalFoodError("OPEN_FOOD_FACTS", "not_found", "Invalid barcode.");
  const data = (await guardedFetchJson("OFF_PRODUCT", userId, `${base()}/api/v2/product/${code}.json?fields=${OFF_FIELDS}`, { headers: headers() }, isOffProductResponse)) as Record<string, unknown>;
  if (data.status !== 1) throw new ExternalFoodError("OPEN_FOOD_FACTS", "not_found", "No product found for this barcode.");
  const food = normalizeOffProduct({ code, ...(data.product as Record<string, unknown>) });
  // A well-formed record without a name is incomplete crowd-sourced data, not a provider
  // malfunction, so it is reported to the caller but doesn't count toward the circuit breaker.
  if (!food) throw new ExternalFoodError("OPEN_FOOD_FACTS", "invalid_response", "The product record has no name.");
  return food;
}
