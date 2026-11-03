import "server-only";
import { Prisma, type FoodEntry, type Profile } from "@prisma/client";
import { prisma } from "../db";
import { HttpError, notFound } from "../api";
import { dec, getLoggableFood, getVisibleFood, isTrustedFood, per100Of, toNum } from "../foods/service";
import {
  addDays, dateRange, entryNutrients, MAX_ENTRY_AMOUNT, fromIsoDate, MEAL_TYPES, progress, remaining, round, sumNutrients, summarizePeriod,
  targetForDate, toIsoDate, type DaySummary, type MealType, type Nutrients,
} from "@/lib/nutrition";
import { getTargets, localToday } from "./targets";

export interface EntryDto {
  id: string;
  date: string;
  mealType: MealType;
  foodId: string | null;
  foodName: string;
  brand: string | null;
  basisUnit: "G" | "ML";
  servingLabel: string;
  servingAmount: number;
  quantity: number;
  /** Total consumed amount in g/ml. */
  amount: number;
  per100: Nutrients;
  nutrients: Nutrients;
  createdAt: string;
}

export function entryToDto(e: FoodEntry): EntryDto {
  const servingAmount = Number(e.servingAmount), quantity = Number(e.quantity);
  return {
    id: e.id, date: toIsoDate(e.date), mealType: e.mealType, foodId: e.foodId, foodName: e.foodName, brand: e.brand, basisUnit: e.basisUnit,
    servingLabel: e.servingLabel, servingAmount, quantity, amount: round(servingAmount * quantity, 2),
    per100: per100Of(e),
    nutrients: { kcal: toNum(e.kcal), protein: toNum(e.protein), carbs: toNum(e.carbs), fat: toNum(e.fat), fiber: toNum(e.fiber) },
    createdAt: e.createdAt.toISOString(),
  };
}

/** Accept dates from the distant past up to tomorrow (covers time-zone edges). */
export function assertLoggableDate(date: string, profile: Profile) {
  if (date < "2000-01-01" || date > addDays(localToday(profile.timezone), 1)) throw new HttpError(400, "Date is out of range");
}

const nutrientData = (n: Nutrients) => ({ kcal: dec(n.kcal), protein: dec(n.protein), carbs: dec(n.carbs), fat: dec(n.fat), fiber: dec(n.fiber) });

/** Raw-amount logging: a 1 g (or 1 ml) "serving" with quantity = amount. */
const rawServing = (unit: "G" | "ML") => ({ label: unit === "ML" ? "ml" : "g", amount: 1 });

async function servingFor(food: { id: string; basisUnit: "G" | "ML" }, servingId: string | null) {
  if (servingId === null) return rawServing(food.basisUnit);
  const s = await prisma.foodServing.findUnique({ where: { id: servingId } });
  // A serving the provider stopped offering is removed on refresh: tell the client to re-select.
  if (!s) throw new HttpError(409, "This serving size is no longer available. Choose another serving or enter grams.", { reason: "serving_removed" });
  if (s.foodId !== food.id) throw new HttpError(400, "Serving does not belong to this food");
  return { label: s.label, amount: Number(s.amount) };
}

/** Keeps a single entry physically sensible and inside DECIMAL precision. */
function assertEntryAmount(servingAmount: number, quantity: number, unit: "G" | "ML") {
  if (servingAmount * quantity > MAX_ENTRY_AMOUNT) {
    throw new HttpError(400, `An entry can't exceed ${MAX_ENTRY_AMOUNT.toLocaleString("en-US")} ${unit === "ML" ? "ml" : "g"}`);
  }
}

export async function createEntry(userId: string, profile: Profile, input: { date: string; mealType: MealType; foodId: string; servingId: string | null; quantity: number }) {
  assertLoggableDate(input.date, profile);
  const food = await getLoggableFood(userId, input.foodId);
  if (!food) throw notFound("Food");
  const serving = await servingFor(food, input.servingId);
  assertEntryAmount(serving.amount, input.quantity, food.basisUnit);
  const per100 = per100Of(food);
  const nutrients = entryNutrients(per100, serving.amount, input.quantity);
  const entry = await prisma.foodEntry.create({
    data: {
      userId, date: fromIsoDate(input.date), mealType: input.mealType, foodId: food.id, foodName: food.name, brand: food.brand, basisUnit: food.basisUnit,
      kcalPer100: food.kcalPer100, proteinPer100: food.proteinPer100, carbsPer100: food.carbsPer100, fatPer100: food.fatPer100, fiberPer100: food.fiberPer100,
      servingLabel: serving.label, servingAmount: new Prisma.Decimal(serving.amount), quantity: new Prisma.Decimal(input.quantity),
      ...nutrientData(nutrients),
    },
  });
  return entryToDto(entry);
}

