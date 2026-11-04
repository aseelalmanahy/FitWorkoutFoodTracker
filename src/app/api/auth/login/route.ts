import { AUTH_BODY_LIMIT_BYTES, publicRoute, parseBody, HttpError } from "@/lib/server/api";
import { credentialsSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";
import { createSession, getDummyHash, hasDeviceCookie, isTrustedDevice, setDeviceCookie, verifyPassword } from "@/lib/server/auth";
import { acquirePasswordCheck, beginLoginAttempt, clientRefusal, hasPasswordCheckCapacity, trustedClientId, waitForLoginSlot } from "@/lib/server/login-throttle";

const tooMany = (retryAfterSec: number) => new HttpError(429, "Too many attempts. Try again later.", undefined, { "Retry-After": String(retryAfterSec) });

export const POST = publicRoute(async (req) => {
  const { email, password } = await parseBody(req, credentialsSchema, { maxBytes: AUTH_BODY_LIMIT_BYTES });
  const client = trustedClientId(req.headers);
  const refused = clientRefusal(client);
  if (refused) throw tooMany(refused.retryAfterSec);

  // Only a well-formed device cookie costs a database read before the limits are applied.
  let user = (await hasDeviceCookie()) ? await prisma.user.findUnique({ where: { email } }) : undefined;
  const knownDevice = user ? await isTrustedDevice(user) : false;
  if (!hasPasswordCheckCapacity(knownDevice)) throw tooMany(1);
  const attempt = beginLoginAttempt(email, client, knownDevice);
  if (!attempt.allowed) throw tooMany(attempt.retryAfterSec);

  let ok = false;
  await waitForLoginSlot(attempt.waitMs);
  const release = acquirePasswordCheck(knownDevice);
  if (!release) {
    attempt.abandoned();
    throw tooMany(1);
  }
  try {
    user ??= await prisma.user.findUnique({ where: { email } });
    ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);
  } catch (err) {
    attempt.abandoned();
    throw err;
  } finally {
    release();
  }
  if (!user || !ok) throw new HttpError(401, "Incorrect email or password");
  attempt.succeeded();
  await createSession(user.id);
  await setDeviceCookie(user);
  return { ok: true };
});
