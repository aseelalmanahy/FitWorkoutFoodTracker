// The registration route's request side, with its real throttle. What happens after the response is in
// src/lib/server/account/access.test.ts. No database is touched, and no network is used.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/server/account/access", () => ({ requestSignupLink: fakes.request }));
vi.mock("@/lib/server/db", () => ({ prisma: {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => {}, get: () => undefined, delete: () => {} }) }));

let POST: (req: NextRequest) => Promise<Response>;
let run = 0;
const register = (headers: Record<string, string> = {}, body: unknown = { email: `user${++run}@example.com` }) =>
  POST(new NextRequest("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", Host: "localhost:3000", ...headers },
    body: JSON.stringify(body),
  }));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
  delete process.env.TRUST_PROXY_HOPS;
  vi.resetModules(); // the registration counters live in the auth module
  ({ POST } = await import("./route"));
  fakes.request.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.TRUST_PROXY_HOPS;
});

describe("registration", () => {
  it("asks for a link with the normalized address, and sets no cookie", async () => {
    const r = await register({}, { email: "New.User@Example.com" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(fakes.request).toHaveBeenCalledWith("new.user@example.com");
  });

  it("keeps its validation", async () => {
    expect((await register({}, { email: "not-an-email" })).status).toBe(400);
    expect((await register({}, {})).status).toBe(400);
    expect(fakes.request).not.toHaveBeenCalled();
  });

  it("passes on nothing but the address, so a password can't be sent this way", async () => {
    await register({}, { email: "a@example.com", password: "correct horse battery" });
    expect(fakes.request.mock.calls).toEqual([["a@example.com"]]);
  });

  it("rejects a mismatched Origin", async () => {
    expect((await register({ Origin: "https://evil.example" })).status).toBe(403);
    expect(fakes.request).not.toHaveBeenCalled();
  });
});

describe("forged headers without a trusted proxy", () => {
  it("rotating X-Forwarded-For can't create new identities: all callers share one limit", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await register({ "X-Forwarded-For": `10.0.0.${i}`, "X-Real-IP": `10.1.0.${i}` })).status);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
    expect(fakes.request).toHaveBeenCalledTimes(10);
  });

  it("an invalid TRUST_PROXY_HOPS is treated as no trusted proxy", async () => {
    process.env.TRUST_PROXY_HOPS = "yes";
    for (let i = 0; i < 10; i++) await register({ "X-Forwarded-For": `203.0.113.${i}` });
    expect((await register({ "X-Forwarded-For": "203.0.113.99" })).status).toBe(429);
  });
});

describe("with a trusted proxy", () => {
  beforeEach(() => { process.env.TRUST_PROXY_HOPS = "1"; });

  it("limits each client separately, so one client doesn't block another", async () => {
    for (let i = 0; i < 10; i++) await register({ "X-Forwarded-For": "203.0.113.1" });
    expect((await register({ "X-Forwarded-For": "203.0.113.1" })).status).toBe(429);
    expect((await register({ "X-Forwarded-For": "198.51.100.7" })).status).toBe(200);
  });

  it("forged entries to the left of the proxy's entry don't bypass the limit", async () => {
    for (let i = 0; i < 10; i++) expect((await register({ "X-Forwarded-For": `1.2.3.${i}, 203.0.113.1` })).status).toBe(200);
    expect((await register({ "X-Forwarded-For": "9.9.9.9, 203.0.113.1" })).status).toBe(429);
  });

  it("a proxy's internal address or a short chain falls back to the shared limit, not a per-header identity", async () => {
    for (let i = 0; i < 5; i++) await register({ "X-Forwarded-For": `10.0.0.${i}` });
    for (let i = 0; i < 5; i++) await register();
    expect((await register({ "X-Forwarded-For": "192.168.0.1" })).status).toBe(429);
  });
});

describe("resource limits", () => {
  it("refuses an oversized body with 413 before anything is queued", async () => {
    const r = await POST(new NextRequest("http://localhost:3000/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", Host: "localhost:3000" },
      body: JSON.stringify({ email: "a@example.com", password: "x".repeat(5_000_000) }),
    }));
    expect(r.status).toBe(413);
    expect(fakes.request).not.toHaveBeenCalled();
  });
});

describe("windows", () => {
  it("the limit expires after 15 minutes", async () => {
    for (let i = 0; i < 10; i++) await register();
    expect((await register()).status).toBe(429);
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect((await register()).status).toBe(200);
  });
});
