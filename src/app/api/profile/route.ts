import { route, parseBody } from "@/lib/server/api";
import { profileSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";

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
  return { profile };
});
