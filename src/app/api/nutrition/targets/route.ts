import { route, parseBody } from "@/lib/server/api";
import { prisma } from "@/lib/server/db";
import { nutritionTargetSchema } from "@/lib/validation";
import { getTargets, localToday, setManualTarget, suggestionFromProfile } from "@/lib/server/nutrition/targets";
import { targetForDate } from "@/lib/nutrition";
import { HttpError } from "@/lib/server/api";

async function profileOf(userId: string) {
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) throw new HttpError(409, "Complete your profile first");
  return profile;
}

export const GET = route(async (_req, { user }) => {
  const profile = await profileOf(user.id);
  const targets = await getTargets(user.id, profile);
  const today = localToday(profile.timezone);
  return { today, current: targetForDate(targets, today), suggestion: suggestionFromProfile(profile), history: targets };
});

export const PUT = route(async (req, { user }) => {
  const profile = await profileOf(user.id);
  const input = await parseBody(req, nutritionTargetSchema);
  return { target: await setManualTarget(user.id, profile, input) };
});