export async function updateEntry(
  userId: string, profile: Profile, id: string,
  input: { mealType?: MealType; date?: string; servingId?: string | null; quantity?: number },
) {
  const entry = await prisma.foodEntry.findFirst({ where: { id, userId } });
  if (!entry) throw notFound("Food entry");
  if (input.date) assertLoggableDate(input.date, profile);

  let servingLabel = entry.servingLabel;
  let servingAmount = Number(entry.servingAmount);
  if (input.servingId !== undefined) {
    if (input.servingId === null) {
      ({ label: servingLabel, amount: servingAmount } = rawServing(entry.basisUnit));
    } else {
      if (!entry.foodId) throw new HttpError(400, "The original food was deleted; only quantity can be changed");
      const food = await getVisibleFood(userId, entry.foodId);
      if (!food || !isTrustedFood(food)) throw new HttpError(409, "This food's data is no longer current; change the quantity or grams instead");
      ({ label: servingLabel, amount: servingAmount } = await servingFor({ id: entry.foodId, basisUnit: entry.basisUnit }, input.servingId));
    }
  }
  const quantity = input.quantity ?? Number(entry.quantity);
  assertEntryAmount(servingAmount, quantity, entry.basisUnit);
  // Always recompute from the entry's own per-100 snapshot so edits are exact.
  const nutrients = entryNutrients(per100Of(entry), servingAmount, quantity);
  const updated = await prisma.foodEntry.update({
    where: { id: entry.id },
    data: {
      ...(input.mealType ? { mealType: input.mealType } : {}),
      ...(input.date ? { date: fromIsoDate(input.date) } : {}),
      servingLabel, servingAmount: new Prisma.Decimal(servingAmount), quantity: new Prisma.Decimal(quantity),
      ...nutrientData(nutrients),
    },
  });
  return entryToDto(updated);
}

export async function deleteEntry(userId: string, id: string) {
  const { count } = await prisma.foodEntry.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound("Food entry");
}

export async function daySummary(userId: string, profile: Profile, date: string) {
  const [rows, targets] = await Promise.all([
    prisma.foodEntry.findMany({ where: { userId, date: fromIsoDate(date) }, orderBy: { createdAt: "asc" } }),
    getTargets(userId, profile),
  ]);
  const entries = rows.map(entryToDto);
  const target = targetForDate(targets, date);
  const meals = MEAL_TYPES.map((mealType) => {
    const list = entries.filter((e) => e.mealType === mealType);
    return { mealType, entries: list, totals: sumNutrients(list.map((e) => e.nutrients)) };
  });
  const totals = sumNutrients(entries.map((e) => e.nutrients));
  return {
    date,
    today: localToday(profile.timezone),
    target,
    totals,
    meals,
    calories: target ? { ...remaining(target.kcal, totals.kcal), ...progress(totals.kcal, target.kcal) } : null,
    macros: target
      ? {
          protein: { target: target.proteinG, ...remaining(target.proteinG, totals.protein), ...progress(totals.protein, target.proteinG) },
          carbs: { target: target.carbsG, ...remaining(target.carbsG, totals.carbs), ...progress(totals.carbs, target.carbsG) },
          fat: { target: target.fatG, ...remaining(target.fatG, totals.fat), ...progress(totals.fat, target.fatG) },
        }
      : null,
  };
}

/** Per-day totals for `days` days ending on `end` (inclusive), with each day's historical target. */
export async function history(userId: string, profile: Profile, end: string, days: number) {
  const start = addDays(end, -(days - 1));
  const [groups, targets] = await Promise.all([
    prisma.foodEntry.groupBy({
      by: ["date"],
      where: { userId, date: { gte: fromIsoDate(start), lte: fromIsoDate(end) } },
      _sum: { kcal: true, protein: true, carbs: true, fat: true, fiber: true },
      _count: { _all: true, kcal: true, protein: true, carbs: true, fat: true, fiber: true },
    }),
    getTargets(userId, profile),
  ]);
  const byDate = new Map(groups.map((g) => [toIsoDate(g.date), g]));
  const list: DaySummary[] = dateRange(start, days).map((date) => {
    const g = byDate.get(date);
    const n = g?._count._all ?? 0;
    const incomplete = g ? (["kcal", "protein", "carbs", "fat", "fiber"] as const).filter((k) => g._count[k] < n) : [];
    return {
      date,
      entries: n,
      target: targetForDate(targets, date),
      totals: {
        kcal: round(Number(g?._sum.kcal ?? 0), 2), protein: round(Number(g?._sum.protein ?? 0), 2), carbs: round(Number(g?._sum.carbs ?? 0), 2),
        fat: round(Number(g?._sum.fat ?? 0), 2), fiber: round(Number(g?._sum.fiber ?? 0), 2), incomplete: [...incomplete],
      },
    };
  });
  return { start, end, today: localToday(profile.timezone), days: list, summary: summarizePeriod(list) };
}
