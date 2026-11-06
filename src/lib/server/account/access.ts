import "server-only";
import { Prisma, type AccountTokenPurpose } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { HttpError } from "../api";
import { hashPassword, hashToken, newSessionRow, setDeviceCookie, setSessionCookie } from "../auth";
import { prisma } from "../db";
import { acquirePasswordCheck } from "../login-throttle";
import { MailRejected, mailTransport, type MailMessage } from "../mail/transport";
import { enqueueAccountJob, logAccountMail } from "../mail/queue";
import { accountLinkOrigin, registrationAllowed } from "../production-config";
import { requireAccountPassword } from "./reauth";

// Token lifetimes, and not retention periods. Reset is the top of the design's suggested range, and sign-up is a judgement.
const HOUR_MS = 60 * 60 * 1000;
const LIFETIME_MS: Record<AccountTokenPurpose, number> = { SIGNUP: 24 * HOUR_MS, PASSWORD_RESET: HOUR_MS };
// Judgements for a small invited beta. All are read from the table, so a restart doesn't reset them.
const COOLDOWN_MS = 60_000;
const MAX_LIVE_PER_ADDRESS = 5;
const MAX_CREATED_PER_HOUR = 200;

const APP_NAME = "Forge";
const invalidLink = () => new HttpError(400, "This link isn't valid or has expired. Request a new one.");

/** Evaluated when it's used, so the time spent hashing a password can't extend a token's life. */
const live = (id: string, purpose: AccountTokenPurpose) => ({ id, purpose, expiresAt: { gt: new Date() } });

/** Mail is sent only from here, and only fixed codes are ever logged. */
async function send(message: MailMessage, signal: AbortSignal): Promise<void> {
  await mailTransport().send(message, signal);
}

function linkMessage(purpose: AccountTokenPurpose, to: string, origin: string, token: string): MailMessage {
  if (purpose === "SIGNUP") {
    return {
      to,
      kind: "signup",
      subject: `Finish creating your ${APP_NAME} account`,
      text: `Use this link to choose a password and finish creating your account. It works for 24 hours. ${APP_NAME} is for adults 18 and over.\n\n${origin}/register/complete#token=${token}\n\nIf you didn't ask for this, you can ignore this email, and no account will be created.\n`,
    };
  }
  return {
    to,
    kind: "password-reset",
    subject: `Reset your ${APP_NAME} password`,
    text: `Use this link to choose a new password. It works for 60 minutes, and signs you out everywhere.\n\n${origin}/reset-password#token=${token}\n\nIf you didn't ask for this, you can ignore this email, and your password won't change.\n`,
  };
}

/** Cooldown, then caps, then one new token and its email. Runs in the serial job queue, so checks can't race. */
async function issueToken(purpose: AccountTokenPurpose, email: string, userId: string | null, signal: AbortSignal): Promise<void> {
  const name = purpose === "SIGNUP" ? "signup" : "password-reset";
  const origin = accountLinkOrigin();
  if (!origin) return logAccountMail(name, "no-origin");
  const now = Date.now();
  await prisma.accountToken.deleteMany({ where: { expiresAt: { lte: new Date(now) } } });
  const existing = await prisma.accountToken.findMany({ where: { email, purpose }, select: { createdAt: true } });
  if (existing.some((t) => now - t.createdAt.getTime() < COOLDOWN_MS)) return;
  if (existing.length >= MAX_LIVE_PER_ADDRESS) return logAccountMail(name, "address-cap");
  if ((await prisma.accountToken.count({ where: { createdAt: { gt: new Date(now - HOUR_MS) } } })) >= MAX_CREATED_PER_HOUR) return logAccountMail(name, "global-cap");

  const token = randomBytes(32).toString("base64url");
  const id = hashToken(token);
  await prisma.accountToken.create({ data: { id, purpose, email, userId, expiresAt: new Date(now + LIFETIME_MS[purpose]) } });
  try {
    await send(linkMessage(purpose, email, origin, token), signal);
  } catch (err) {
    // Otherwise it may have arrived, so its row stays, and the limits keep counting it.
    if (err instanceof MailRejected) await prisma.accountToken.deleteMany({ where: { id } });
    logAccountMail(name, err instanceof MailRejected ? "rejected" : "send-failed");
  }
}

/** Nothing is looked up before the response. An unlisted address and an existing account just get no email. */
export function requestSignupLink(email: string): void {
  enqueueAccountJob("signup", async (signal) => {
    if (!registrationAllowed(email)) return;
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) return;
    await issueToken("SIGNUP", email, null, signal);
  });
}

