import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { accessStateFor } from "@/lib/eligibility";
import { getCurrentUser, type AuthUser } from "./auth";
import { prisma } from "./db";
import { trustedProxyHops } from "./login-throttle";
import { logServerError } from "./safe-log";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown, public headers?: Record<string, string>) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new HttpError(404, `${what} not found`);

export function jsonError(status: number, error: string, details?: unknown, headers?: Record<string, string>) {
  return NextResponse.json({ error, ...(details ? { details } : {}) }, { status, headers });
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The host this request should have come from. X-Forwarded-Host is believed only when trusted
 * proxies are configured (the same entry position as X-Forwarded-For), because anyone can send it.
 */
function expectedHost(req: NextRequest): string | null {
  const hops = trustedProxyHops();
  if (hops >= 1) {
    const chain = (req.headers.get("x-forwarded-host") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const forwarded = chain[chain.length - hops];
    if (forwarded) return forwarded;
  }
  return req.headers.get("host");
}

/**
 * CSRF defence in depth: SameSite=Lax cookies already block cross-site POSTs,
 * and here we additionally require same-origin Origin headers on mutations.
 * With APP_ORIGIN set, the Origin must match it exactly and no request header is believed.
 */
function checkOrigin(req: NextRequest): boolean {
  if (!MUTATING.has(req.method)) return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const appOrigin = process.env.APP_ORIGIN?.replace(/\/$/, "");
  if (appOrigin) return origin === appOrigin;
  try {
    return new URL(origin).host === expectedHost(req);
  } catch {
    return false;
  }
}

type Ctx<P> = { params: Promise<P> };

/** PostgreSQL's lock_timeout, however Prisma happens to report it. See limitLockWait. */
const isLockTimeout = (err: unknown) =>
  (err instanceof Prisma.PrismaClientKnownRequestError || err instanceof Prisma.PrismaClientUnknownRequestError) && /\b55P03\b|lock timeout/.test(err.message);

function handleError(err: unknown) {
  if (err instanceof HttpError) return jsonError(err.status, err.message, err.details, err.headers);
  if (err instanceof ZodError) return jsonError(400, "Invalid input", z.flattenError(err));
  if (isLockTimeout(err)) return jsonError(503, "This is taking longer than usual, and nothing was changed. Try again shortly.", undefined, { "Retry-After": "5" });
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return jsonError(404, "Not found");
    if (err.code === "P2002") return jsonError(409, "Already exists");
    if (err.code === "P2003") return jsonError(409, "Referenced by other records");
  }
  // PostgreSQL 22003 (numeric field overflow) surfaces as an unknown request error.
  if (err instanceof Prisma.PrismaClientUnknownRequestError && /22003|numeric field overflow/.test(err.message)) {
    return jsonError(422, "A value is outside the supported range");
  }
  logServerError(err);
  return jsonError(500, "Internal server error");
}

type Handler<P> = (req: NextRequest, ctx: { params: P; user: AuthUser }) => Promise<Response | unknown>;

function authenticated<P>(handler: Handler<P>, gated: boolean): (req: NextRequest, ctx: Ctx<P>) => Promise<Response> {
  return async (req, ctx) => {
    try {
      if (!checkOrigin(req)) return jsonError(403, "Invalid origin");
      const user = await getCurrentUser();
      if (!user) return jsonError(401, "Not authenticated");
      if (gated) {
        const state = accessStateFor(await prisma.profile.findUnique({ where: { userId: user.id }, select: { birthDate: true } }));
        if (state === "no_profile") return jsonError(409, "Complete your profile first");
        if (state === "restricted") return jsonError(403, "This account is restricted.", { reason: "account_restricted" });
      }
      const result = await handler(req, { params: await ctx.params, user });
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return handleError(err);
    }
  };
}

/**
 * Origin check, sign-in and error mapping, plus the access gate: no profile gets 409, and a stored
 * date under the minimum gets 403. Closed by default, so a new route can't be left open by accident.
 */
export function route<P = Record<string, never>>(handler: Handler<P>) {
  return authenticated(handler, true);
}

/** Signed in, without the access gate, for what a restricted person must still reach. Named exceptions only. */
export function accountRoute<P = Record<string, never>>(handler: Handler<P>) {
  return authenticated(handler, false);
}

export function publicRoute(handler: (req: NextRequest) => Promise<Response | unknown>) {
  return async (req: NextRequest) => {
    try {
      if (!checkOrigin(req)) return jsonError(403, "Invalid origin");
      const result = await handler(req);
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return handleError(err);
    }
  };
}

/** Credentials fit well within this, even with every password character escaped. */
export const AUTH_BODY_LIMIT_BYTES = 4096;
/** For sign-in forms: small, and a body that stalls can't hold a request open. */
export const AUTH_BODY = { maxBytes: AUTH_BODY_LIMIT_BYTES, timeoutMs: 10_000 };
const tooLarge = () => new HttpError(413, "Request body is too large");

/**
 * Read at most maxBytes and cancel the rest, so a caller can't fill memory. With timeoutMs, a body
 * that arrives too slowly is abandoned too, so a stalled upload can't hold its slot.
 */
export async function readLimitedBytes(req: NextRequest, { maxBytes, timeoutMs }: { maxBytes: number; timeoutMs?: number }): Promise<Uint8Array> {
  if (Number(req.headers.get("content-length")) > maxBytes) throw tooLarge();
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = timeoutMs
    ? new Promise<never>((_, fail) => { timer = setTimeout(() => fail(new HttpError(408, "The upload took too long")), timeoutMs); })
    : null;
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await (deadline ? Promise.race([reader.read(), deadline]) : reader.read());
      if (done) break;
      received += value.length;
      if (received > maxBytes) throw tooLarge();
      chunks.push(value);
    }
  } catch (err) {
    void reader.cancel().catch(() => {});
    throw err instanceof HttpError ? err : new HttpError(400, "The request body couldn't be read");
  } finally {
    clearTimeout(timer);
  }
  const bytes = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
}

/** Far beyond any form in this app. Without a limit, one request could fill the server's memory. */
export const JSON_BODY_LIMIT_BYTES = 256 * 1024;

export async function parseBody<T extends z.ZodType>(req: NextRequest, schema: T, { maxBytes = JSON_BODY_LIMIT_BYTES, timeoutMs }: { maxBytes?: number; timeoutMs?: number } = {}): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(await readLimitedBytes(req, { maxBytes, timeoutMs })));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "Body must be valid JSON");
  }
  return schema.parse(body);
}
