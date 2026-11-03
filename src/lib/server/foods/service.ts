import "server-only";
import { Prisma, type Food, type FoodServing, type FoodSource } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../api";
import { NUTRIENT_KEYS, type Nutrients } from "@/lib/nutrition";
import { getUsdaFood, searchUsda, usdaOrigin } from "./usda";
import { getOffProduct, offOrigin, searchOff } from "./openfoodfacts";
import { ExternalFoodError, hasAnyNutrient, type ExternalSource, type NormalizedFood } from "./types";

/** Cached external foods are refreshed from the source after this age. */
export const FOOD_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const dec = (v: number | null | undefined) => (v == null ? null : new Prisma.Decimal(v));
export const toNum = (v: Prisma.Decimal | null | undefined) => (v == null ? null : Number(v));

export interface FoodDto {
  id: string;
  source: FoodSource;
  sourceId: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  dataType: string | null;
  basisUnit: "G" | "ML";
  per100: Nutrients;
  servings: { id: string; label: string; amount: number; isDefault: boolean }[];
  isCustom: boolean;
  complete: boolean;
}

type FoodWithServings = Food & { servings: FoodServing[] };

const origins: Record<ExternalSource, () => string> = { USDA: usdaOrigin, OPEN_FOOD_FACTS: offOrigin };

/**
 * A cached external food is trusted only if it was produced by the provider
 * endpoint configured right now. This keeps records written by a test stub
 * (or a different endpoint) from being served as live provider data.
 * Custom foods are always trusted. Legacy rows without an origin are not.
 */
export function isTrustedFood(f: Pick<Food, "source" | "origin">): boolean {
  return f.source === "CUSTOM" || f.origin === origins[f.source as ExternalSource]();
}

export function per100Of(f: Pick<Food, "kcalPer100" | "proteinPer100" | "carbsPer100" | "fatPer100" | "fiberPer100">): Nutrients {
  return { kcal: toNum(f.kcalPer100), protein: toNum(f.proteinPer100), carbs: toNum(f.carbsPer100), fat: toNum(f.fatPer100), fiber: toNum(f.fiberPer100) };
}

const isComplete = (n: Nutrients) => n.kcal != null && n.protein != null && n.carbs != null && n.fat != null;

export function foodToDto(f: FoodWithServings): FoodDto {
  const per100 = per100Of(f);
  return {
    id: f.id,
    source: f.source,
    sourceId: f.sourceId,
    name: f.name,
    brand: f.brand,
    barcode: f.barcode,
    dataType: f.dataType,
    basisUnit: f.basisUnit,
    per100,
    servings: [...f.servings].sort((a, b) => a.position - b.position).map((s) => ({ id: s.id, label: s.label, amount: Number(s.amount), isDefault: s.isDefault })),
    isCustom: f.source === "CUSTOM",
    complete: isComplete(per100),
  };
}

const per100Data = (n: Nutrients) => ({
  kcalPer100: dec(n.kcal), proteinPer100: dec(n.protein), carbsPer100: dec(n.carbs), fatPer100: dec(n.fat), fiberPer100: dec(n.fiber),
});

/** Insert or refresh an external food in the shared cache (deduplicated on source + sourceId). */
export async function upsertExternalFood(n: NormalizedFood): Promise<FoodWithServings> {
  const data = {
    name: n.name, brand: n.brand, barcode: n.barcode, dataType: n.dataType, basisUnit: n.basisUnit, ...per100Data(n.per100),
    fetchedAt: new Date(), origin: origins[n.source](),
  };
  return prisma.$transaction(async (tx) => {
    const food = await tx.food.upsert({
      where: { source_sourceId: { source: n.source, sourceId: n.sourceId } },
      create: { source: n.source, sourceId: n.sourceId, ...data },
      update: data,
    });
    await tx.foodServing.deleteMany({ where: { foodId: food.id } });
    const seen = new Set<string>();
    const servings = n.servings.filter((s) => s.amount > 0 && !seen.has(s.label) && seen.add(s.label));
    await tx.foodServing.createMany({
      data: servings.map((s, i) => ({ foodId: food.id, label: s.label.slice(0, 120), amount: new Prisma.Decimal(s.amount), isDefault: i === 0, position: i })),
    });
    return tx.food.findUniqueOrThrow({ where: { id: food.id }, include: { servings: true } });
  });
}

export function toHttpError(e: unknown): unknown {
  if (!(e instanceof ExternalFoodError)) return e;
  const status = e.kind === "not_found" ? 404 : e.kind === "not_configured" ? 503 : e.kind === "rate_limited" ? 429 : e.kind === "timeout" ? 504 : 502;
  return new HttpError(status, e.message, { source: e.source, kind: e.kind });
}

const fetchers: Record<ExternalSource, (id: string) => Promise<NormalizedFood>> = { USDA: getUsdaFood, OPEN_FOOD_FACTS: getOffProduct };

/**
 * Return a cached external food, fetching or refreshing it from the source when
 * needed. If the refresh fails but a cached copy exists, the cached copy is used.
 */
export async function resolveExternalFood(source: ExternalSource, sourceId: string): Promise<FoodWithServings> {
  const existing = await prisma.food.findUnique({ where: { source_sourceId: { source, sourceId } }, include: { servings: true } });
  const trusted = existing !== null && isTrustedFood(existing);
  if (trusted && existing.fetchedAt && Date.now() - existing.fetchedAt.getTime() < FOOD_CACHE_MAX_AGE_MS) return existing;
  try {
    return await upsertExternalFood(await fetchers[source](sourceId));
  } catch (e) {
    // A stale copy from the same provider is better than nothing during an outage;
    // a copy of unknown or different origin is never used.
    if (trusted) return existing;
    throw toHttpError(e);
  }
}

