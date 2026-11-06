// Login route with its real throttle and real Argon2 hashing. The database and cookie store are
// in-memory fakes: no database is touched, and no network is used.
import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { _attemptKeyCount, hashPassword, isRateLimited, recordAttempt } from "@/lib/server/auth";
import { _loginThrottleRecordCount, _resetLoginThrottle, _setLoginSleep, beginLoginAttempt, trustedClientId } from "@/lib/server/login-throttle";
import { POST } from "./route";

const fakes = vi.hoisted(() => ({
  findUnique: vi.fn(),
  sessionCreate: vi.fn(),
  cookieSet: vi.fn(),
  cookies: new Map<string, string>(),
  /** What the row holds when the session is stored. Differs from what was read only if it changed meanwhile. */
  storedHash: "",
}));
vi.mock("@/lib/server/db", () => {
  const session = { create: fakes.sessionCreate };
  const tx = { $executeRaw: async () => 0, $queryRaw: async () => [{ passwordHash: fakes.storedHash }], session };
  return { prisma: { user: { findUnique: fakes.findUnique }, session, $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: fakes.cookieSet,
    get: (name: string) => (fakes.cookies.has(name) ? { value: fakes.cookies.get(name) } : undefined),
    delete: () => {},
  }),
}));

const VICTIM = "victim@example.com";
const OTHER = "other@example.com";
const RIGHT = "correct horse battery";
const WRONG = "wrong password here";
const MAX_SPACING_MS = 30_000;
let passwordHash: string;
let waits: number[];

const login = (email: string, password: string, headers: Record<string, string> = {}) => POST(new NextRequest("http://localhost:3000/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", Host: "localhost:3000", ...headers },
  body: JSON.stringify({ email, password }),
}));
const from = (ip: string) => ({ "X-Forwarded-For": ip });
/** Failed logins from one client, leaving enough time between them that account spacing never interferes. */
const fail = async (times: number, email: string, headers: Record<string, string> = {}) => {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) {
    statuses.push((await login(email, WRONG, headers)).status);
    vi.advanceTimersByTime(MAX_SPACING_MS);
  }
  return statuses;
};
const deviceCookie = () => fakes.cookieSet.mock.calls.find((c) => c[0] === "fit_device");
/** Log in once from a browser, so it holds a valid device cookie afterwards. */
const rememberDevice = async (ip: string) => {
  expect((await login(VICTIM, RIGHT, from(ip))).status).toBe(200);
  fakes.cookies.set("fit_device", deviceCookie()![1]);
};

beforeAll(async () => { passwordHash = await hashPassword(RIGHT); });
beforeEach(() => { fakes.storedHash = passwordHash; });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
  process.env.TRUST_PROXY_HOPS = "1";
  delete process.env.APP_ORIGIN;
  _resetLoginThrottle();
  waits = [];
  fakes.cookies.clear();
  _setLoginSleep(async (ms) => { waits.push(ms); vi.advanceTimersByTime(ms); });
  fakes.findUnique.mockReset().mockImplementation(async ({ where }: { where: { email: string } }) =>
    ([VICTIM, OTHER].includes(where.email) ? { id: `id-${where.email}`, email: where.email, passwordHash } : null));
  fakes.sessionCreate.mockReset().mockResolvedValue({});
  fakes.cookieSet.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.TRUST_PROXY_HOPS;
  delete process.env.APP_ORIGIN;
  vi.restoreAllMocks();
});

