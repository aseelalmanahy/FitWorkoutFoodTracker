import { HttpError, parseBody, route } from "@/lib/server/api";
import { prisma } from "@/lib/server/db";
import { assertLoggableDate } from "@/lib/server/nutrition/entries";
import { getWeightEntries, saveWeightEntry } from "@/lib/server/weight";
import { round } from "@/lib/units";
import { weightEntrySchema } from "@/lib/validation";
import { weightTrend } from "@/lib/weight-trend";

export const GET = route(async (_req, { user }) => {
  const entries = await getWeightEntries(user.id);
  return { entries, trend: weightTrend(entries) };
});

export const PUT = route(async (req, { user }) => {
  const input = await parseBody(req, weightEntrySchema);
  const profile = await prisma.profile.findUnique({ where: { userId: user.id } });
  if (!profile) throw new HttpError(409, "Complete your profile first");
  assertLoggableDate(input.date, profile);
  return { entry: await saveWeightEntry(user.id, input.date, round(input.weightKg, 2)) };
});
