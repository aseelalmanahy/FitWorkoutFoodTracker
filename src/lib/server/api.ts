import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { getCurrentUser, type AuthUser } from "./auth";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new HttpError(404, `${what} not found`);

export function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json({ error, ...(details ? { details } : {}) }, { status });
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defence in depth: SameSite=Lax cookies already block cross-site POSTs,
 * and here we additionally require same-origin Origin headers on mutations.
 */
function checkOrigin(req: NextRequest): boolean {
  if (!MUTATING.has(req.method)) return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

type Ctx<P> = { params: Promise<P> };

function handleError(err: unknown) {
  if (err instanceof HttpError) return jsonError(err.status, err.message, err.details);
  if (err instanceof ZodError) return jsonError(400, "Invalid input", z.flattenError(err));
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return jsonError(404, "Not found");
    if (err.code === "P2002") return jsonError(409, "Already exists");
    if (err.code === "P2003") return jsonError(409, "Referenced by other records");
  }
  console.error(err);
  return jsonError(500, "Internal server error");
}

/** Wrap a route handler with origin check, error mapping, and optional auth. */
export function route<P = Record<string, never>>(
  handler: (req: NextRequest, ctx: { params: P; user: AuthUser }) => Promise<Response | unknown>,
): (req: NextRequest, ctx: Ctx<P>) => Promise<Response> {
  return async (req, ctx) => {
    try {
      if (!checkOrigin(req)) return jsonError(403, "Invalid origin");
      const user = await getCurrentUser();
      if (!user) return jsonError(401, "Not authenticated");
      const result = await handler(req, { params: await ctx.params, user });
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return handleError(err);
    }
  };
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

export async function parseBody<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Body must be valid JSON");
  }
  return schema.parse(body);
}