describe("credentials and sessions", () => {
  it("a password changed during the check counts for nothing: no session, no cookie", async () => {
    fakes.storedHash = "changed by a reset";
    expect((await login(VICTIM, RIGHT)).status).toBe(401);
    expect(fakes.sessionCreate).not.toHaveBeenCalled();
    expect(fakes.cookieSet).not.toHaveBeenCalled();
  });

  it("valid credentials log in and create a server-side session with a secure cookie", async () => {
    const r = await login(VICTIM, RIGHT, from("203.0.113.1"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(fakes.sessionCreate).toHaveBeenCalledTimes(1);
    expect(fakes.sessionCreate.mock.calls[0][0].data.userId).toBe(`id-${VICTIM}`);
    const [name, token, options] = fakes.cookieSet.mock.calls[0];
    expect(name).toBe("fit_session");
    expect(token).not.toBe(fakes.sessionCreate.mock.calls[0][0].data.id); // only a hash is stored
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });

  it("invalid credentials get the same generic 401 for a wrong password and an unknown email", async () => {
    const wrong = await login(VICTIM, WRONG, from("203.0.113.1"));
    const unknown = await login("nobody@example.com", WRONG, from("203.0.113.1"));
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(fakes.sessionCreate).not.toHaveBeenCalled();
  });
});

describe("account lockout resistance", () => {
  it("repeated failures refuse the failing client after 10, with Retry-After", async () => {
    const statuses = await fail(11, VICTIM, from("203.0.113.1"));
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    const over = await login(VICTIM, WRONG, from("203.0.113.1"));
    expect(statuses[10]).toBe(429);
    expect(over.status).toBe(429);
    expect(Number(over.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("a refused client can't get in even with the right password until the window passes", async () => {
    await fail(10, VICTIM, from("203.0.113.1"));
    expect((await login(VICTIM, RIGHT, from("203.0.113.1"))).status).toBe(429);
    expect(fakes.sessionCreate).not.toHaveBeenCalled();
  });

  it("an attacker who knows the email can't lock out the account owner on another client", async () => {
    await fail(12, VICTIM, from("203.0.113.66"));
    expect((await login(VICTIM, WRONG, from("203.0.113.66"))).status).toBe(429);
    vi.advanceTimersByTime(MAX_SPACING_MS);
    const owner = await login(VICTIM, RIGHT, from("198.51.100.7"));
    expect(owner.status).toBe(200);
    expect(fakes.sessionCreate).toHaveBeenCalledTimes(1);
  });

  it("the owner's wait stays short after an attack, and a refused attacker can't extend it", async () => {
    await fail(10, VICTIM, from("203.0.113.66"));
    for (let i = 0; i < 200; i++) await login(VICTIM, WRONG, from("203.0.113.66")); // all refused before the account's queue
    vi.advanceTimersByTime(MAX_SPACING_MS);
    waits = [];
    expect((await login(VICTIM, RIGHT, from("198.51.100.7"))).status).toBe(200);
    expect(Math.max(0, ...waits)).toBeLessThanOrEqual(5000);
  });

  it("a known device logs in at once while an attacker holds the account's queue", async () => {
    await rememberDevice("198.51.100.7");
    fakes.cookies.clear();
    for (let i = 0; i < 12; i++) await login(VICTIM, WRONG, from(`192.0.2.${i + 1}`)); // no time passes: the queue is full
    expect((await login(VICTIM, WRONG, from("192.0.2.50"))).status).toBe(429);

    fakes.cookies.set("fit_device", deviceCookie()![1]);
    waits = [];
    expect((await login(VICTIM, RIGHT, from("198.51.100.7"))).status).toBe(200);
    expect(waits).toEqual([]);
  });

  it("a known device behind the attacker's own IP isn't blocked by that attacker's failures", async () => {
    await rememberDevice("203.0.113.9");
    const cookie = fakes.cookies.get("fit_device")!;
    fakes.cookies.clear();
    await fail(11, VICTIM, from("203.0.113.9"));
    expect((await login(VICTIM, WRONG, from("203.0.113.9"))).status).toBe(429);
    fakes.cookies.set("fit_device", cookie);
    expect((await login(VICTIM, RIGHT, from("203.0.113.9"))).status).toBe(200);
  });
});

describe("known-device cookie", () => {
  it("is httpOnly, Lax, limited to the login path, and grants no access without the password", async () => {
    await rememberDevice("198.51.100.7");
    expect(deviceCookie()![2]).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/api/auth/login" });
    fakes.sessionCreate.mockClear();
    expect((await login(VICTIM, WRONG, from("198.51.100.7"))).status).toBe(401);
    expect(fakes.sessionCreate).not.toHaveBeenCalled();
  });

  it("forged, tampered, expired and other accounts' cookies don't skip the account queue", async () => {
    await rememberDevice("198.51.100.7");
    const good = deviceCookie()![1];
    fakes.cookies.clear();
    for (let i = 0; i < 12; i++) await login(VICTIM, WRONG, from(`192.0.2.${i + 1}`));
    const flipped = `${good.slice(0, -1)}${good.endsWith("0") ? "1" : "0"}`;
    for (const bad of ["junk", "v1.1.abc", `v1.${Date.now()}.${"a".repeat(64)}`, flipped]) {
      fakes.cookies.set("fit_device", bad);
      expect((await login(VICTIM, RIGHT, from("192.0.2.200"))).status).toBe(429);
    }
    fakes.cookies.set("fit_device", good);
    vi.advanceTimersByTime(91 * 24 * 60 * 60 * 1000);
    for (let i = 0; i < 12; i++) await login(VICTIM, WRONG, from(`192.0.2.${i + 100}`));
    expect((await login(VICTIM, RIGHT, from("192.0.2.201"))).status).toBe(429); // expired after 90 days
  });

  it("stops working when the password changes", async () => {
    await rememberDevice("198.51.100.7");
    const newHash = await hashPassword("a brand new password");
    fakes.findUnique.mockImplementation(async ({ where }: { where: { email: string } }) => ({ id: `id-${where.email}`, email: where.email, passwordHash: newHash }));
    for (let i = 0; i < 12; i++) { fakes.cookies.clear(); await login(VICTIM, WRONG, from(`192.0.2.${i + 1}`)); }
    fakes.cookies.set("fit_device", deviceCookie()![1]);
    expect((await login(VICTIM, "a brand new password", from("198.51.100.7"))).status).toBe(429);
  });

  it("a changed timestamp breaks the signature, so an expiry can't be extended or set in the future", async () => {
    await rememberDevice("198.51.100.7");
    const [, , signature] = deviceCookie()![1].split(".");
    fakes.cookies.clear();
    for (let i = 0; i < 12; i++) await login(VICTIM, WRONG, from(`192.0.2.${i + 1}`));
    for (const issuedAt of [Date.now() + 1000, Date.now() + 365 * 24 * 60 * 60 * 1000]) {
      fakes.cookies.set("fit_device", `v1.${issuedAt}.${signature}`);
      expect((await login(VICTIM, RIGHT, from("192.0.2.200"))).status).toBe(429);
    }
  });

  it("holds no email, user id, password or hash", async () => {
    await rememberDevice("198.51.100.7");
    const value = deviceCookie()![1];
    expect(value).toMatch(/^v1\.\d+\.[0-9a-f]{64}$/);
    for (const secret of [VICTIM, `id-${VICTIM}`, RIGHT, passwordHash]) expect(value).not.toContain(secret);
  });

  it("doesn't transfer to another account", async () => {
    await rememberDevice("198.51.100.7");
    const cookie = deviceCookie()![1];
    fakes.cookies.clear();
    for (let i = 0; i < 12; i++) await login(OTHER, WRONG, from(`192.0.2.${i + 1}`));
    fakes.cookies.set("fit_device", cookie);
    expect((await login(OTHER, RIGHT, from("198.51.100.7"))).status).toBe(429);
  });

  it("a known device still has a limit of its own", async () => {
    await rememberDevice("198.51.100.7");
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await login(VICTIM, WRONG, from("198.51.100.7"))).status);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses[10]).toBe(429);
  });

  it("known devices have that limit even without any trusted client address", async () => {
    await rememberDevice("198.51.100.7");
    delete process.env.TRUST_PROXY_HOPS;
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await login(VICTIM, WRONG)).status);
    expect(statuses[10]).toBe(429);
  });
});

describe("brute-force resistance", () => {
  it("failures add progressive delay", async () => {
    const statuses: number[] = [];
    const retries: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await login(VICTIM, WRONG, from(`192.0.2.${i + 1}`));
      statuses.push(r.status);
      if (r.status === 429) retries.push(Number(r.headers.get("Retry-After")));
    }
    expect(waits).toEqual([1000, 2000, 4000]); // held briefly while the wait is short
    expect(statuses.slice(0, 9)).toEqual(Array(9).fill(401));
    expect(statuses.slice(9)).toEqual([429, 429, 429]); // the next wait is 8 s: refused with a time to retry
    expect(retries).toEqual([8, 8, 8]);
  });

  it("distributed guessing from a new client every second gets about 40 attempts per 15 minutes", () => {
    let admitted = 0;
    for (let s = 0; s < 15 * 60; s++) {
      const attempt = beginLoginAttempt(VICTIM, `198.18.${s >> 8}.${s & 255}`);
      if (attempt.allowed) admitted++;
      vi.advanceTimersByTime(1000);
    }
    expect(admitted).toBeGreaterThan(5);
    expect(admitted).toBeLessThanOrEqual(45);
  });

  it("the same rate holds with no trusted client identity at all", () => {
    delete process.env.TRUST_PROXY_HOPS;
    let admitted = 0;
    for (let s = 0; s < 15 * 60; s++) {
      if (beginLoginAttempt(VICTIM, null).allowed) admitted++;
      vi.advanceTimersByTime(1000);
    }
    expect(admitted).toBeLessThanOrEqual(45);
  });

  it("a parallel burst can't all reach the password check: the limit counts before it runs", async () => {
    _setLoginSleep(async () => {}); // nothing advances the clock during the burst
    const results = await Promise.all(Array.from({ length: 40 }, () => login(VICTIM, WRONG, from("203.0.113.1"))));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(10);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(30);
    expect(fakes.findUnique.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it("password spraying: one client is refused after 100 failures across different accounts", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 101; i++) statuses.push((await login(`user${i}@example.com`, WRONG, from("203.0.113.1"))).status);
    expect(statuses.slice(0, 100)).toEqual(Array(100).fill(401));
    expect(statuses[100]).toBe(429);
    expect((await login("user500@example.com", WRONG, from("198.51.100.7"))).status).toBe(401);
  });

  it("no more than 14 password checks run at once for unrecognized clients, and a refused attempt isn't counted", async () => {
    let finish: (v: null) => void = () => {};
    const gate = new Promise<null>((resolve) => { finish = resolve; });
    fakes.findUnique.mockImplementation(() => gate);
    const pending = Array.from({ length: 20 }, (_, i) => login(`load${i}@example.com`, WRONG, from(`198.18.0.${i + 1}`)));
    await vi.waitFor(() => expect(fakes.findUnique.mock.calls.length).toBe(14));
    await new Promise((r) => setImmediate(r));
    expect(fakes.findUnique.mock.calls.length).toBe(14);
    finish(null);
    const statuses = (await Promise.all(pending)).map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBe(14);
    expect(statuses.filter((s) => s === 429).length).toBe(6);
    fakes.findUnique.mockResolvedValue(null);
    expect((await login("load19@example.com", WRONG, from("198.18.0.20"))).status).toBe(401); // slots were released
  });
});

describe("shared IP addresses", () => {
  it("one person's failures don't refuse someone else's account from the same address", async () => {
    await fail(10, VICTIM, from("203.0.113.5"));
    expect((await login(VICTIM, WRONG, from("203.0.113.5"))).status).toBe(429);
    expect((await login(OTHER, RIGHT, from("203.0.113.5"))).status).toBe(200);
  });

  it("the whole address is refused only after 100 failures across accounts", async () => {
    for (let i = 0; i < 99; i++) await login(`shared${i}@example.com`, WRONG, from("203.0.113.5"));
    expect((await login(OTHER, RIGHT, from("203.0.113.5"))).status).toBe(200);
    await login("shared99@example.com", WRONG, from("203.0.113.5"));
    expect((await login(OTHER, RIGHT, from("203.0.113.5"))).status).toBe(429);
  });
});

describe("bypass attempts", () => {
  it("email capitalization and surrounding spaces count as the same account", async () => {
    const forms = [VICTIM, VICTIM.toUpperCase(), "Victim@Example.com", `  ${VICTIM}  `];
    for (let i = 0; i < 10; i++) {
      expect((await login(forms[i % forms.length], WRONG, from("203.0.113.1"))).status).toBe(401);
      vi.advanceTimersByTime(MAX_SPACING_MS);
    }
    for (const form of forms) expect((await login(form, WRONG, from("203.0.113.1"))).status).toBe(429);
  });

  it("forged X-Forwarded-For entries to the left of the proxy's entry don't create a new client", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await login(VICTIM, WRONG, from(`10.9.8.${i}, 203.0.113.1`))).status).toBe(401);
      vi.advanceTimersByTime(MAX_SPACING_MS);
    }
    expect((await login(VICTIM, WRONG, from("1.2.3.4, 5.6.7.8, 203.0.113.1"))).status).toBe(429);
  });

  it("other client-controlled headers are ignored", async () => {
    await fail(10, VICTIM, from("203.0.113.1"));
    const r = await login(VICTIM, WRONG, { ...from("203.0.113.1"), "X-Real-IP": "9.9.9.9", "CF-Connecting-IP": "9.9.9.9", "True-Client-IP": "9.9.9.9", Forwarded: "for=9.9.9.9" });
    expect(r.status).toBe(429);
  });

  it("the address read depends on the configured number of proxies", () => {
    const headers = new Headers(from("1.1.1.1, 2.2.2.2, 3.3.3.3"));
    process.env.TRUST_PROXY_HOPS = "1";
    expect(trustedClientId(headers)).toBe("3.3.3.3");
    process.env.TRUST_PROXY_HOPS = "2";
    expect(trustedClientId(headers)).toBe("2.2.2.2");
    process.env.TRUST_PROXY_HOPS = "4"; // fewer entries than proxies: the proxy chain was bypassed
    expect(trustedClientId(headers)).toBeNull();
    for (const invalid of ["0", "", "-1", "1.5", "true"]) {
      process.env.TRUST_PROXY_HOPS = invalid;
      expect(trustedClientId(headers)).toBeNull();
    }
  });

  it("an invalid proxy entry gives no identity, and IPv6 is grouped by /64 with mapped IPv4 unified", () => {
    const id = (xff: string) => trustedClientId(new Headers(from(xff)));
    expect(id("not-an-ip")).toBeNull();
    expect(id("")).toBeNull();
    expect(id("2001:db8:1:2:aaaa::1")).toBe(id("2001:db8:1:2:bbbb:cccc:dddd:eeee"));
    expect(id("2001:db8:1:2::1")).not.toBe(id("2001:db8:1:3::1"));
    expect(id("::ffff:203.0.113.1")).toBe("203.0.113.1");
    expect(id("::ffff:cb00:7101")).toBe("203.0.113.1");
    expect(id("2001:DB8:1:2::1")).toBe(id("2001:db8:1:2::1"));
  });

  it("without TRUST_PROXY_HOPS, rotating forged headers gives no new identity and spacing still applies", async () => {
    delete process.env.TRUST_PROXY_HOPS;
    for (let i = 0; i < 8; i++) await login(VICTIM, WRONG, from(`10.0.0.${i}`));
    expect(waits).toEqual([1000, 2000]);
    vi.advanceTimersByTime(MAX_SPACING_MS);
    expect((await login(VICTIM, RIGHT, from("10.0.0.99"))).status).toBe(200);
  });

  it("without TRUST_PROXY_HOPS, a parallel flood is limited by the account queue, not a long lockout", async () => {
    delete process.env.TRUST_PROXY_HOPS;
    _setLoginSleep(async () => {});
    const flood = await Promise.all(Array.from({ length: 30 }, () => login(VICTIM, WRONG)));
    expect(flood.filter((r) => r.status === 429).length).toBeGreaterThan(0);
    expect(fakes.findUnique.mock.calls.length).toBeLessThan(30);
    vi.advanceTimersByTime(MAX_SPACING_MS + 1000); // the queue clears within seconds, not 15 minutes
    expect((await login(VICTIM, RIGHT)).status).toBe(200);
  });
});

