import "server-only";
import { Prisma, type NutritionTarget, type Profile } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../api";
import { carbsFromRemainder, toIsoDate, fromIsoDate, type TargetRow } from "@/lib/nutrition";
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

export const toRow = (t: NutritionTarget): TargetRow => ({
  effectiveFrom: toIsoDate(t.effectiveFrom), kcal: t.kcal, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG, source: t.source,
});

/** All of the person's rows, oldest first, including stopped ones. Read-only. */
export async function getTargets(userId: string): Promise<TargetRow[]> {
  const rows = await prisma.nutritionTarget.findMany({ where: { userId }, orderBy: { effectiveFrom: "asc" } });
  return rows.map(toRow);
}

const latestRow = (userId: string) => prisma.nutritionTarget.findFirst({ where: { userId }, orderBy: { effectiveFrom: "desc" } });

/**
 * The later of today and the latest row's date. After moving to an earlier time zone a row can be dated
 * tomorrow, and writing at today would let that row silently undo this choice tomorrow.
 * Earlier rows are never touched. Writing twice on one date replaces that date's row, as the unique
 * key allows one row per date, and it's always the person's own act.
 */
function writeDate(today: Date, latest: NutritionTarget | null): Date {
  return latest && latest.effectiveFrom > today ? latest.effectiveFrom : today;
}

type RowValues = Pick<NutritionTarget, "kcal" | "proteinG" | "carbsG" | "fatG" | "source">;

async function writeRow(userId: string, effectiveFrom: Date, values: RowValues) {
  const row = await upsertWithRetry(() => prisma.nutritionTarget.upsert({
    where: { userId_effectiveFrom: { userId, effectiveFrom } },
    create: { userId, effectiveFrom, ...values },
    update: values,
  }));
  return toRow(row);
}

/**
 * The person's own target. Blank macros stay null and zero stays zero. Carbs are the energy remainder,
 * only when protein and fat were both given, so a missing macro target is never invented.
 */
export async function setManualTarget(userId: string, profile: Profile, input: { kcal: number; proteinG: number | null; fatG: number | null }) {
  // What was given still has to fit, even when carbs can't be worked out.
  const remainder = carbsFromRemainder(input.kcal, input.proteinG ?? 0, input.fatG ?? 0);
  if (remainder === null) throw new HttpError(400, "Protein and fat targets contain more energy than the calorie target.");
  const carbsG = input.proteinG !== null && input.fatG !== null ? remainder : null;
  const effectiveFrom = writeDate(fromIsoDate(localToday(profile.timezone)), await latestRow(userId));
  return writeRow(userId, effectiveFrom, { ...input, carbsG, source: "MANUAL" });
}

/**
 * Stop using a target from now on, by the person's explicit choice. Earlier rows and the food log stay,
 * so past days keep their comparison. With no target to stop, nothing is written.
 */
export async function stopTarget(userId: string, profile: Profile) {
  const latest = await latestRow(userId);
  if (!latest || latest.kcal === null) return { stopped: false as const };
  const effectiveFrom = writeDate(fromIsoDate(localToday(profile.timezone)), latest);
  const target = await writeRow(userId, effectiveFrom, { kcal: null, proteinG: null, carbsG: null, fatG: null, source: "MANUAL" });
  return { stopped: true as const, target };
}