export async function getVisibleFood(userId: string, id: string): Promise<FoodWithServings | null> {
  return prisma.food.findFirst({ where: { id, OR: [{ userId: null }, { userId }] }, include: { servings: true } });
}

/**
 * Visible food that is safe to log from: custom foods, or external foods from the
 * configured provider. Untrusted external rows are refreshed from the provider first.
 */
export async function getLoggableFood(userId: string, id: string): Promise<FoodWithServings | null> {
  const food = await getVisibleFood(userId, id);
  if (!food || isTrustedFood(food)) return food;
  return resolveExternalFood(food.source as ExternalSource, food.sourceId);
}

// ─── Search ─────────────────────────────────────────────────────────────────

export type SearchSource = ExternalSource | "CUSTOM";

export interface SearchItem {
  key: string;
  foodId: string | null;
  source: SearchSource;
  sourceId: string;
  name: string;
  brand: string | null;
  dataType: string | null;
  basisUnit: "G" | "ML";
  per100: Nutrients;
  servings: { label: string; amount: number }[];
  complete: boolean;
  hasNutrition: boolean;
}

export interface SearchResponse {
  query: string;
  barcode: boolean;
  results: Record<SearchSource, SearchItem[]>;
  errors: { source: ExternalSource; kind: string; message: string }[];
}

const fromNormalized = (n: NormalizedFood, foodId: string | null = null): SearchItem => ({
  key: `${n.source}:${n.sourceId}`, foodId, source: n.source, sourceId: n.sourceId, name: n.name, brand: n.brand, dataType: n.dataType,
  basisUnit: n.basisUnit, per100: n.per100, servings: n.servings, complete: isComplete(n.per100), hasNutrition: hasAnyNutrient(n.per100),
});

const fromDto = (d: FoodDto): SearchItem => ({
  key: `${d.source}:${d.sourceId}`, foodId: d.id, source: d.source, sourceId: d.sourceId, name: d.name, brand: d.brand, dataType: d.dataType,
  basisUnit: d.basisUnit, per100: d.per100, servings: d.servings.map(({ label, amount }) => ({ label, amount })), complete: d.complete,
  hasNutrition: hasAnyNutrient(d.per100),
});

export const isBarcode = (q: string) => /^\d{8,14}$/.test(q);

export async function searchFoods(userId: string, query: string, sources: SearchSource[]): Promise<SearchResponse> {
  const q = query.trim();
  const barcode = isBarcode(q);
  const res: SearchResponse = { query: q, barcode, results: { CUSTOM: [], USDA: [], OPEN_FOOD_FACTS: [] }, errors: [] };

  const tasks: Promise<void>[] = [];
  if (sources.includes("CUSTOM")) {
    tasks.push(
      prisma.food
        .findMany({
          where: { userId, source: "CUSTOM", ...(barcode ? { barcode: q } : { name: { contains: q, mode: "insensitive" } }) },
          include: { servings: true },
          orderBy: { name: "asc" },
          take: 20,
        })
        .then((rows) => { res.results.CUSTOM = rows.map((r) => fromDto(foodToDto(r))); }),
    );
  }
  const external: [ExternalSource, () => Promise<NormalizedFood[]>][] = [];
  if (barcode) {
    if (sources.includes("OPEN_FOOD_FACTS")) external.push(["OPEN_FOOD_FACTS", async () => [await getOffProduct(q)]]);
  } else {
    if (sources.includes("USDA")) external.push(["USDA", () => searchUsda(q)]);
    if (sources.includes("OPEN_FOOD_FACTS")) external.push(["OPEN_FOOD_FACTS", () => searchOff(q)]);
  }
  for (const [source, run] of external) {
    tasks.push(
      run()
        .then((list) => { res.results[source] = list.map((n) => fromNormalized(n)); })
        .catch((e) => {
          if (e instanceof ExternalFoodError) {
            if (barcode && e.kind === "not_found") return; // empty result, not an error
            res.errors.push({ source, kind: e.kind, message: e.message });
          } else {
            console.error(e);
            res.errors.push({ source, kind: "unknown", message: "Search failed." });
          }
        }),
    );
  }
  await Promise.all(tasks);

  // Attach ids of foods already cached so the client can skip the resolve step.
  const ext = [...res.results.USDA, ...res.results.OPEN_FOOD_FACTS];
  if (ext.length) {
    const cached = await prisma.food.findMany({
      where: { OR: ext.map((i) => ({ source: i.source as ExternalSource, sourceId: i.sourceId })) },
      select: { id: true, source: true, sourceId: true, origin: true },
    });
    const ids = new Map(cached.filter(isTrustedFood).map((c) => [`${c.source}:${c.sourceId}`, c.id]));
    for (const i of ext) i.foodId = ids.get(i.key) ?? null;
  }
  // Deduplicate within each source.
  for (const k of Object.keys(res.results) as SearchSource[]) {
    const seen = new Set<string>();
    res.results[k] = res.results[k].filter((i) => !seen.has(i.key) && seen.add(i.key));
  }
  return res;
}

export async function recentFoods(userId: string, limit = 15): Promise<FoodDto[]> {
  const rows = await prisma.foodEntry.findMany({
    where: { userId, foodId: { not: null } },
    orderBy: { createdAt: "desc" },
    distinct: ["foodId"],
    take: limit,
    select: { food: { include: { servings: true } } },
  });
  return rows
    .map((r) => r.food)
    .filter((f): f is FoodWithServings => !!f && (f.userId === null || f.userId === userId) && isTrustedFood(f))
    .map(foodToDto);
}

export { NUTRIENT_KEYS };
