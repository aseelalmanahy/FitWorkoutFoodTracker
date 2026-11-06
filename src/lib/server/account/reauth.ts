import "server-only";
import { HttpError } from "../api";
import { isRateLimited, recordAttempt, verifyPassword } from "../auth";
import { prisma } from "../db";
import { acquirePasswordCheck } from "../login-throttle";

/** Shared by deletion and export, so a stolen session gets one allowance of guesses across both. */
export const reauthKey = (userId: string) => `reauth:${userId}`;

/**
 * The account's own password, entered for this request. Identity comes only from the session. The
 * attempt counts before the slow check, so parallel requests can't all pass the limit.
 */
export async function requireAccountPassword(userId: string, password: string): Promise<void> {
  const key = reauthKey(userId);
  if (isRateLimited(key)) throw new HttpError(429, "Too many attempts. Try again later.", undefined, { "Retry-After": "900" });
  recordAttempt(key);
  const release = acquirePasswordCheck();
  if (!release) throw new HttpError(429, "Too many attempts. Try again later.", undefined, { "Retry-After": "1" });
  try {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!row) throw new HttpError(401, "Not authenticated"); // deleted since the session was read
    if (!(await verifyPassword(row.passwordHash, password))) throw new HttpError(403, "That password isn't right.", { reason: "wrong_password" });
  } finally {
    release();
  }
}
