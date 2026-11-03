import "server-only";
import { prisma } from "../db";
import { HttpError } from "../api";

export async function requireApiProfile(userId: string) {
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) throw new HttpError(409, "Complete your profile first");
  return profile;
}
