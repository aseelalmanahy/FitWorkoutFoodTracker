// Provider HTTP error diagnostics: useful detail reaches the server log with secrets removed,
// and clients keep getting the generic error. Mocked responses only: no network, no database.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { _resetGuard } from "./guard";
import { getOffProduct, searchOff, _resetOffCache } from "./openfoodfacts";
import { publicError } from "./service";
import { ExternalFoodError } from "./types";
import { searchUsda, _resetUsdaCache } from "./usda";

vi.mock("@/lib/server/db", () => ({ prisma: {} }));

const KEY = "Zx9Qw7Er5Ty3Ui1Op0As8Df6Gh4Jk2Lz7Xc5Vb3N"; // sentinel, not a real key
const GENERIC = "The food database returned an error (400).";

let logged: MockInstance<typeof console.error>;
const mockBody = (body: string, status = 400) => vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));
const logLine = () => {
  expect(logged).toHaveBeenCalledTimes(1);
  return String(logged.mock.calls[0][0]);
};
const failedSearch = (q = "chicken breast") => searchUsda(q, "u1").then(
  () => { throw new Error("expected the search to fail"); },
  (e: unknown) => e as ExternalFoodError,
);

beforeEach(() => {
  process.env.FDC_API_KEY = KEY;
  _resetGuard();
  _resetUsdaCache();
  _resetOffCache();
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.FDC_API_KEY;
});

