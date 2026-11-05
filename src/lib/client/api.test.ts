import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, isUncertainFailure, newIdempotencyKey, parseNum, saveFailureMessage } from "./api";

afterEach(() => vi.unstubAllGlobals());

const respond = (status: number, body: string) => vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));

describe("numbers a person types", () => {
  it.each([["12", 12], ["12.5", 12.5], ["12,5", 12.5], ["0", 0], [".5", 0.5], [",5", 0.5], [" 7 ", 7], ["1,20", 1.2], ["1,2345", 1.2345], ["5.", 5], ["-1", -1], ["+5", 5]])('reads "%s" as %d', (text, value) => {
    expect(parseNum(text as string)).toBe(value);
  });

  it.each(["", "   ", "abc", "12g", "1e3", "0x10", "Infinity", "NaN", "1.2.3", "1,2,3", "1 000", "<1", ".", ","])('refuses "%s"', (text) => {
    expect(parseNum(text)).toBeNaN();
  });

  it.each(["1,200", "12,500", "1,000", "-1,200", "100,000"])('refuses "%s", which could mean a thousand times more or less', (text) => {
    expect(parseNum(text)).toBeNaN();
  });
});

describe("what a failed request says", () => {
  it("no answer is uncertain, and doesn't show the browser's own words", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const err = await api<ApiError>("POST", "/x", {}).catch((e: ApiError) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).not.toMatch(/Failed to fetch/);
    expect(isUncertainFailure(err)).toBe(true);
  });

  it("a success with a cut-off body is uncertain, rather than an empty result", async () => {
    respond(200, '{"entry":');
    const err = await api<ApiError>("POST", "/x", {}).catch((e: ApiError) => e);
    expect(err.status).toBe(0);
  });

  it.each([500, 502, 503, 504])("a %d is uncertain", async (status) => {
    respond(status, "<html>Bad gateway</html>");
    expect(isUncertainFailure(await api<ApiError>("POST", "/x", {}).catch((e: ApiError) => e))).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 413, 422, 429])("a %d is a definite refusal, with the server's reason", async (status) => {
    respond(status, JSON.stringify({ error: "Refused for a reason" }));
    const err = await api<ApiError>("POST", "/x", {}).catch((e: ApiError) => e);
    expect(isUncertainFailure(err)).toBe(false);
    expect(saveFailureMessage(err)).toBe("Refused for a reason");
  });

  it("names the field the server objected to", async () => {
    respond(400, JSON.stringify({ error: "Invalid input", details: { fieldErrors: { quantity: ["Too big"] } } }));
    expect((await api<ApiError>("POST", "/x", {}).catch((e: ApiError) => e)).message).toBe("quantity: Too big");
  });

  it("an uncertain failure says so, and that retrying is safe", () => {
    const text = saveFailureMessage(new ApiError(0, "x"));
    expect(text).toMatch(/can't tell whether this was saved/);
    expect(text).toMatch(/won't save it twice/);
  });
});

describe("requests", () => {
  it("sends the key only when given one, and no headers when there's nothing to send", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await api("POST", "/x", { a: 1 }, { idempotencyKey: "abc" });
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({ "Content-Type": "application/json", "Idempotency-Key": "abc" });
    await api("GET", "/x");
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toBeUndefined();
  });

  it("a timeout counts as no answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (!init.signal) return new Response("{}"); // no deadline: this test must then fail
      return new Promise<Response>((_, fail) => init.signal!.addEventListener("abort", () => fail(init.signal!.reason)));
    }));
    const err = await api<ApiError>("POST", "/x", {}, { timeoutMs: 5 }).catch((e: ApiError) => e);
    expect(err.status).toBe(0);
  });

  it("no deadline is set unless asked for", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await api("GET", "/x");
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeUndefined();
  });

  it("still sends where the browser has no AbortSignal.timeout", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => new Response('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("AbortSignal", class {});
    await expect(api("POST", "/x", {}, { timeoutMs: 5 })).resolves.toEqual({ ok: true });
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeUndefined();
  });

  it("makes a different key each time, in the form the server accepts", () => {
    const [a, b] = [newIdempotencyKey(), newIdempotencyKey()];
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});
