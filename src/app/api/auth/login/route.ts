import { publicRoute, parseBody, HttpError } from "@/lib/server/api";
import { credentialsSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";
import {
  clearAttempts, createSession, getDummyHash, isRateLimited, recordAttempt, verifyPassword,
} from "@/lib/server/auth";

export const POST = publicRoute(async (req) => {
  const { email, password } = await parseBody(req, credentialsSchema);
  const key = `login:${email}`;
  if (isRateLimited(key)) throw new HttpError(429, "Too many attempts. Try again in 15 minutes.");
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);
  if (!user || !ok) {
    recordAttempt(key);
    throw new HttpError(401, "Incorrect email or password");
  }
  clearAttempts(key);
  await createSession(user.id);
  return { ok: true };
});