describe("incorrect proxy configuration", () => {
  it("too low a TRUST_PROXY_HOPS can't turn a proxy's internal address into one shared identity", async () => {
    for (const internal of ["10.1.2.3", "172.16.0.9", "172.31.255.1", "192.168.1.1", "127.0.0.1", "169.254.0.5", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(trustedClientId(new Headers(from(`203.0.113.1, ${internal}`)))).toBeNull();
    }
    expect(trustedClientId(new Headers(from("172.32.0.1")))).toBe("172.32.0.1"); // just outside the private range
    for (let i = 0; i < 12; i++) {
      await login(VICTIM, WRONG, from("10.1.2.3"));
      vi.advanceTimersByTime(MAX_SPACING_MS);
    }
    expect((await login(VICTIM, RIGHT, from("10.1.2.3"))).status).toBe(200); // no per-client refusal on that address
  });

  it("warns once in production when no client address can be trusted, without logging addresses", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    delete process.env.TRUST_PROXY_HOPS;
    trustedClientId(new Headers(from("203.0.113.1")));
    trustedClientId(new Headers(from("203.0.113.2")));
    expect(warn).toHaveBeenCalledTimes(1);
    process.env.TRUST_PROXY_HOPS = "3";
    trustedClientId(new Headers(from("203.0.113.1")));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("203.0.113");
    vi.unstubAllEnvs();
  });
});

