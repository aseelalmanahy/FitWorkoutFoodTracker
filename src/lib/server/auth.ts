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

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

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

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { id: hashToken(token), userId, expiresAt } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { id: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
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
/** Test hook. */
export const _attemptKeyCount = () => attempts.size;
