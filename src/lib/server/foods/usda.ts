/**
 * USDA FoodData Central client (https://fdc.nal.usda.gov/api-guide).
 * Used for generic foods: Foundation, SR Legacy and Survey (FNDDS) data types.
 * Branded foods are left to Open Food Facts to avoid duplicate packaged items.
 * FDC data is public domain (CC0 1.0). Nutrient amounts are per 100 g.
 */
import "server-only";
import { MAX_SERVING_AMOUNT, sanitizePer100, type Nutrients } from "@/lib/nutrition";
import { guardedFetchJson, isObject, logProviderConfigError, PROVIDER_UNAVAILABLE, searchKey, SingleFlight, TtlCache } from "./http";

/** /foods/search must return an object with a `foods` array. */
export const isUsdaSearchResponse = (d: unknown) => isObject(d) && Array.isArray(d.foods);
/** /food/{id} must return a food object with an id and a description. */
export const isUsdaFoodResponse = (d: unknown) => isObject(d) && d.fdcId != null && typeof d.description === "string" && d.description.trim() !== "";
import { ExternalFoodError, num, type NormalizedFood, type ServingOption } from "./types";

const base = () => (process.env.FDC_BASE_URL ?? "https://api.nal.usda.gov/fdc/v1").replace(/\/$/, "");
/** Host of the configured endpoint; recorded with cached foods (see Food.origin). */
export const usdaOrigin = () => new URL(base()).host;
export const USDA_GENERIC_TYPES = ["Foundation", "SR Legacy", "Survey (FNDDS)"];

let lastConfigLog = 0;
function apiKey(): string {
  const k = process.env.FDC_API_KEY;
  if (!k) {
    // Configuration detail stays server-side (rate-limited to once a minute); clients get a generic message.
    if (Date.now() - lastConfigLog > 60_000) {
      lastConfigLog = Date.now();
      logProviderConfigError("USDA", "FDC_API_KEY is not set; USDA search is disabled");
    }
    throw new ExternalFoodError("USDA", "not_configured", PROVIDER_UNAVAILABLE);
  }
  return k;
}
export const _resetUsdaConfigLog = () => { lastConfigLog = 0; };

// FDC nutrient ids (and legacy nutrient numbers) for the values we track.
const NUTRIENTS: Record<keyof Nutrients, { ids: number[]; numbers: string[]; unit: string }> = {
  // 1008 Energy (kcal); 2047/2048 Atwater general/specific energy (used by Foundation foods).
  kcal: { ids: [1008, 2047, 2048], numbers: ["208", "957", "958"], unit: "KCAL" },
  protein: { ids: [1003], numbers: ["203"], unit: "G" },
  // 1005 carbohydrate by difference; 1050 by summation as fallback.
  carbs: { ids: [1005, 1050], numbers: ["205", "205.2"], unit: "G" },
  fat: { ids: [1004], numbers: ["204"], unit: "G" },
  fiber: { ids: [1079], numbers: ["291"], unit: "G" },
};

interface RawNutrient {
  id?: number;
  number?: string;
  unit?: string;
  value?: unknown;
}

/** Search results use flat nutrients; the detail endpoint nests them under `nutrient`. */
function flatten(list: unknown): RawNutrient[] {
  if (!Array.isArray(list)) return [];
  return list.map((n: Record<string, unknown>) => {
    const nested = n.nutrient as Record<string, unknown> | undefined;
    return {
      id: (n.nutrientId as number) ?? (nested?.id as number),
      number: (n.nutrientNumber as string) ?? (nested?.number as string),
      unit: String((n.unitName as string) ?? (nested?.unitName as string) ?? "").toUpperCase(),
      value: n.value ?? n.amount,
    };
  });
}

export function extractNutrients(list: unknown): Nutrients {
  const flat = flatten(list);
  const out = {} as Nutrients;
  for (const [key, spec] of Object.entries(NUTRIENTS) as [keyof Nutrients, (typeof NUTRIENTS)[keyof Nutrients]][]) {
    out[key] = null;
    // Respect priority order of ids, and require the expected unit (e.g. skip kJ energy).
    for (let i = 0; i < spec.ids.length; i++) {
      const hit = flat.find((n) => (n.id === spec.ids[i] || n.number === spec.numbers[i]) && n.unit === spec.unit);
      const v = hit ? num(hit.value) : null;
      if (v != null) {
        out[key] = v;
        break;
      }
    }
  }
  return out;
}

const DEFAULT_SERVING: ServingOption = { label: "100 g", amount: 100 };

