import "server-only";
import { prisma } from "./db";
import { notFound } from "./api";
import { fromIsoDate, toIsoDate } from "@/lib/nutrition";
import type { WeightPoint } from "@/lib/weight-trend";

export interface WeightEntry extends WeightPoint { id: string }

const WEIGHT = "WEIGHT" as const;
const toEntry = (r: { id: string; date: Date; value: number }): WeightEntry => ({ id: r.id, date: toIsoDate(r.date), weightKg: r.value });

/** Every query here names the owner. Oldest first, as the trend reads it. */
export async function getWeightEntries(userId: string): Promise<WeightEntry[]> {
  const rows = await prisma.bodyMetric.findMany({ where: { userId, kind: WEIGHT }, orderBy: { date: "asc" }, select: { id: true, date: true, value: true } });
  return rows.map(toEntry);
}

/** One entry a day, so logging a date again replaces it. Nothing else changes, including the profile's stored weight. */
export async function saveWeightEntry(userId: string, date: string, weightKg: number): Promise<WeightEntry> {
  const when = fromIsoDate(date);
  const row = await prisma.bodyMetric.upsert({
    where: { userId_kind_date: { userId, kind: WEIGHT, date: when } },
    create: { userId, kind: WEIGHT, date: when, value: weightKg },
    update: { value: weightKg },
    select: { id: true, date: true, value: true },
  });
  return toEntry(row);
}

/** The same answer for someone else's entry and one that doesn't exist. */
export async function deleteWeightEntry(userId: string, id: string): Promise<void> {
  const { count } = await prisma.bodyMetric.deleteMany({ where: { id, userId, kind: WEIGHT } });
  if (count === 0) throw notFound("Entry");
}