export function requestPasswordReset(email: string): void {
  enqueueAccountJob("password-reset", async (signal) => {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user) await issueToken("PASSWORD_RESET", email, user.id, signal);
  });
}

function notifyPasswordChanged(to: string): void {
  enqueueAccountJob("password-changed", async (signal) => {
    const origin = accountLinkOrigin();
    if (!origin) return logAccountMail("password-changed", "no-origin");
    await send({
      to,
      kind: "password-changed",
      subject: `Your ${APP_NAME} password was changed`,
      text: `Your password was just changed, and your other devices were signed out.\n\nIf this wasn't you, reset your password now: ${origin}/forgot-password\n`,
    }, signal);
  });
}

/** Argon2 is slow and memory-hungry, so it runs in one of the limited slots, before any transaction opens. */
async function hashNewPassword(password: string): Promise<string> {
  const release = acquirePasswordCheck();
  if (!release) throw new HttpError(429, "Too many attempts. Try again later.", undefined, { "Retry-After": "1" });
  try {
    return await hashPassword(password);
  } finally {
    release();
  }
}

const isDuplicateEmail = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/**
 * The account comes into existence here, and not before. Exactly one request can consume the token. The unique
 * email settles two different tokens used together, and undoes that token's deletion. No session is created.
 */
export async function completeSignup(token: string, password: string): Promise<void> {
  const id = hashToken(token);
  const row = await prisma.accountToken.findFirst({ where: live(id, "SIGNUP"), select: { email: true } });
  // This is the second allowlist check, as an address can be removed after its link was sent.
  if (!row || !registrationAllowed(row.email)) throw invalidLink();
  const passwordHash = await hashNewPassword(password);
  try {
    await prisma.$transaction(async (tx) => {
      const used = await tx.accountToken.deleteMany({ where: live(id, "SIGNUP") });
      if (used.count !== 1) throw invalidLink();
      await tx.user.create({ data: { email: row.email, passwordHash } });
    });
  } catch (err) {
    if (isDuplicateEmail(err)) throw invalidLink();
    throw err;
  }
  // After commit, as deleting these inside would deadlock two redemptions. If it fails, they can't create a second account.
  await prisma.accountToken.deleteMany({ where: { email: row.email, purpose: "SIGNUP" } }).catch(() => logAccountMail("signup", "cleanup-failed"));
}

/**
 * The user row is locked first, the same order as deletion and change-password. So the password, every session and
 * every token change together, and a login past its password check sees either all of it or none. See auth.ts.
 */
export async function resetPassword(token: string, password: string): Promise<void> {
  const id = hashToken(token);
  const row = await prisma.accountToken.findFirst({ where: live(id, "PASSWORD_RESET"), select: { userId: true } });
  if (!row?.userId) throw invalidLink();
  const userId = row.userId;
  const passwordHash = await hashNewPassword(password);
  const email = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ email: string }[]>`SELECT email FROM "User" WHERE id = ${userId} FOR UPDATE`;
    if (!locked.length) throw invalidLink();
    const used = await tx.accountToken.deleteMany({ where: live(id, "PASSWORD_RESET") });
    if (used.count !== 1) throw invalidLink();
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId } });
    await tx.accountToken.deleteMany({ where: { OR: [{ userId }, { email: locked[0].email }] } });
    return locked[0].email;
  });
  notifyPasswordChanged(email);
}

/**
 * The update requires the hash that was just verified, so a request held up while a reset commits can't overwrite
 * the owner's new password. This browser keeps a new session, and every other session and pending link ends.
 */
export async function changePassword(user: { id: string; email: string }, currentPassword: string, newPassword: string): Promise<void> {
  const verified = await requireAccountPassword(user.id, currentPassword);
  const passwordHash = await hashNewPassword(newPassword);
  const session = newSessionRow();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({ where: { id: user.id, passwordHash: verified }, data: { passwordHash } });
    if (updated.count !== 1) throw new HttpError(409, "Your password was changed elsewhere just now. Log in again and retry.");
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.accountToken.deleteMany({ where: { OR: [{ userId: user.id }, { email: user.email }] } });
    await tx.session.create({ data: { id: session.id, userId: user.id, expiresAt: session.expiresAt } });
  });
  await setSessionCookie(session.token, session.expiresAt);
  await setDeviceCookie({ id: user.id, passwordHash });
  notifyPasswordChanged(user.email);
}
