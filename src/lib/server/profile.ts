import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import { requireUser } from "./auth";

/** For pages inside the app shell: authenticated user with a completed profile. */
export const requireProfile = cache(async () => {
  const user = await requireUser();
  const profile = await prisma.profile.findUnique({ where: { userId: user.id } });
  if (!profile) redirect("/onboarding");
  return { user, profile };
});
