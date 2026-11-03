import { route, HttpError } from "@/lib/server/api";
import { prisma } from "@/lib/server/db";
import { applySuggestion } from "@/lib/server/nutrition/targets";

/** Replace today's target with the profile-based suggestion. */
export const POST = route(async (_req, { user }) => {
  const profile = await prisma.profile.findUnique({ where: { userId: user.id } });
  if (!profile) throw new HttpError(409, "Complete your profile first");
  return { target: await applySuggestion(user.id, profile) };
});
