import "server-only";
import { ExternalFoodError, type ExternalSource } from "./types";
import { acquire, parseRetryAfter, record, type ProviderOp } from "./guard";

/** Generic text for any provider configuration problem; the detail goes to server logs only. */
export const PROVIDER_UNAVAILABLE = "This food database is currently unavailable. Try again later.";

/** Log a configuration problem server-side. Never pass secrets to this function. */
export function logProviderConfigError(source: ExternalSource, detail: string) {
  console.error(`[foods] ${source} configuration error: ${detail}`);
}

export const DEFAULT_TIMEOUT_MS = 8000;

/** GET JSON with a timeout, mapping every failure to an ExternalFoodError. */
export async function fetchJson(source: ExternalSource, url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") throw new ExternalFoodError(source, "timeout", "The food database took too long to respond.");
    throw new ExternalFoodError(source, "network", "Could not reach the food database.");
  }
  if (res.status === 404) throw new ExternalFoodError(source, "not_found", "Food not found.");
  if (res.status === 429) {
    throw new ExternalFoodError(source, "rate_limited", "The food database is rate-limiting requests. Try again shortly.", parseRetryAfter(res.headers.get("retry-after")));
  }
  if (res.status === 401 || res.status === 403) {
    logProviderConfigError(source, `provider rejected the request credentials (HTTP ${res.status}); check the API key`);
    throw new ExternalFoodError(source, "not_configured", PROVIDER_UNAVAILABLE);
  }
  if (!res.ok) throw new ExternalFoodError(source, "http", `The food database returned an error (${res.status}).`);
  try {
    return await res.json();
  } catch {
    throw new ExternalFoodError(source, "invalid_response", "The food database returned an unreadable response.");
  }
}

/**
 * fetchJson behind the provider guard: budgets are checked and charged first,
 * and the outcome feeds the circuit breaker.
 */
export async function guardedFetchJson(op: ProviderOp, userId: string | undefined, url: string, init: RequestInit = {}): Promise<unknown> {
  const source: ExternalSource = op === "USDA" ? "USDA" : "OPEN_FOOD_FACTS";
  acquire(op, userId);
  try {
    const data = await fetchJson(source, url, init);
    record(op, "success");
    return data;
  } catch (e) {
    if (e instanceof ExternalFoodError) record(op, e);
    throw e;
  }
}

/** Small in-memory TTL cache for search responses (per server instance). */
export class TtlCache<V> {
  private map = new Map<string, { v: V; exp: number }>();
  constructor(private ttlMs: number, private max = 200) {}
  get(k: string): V | undefined {
    const hit = this.map.get(k);
    if (!hit) return undefined;
    if (hit.exp < Date.now()) {
      this.map.delete(k);
      return undefined;
    }
    return hit.v;
  }
  set(k: string, v: V) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(k, { v, exp: Date.now() + this.ttlMs });
  }
  clear() {
    this.map.clear();
  }
}
