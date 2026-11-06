import { accountRoute, HttpError, parseBody } from "@/lib/server/api";
import { isRateLimited, recordAttempt } from "@/lib/server/auth";
import { eligibilityOf } from "@/lib/eligibility";
import { profileSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";

// These are accountRoute, not route: someone with no profile, or a restricted one, has to reach them.
export const GET = accountRoute(async (_req, { user }) => {
  return { profile: await prisma.profile.findUnique({ where: { userId: user.id } }) };
});

/**
 * Nothing is written unless the declared date is eligible. A refused date is never stored or logged.
 * The attempt limit is friction, not enforcement: a false date or a new email gets past it.
 * A field left out of the body is undefined here, which Prisma leaves unchanged, and stores as null on a
 * new row. An explicit null clears it.
 */
export const PUT = accountRoute(async (req, { user }) => {
  const input = await parseBody(req, profileSchema);
  const stored = await prisma.profile.findUnique({ where: { userId: user.id }, select: { birthDate: true } });
  const dateChanged = stored?.birthDate.toISOString().slice(0, 10) !== input.birthDate;
  const attempts = `age-refusal:${user.id}`;
  if (dateChanged && isRateLimited(attempts)) throw new HttpError(429, "Too many attempts. Try again later.", undefined, { "Retry-After": "900" });

  const eligibility = eligibilityOf(input.birthDate);
  if (eligibility === "out_of_range") throw new HttpError(400, "Check the date of birth.");
  if (eligibility === "under_minimum") {
    recordAttempt(attempts);
    throw new HttpError(422, "This date of birth can't be used.", { reason: "age_ineligible" });
  }

  const data = { ...input, birthDate: new Date(input.birthDate) };
  const profile = await prisma.profile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });
  return { profile };
});
