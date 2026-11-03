import { route, parseBody } from "@/lib/server/api";
import { profileSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";
import { syncSuggestedTarget } from "@/lib/server/nutrition/targets";

export const GET = route(async (_req, { user }) => {
  return { profile: await prisma.profile.findUnique({ where: { userId: user.id } }) };
});

export const PUT = route(async (req, { user }) => {
  const input = await parseBody(req, profileSchema);
  const data = { ...input, birthDate: new Date(input.birthDate) };
  const profile = await prisma.profile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });
  // Suggested nutrition targets follow profile changes; manual ones are left alone.
  await syncSuggestedTarget(user.id, profile);
  return { profile };
});