describe("origin validation", () => {
  const withOrigin = (headers: Record<string, string>) => POST(new NextRequest("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: "app.example", ...headers },
    body: JSON.stringify({ email: VICTIM, password: RIGHT }),
  }));

  it("requires an Origin that matches the Host", async () => {
    expect((await withOrigin({ Origin: "https://app.example" })).status).toBe(200);
    expect((await withOrigin({ Origin: "https://evil.example" })).status).toBe(403);
    expect((await withOrigin({})).status).toBe(403);
    expect((await withOrigin({ Origin: "null" })).status).toBe(403);
    expect((await withOrigin({ Origin: "not a url" })).status).toBe(403);
  });

  it("ignores a forged X-Forwarded-Host when no proxy is trusted", async () => {
    delete process.env.TRUST_PROXY_HOPS;
    expect((await withOrigin({ Origin: "https://evil.example", "X-Forwarded-Host": "evil.example" })).status).toBe(403);
    expect((await withOrigin({ Origin: "https://app.example", "X-Forwarded-Host": "evil.example" })).status).toBe(200);
  });

  it("with trusted proxies, reads the proxy's entry and ignores entries to its left", async () => {
    expect((await withOrigin({ Origin: "https://public.example", "X-Forwarded-Host": "public.example" })).status).toBe(200);
    expect((await withOrigin({ Origin: "https://evil.example", "X-Forwarded-Host": "evil.example, public.example" })).status).toBe(403);
    expect((await withOrigin({ Origin: "https://public.example", "X-Forwarded-Host": "evil.example, public.example" })).status).toBe(200);
  });

  it("APP_ORIGIN is an exact match that no request header can change", async () => {
    process.env.APP_ORIGIN = "https://app.example/";
    expect((await withOrigin({ Origin: "https://app.example" })).status).toBe(200);
    expect((await withOrigin({ Origin: "https://evil.example", "X-Forwarded-Host": "evil.example", Host: "evil.example" })).status).toBe(403);
    expect((await withOrigin({ Origin: "http://app.example" })).status).toBe(403); // the scheme must match too
  });
});

