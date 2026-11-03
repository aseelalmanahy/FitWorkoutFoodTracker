import "server-only";
import { ExternalFoodError, type ExternalSource } from "./types";

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
  if (res.status === 429) throw new ExternalFoodError(source, "rate_limited", "The food database is rate-limiting requests. Try again shortly.");
  if (res.status === 401 || res.status === 403) throw new ExternalFoodError(source, "not_configured", "The food database rejected the API credentials.");
  if (!res.ok) throw new ExternalFoodError(source, "http", `The food database returned an error (${res.status}).`);
  try {
    return await res.json();
  } catch {
    throw new ExternalFoodError(source, "invalid_response", "The food database returned an unreadable response.");
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
