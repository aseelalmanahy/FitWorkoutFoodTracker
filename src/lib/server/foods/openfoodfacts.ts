/**
 * Open Food Facts client (https://openfoodfacts.github.io/openfoodfacts-server/api/).
 * Used for packaged foods and barcode lookup. OFF data is licensed under ODbL.
 * Attribution is shown in the UI, and requests carry an identifying User-Agent.
 * `*_100g` nutriment fields are normalised per 100 g (or 100 ml for liquids).
 */
import "server-only";
import { MAX_SERVING_AMOUNT, sanitizePer100, type Nutrients } from "@/lib/nutrition";
import { fetchJson, TtlCache } from "./http";
import { ExternalFoodError, num, type NormalizedFood, type ServingOption } from "./types";

const base = () => (process.env.OFF_BASE_URL ?? "https://world.openfoodfacts.org").replace(/\/$/, "");
/** Host of the configured endpoint; recorded with cached foods (see Food.origin). */
export const offOrigin = () => new URL(base()).host;
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

export function normalizeOffProduct(p: Record<string, unknown>): NormalizedFood | null {
  const code = typeof p.code === "string" ? p.code.trim() : p.code != null ? String(p.code) : "";
  const name = String(p.product_name || p.product_name_en || p.generic_name || "").trim();
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
  const brand = typeof p.brands === "string" ? p.brands.split(",")[0].trim() || null : null;
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

const headers = () => ({ "User-Agent": userAgent(), Accept: "application/json" });
const searchCache = new TtlCache<NormalizedFood[]>(10 * 60 * 1000);
export const _resetOffCache = () => searchCache.clear();

export async function searchOff(query: string, pageSize = 20): Promise<NormalizedFood[]> {
  const cacheKey = `${query.toLowerCase()}|${pageSize}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;
  const params = new URLSearchParams({
    search_terms: query, search_simple: "1", action: "process", json: "1", page_size: String(pageSize), fields: OFF_FIELDS,
  });
  const data = (await fetchJson("OPEN_FOOD_FACTS", `${base()}/cgi/search.pl?${params}`, { headers: headers() })) as Record<string, unknown>;
  if (!data || !Array.isArray(data.products)) throw new ExternalFoodError("OPEN_FOOD_FACTS", "invalid_response", "Unexpected response from Open Food Facts.");
  const foods = (data.products as Record<string, unknown>[]).map(normalizeOffProduct).filter((f): f is NormalizedFood => f !== null);
  searchCache.set(cacheKey, foods);
  return foods;
}

/** Product by barcode (also the entry point for future camera barcode scanning). */
export async function getOffProduct(code: string): Promise<NormalizedFood> {
  if (!/^\d{6,14}$/.test(code)) throw new ExternalFoodError("OPEN_FOOD_FACTS", "not_found", "Invalid barcode.");
  const data = (await fetchJson("OPEN_FOOD_FACTS", `${base()}/api/v2/product/${code}.json?fields=${OFF_FIELDS}`, { headers: headers() })) as Record<string, unknown>;
  if (!data || data.status !== 1 || !data.product) throw new ExternalFoodError("OPEN_FOOD_FACTS", "not_found", "No product found for this barcode.");
  const food = normalizeOffProduct({ code, ...(data.product as Record<string, unknown>) });
  if (!food) throw new ExternalFoodError("OPEN_FOOD_FACTS", "invalid_response", "The product record has no name.");
  return food;
}