describe("windows and successful logins", () => {
  it("a refusal expires when the 15-minute window passes", async () => {
    await fail(10, VICTIM, from("203.0.113.1"));
    expect((await login(VICTIM, WRONG, from("203.0.113.1"))).status).toBe(429);
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect((await login(VICTIM, RIGHT, from("203.0.113.1"))).status).toBe(200);
  });

  it("Retry-After matches the time left in the window", async () => {
    await fail(10, VICTIM, from("203.0.113.1"));
    vi.setSystemTime(Date.now() + 60_000);
    const seconds = Number((await login(VICTIM, WRONG, from("203.0.113.1"))).headers.get("Retry-After"));
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(15 * 60);
  });

  it("a success resets only that client's count for that account", async () => {
    await fail(9, VICTIM, from("203.0.113.1"));
    await fail(9, VICTIM, from("203.0.113.2"));
    expect((await login(VICTIM, RIGHT, from("203.0.113.1"))).status).toBe(200);
    fakes.cookies.clear();
    vi.advanceTimersByTime(MAX_SPACING_MS);
    await fail(9, VICTIM, from("203.0.113.1")); // its count was reset
    await fail(1, VICTIM, from("203.0.113.2")); // the 10th for this client
    expect((await login(VICTIM, WRONG, from("203.0.113.2"))).status).toBe(429);
  });

  it("logging into your own account doesn't reset your limit on a different account", async () => {
    await fail(10, VICTIM, from("203.0.113.66"));
    expect((await login(OTHER, RIGHT, from("203.0.113.66"))).status).toBe(200);
    expect((await login(VICTIM, WRONG, from("203.0.113.66"))).status).toBe(429);
  });

  it("logging into your own account doesn't reset your limit across accounts", async () => {
    for (let i = 0; i < 100; i++) await login(`spray${i}@example.com`, WRONG, from("203.0.113.66"));
    expect((await login(OTHER, RIGHT, from("203.0.113.66"))).status).toBe(429);
  });

  it("a database failure isn't counted as a failed password", async () => {
    fakes.findUnique.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 20; i++) expect((await login(VICTIM, RIGHT, from("203.0.113.1"))).status).toBe(500);
    fakes.findUnique.mockResolvedValue({ id: "id-victim", email: VICTIM, passwordHash });
    expect((await login(VICTIM, RIGHT, from("203.0.113.1"))).status).toBe(200);
  });
});