export function extractPortions(food: Record<string, unknown>): ServingOption[] {
  const out: ServingOption[] = [];
  const portions = Array.isArray(food.foodPortions) ? food.foodPortions : [];
  for (const p of portions as Record<string, unknown>[]) {
    const grams = num(p.gramWeight);
    if (!grams || grams > MAX_SERVING_AMOUNT) continue;
    // WT-05: an unspecified quantity isn't a portion anyone can choose (as for search measures below), and a
    // modifier that is only digits is an FNDDS portion code ("90000"), not words to show.
    if (p.portionDescription === "Quantity not specified") continue;
    const unit = (p.measureUnit as Record<string, unknown> | undefined)?.name as string | undefined;
    const modifier = typeof p.modifier === "string" && !/^\s*\d+\s*$/.test(p.modifier) ? p.modifier : "";
    const desc = typeof p.portionDescription === "string" && p.portionDescription
      ? p.portionDescription
      : [num(p.amount) ?? "", unit && unit !== "undetermined" ? unit : "", modifier].join(" ").replace(/\s+/g, " ").trim();
    if (!/[a-z]/i.test(desc)) continue; // a bare number ("1") isn't a portion anyone can recognise
    out.push({ label: `${desc} (${Math.round(grams * 10) / 10} g)`, amount: grams });
  }
  // Search results expose household measures as `foodMeasures`.
  const measures = Array.isArray(food.foodMeasures) ? food.foodMeasures : [];
  for (const m of measures as Record<string, unknown>[]) {
    const grams = num(m.gramWeight);
    const text = m.disseminationText as string | undefined;
    if (!grams || grams > MAX_SERVING_AMOUNT || !text || text === "Quantity not specified") continue;
    out.push({ label: `${text} (${Math.round(grams * 10) / 10} g)`, amount: grams });
  }
  const seen = new Set<string>();
  return [DEFAULT_SERVING, ...out].filter((s) => (seen.has(s.label) ? false : (seen.add(s.label), true))).slice(0, 12);
}

export function normalizeUsdaFood(food: Record<string, unknown>): NormalizedFood | null {
  const id = food.fdcId;
  const name = typeof food.description === "string" ? food.description.trim() : "";
  if (id == null || !name) return null;
  const servings = extractPortions(food);
  return {
    source: "USDA",
    sourceId: String(id),
    name,
    brand: (food.brandOwner as string) || (food.brandName as string) || null,
    barcode: (food.gtinUpc as string) || null,
    dataType: (food.dataType as string) || null,
    basisUnit: "G",
    // Implausible values (data-entry errors) are treated as not reported.
    per100: sanitizePer100(extractNutrients(food.foodNutrients), "G").per100,
    // Prefer a household measure as default when one exists; 100 g stays available.
    servings: servings.length > 1 ? [servings[1], servings[0], ...servings.slice(2)] : servings,
  };
}

// USDA's generic records change a few times a year, so a search is kept for 6 hours (FOOD-01), bounded in size.
const searchCache = new TtlCache<NormalizedFood[]>(6 * 60 * 60 * 1000, 500);
const inFlight = new SingleFlight<NormalizedFood[]>();
export const _resetUsdaCache = () => searchCache.clear();

export async function searchUsda(query: string, userId?: string, pageSize = 20): Promise<NormalizedFood[]> {
  const key = apiKey();
  const cacheKey = searchKey(query, pageSize);
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;
  return inFlight.run(cacheKey, () => fetchUsdaSearch(query, userId, pageSize, key, cacheKey));
}

async function fetchUsdaSearch(query: string, userId: string | undefined, pageSize: number, key: string, cacheKey: string): Promise<NormalizedFood[]> {
  // POST, the form the API guide documents for dataType. GET with a dataType query parameter
  // intermittently returned an HTML 400 from nginx, in both encodings; POST never did (see PHASE_2_PROGRESS.md).
  const init = {
    method: "POST",
    headers: { "X-Api-Key": key, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ query, pageSize, dataType: USDA_GENERIC_TYPES }),
  };
  const data = (await guardedFetchJson("USDA", userId, `${base()}/foods/search`, init, isUsdaSearchResponse)) as Record<string, unknown>;
  const foods = (data.foods as Record<string, unknown>[]).map(normalizeUsdaFood).filter((f): f is NormalizedFood => f !== null);
  searchCache.set(cacheKey, foods);
  return foods;
}

/**
 * WT-02: one food record. USDA's first answer for a record it hasn't served recently can take about 8 seconds
 * (measured: 7–8.4 s for fdcId 330137, then 0.3–1 s), which the 8-second search limit cut off every time. A
 * single record is fetched once, when someone chooses it, so it gets its own bounded limit. Searches keep the
 * default, so typing stays responsive. The request also asks only for the nutrients the app reads (portions are
 * still included), which cut that record from 726 KB to about 23 KB with the same values.
 */
export const USDA_FOOD_TIMEOUT_MS = 15_000;
const TRACKED_NUMBERS = Object.values(NUTRIENTS).flatMap((n) => n.numbers);
export const usdaFoodUrl = (fdcId: string) => `${base()}/food/${fdcId}?${TRACKED_NUMBERS.map((n) => `nutrients=${encodeURIComponent(n)}`).join("&")}`;

export async function getUsdaFood(fdcId: string, userId?: string): Promise<NormalizedFood> {
  if (!/^\d{1,10}$/.test(fdcId)) throw new ExternalFoodError("USDA", "not_found", "Invalid USDA food id.");
  const key = apiKey();
  const data = (await guardedFetchJson("USDA", userId, usdaFoodUrl(fdcId), { headers: { "X-Api-Key": key, Accept: "application/json" } }, isUsdaFoodResponse, USDA_FOOD_TIMEOUT_MS)) as Record<string, unknown>;
  const food = normalizeUsdaFood(data);
  if (!food) throw new ExternalFoodError("USDA", "invalid_response", "The food database returned an unexpected response.");
  return food;
}
