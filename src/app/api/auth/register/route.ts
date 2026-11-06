import { Prisma } from "@prisma/client";
import { AUTH_BODY_LIMIT_BYTES, publicRoute, parseBody, HttpError } from "@/lib/server/api";
import { credentialsSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";
import { createSession, hashPassword, isRateLimited, recordAttempt } from "@/lib/server/auth";
import { acquirePasswordCheck, trustedClientId } from "@/lib/server/login-throttle";
import { registrationAllowed, registrationIsClosed } from "@/lib/server/production-config";

/** The same answer whether an address isn't invited or already has an account, so neither can be learned here. */
const notAvailable = () => new HttpError(403, "We can't create an account with these details. Sign-up is by invitation. If you already have an account, log in.");

export const POST = publicRoute(async (req) => {
  // Without a trusted client address, all callers share one limit, so forged headers gain nothing.
  const key = `register:${trustedClientId(req.headers) ?? "untrusted"}`;
  if (isRateLimited(key)) throw new HttpError(429, "Too many attempts. Try again later.");
  recordAttempt(key);
  const { email, password } = await parseBody(req, credentialsSchema, { maxBytes: AUTH_BODY_LIMIT_BYTES });
  const closed = registrationIsClosed();
  if (!closed && (await prisma.user.findUnique({ where: { email } }))) throw new HttpError(409, "An account with this email already exists");
  const release = acquirePasswordCheck();
  if (!release) throw new HttpError(429, "Too many attempts. Try again later.", undefined, { "Retry-After": "1" });
  let passwordHash: string;
  try {
    // Before the allowlist is consulted, so a refusal takes as long as a real sign-up.
    passwordHash = await hashPassword(password);
  } finally {
    release();
  }
  if (!registrationAllowed(email)) {
    await prisma.user.findUnique({ where: { email }, select: { id: true } }); // the read a listed address would cost
    throw notAvailable();
  }
  let user;
  try {
    user = await prisma.user.create({ data: { email, passwordHash } });
  } catch (err) {
    if (closed && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw notAvailable();
    throw err;
  }
  await createSession(user.id);
  return { ok: true };
});
