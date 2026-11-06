import "server-only";
import { Prisma, type NutritionTarget, type Profile } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../api";
import { carbsFromRemainder, toIsoDate, fromIsoDate, type DatedTarget } from "@/lib/nutrition";
import { localParts } from "@/lib/time";

/**
 * Run an upsert on NutritionTarget(userId, effectiveFrom). Two saves at once can race on the unique
 * key. The loser retries once, and that retry updates the row the winner created.
 */
async function upsertWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fn();
    throw e;
  }
}

export function localToday(timeZone: string, now = new Date()): string {
  const p = localParts(now, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export const toDated = (t: NutritionTarget): DatedTarget => ({
  effectiveFrom: toIsoDate(t.effectiveFrom), kcal: t.kcal, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG, source: t.source,
});

/** All of the person's targets, oldest first. Read-only: nothing here ever writes a target. */
export async function getTargets(userId: string): Promise<DatedTarget[]> {
  const rows = await prisma.nutritionTarget.findMany({ where: { userId }, orderBy: { effectiveFrom: "asc" } });
  return rows.map(toDated);
}

/**
 * The person's own target, from today on. The only way a target is written. Earlier dates are never
 * touched. A second save on the same day replaces that day's row, as one row exists per date.
 * Carbs are the energy remainder, so the target is always consistent.
 */
export async function setManualTarget(userId: string, profile: Profile, input: { kcal: number; proteinG: number; fatG: number }) {
  const carbsG = carbsFromRemainder(input.kcal, input.proteinG, input.fatG);
  if (carbsG === null) throw new HttpError(400, "Protein and fat targets contain more energy than the calorie target.");
  const effectiveFrom = fromIsoDate(localToday(profile.timezone));
  const values = { ...input, carbsG, source: "MANUAL" as const };
  const row = await upsertWithRetry(() => prisma.nutritionTarget.upsert({
    where: { userId_effectiveFrom: { userId, effectiveFrom } },
    create: { userId, effectiveFrom, ...values },
    update: values,
  }));
  return toDated(row);
}
