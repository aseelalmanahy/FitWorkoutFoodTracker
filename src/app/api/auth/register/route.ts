import { AUTH_BODY_LIMIT_BYTES, publicRoute, parseBody, HttpError } from "@/lib/server/api";
import { credentialsSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";
import { createSession, hashPassword, isRateLimited, recordAttempt } from "@/lib/server/auth";
import { acquirePasswordCheck, trustedClientId } from "@/lib/server/login-throttle";

export const POST = publicRoute(async (req) => {
  // Without a trusted client address, all callers share one limit, so forged headers gain nothing.
  const key = `register:${trustedClientId(req.headers) ?? "untrusted"}`;
  if (isRateLimited(key)) throw new HttpError(429, "Too many attempts. Try again later.");
  recordAttempt(key);
  const { email, password } = await parseBody(req, credentialsSchema, { maxBytes: AUTH_BODY_LIMIT_BYTES });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new HttpError(409, "An account with this email already exists");
  const release = acquirePasswordCheck();
  if (!release) throw new HttpError(429, "Too many attempts. Try again later.", undefined, { "Retry-After": "1" });
  let passwordHash: string;
  try {
    passwordHash = await hashPassword(password);
  } finally {
    release();
  }
  const user = await prisma.user.create({ data: { email, passwordHash } });
  await createSession(user.id);
  return { ok: true };
});
