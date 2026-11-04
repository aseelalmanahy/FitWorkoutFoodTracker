import "server-only";
/**
 * Provider protection for USDA FoodData Central and Open Food Facts.
 *
 * 1. Budgets (sliding windows, same approach as the login throttle in auth.ts):
 *    - a GLOBAL budget per provider operation, kept within the provider's
 *      published limit, so the whole app stays a good API citizen;
 *    - a PER-USER budget, a fraction of the global one, so one user can't
 *      consume capacity everyone shares (the USDA key quota, OFF's per-IP limit).
 *    Budgets are charged only when a request actually goes to the provider.
 *    Cached results are free.
 * 2. Circuit breaker per provider operation:
 *    - a provider 429 opens it for Retry-After (default 60 s), doubling on
 *      consecutive 429s, capped at 15 min;
 *    - 3 consecutive failures (5xx, network, timeout, unreadable response)
 *      open it for 30 s, doubling up to 5 min;
 *    - while open, requests fail fast without calling the provider. One
 *      success closes it.
 *
 * LIMITATION: all state is in memory, per server process. With several
 * instances, each enforces its own budgets, so the effective global rate is
 * N × the configured budget. Move this state to a shared store (e.g. Redis)
 * before horizontal scaling.
 */
import { ExternalFoodError, type ExternalSource } from "./types";

export type ProviderOp = "USDA" | "OFF_SEARCH" | "OFF_PRODUCT";

interface Budget { limit: number; windowMs: number }
const MIN = 60_000, HOUR = 3_600_000;

/**
 * Published provider limits:
 *  - USDA FDC via api.data.gov: 1,000 requests/hour per key by default.
 *  - Open Food Facts (per IP, exceeding them can return HTTP 503): 10 req/min for search and
 *    15 req/min for product reads. Search-a-licious publishes no limit of its own, so text
 *    search keeps the 10/min budget. The product budget stays below 15 to leave a margin.
 */
const BASE_LIMITS: Record<ProviderOp, { global: Budget[]; perUser: Budget[] }> = {
  USDA: { global: [{ limit: 900, windowMs: HOUR }], perUser: [{ limit: 20, windowMs: MIN }, { limit: 150, windowMs: HOUR }] },
  OFF_SEARCH: { global: [{ limit: 10, windowMs: MIN }], perUser: [{ limit: 4, windowMs: MIN }] },
  OFF_PRODUCT: { global: [{ limit: 12, windowMs: MIN }], perUser: [{ limit: 6, windowMs: MIN }] },
};

/**
 * Test-only scale for budgets (default 1). The general integration and E2E
 * suites make far more provider calls per minute than a person would.
 * Never set this in production.
 */
const multiplier = () => {
  const m = Number(process.env.FOOD_RATE_LIMIT_MULTIPLIER ?? 1);
  return Number.isFinite(m) && m >= 1 ? m : 1;
};

export const sourceOf = (op: ProviderOp): ExternalSource => (op === "USDA" ? "USDA" : "OPEN_FOOD_FACTS");

let now = () => Date.now();
/** Test hook: replace the clock. */
export function _setClock(fn: () => number) { now = fn; }

const windows = new Map<string, number[]>();

function used(key: string, windowMs: number): number[] {
  const t = now();
  const list = (windows.get(key) ?? []).filter((x) => t - x < windowMs);
  windows.set(key, list);
  return list;
}

/** Earliest moment a slot frees up in a full window (ms from now). */
const retryIn = (list: number[], windowMs: number) => Math.max(1000, list[0] + windowMs - now());

interface Circuit { openUntil: number; failures: number; rateLimitHits: number }
const circuits = new Map<ProviderOp, Circuit>();
const circuit = (op: ProviderOp) => circuits.get(op) ?? circuits.set(op, { openUntil: 0, failures: 0, rateLimitHits: 0 }).get(op)!;

export const FAILURE_THRESHOLD = 3;
const FAILURE_BACKOFF_MS = 30_000, FAILURE_BACKOFF_MAX_MS = 5 * MIN;
const RATE_LIMIT_DEFAULT_MS = MIN, RATE_LIMIT_MAX_MS = 15 * MIN;

/**
 * Call before contacting a provider. Throws without side effects if the
 * circuit is open or a budget is exhausted; otherwise charges all budgets.
 */
export function acquire(op: ProviderOp, userId: string | undefined): void {
  const source = sourceOf(op);
  const c = circuit(op);
  if (c.openUntil > now()) {
    throw new ExternalFoodError(source, "unavailable", "This food database is temporarily unavailable. Try again shortly.", c.openUntil - now());
  }
  const m = multiplier();
  const checks: { key: string; b: Budget; scope: "user" | "global" }[] = [
    ...BASE_LIMITS[op].global.map((b) => ({ key: `g:${op}:${b.windowMs}`, b, scope: "global" as const })),
    ...(userId ? BASE_LIMITS[op].perUser.map((b) => ({ key: `u:${userId}:${op}:${b.windowMs}`, b, scope: "user" as const })) : []),
  ];
  for (const { key, b, scope } of checks) {
    const list = used(key, b.windowMs);
    if (list.length >= b.limit * m) {
      const wait = retryIn(list, b.windowMs);
      throw scope === "user"
        ? new ExternalFoodError(source, "user_rate_limited", "You're searching faster than the food database allows. Wait a moment and try again.", wait)
        : new ExternalFoodError(source, "unavailable", "This food database is busy. Try again shortly.", wait);
    }
  }
  const t = now();
  for (const { key } of checks) windows.get(key)!.push(t);
}

/** Record the provider outcome for the circuit breaker. */
export function record(op: ProviderOp, outcome: "success" | ExternalFoodError): void {
  const c = circuit(op);
  if (outcome === "success" || outcome.kind === "not_found") {
    // A 404 is a valid answer from a healthy provider.
    c.failures = 0;
    c.rateLimitHits = 0;
    return;
  }
  if (outcome.kind === "rate_limited") {
    c.rateLimitHits++;
    const base = outcome.retryAfterMs ?? RATE_LIMIT_DEFAULT_MS;
    const wait = Math.min(RATE_LIMIT_MAX_MS, base * 2 ** (c.rateLimitHits - 1));
    c.openUntil = Math.max(c.openUntil, now() + wait);
    return;
  }
  if (["timeout", "network", "http", "invalid_response"].includes(outcome.kind)) {
    c.failures++;
    if (c.failures >= FAILURE_THRESHOLD) {
      const wait = Math.min(FAILURE_BACKOFF_MAX_MS, FAILURE_BACKOFF_MS * 2 ** (c.failures - FAILURE_THRESHOLD));
      c.openUntil = Math.max(c.openUntil, now() + wait);
    }
  }
}

/** Parse an HTTP Retry-After header (delta-seconds or HTTP date) into ms, capped. */
export function parseRetryAfter(v: string | null): number | undefined {
  if (!v) return undefined;
  const secs = Number(v);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(v) - now();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, RATE_LIMIT_MAX_MS) : undefined;
}

/** Test hook: clear all budgets and circuits. */
export function _resetGuard() {
  windows.clear();
  circuits.clear();
}
