export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fieldErrors = data?.details?.fieldErrors as Record<string, string[]> | undefined;
    const first = fieldErrors && Object.entries(fieldErrors).find(([, v]) => v?.length);
    const msg = first ? `${first[0]}: ${first[1][0]}` : data?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, data?.details);
  }
  return data as T;
}

/** Parse a decimal input, tolerating commas. Returns NaN for empty input. */
export function parseNum(v: string): number {
  if (v.trim() === "") return NaN;
  return Number(v.replace(",", "."));
}
