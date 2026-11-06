import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { prisma } from "./db";

export const SESSION_COOKIE = "fit_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Argon2id with OWASP-recommended minimum parameters (m=19 MiB, t=2, p=1).
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string) => hash(pw, ARGON_OPTS);
export async function verifyPassword(stored: string, pw: string): Promise<boolean> {
  try {
    return await verify(stored, pw);
  } catch {
    return false;
  }
}

// Used to keep login timing similar whether or not the email exists.
let dummyHash: Promise<string> | null = null;
export const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString("hex")));

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// ─── Known-device cookie ────────────────────────────────────────────────────
// Lets a browser that logged in before skip the per-account spacing (login-throttle.ts), so an
// attacker can't keep the owner out. It grants no access: the password is still required. Signed
// with the user's password hash, a server-side value that needs no new secret, so it stops working
// when the password changes. Only one account per browser is remembered.
const DEVICE_COOKIE = "fit_device";
const DEVICE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const DEVICE_PATH = "/api/auth/login";
const DEVICE_FORMAT = /^v1\.(\d{1,16})\.([0-9a-f]{64})$/;
type DeviceUser = { id: string; passwordHash: string };
const deviceSignature = (user: DeviceUser, issuedAt: string) =>
  createHmac("sha256", user.passwordHash).update(`fit-device-v1|${user.id}|${issuedAt}`).digest("hex");

const readDeviceCookie = async () => (await cookies()).get(DEVICE_COOKIE)?.value.match(DEVICE_FORMAT) ?? null;
export const hasDeviceCookie = async () => (await readDeviceCookie()) !== null;

export async function isTrustedDevice(user: DeviceUser): Promise<boolean> {
  const parsed = await readDeviceCookie();
  if (!parsed) return false;
  const [, issuedAt, signature] = parsed;
  const age = Date.now() - Number(issuedAt);
  if (age < 0 || age > DEVICE_TTL_MS) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(deviceSignature(user, issuedAt)));
}

export async function setDeviceCookie(user: DeviceUser): Promise<void> {
  const now = Date.now();
  const issuedAt = String(now);
  (await cookies()).set(DEVICE_COOKIE, `v1.${issuedAt}.${deviceSignature(user, issuedAt)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: DEVICE_PATH,
    expires: new Date(now + DEVICE_TTL_MS),
  });
}

/** A session's values, for the caller to store in its own transaction. Only the hash goes in the database. */
export function newSessionRow() {
  const token = randomBytes(32).toString("base64url");
  return { token, id: hashToken(token), expiresAt: new Date(Date.now() + SESSION_TTL_MS) };
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/**
 * After a password check, which is slow. A reset can commit in that time, so the row is held FOR SHARE while the
 * hash is compared with the one verified, and the session stored. A reset updates that row before deleting sessions,
 * so it either waits and deletes this one, or this sees the new hash and refuses. Returns false if it changed.
 */
export async function createSessionForVerifiedPassword(userId: string, verifiedHash: string): Promise<boolean> {
  const session = newSessionRow();
  const stored = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ passwordHash: string }[]>`SELECT "passwordHash" FROM "User" WHERE id = ${userId} FOR SHARE`;
    if (rows[0]?.passwordHash !== verifiedHash) return false;
    await tx.session.create({ data: { id: session.id, userId, expiresAt: session.expiresAt } });
    return true;
  });
  if (stored) await setSessionCookie(session.token, session.expiresAt);
  return stored;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { id: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

/** After a deletion: nothing identifying stays in this browser. The device cookie has its own path. */
export async function clearAuthCookies(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete({ name: DEVICE_COOKIE, path: DEVICE_PATH });
}

export interface AuthUser {
  id: string;
  email: string;
}

/** Resolve the current user from the session cookie (memoised per request). */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session.user;
});

/** For server components/pages: redirect to login when unauthenticated. */
export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

// ─── Registration throttling ────────────────────────────────────────────────
// Login uses login-throttle.ts. In-memory sliding window. Adequate for a single
// instance; replace with a shared store (e.g. Redis) when horizontally scaling.
const attempts = new Map<string, number[]>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const MAX_KEYS = 50_000;

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const existing = attempts.get(key);
  if (!existing) return false;
  const list = existing.filter((t) => now - t < WINDOW_MS);
  if (list.length) attempts.set(key, list); else attempts.delete(key);
  return list.length >= MAX_ATTEMPTS;
}
export function recordAttempt(key: string): void {
  // Keys can come from caller-supplied values, so the map must stay bounded.
  if (!attempts.has(key) && attempts.size >= MAX_KEYS) attempts.delete(attempts.keys().next().value as string);
  const list = attempts.get(key) ?? [];
  list.push(Date.now());
  attempts.set(key, list);
}
export function forgetAttempts(...keys: string[]): void {
  for (const key of keys) attempts.delete(key);
}
/** Test hook. */
export const _attemptKeyCount = () => attempts.size;
