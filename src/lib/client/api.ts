export class ApiError extends Error {
  /** `status` is 0 when no usable answer arrived: the request may or may not have been processed. */
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export interface ApiOptions {
  /** One per deliberate save, kept across retries of it. The server turns it into a unique value, so a retry can't save twice. */
  idempotencyKey?: string;
  timeoutMs?: number;
}

const NO_ANSWER = "Couldn't reach the server. Check your connection and try again.";

/** Long enough for a save that has to refresh a food from its source first. */
export const SAVE_TIMEOUT_MS = 30_000;

/** For every sign-in, sign-up and password call. */
export const AUTH_TIMEOUT_MS = 15_000;

export async function api<T = unknown>(method: string, url: string, body?: unknown, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
  };
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      // Older Safari lacks this. A save there just has no client deadline, and the browser's own applies.
      ...(options.timeoutMs && typeof AbortSignal.timeout === "function" ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
    });
  } catch {
    throw new ApiError(0, NO_ANSWER);
  }
  let parsed = true;
  const data = await res.json().catch(() => { parsed = false; return {}; });
  if (!res.ok) {
    const fieldErrors = data?.details?.fieldErrors as Record<string, string[]> | undefined;
    const first = fieldErrors && Object.entries(fieldErrors).find(([, v]) => v?.length);
    const msg = first ? `${first[0]}: ${first[1][0]}` : data?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, data?.details);
  }
  // Every route answers with JSON, so a success with a cut-off body says nothing about the outcome.
  if (!parsed) throw new ApiError(0, NO_ANSWER);
  return data as T;
}

/**
 * Strict on purpose, as this number can become nutrition or a diary amount. Empty or anything unclear
 * is NaN, for the caller to refuse. "1,200" could mean 1.2 or 1200, so it's refused rather than guessed,
 * and so are forms like 1e3 and 0x10. A decimal comma such as "12,5" is accepted.
 */
export function parseNum(v: string): number {
  const text = v.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) return NaN;
  if (/^[+-]?\d+,\d{3}$/.test(text)) return NaN;
  return Number(text.replace(",", "."));
}

/** Random enough for its purpose, and works without HTTPS, unlike crypto.randomUUID. */
export function newIdempotencyKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** No answer, or a server failure, says nothing about whether the work was done. */
export const isUncertainFailure = (err: unknown) => err instanceof ApiError && (err.status === 0 || err.status >= 500);

/** For a save sent with an idempotency key, which is what makes the advice to retry true. */
export function saveFailureMessage(err: unknown): string {
  if (isUncertainFailure(err)) return "We can't tell whether this was saved. Everything you entered is still here, and trying again won't save it twice.";
  return err instanceof Error ? err.message : "This couldn't be saved. Try again.";
}
