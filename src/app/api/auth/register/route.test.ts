// Registration route with its real throttle. The database and cookie store are in-memory fakes:
// no database is touched, and no network is used.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetLoginThrottle } from "@/lib/server/login-throttle";

const fakes = vi.hoisted(() => ({ findUnique: vi.fn(), create: vi.fn(), sessionCreate: vi.fn(), cookieSet: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ prisma: { user: { findUnique: fakes.findUnique, create: fakes.create }, session: { create: fakes.sessionCreate } } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: fakes.cookieSet, get: () => undefined, delete: () => {} }) }));

let POST: (req: NextRequest) => Promise<Response>;
let run = 0;
const register = (headers: Record<string, string> = {}, body: unknown = { email: `user${++run}@example.com`, password: "correct horse battery" }) =>
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
  const throttle = await import("@/lib/server/login-throttle");
  throttle._resetLoginThrottle();
  fakes.findUnique.mockReset().mockResolvedValue(null);
  fakes.create.mockReset().mockImplementation(async ({ data }: { data: { email: string } }) => ({ id: `id-${data.email}`, email: data.email }));
  fakes.sessionCreate.mockReset().mockResolvedValue({});
  fakes.cookieSet.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.TRUST_PROXY_HOPS;
  _resetLoginThrottle();
});

describe("registration", () => {
  it("creates the user with a hashed password and a session", async () => {
    const r = await register({}, { email: "New.User@Example.com", password: "correct horse battery" });
    expect(r.status).toBe(200);
    const { data } = fakes.create.mock.calls[0][0];
    expect(data.email).toBe("new.user@example.com");
    expect(data.passwordHash).toMatch(/^\$argon2id\$/);
    expect(fakes.sessionCreate).toHaveBeenCalledTimes(1);
    expect(fakes.cookieSet.mock.calls[0][0]).toBe("fit_session");
  });

  it("keeps its validation", async () => {
    expect((await register({}, { email: "not-an-email", password: "correct horse battery" })).status).toBe(400);
    expect((await register({}, { email: "a@example.com", password: "short" })).status).toBe(400);
    expect(fakes.create).not.toHaveBeenCalled();
  });

  it("keeps the duplicate-email response", async () => {
    fakes.findUnique.mockResolvedValue({ id: "existing" });
    expect((await register()).status).toBe(409);
    expect(fakes.create).not.toHaveBeenCalled();
  });

  it("rejects a mismatched Origin", async () => {
    expect((await register({ Origin: "https://evil.example" })).status).toBe(403);
    expect(fakes.create).not.toHaveBeenCalled();
  });
});

describe("forged headers without a trusted proxy", () => {
  it("rotating X-Forwarded-For can't create new identities: all callers share one limit", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await register({ "X-Forwarded-For": `10.0.0.${i}`, "X-Real-IP": `10.1.0.${i}` })).status);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
    expect(fakes.create).toHaveBeenCalledTimes(10);
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
  it("refuses hashing while every password-check slot is busy, then recovers", async () => {
    process.env.TRUST_PROXY_HOPS = "1";
    const throttle = await import("@/lib/server/login-throttle");
    const held = Array.from({ length: 14 }, () => throttle.acquirePasswordCheck());
    expect(held.every(Boolean)).toBe(true);
    const r = await register({ "X-Forwarded-For": "203.0.113.1" });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(fakes.create).not.toHaveBeenCalled();
    held.forEach((release) => release!());
    expect((await register({ "X-Forwarded-For": "203.0.113.1" })).status).toBe(200);
  });

  it("releases its slot when hashing's follow-up fails", async () => {
    const throttle = await import("@/lib/server/login-throttle");
    fakes.create.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await register()).status).toBe(500);
    const held = Array.from({ length: 14 }, () => throttle.acquirePasswordCheck());
    expect(held.every(Boolean)).toBe(true); // no slot leaked
    held.forEach((release) => release!());
    vi.restoreAllMocks();
  });

  it("refuses an oversized body with 413 before any database read", async () => {
    const r = await POST(new NextRequest("http://localhost:3000/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", Host: "localhost:3000" },
      body: JSON.stringify({ email: "a@example.com", password: "x".repeat(5_000_000) }),
    }));
    expect(r.status).toBe(413);
    expect(fakes.findUnique).not.toHaveBeenCalled();
    expect(fakes.create).not.toHaveBeenCalled();
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
