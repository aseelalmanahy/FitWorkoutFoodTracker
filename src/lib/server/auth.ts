import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
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

// ─── Login throttling ───────────────────────────────────────────────────────
// In-memory sliding window. Adequate for a single instance; replace with a
// shared store (e.g. Redis) when horizontally scaling.
const attempts = new Map<string, number[]>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const list = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  attempts.set(key, list);
  return list.length >= MAX_ATTEMPTS;
}
export function recordAttempt(key: string): void {
  const list = attempts.get(key) ?? [];
  list.push(Date.now());
  attempts.set(key, list);
}
export const clearAttempts = (key: string) => attempts.delete(key);