describe("USDA HTTP error logging", () => {
  it("logs the status, the path and the provider's error text, but not the query or request URL", async () => {
    mockBody(JSON.stringify({ error: { code: "BAD_REQUEST", message: "Invalid dataType filter" } }));
    await failedSearch();
    const line = logLine();
    expect(line).toMatch(/^\[foods\] USDA HTTP 400 on \/fdc\/v1\/foods\/search at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z headers=\{.*\}: /);
    expect(line).toContain("BAD_REQUEST");
    expect(line).toContain("Invalid dataType filter");
    for (const leak of [KEY, "chicken", "pageSize", "dataType=", "https://", "X-Api-Key"]) expect(line).not.toContain(leak);
  });

  it("redacts the configured key, URLs, credentials and long tokens from the provider's text", async () => {
    mockBody([
      `key echoed: ${KEY};`,
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=rice&api_key=URLSECRET1`,
      `/fdc/v1/foods/search?api_key=RELATIVESECRET2`,
      `postgresql://fit:DBPASSWORD3@localhost:5432/fitdb`,
      `Authorization: Bearer HEADERSECRET4`,
      `{"password":"JSONSECRET5","token":"JSONSECRET6"}`,
      `x-api-key=HEADERSECRET7`,
      `other ${"a1B2".repeat(12)}`,
      `visible message`,
    ].join(" "));
    await failedSearch();
    const line = logLine();
    for (const leak of [KEY, "URLSECRET1", "RELATIVESECRET2", "DBPASSWORD3", "HEADERSECRET4", "JSONSECRET5", "JSONSECRET6", "HEADERSECRET7", "a1B2a1B2"]) {
      expect(line).not.toContain(leak);
    }
    expect(line).toContain("[redacted]");
    expect(line).toContain("[url]");
    expect(line).toContain("visible message");
  });

  it("redacts a short configured key in plain and URL-encoded form", async () => {
    process.env.FDC_API_KEY = "abc+def/ghi";
    mockBody("plain abc+def/ghi encoded abc%2Bdef%2Fghi done");
    await failedSearch();
    const line = logLine();
    expect(line).not.toContain("abc+def/ghi");
    expect(line).not.toContain("abc%2Bdef%2Fghi");
    expect(line).toContain("done");
  });

  it("limits the length and keeps the entry on one line, leaving no partial key at the cut", async () => {
    // The prefix collapses to 295 characters, so the key would straddle the 300-character cut.
    const prefix = `first\r\nforged [foods] log line\n${"word ".repeat(53)}`;
    mockBody(`${prefix}${KEY}${" tail".repeat(5000)}`);
    await failedSearch();
    const line = logLine();
    const detail = line.slice(line.indexOf(": ") + 2);
    expect(detail).toHaveLength(300);
    expect(detail.startsWith("first forged [foods] log line word")).toBe(true);
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).not.toContain(KEY.slice(0, 5));
  });

  it("logs a placeholder for an empty or unreadable body and still throws the generic error", async () => {
    mockBody("");
    expect((await failedSearch()).message).toBe(GENERIC);
    expect(logLine()).toContain("(empty)");

    logged.mockClear();
    _resetGuard();
    const broken = new ReadableStream<Uint8Array>({ start: (c) => c.error(new Error(`socket failed for ${KEY}`)) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(broken, { status: 400 })));
    const e = await failedSearch("white rice");
    expect([e.kind, e.message]).toEqual(["http", GENERIC]);
    expect(logLine()).toContain("(unreadable)");
    expect(logLine()).not.toContain(KEY);
  });

  it("reads at most 8 KB of an endless body, cancels the rest, and stays sanitized, single-line and generic", async () => {
    const encode = (s: string) => new TextEncoder().encode(s);
    const first = encode(`line one\r\nkey ${KEY} https://api.nal.usda.gov/fdc/v1/foods/search?api_key=URLSECRET1 visible message\n`);
    const filler = encode("x y ".repeat(256)); // 1 KB
    let pulled = 0, cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        const chunk = pulled === 0 ? first : filler;
        pulled += chunk.length;
        c.enqueue(chunk);
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 400 })));

    const e = await failedSearch();

    await vi.waitFor(() => expect(cancelled).toBe(true));
    expect(pulled).toBeLessThanOrEqual(8192 + filler.length);
    expect(pulled).toBeGreaterThan(0);
    const line = logLine();
    const detail = line.slice(line.indexOf(": ") + 2);
    expect(detail.length).toBeLessThanOrEqual(300);
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).toContain("visible message");
    for (const leak of [KEY, "URLSECRET1", "https://"]) expect(line).not.toContain(leak);
    expect([e.kind, e.message]).toEqual(["http", GENERIC]);
    expect(publicError(e)).toEqual({ kind: "http", message: GENERIC });
  });

  it("keeps only 8 KB of one oversized chunk", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode(`${"a ".repeat(4096)}AFTERLIMIT`)); },
      cancel() { cancelled = true; },
    });
    const text = vi.fn();
    const res = new Response(body, { status: 400 });
    vi.spyOn(res, "text").mockImplementation(text);
    vi.stubGlobal("fetch", vi.fn(async () => res));
    await failedSearch();
    await vi.waitFor(() => expect(cancelled).toBe(true));
    expect(text).not.toHaveBeenCalled();
    expect(logLine()).not.toContain("AFTERLIMIT");
  });

  it("leaves no piece of a key that the 8 KB limit splits, even after whitespace collapses", async () => {
    mockBody(`${" ".repeat(8192 - 10)}${KEY} tail`);
    await failedSearch();
    const line = logLine();
    expect(line).toContain("(empty)");
    expect(line).not.toContain(KEY.slice(0, 10));
  });

  it("logs tracing headers from the allowlist only, keeping long request ids but not the key or credentials", async () => {
    const requestId = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const cfId = "A".repeat(56);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503, headers: {
      "X-Request-Id": requestId,
      "X-Amz-Cf-Id": cfId,
      Server: "nginx",
      Via: "1.1 user:VIAPASSWORD@proxy.example",
      "CF-Ray": `ray-${KEY}`,
      "Set-Cookie": "session=COOKIESECRET",
      Authorization: "Bearer AUTHSECRET",
      "WWW-Authenticate": "Basic realm=AUTHSECRET2",
      "X-Api-Key": "HEADERKEYSECRET",
      "X-Custom": "NOTALLOWLISTED",
    } })));
    await failedSearch();
    const line = logLine();
    for (const kept of [`x-request-id=${requestId}`, `x-amz-cf-id=${cfId}`, "server=nginx", "cf-ray=ray-[redacted]"]) expect(line).toContain(kept);
    for (const leak of [KEY, "VIAPASSWORD", "COOKIESECRET", "AUTHSECRET", "HEADERKEYSECRET", "NOTALLOWLISTED", "set-cookie", "authorization"]) {
      expect(line).not.toContain(leak);
    }
  });

  it("logs rate-limit and credential rejections too, with their client errors unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429, headers: { "Retry-After": "120" } })));
    const limited = await failedSearch();
    expect([limited.kind, limited.message, limited.retryAfterMs]).toEqual(["rate_limited", "The food database is rate-limiting requests. Try again shortly.", 120_000]);
    const line = logLine();
    expect(line).toContain("USDA HTTP 429");
    expect(line).toContain("retry-after=120");
    expect(line).toContain("slow down");

    logged.mockClear();
    _resetGuard();
    mockBody(`denied ${KEY}`, 403);
    const denied = await failedSearch("white rice");
    expect([denied.kind, denied.message]).toEqual(["not_configured", "This food database is currently unavailable. Try again later."]);
    const lines = logged.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("USDA HTTP 403");
    expect(lines.join(" ")).not.toContain(KEY);
  });

  it("does not log a provider 404, which is a normal not-found answer", async () => {
    mockBody("not here", 404);
    expect((await failedSearch()).kind).toBe("not_found");
    expect(logged).not.toHaveBeenCalled();
  });
});

