import "server-only";
import { ExternalFoodError, type ExternalSource } from "./types";
import { acquire, parseRetryAfter, record, type ProviderOp } from "./guard";

/** Generic text for any provider configuration problem; the detail goes to server logs only. */
export const PROVIDER_UNAVAILABLE = "This food database is currently unavailable. Try again later.";

/** Log a configuration problem server-side. Never pass secrets to this function. */
export function logProviderConfigError(source: ExternalSource, detail: string) {
  console.error(`[foods] ${source} configuration error: ${detail}`);
}

const PROVIDER_ERROR_READ_MAX = 8192; // bytes
const PROVIDER_ERROR_LOG_MAX = 300;

/**
 * Read at most PROVIDER_ERROR_READ_MAX bytes of a response body and cancel the rest.
 * A body cut at the limit also loses a tail as long as the encoded key, so a piece of the
 * key split by the cut can't reach the log once sanitizing shortens the text before it.
 */
async function readBoundedText(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "", received = 0;
  try {
    while (received < PROVIDER_ERROR_READ_MAX) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      const part = value.subarray(0, PROVIDER_ERROR_READ_MAX - received);
      received += part.length;
      text += decoder.decode(part, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  const key = process.env.FDC_API_KEY;
  return key ? text.slice(0, Math.max(0, text.length - encodeURIComponent(key).length)) : text;
}

/**
 * Reduce provider error text to something safe for server logs: one line, length-limited,
 * with the configured key, URLs, credentials and long tokens removed. The key is removed
 * before the final cut, so a truncated copy of it can't survive.
 */
function sanitizeProviderErrorText(text: string): string {
  let out = text;
  const key = process.env.FDC_API_KEY;
  if (key) for (const form of [key, encodeURIComponent(key)]) out = out.split(form).join("[redacted]");
  return out
    .replace(/<[^>]*>/g, " ")
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"']*/gi, "[url]")
    .replace(/[^\s"']*\?[^\s"']*=[^\s"']*/g, "[url]")
    .replace(/\b(api[_-]?key|authorization|password|passwd|pwd|secret|token)\b(["']?\s*[:=]\s*["']?)(?:bearer\s+)?[^\s"'&,;}]+/gi, "$1$2[redacted]")
    .replace(/\bbearer\s+\S+/gi, "bearer [redacted]")
    .replace(/[A-Za-z0-9+/_=-]{32,}/g, "[redacted]")
    .replace(/[\u0000-\u001f\u007f\s]+/g, " ")
    .trim()
    .slice(0, PROVIDER_ERROR_LOG_MAX);
}

/** Only these response headers are logged. An allowlist, so cookies and auth headers can't appear. */
const TRACE_HEADERS = [
  "x-request-id", "x-amzn-requestid", "x-amz-cf-id", "x-amz-cf-pop", "x-api-umbrella-request-id", "cf-ray",
  "x-cache", "via", "server", "date", "age", "retry-after", "content-type", "x-ratelimit-limit", "x-ratelimit-remaining",
];

/**
 * Allowlisted headers as one safe string. Long-token redaction is skipped because request ids
 * look like long tokens and are the point of logging them; the configured key is still removed.
 */
function safeTraceHeaders(res: Response): string {
  const key = process.env.FDC_API_KEY;
  return TRACE_HEADERS.flatMap((name) => {
    let value = res.headers.get(name) ?? "";
    if (key) for (const form of [key, encodeURIComponent(key)]) value = value.split(form).join("[redacted]");
    value = value.replace(/\S*@\S*/g, "[redacted]").replace(/[^\w .:;,/=()+[\]-]/g, "").trim().slice(0, 128);
    return value ? [`${name}=${value}`] : [];
  }).join(" | ");
}

/** Server-side diagnostic for a provider HTTP error. Clients only ever get the generic message. */
async function logProviderHttpError(source: ExternalSource, url: string, res: Response) {
  let detail = "(unreadable)", path = "(unknown path)", headers = "";
  try {
    detail = sanitizeProviderErrorText(await readBoundedText(res)) || "(empty)";
  } catch { /* the status and headers are still useful */ }
  try {
    path = sanitizeProviderErrorText(new URL(url).pathname);
    headers = safeTraceHeaders(res);
  } catch { /* never let diagnostics change the outcome */ }
  console.error(`[foods] ${source} HTTP ${res.status} on ${path} at ${new Date().toISOString()} headers={${headers}}: ${detail}`);
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
    const networkError = new ExternalFoodError(source, "network", "Could not reach the food database.");
    networkError.transient = true;
    throw networkError;
  }
  if (res.status === 404) throw new ExternalFoodError(source, "not_found", "Food not found.");
  if (res.status === 429) {
    await logProviderHttpError(source, url, res);
    throw new ExternalFoodError(source, "rate_limited", "The food database is rate-limiting requests. Try again shortly.", parseRetryAfter(res.headers.get("retry-after")));
  }
  if (res.status === 401 || res.status === 403) {
    logProviderConfigError(source, `provider rejected the request credentials (HTTP ${res.status}); check the API key`);
    await logProviderHttpError(source, url, res);
    throw new ExternalFoodError(source, "not_configured", PROVIDER_UNAVAILABLE);
  }
  if (!res.ok) {
    await logProviderHttpError(source, url, res);
    const httpError = new ExternalFoodError(source, "http", `The food database returned an error (${res.status}).`);
    // A Retry-After is the provider asking us to wait longer than a retry would.
    httpError.transient = [502, 503, 504].includes(res.status) && !res.headers.get("retry-after");
    throw httpError;
  }
  try {
    return await res.json();
  } catch {
    throw new ExternalFoodError(source, "invalid_response", "The food database returned an unreadable response.");
  }
}

/** Structural check of a parsed provider body; returning false marks it malformed. */
export type ResponseValidator = (data: unknown) => boolean;

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

let searchRetryDelayMs = () => 400 + Math.random() * 200;
/** Test hook: replace the delay before the search retry. */
export function _setSearchRetryDelay(fn: () => number) { searchRetryDelayMs = fn; }

/**
 * fetchJson behind the provider guard: budgets are checked and charged first,
 * and the outcome feeds the circuit breaker. Success is recorded only after
 * `validate` accepts the body. Well-formed JSON with an unexpected structure is
 * an `invalid_response` failure and counts toward opening the circuit.
 *
 * Open Food Facts search gets one short retry after a transient failure. The retry
 * passes the circuit and global budget again, but not the per-user budget: a provider
 * fault shouldn't use up the user's allowance. Each search counts once for the circuit.
 */
export async function guardedFetchJson(
  op: ProviderOp, userId: string | undefined, url: string, init: RequestInit, validate: ResponseValidator,
): Promise<unknown> {
  const source: ExternalSource = op === "USDA" ? "USDA" : "OPEN_FOOD_FACTS";
  acquire(op, userId);
  try {
    let data: unknown;
    try {
      data = await fetchJson(source, url, init);
    } catch (e) {
      if (op !== "OFF_SEARCH" || !(e instanceof ExternalFoodError) || !e.transient) throw e;
      await new Promise((resolve) => setTimeout(resolve, searchRetryDelayMs()));
      try {
        acquire(op, undefined);
      } catch {
        throw e; // No capacity for a retry: report the failure that actually happened.
      }
      data = await fetchJson(source, url, init);
    }
    if (!validate(data)) {
      throw new ExternalFoodError(source, "invalid_response", "The food database returned an unexpected response.");
    }
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

/** One cache key per meaning: case and runs of spaces don't make a second provider request. */
export const searchKey = (query: string, pageSize: number) => `${query.trim().toLowerCase().replace(/\s+/g, " ")}|${pageSize}`;

/**
 * At most one request in flight per key (FOOD-01). A second identical search while the first is still on its way,
 * from another person or another tab, shares the first one's answer instead of costing another provider request.
 * A failure is shared too, and isn't kept: the next search after it asks again.
 */
export class SingleFlight<V> {
  private pending = new Map<string, Promise<V>>();
  run(key: string, fn: () => Promise<V>): Promise<V> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const p = fn().finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }
  get size() { return this.pending.size; }
}
