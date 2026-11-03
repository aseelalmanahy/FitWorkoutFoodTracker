/**
 * USDA FoodData Central client (https://fdc.nal.usda.gov/api-guide).
 * Used for generic foods: Foundation, SR Legacy and Survey (FNDDS) data types.
 * Branded foods are left to Open Food Facts to avoid duplicate packaged items.
 * FDC data is public domain (CC0 1.0). Nutrient amounts are per 100 g.
 */
import "server-only";
import type { Nutrients } from "@/lib/nutrition";
import { fetchJson, TtlCache } from "./http";
import { ExternalFoodError, num, type NormalizedFood, type ServingOption } from "./types";

const base = () => (process.env.FDC_BASE_URL ?? "https://api.nal.usda.gov/fdc/v1").replace(/\/$/, "");
/** Host of the configured endpoint; recorded with cached foods (see Food.origin). */
export const usdaOrigin = () => new URL(base()).host;
export const USDA_GENERIC_TYPES = ["Foundation", "SR Legacy", "Survey (FNDDS)"];

function apiKey(): string {
  const k = process.env.FDC_API_KEY;
  if (!k) throw new ExternalFoodError("USDA", "not_configured", "USDA search is not configured (FDC_API_KEY missing).");
  return k;
}

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
    if (!grams) continue;
    const unit = (p.measureUnit as Record<string, unknown> | undefined)?.name as string | undefined;
    const desc = typeof p.portionDescription === "string" && p.portionDescription && p.portionDescription !== "Quantity not specified"
      ? p.portionDescription
      : [num(p.amount) ?? "", unit && unit !== "undetermined" ? unit : "", (p.modifier as string) ?? ""].join(" ").replace(/\s+/g, " ").trim();
    if (!desc) continue;
    out.push({ label: `${desc} (${Math.round(grams * 10) / 10} g)`, amount: grams });
  }
  // Search results expose household measures as `foodMeasures`.
  const measures = Array.isArray(food.foodMeasures) ? food.foodMeasures : [];
  for (const m of measures as Record<string, unknown>[]) {
    const grams = num(m.gramWeight);
    const text = m.disseminationText as string | undefined;
    if (!grams || !text || text === "Quantity not specified") continue;
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
    per100: extractNutrients(food.foodNutrients),
    // Prefer a household measure as default when one exists; 100 g stays available.
    servings: servings.length > 1 ? [servings[1], servings[0], ...servings.slice(2)] : servings,
  };
}

const searchCache = new TtlCache<NormalizedFood[]>(10 * 60 * 1000);
export const _resetUsdaCache = () => searchCache.clear();

export async function searchUsda(query: string, pageSize = 20): Promise<NormalizedFood[]> {
  const key = apiKey();
  const cacheKey = `${query.toLowerCase()}|${pageSize}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;
  const params = new URLSearchParams({ query, pageSize: String(pageSize), dataType: USDA_GENERIC_TYPES.join(",") });
  const data = (await fetchJson("USDA", `${base()}/foods/search?${params}`, { headers: { "X-Api-Key": key, Accept: "application/json" } })) as Record<string, unknown>;
  if (!data || !Array.isArray(data.foods)) throw new ExternalFoodError("USDA", "invalid_response", "Unexpected response from USDA.");
  const foods = (data.foods as Record<string, unknown>[]).map(normalizeUsdaFood).filter((f): f is NormalizedFood => f !== null);
  searchCache.set(cacheKey, foods);
  return foods;
}

export async function getUsdaFood(fdcId: string): Promise<NormalizedFood> {
  if (!/^\d{1,10}$/.test(fdcId)) throw new ExternalFoodError("USDA", "not_found", "Invalid USDA food id.");
  const key = apiKey();
  const data = (await fetchJson("USDA", `${base()}/food/${fdcId}`, { headers: { "X-Api-Key": key, Accept: "application/json" } })) as Record<string, unknown>;
  const food = data && typeof data === "object" ? normalizeUsdaFood(data) : null;
  if (!food) throw new ExternalFoodError("USDA", "invalid_response", "Unexpected response from USDA.");
  return food;
}