describe("Open Food Facts HTTP error logging", () => {
  it("logs provider, status, path, headers and sanitized text, with the same generic client error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`<html><title>Service down</title>${KEY} https://world.openfoodfacts.org/cgi/search.pl?search_terms=nutella</html>`, {
      status: 500, headers: { "X-Request-Id": "off-trace-1", "Set-Cookie": "off=COOKIESECRET" },
    })));
    const e: ExternalFoodError = await searchOff("nutella", "u1").then(() => { throw new Error("expected the search to fail"); }, (x: unknown) => x as ExternalFoodError);
    expect([e.source, e.kind, e.message]).toEqual(["OPEN_FOOD_FACTS", "http", "The food database returned an error (500)."]);
    expect(publicError(e)).toEqual({ kind: "http", message: "The food database returned an error (500)." });
    const line = logLine();
    expect(line).toMatch(/^\[foods\] OPEN_FOOD_FACTS HTTP 500 on \/search at \d{4}-/);
    expect(line).toContain("x-request-id=off-trace-1");
    expect(line).toContain("Service down");
    for (const leak of [KEY, "COOKIESECRET", "nutella", "https://", "search_terms"]) expect(line).not.toContain(leak);
  });

  it("does not log an unknown barcode (a normal 404)", async () => {
    mockBody(JSON.stringify({ status: 0 }), 404);
    await expect(getOffProduct("3017620422003", "u1")).rejects.toMatchObject({ kind: "not_found" });
    expect(logged).not.toHaveBeenCalled();
  });
});

describe("client-facing USDA errors stay generic", () => {
  it("carries no provider text in the thrown error or the public error", async () => {
    mockBody(JSON.stringify({ error: { message: "PROVIDER DETAIL" } }));
    const e = await failedSearch();
    expect(e).toBeInstanceOf(ExternalFoodError);
    expect([e.source, e.kind, e.message]).toEqual(["USDA", "http", GENERIC]);
    expect(publicError(e)).toEqual({ kind: "http", message: GENERIC });
    expect(JSON.stringify(publicError(e))).not.toContain("PROVIDER DETAIL");
    expect(logLine()).toContain("PROVIDER DETAIL");
  });
});
