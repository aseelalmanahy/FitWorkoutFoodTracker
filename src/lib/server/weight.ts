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

/** Ids are cuids. A malformed one can't match, and a null byte would reach the database as an error, so it's answered here. */
const ENTRY_ID = /^[0-9A-Za-z_-]{1,40}$/;

/** The same answer for someone else's entry, one that doesn't exist, and an id that couldn't be one. */
export async function deleteWeightEntry(userId: string, id: string): Promise<void> {
  if (!ENTRY_ID.test(id)) throw notFound("Entry");
  const { count } = await prisma.bodyMetric.deleteMany({ where: { id, userId, kind: WEIGHT } });
  if (count === 0) throw notFound("Entry");
}
