import { publicRoute, parseBody, HttpError } from "@/lib/server/api";
import { credentialsSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";
import { createSession, hashPassword, isRateLimited, recordAttempt } from "@/lib/server/auth";
import type { NextRequest } from "next/server";

const ip = (req: NextRequest) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";

export const POST = publicRoute(async (req) => {
  const key = `register:${ip(req)}`;
  if (isRateLimited(key)) throw new HttpError(429, "Too many attempts. Try again later.");
  recordAttempt(key);
  const { email, password } = await parseBody(req, credentialsSchema);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new HttpError(409, "An account with this email already exists");
  const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword(password) } });
  await createSession(user.id);
  return { ok: true };
});
