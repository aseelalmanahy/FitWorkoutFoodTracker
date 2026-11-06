import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { accessStateFor } from "@/lib/eligibility";
import { prisma } from "./db";
import { requireUser } from "./auth";

/** For pages inside the app shell: a signed-in person with a complete, eligible profile. */
export const requireProfile = cache(async () => {
  const user = await requireUser();
  const profile = await prisma.profile.findUnique({ where: { userId: user.id } });
  const state = accessStateFor(profile);
  if (state === "no_profile") redirect("/onboarding");
  if (state === "restricted") redirect("/account-restricted");
  return { user, profile: profile! };
});