describe("information leakage", () => {
  it("throttling behaves identically for an existing and an unknown email", async () => {
    const run = async (email: string, ip: string) => {
      waits = [];
      const statuses = await fail(11, email, from(ip));
      const over = await login(email, WRONG, from(ip));
      return { statuses, waits, status: over.status, body: await over.json(), retry: over.headers.get("Retry-After") };
    };
    const existing = await run(VICTIM, "203.0.113.1");
    _resetLoginThrottle();
    vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
    const unknown = await run("nobody@example.com", "203.0.113.1");
    expect(unknown).toEqual(existing);
    expect(existing.body).toEqual({ error: "Too many attempts. Try again later." });
  });

  it("a device cookie on an unknown email changes nothing, and an unknown email gets no cookie", async () => {
    fakes.cookies.set("fit_device", `v1.${Date.now()}.${"a".repeat(64)}`);
    expect((await login("nobody@example.com", RIGHT, from("203.0.113.1"))).status).toBe(401);
    expect(fakes.cookieSet).not.toHaveBeenCalled();
  });
});

describe("flooding", () => {
  const pendingLoad = (count: number) => {
    let finish: (v: null) => void = () => {};
    const gate = new Promise<null>((resolve) => { finish = resolve; });
    const real = fakes.findUnique.getMockImplementation()!;
    fakes.findUnique.mockImplementation((args: { where: { email: string } }) => (args.where.email.startsWith("load") ? gate : real(args)));
    const requests = Array.from({ length: count }, (_, i) => login(`load${i}@example.com`, WRONG, from(`198.18.0.${i + 1}`)));
    return { requests, finish: () => finish(null) };
  };

  it("flooding unique emails can't evict a victim's spacing and reset the guessing limit", () => {
    for (let i = 0; i < 8; i++) {
      beginLoginAttempt(VICTIM, `198.18.1.${i + 1}`);
      vi.advanceTimersByTime(40_000);
    }
    for (let i = 0; i < 60_000; i++) beginLoginAttempt(`flood${i}@example.com`, null);
    const next = beginLoginAttempt(VICTIM, "198.18.1.100");
    const after = beginLoginAttempt(VICTIM, "198.18.1.101");
    expect(next.allowed).toBe(true);
    expect(after.allowed && after.waitMs > 0 || !after.allowed).toBe(true); // spacing survived the flood
  });

  it("flooding unique emails can't evict a refused client's record", async () => {
    await fail(10, VICTIM, from("203.0.113.1"));
    for (let i = 0; i < 60_000; i++) beginLoginAttempt(`flood${i}@example.com`, null);
    expect((await login(VICTIM, WRONG, from("203.0.113.1"))).status).toBe(429);
  });

  it("while every password-check slot is busy, a flood is refused without creating any records", async () => {
    const load = pendingLoad(14);
    await vi.waitFor(() => expect(fakes.findUnique.mock.calls.length).toBe(14));
    const before = _loginThrottleRecordCount();
    const flood = await Promise.all(Array.from({ length: 200 }, (_, i) => login(`flood${i}@example.com`, WRONG)));
    expect(flood.every((r) => r.status === 429)).toBe(true);
    expect(_loginThrottleRecordCount()).toBe(before);
    load.finish();
    await Promise.all(load.requests);
  });

  it("a flood filling the slots for unrecognized clients leaves room for a known device", async () => {
    await rememberDevice("198.51.100.7");
    const cookie = fakes.cookies.get("fit_device")!;
    fakes.cookies.clear();
    const load = pendingLoad(14);
    await vi.waitFor(() => expect(fakes.findUnique.mock.calls.filter((c) => c[0].where.email.startsWith("load")).length).toBe(14));
    expect((await login(OTHER, RIGHT, from("198.51.100.8"))).status).toBe(429); // a new browser waits
    fakes.cookies.set("fit_device", cookie);
    expect((await login(VICTIM, RIGHT, from("198.51.100.7"))).status).toBe(200);
    load.finish();
    await Promise.all(load.requests);
  });

  const oversized = (size: number, extra: Record<string, string> = {}) => new NextRequest("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", Host: "localhost:3000", ...extra },
    body: JSON.stringify({ email: VICTIM, password: "x".repeat(size) }),
  });

  it("an oversized body is refused with 413, before any database read or password check", async () => {
    const r = await POST(oversized(5_000_000));
    expect(r.status).toBe(413);
    expect(await r.json()).toEqual({ error: "Request body is too large" });
    expect(fakes.findUnique).not.toHaveBeenCalled();
  });

  it("an oversized chunked body with no Content-Length stops being read at the limit", async () => {
    let sent = 0, cancelled = false;
    const chunk = new TextEncoder().encode("x".repeat(1024));
    const stream = new ReadableStream<Uint8Array>({
      pull(c) { sent += chunk.length; c.enqueue(chunk); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const req = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST", body: stream, duplex: "half",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", Host: "localhost:3000" },
    } as ConstructorParameters<typeof NextRequest>[1]);
    expect((await POST(req)).status).toBe(413);
    await vi.waitFor(() => expect(cancelled).toBe(true));
    expect(sent).toBeLessThanOrEqual(16 * 1024);
    expect(fakes.findUnique).not.toHaveBeenCalled();
  });

  it("the largest valid credentials still fit, including multi-byte passwords", async () => {
    const r = await login(VICTIM, "é".repeat(256), from("203.0.113.1"));
    expect(r.status).toBe(401);
    expect((await POST(new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST", body: "{not json",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", Host: "localhost:3000" },
    }))).status).toBe(400);
  });
});

describe("memory", () => {
  it("rate-limit records stay bounded when flooded with unique emails and clients", () => {
    for (let i = 0; i < 60_000; i++) beginLoginAttempt(`flood${i}@example.com`, `11.${i >> 16}.${(i >> 8) & 255}.${i & 255}`);
    expect(_loginThrottleRecordCount()).toBeLessThanOrEqual(50_000);
  }, 30_000);

  it("registration throttle keys stay bounded when flooded with unique values, and its limit still works", () => {
    for (let i = 0; i < 60_000; i++) {
      const key = `register:spoofed-${i}`;
      if (!isRateLimited(key)) recordAttempt(key);
    }
    expect(_attemptKeyCount()).toBeLessThanOrEqual(50_000);
    for (let i = 0; i < 10; i++) {
      expect(isRateLimited("register:one-client")).toBe(false);
      recordAttempt("register:one-client");
    }
    expect(isRateLimited("register:one-client")).toBe(true);
  });
});
