import "server-only";
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { HttpError } from "./api";

/**
 * Makes a retried save safe, with no table of its own. The client sends one key per deliberate save,
 * and the server derives from it a value for a column that's already unique, so the database itself
 * refuses a second row, including from two requests racing each other. The user is part of the hash,
 * so one person's key can never reach another person's row. Nothing here looks at names or values.
 */
const KEY = /^[A-Za-z0-9_-]{16,128}$/;

/** Null when the client sent none, which keeps the behaviour from before keys existed. */
export function readIdempotencyKey(req: NextRequest): string | null {
  const key = req.headers.get("idempotency-key");
  if (key === null) return null;
  if (!KEY.test(key)) throw new HttpError(400, "Invalid idempotency key");
  return key;
}

/** 37 characters, within the 40 the API accepts for an id. */
export function idempotentId(kind: "entry" | "food" | "set" | "template", userId: string, key: string): string {
  return `idem_${createHash("sha256").update(`${kind}\0${userId}\0${key}`).digest("hex").slice(0, 32)}`;
}

export const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/** Returning the first values would claim that the new ones were saved, and saving them would make a duplicate. */
export const idempotencyConflict = () => new HttpError(409, "An earlier attempt already saved this with different values. Check it before adding it again.", { reason: "idempotency_conflict" });
