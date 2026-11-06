// Phase 4.0.4: sign-up, recovery and change-password through their real routes, with real Argon2 and the real queue.
// The database, cookies and mail provider are in-memory fakes, so no database or network is touched.
// LIMIT: the fake runs one transaction at a time, so it shows the logic and can't prove a database race. Real races and
// locks are in scripts/account-tokens.test.cjs, which needs MIG-03 applied.
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetAttempts, hashPassword } from "@/lib/server/auth";
import { _resetLoginThrottle, acquirePasswordCheck } from "@/lib/server/login-throttle";
import { JOB_DEADLINE_MS, _accountJobsIdle, enqueueAccountJob } from "@/lib/server/mail/queue";
import { MailRejected, type MailMessage } from "@/lib/server/mail/transport";

type Row = Record<string, unknown>;
const f = vi.hoisted(() => ({
  users: [] as Row[],
  sessions: [] as Row[],
  tokens: [] as Row[],
  /** Every database call, to show when lookups happen. */
  calls: [] as string[],
  sent: [] as MailMessage[],
  send: null as null | ((m: MailMessage, s: AbortSignal) => Promise<void>),
  /** Runs just before a transaction, to stand in for something committing during the slow password hash. */
  beforeTransaction: null as null | (() => void),
  cookies: new Map<string, string>(),
  cookieSets: [] as string[],
  cookieDeletes: [] as string[],
}));

vi.mock("@/lib/server/db", () => {
  const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([key, want]) => {
    if (key === "OR") return (want as Row[]).some((w) => matches(row, w));
    if (want && typeof want === "object" && !(want instanceof Date)) {
      const c = want as { gt?: Date; lte?: Date };
      const have = (row[key] as Date).getTime();
      return (c.gt === undefined || have > c.gt.getTime()) && (c.lte === undefined || have <= c.lte.getTime());
    }
    return row[key] === want;
  });
  const removeWhere = (list: Row[], where: Row) => {
    const before = list.length;
    for (let i = list.length - 1; i >= 0; i--) if (matches(list[i], where)) list.splice(i, 1);
    return { count: before - list.length };
  };
  const log = (name: string) => f.calls.push(name);
  const db = {
    user: {
      findUnique: async ({ where }: { where: Row }) => { log("user.findUnique"); return f.users.find((u) => matches(u, where)) ?? null; },
      create: async ({ data }: { data: Row }) => {
        log("user.create");
        if (f.users.some((u) => u.email === data.email)) {
          const { Prisma } = await import("@prisma/client");
          throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
        }
        const user = { id: `user-${f.users.length + 1}`, ...data };
        f.users.push(user);
        return user;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => { log("user.update"); return Object.assign(f.users.find((u) => matches(u, where))!, data); },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        log("user.updateMany");
        const found = f.users.filter((u) => matches(u, where));
        found.forEach((u) => Object.assign(u, data));
        return { count: found.length };
      },
      delete: async ({ where }: { where: Row }) => { log("user.delete"); return removeWhere(f.users, where); },
    },
    session: {
      findUnique: async ({ where }: { where: Row }) => {
        log("session.findUnique");
        const s = f.sessions.find((x) => matches(x, where));
        return s ? { ...s, user: f.users.find((u) => u.id === s.userId) } : null;
      },
      create: async ({ data }: { data: Row }) => { log("session.create"); f.sessions.push({ ...data }); return data; },
      deleteMany: async ({ where }: { where: Row }) => { log("session.deleteMany"); return removeWhere(f.sessions, where); },
      delete: async ({ where }: { where: Row }) => removeWhere(f.sessions, where),
    },
    accountToken: {
      findFirst: async ({ where }: { where: Row }) => { log("accountToken.findFirst"); return f.tokens.find((t) => matches(t, where)) ?? null; },
      findMany: async ({ where }: { where: Row }) => { log("accountToken.findMany"); return f.tokens.filter((t) => matches(t, where)); },
      count: async ({ where }: { where: Row }) => { log("accountToken.count"); return f.tokens.filter((t) => matches(t, where)).length; },
      create: async ({ data }: { data: Row }) => { log("accountToken.create"); f.tokens.push({ createdAt: new Date(), ...data }); return data; },
      deleteMany: async ({ where }: { where: Row }) => { log("accountToken.deleteMany"); return removeWhere(f.tokens, where); },
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      log(`raw:${/FOR (UPDATE|SHARE)/.exec(strings.join("?"))?.[0] ?? "other"}`);
      return f.users.filter((u) => u.id === values[0]);
    },
  };
  const others = new Proxy({}, { get: () => ({ deleteMany: async () => ({ count: 0 }) }) });
  const all = new Proxy(db as Row, { get: (t, k: string) => t[k] ?? (others as Row)[k] });
  let chain: Promise<unknown> = Promise.resolve();
  const $transaction = (fn: (tx: unknown) => Promise<unknown>) => {
    const run = async () => {
      f.beforeTransaction?.();
      f.beforeTransaction = null;
      const saved = [[...f.users.map((u) => ({ ...u }))], [...f.sessions.map((s) => ({ ...s }))], [...f.tokens.map((t) => ({ ...t }))]] as Row[][];
      try {
        return await fn(all);
      } catch (err) {
        f.users.splice(0, f.users.length, ...saved[0]);
        f.sessions.splice(0, f.sessions.length, ...saved[1]);
        f.tokens.splice(0, f.tokens.length, ...saved[2]);
        throw err;
      }
    };
    const result = chain.then(run, run);
    chain = result.catch(() => {});
    return result;
  };
  return { prisma: new Proxy(all as Row, { get: (t, k: string) => (k === "$transaction" ? $transaction : t[k]) }) };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (f.cookies.has(name) ? { value: f.cookies.get(name) } : undefined),
    set: (name: string, value: string) => { f.cookies.set(name, value); f.cookieSets.push(name); },
    delete: (c: string | { name: string }) => {
      const name = typeof c === "string" ? c : c.name;
      f.cookies.delete(name);
      f.cookieDeletes.push(name);
    },
  }),
}));
vi.mock("@/lib/server/mail/transport", async (original) => ({
  ...(await original<object>()),
  mailTransport: () => ({ send: (m: MailMessage, s: AbortSignal) => { f.sent.push(m); return f.send ? f.send(m, s) : Promise.resolve(); } }),
}));

const routes = {
  register: () => import("@/app/api/auth/register/route"),
  complete: () => import("@/app/api/auth/register/complete/route"),
  forgot: () => import("@/app/api/auth/password/forgot/route"),
  reset: () => import("@/app/api/auth/password/reset/route"),
  login: () => import("@/app/api/auth/login/route"),
  change: () => import("@/app/api/account/password/route"),
};
const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct horse battery";
const NEW_PASSWORD = "a different long passphrase";
let client = 0;
let origin = ORIGIN;

async function post(name: keyof typeof routes, body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await routes[name]();
  const req = new NextRequest(`${ORIGIN}/api/x`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, Host: "localhost:3000", "X-Forwarded-For": `203.0.113.${++client % 250}`, ...headers },
    body: JSON.stringify(body),
  });
  return (POST as (r: NextRequest, c: unknown) => Promise<Response>)(req, { params: Promise.resolve({}) });
}
const tokenIn = (m: MailMessage) => /#token=([A-Za-z0-9_-]{43})/.exec(m.text)![1];
const lastToken = () => tokenIn(f.sent.filter((m) => m.kind !== "password-changed").at(-1)!);
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

async function askSignup(email: string) {
  expect((await post("register", { email })).status).toBe(200);
  await _accountJobsIdle();
  return lastToken();
}
async function askReset(email: string) {
  expect((await post("forgot", { email })).status).toBe(200);
  await _accountJobsIdle();
  return lastToken();
}
async function makeUser(email = "owner@example.com", password = PASSWORD) {
  const user = { id: `user-${f.users.length + 1}`, email, passwordHash: await hashPassword(password) };
  f.users.push(user);
  return user;
}
function signIn(userId: string, token = `session-${f.sessions.length}`) {
  f.sessions.push({ id: hash(token), userId, expiresAt: new Date(Date.now() + 3_600_000) });
  f.cookies.set("fit_session", token);
  return token;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
  vi.stubEnv("TRUST_PROXY_HOPS", "1");
  for (const list of [f.users, f.sessions, f.tokens, f.calls, f.sent, f.cookieSets, f.cookieDeletes]) list.length = 0;
  f.cookies.clear();
  f.send = null;
  f.beforeTransaction = null;
  origin = ORIGIN;
  _resetLoginThrottle();
  forgetAttempts("reauth:user-1");
});
afterEach(async () => {
  await _accountJobsIdle();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("nobody can learn who has an account", () => {
  it.each(["register", "forgot"] as const)("%s: the same answer for known and unknown addresses, with no cookie", async (route) => {
    await makeUser("known@example.com");
    const [known, unknown] = [await post(route, { email: "known@example.com" }), await post(route, { email: "unknown@example.com" })];
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(known.status);
    expect(await unknown.text()).toBe(await known.text());
    expect(known.headers.get("set-cookie")).toBeNull();
    expect(unknown.headers.get("set-cookie")).toBeNull();
  });

  it.each(["register", "forgot"] as const)("%s: nothing is looked up until after the response", async (route) => {
    await post(route, { email: "someone@example.com" });
    expect(f.calls).toEqual([]);
    await _accountJobsIdle();
    expect(f.calls).toContain("user.findUnique");
  });

  it("forgot: only an existing account gets an email", async () => {
    await makeUser("known@example.com");
    await post("forgot", { email: "unknown@example.com" });
    await _accountJobsIdle();
    expect(f.sent).toEqual([]);
    expect(f.tokens).toEqual([]);
    await post("forgot", { email: "known@example.com" });
    await _accountJobsIdle();
    expect(f.sent.map((m) => m.to)).toEqual(["known@example.com"]);
  });

  it("register: an existing account gets nothing, and no token", async () => {
    await makeUser("known@example.com");
    await post("register", { email: "known@example.com" });
    await _accountJobsIdle();
    expect(f.sent).toEqual([]);
    expect(f.tokens).toEqual([]);
  });
});

describe("sign-up", () => {
  it("creates no account, session or cookie until the link is used, and ignores a password sent early", async () => {
    await post("register", { email: "new@example.com", password: "sent by an old client" });
    await _accountJobsIdle();
    expect(f.users).toEqual([]);
    expect(f.sessions).toEqual([]);
    expect(f.cookieSets).toEqual([]);
    expect(f.tokens).toHaveLength(1);
    expect(JSON.stringify(f.tokens)).not.toContain("sent by an old client");
  });

  it("the link creates the account with the password chosen then, and doesn't sign anyone in", async () => {
    const token = await askSignup("New.User@Example.com");
    expect((await post("complete", { token, password: PASSWORD })).status).toBe(200);
    expect(f.users.map((u) => u.email)).toEqual(["new.user@example.com"]);
    expect(f.users[0].passwordHash).toMatch(/^\$argon2id\$/);
    expect(f.users[0].termsAcceptedAt).toBeUndefined();
    expect(f.sessions).toEqual([]);
    expect(f.cookieSets).toEqual([]);
  });

  it("a profile-less account can then log in", async () => {
    const token = await askSignup("new@example.com");
    await post("complete", { token, password: PASSWORD });
    expect((await post("login", { email: "new@example.com", password: PASSWORD })).status).toBe(200);
    expect(f.sessions).toHaveLength(1);
    expect(f.cookies.has("fit_session")).toBe(true);
  });

  it("stores only a hash, and the emailed token appears in no column", async () => {
    const token = await askSignup("new@example.com");
    expect(f.tokens[0].id).toBe(hash(token));
    expect(JSON.stringify(f.tokens)).not.toContain(token);
    expect(f.tokens[0].purpose).toBe("SIGNUP");
    expect(f.tokens[0].userId).toBeNull();
  });

  it("reusing a link fails, and creates nothing", async () => {
    const token = await askSignup("new@example.com");
    await post("complete", { token, password: PASSWORD });
    const again = await post("complete", { token, password: NEW_PASSWORD });
    expect(again.status).toBe(400);
    expect(f.users).toHaveLength(1);
  });

  it("works until its expiry, and not from that moment on", async () => {
    const token = await askSignup("early@example.com");
    vi.setSystemTime((f.tokens[0].expiresAt as Date).getTime() - 1);
    expect((await post("complete", { token, password: PASSWORD })).status).toBe(200);

    vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
    const late = await askSignup("late@example.com");
    vi.setSystemTime((f.tokens[0].expiresAt as Date).getTime() + 1);
    expect((await post("complete", { token: late, password: PASSWORD })).status).toBe(400);
    vi.setSystemTime((f.tokens[0].expiresAt as Date).getTime());
    expect((await post("complete", { token: late, password: PASSWORD })).status).toBe(400);
    expect(f.users.map((u) => u.email)).toEqual(["early@example.com"]);
  });

  it("expires during the password hash if that's when its time comes", async () => {
    const token = await askSignup("new@example.com");
    vi.setSystemTime((f.tokens[0].expiresAt as Date).getTime() - 1);
    f.beforeTransaction = () => advance(2);
    expect((await post("complete", { token, password: PASSWORD })).status).toBe(400);
    expect(f.users).toEqual([]);
  });

  it("parallel use of one link gives exactly one success, with no 429 or 500", async () => {
    const token = await askSignup("new@example.com");
    const results = await Promise.all(Array.from({ length: 8 }, () => post("complete", { token, password: PASSWORD }, { "X-Forwarded-For": "203.0.113.200" })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400, 400, 400, 400, 400, 400]);
    expect(f.users).toHaveLength(1);
  });

  it("two different live links for one address make one account, and the loser's token isn't spent", async () => {
    const first = await askSignup("new@example.com");
    advance(60_001);
    const second = await askSignup("new@example.com");
    expect(f.tokens).toHaveLength(2);
    const results = await Promise.all([post("complete", { token: first, password: PASSWORD }), post("complete", { token: second, password: NEW_PASSWORD })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(f.users).toHaveLength(1);
    expect(f.tokens).toEqual([]);
  });

  it("using one link removes the others for that address", async () => {
    const first = await askSignup("new@example.com");
    advance(60_001);
    const second = await askSignup("new@example.com");
    await post("complete", { token: first, password: PASSWORD });
    expect(f.tokens).toEqual([]);
    expect((await post("complete", { token: second, password: PASSWORD })).status).toBe(400);
  });

  it("a malformed or unknown token and a short password are refused, and spend nothing", async () => {
    const token = await askSignup("new@example.com");
    expect((await post("complete", { token: "short", password: PASSWORD })).status).toBe(400);
    expect((await post("complete", { token: "x".repeat(43), password: PASSWORD })).status).toBe(400);
    expect((await post("complete", { token, password: "short" })).status).toBe(400);
    expect(f.tokens).toHaveLength(1);
    expect(f.users).toEqual([]);
  });

  it("a bad token costs no Argon2 slot, and when none is free a good one isn't spent", async () => {
    const token = await askSignup("new@example.com");
    const held = Array.from({ length: 14 }, () => acquirePasswordCheck());
    expect((await post("complete", { token: "x".repeat(43), password: PASSWORD })).status).toBe(400);
    expect((await post("complete", { token, password: PASSWORD })).status).toBe(429);
    expect(f.tokens).toHaveLength(1);
    held.forEach((release) => release!());
    expect((await post("complete", { token, password: PASSWORD })).status).toBe(200);
  });
});

describe("the allowlist", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "https://app.example");
    vi.stubEnv("REGISTRATION_ALLOWLIST", "invited@example.com");
    origin = "https://app.example";
  });

  it("an address not on it gets the same answer, and no email or token", async () => {
    const [listed, unlisted] = [await post("register", { email: "invited@example.com" }), await post("register", { email: "stranger@example.com" })];
    expect(unlisted.status).toBe(listed.status);
    expect(await unlisted.text()).toBe(await listed.text());
    await _accountJobsIdle();
    expect(f.sent.map((m) => m.to)).toEqual(["invited@example.com"]);
    expect(f.tokens.map((t) => t.email)).toEqual(["invited@example.com"]);
  });

  it("normalizes before matching, and has no wildcards", async () => {
    await post("register", { email: "  INVITED@Example.COM " });
    await _accountJobsIdle();
    expect(f.sent).toHaveLength(1);
    vi.stubEnv("REGISTRATION_ALLOWLIST", "*@example.com,@example.com,*");
    advance(60_001);
    await post("register", { email: "other@example.com" });
    await _accountJobsIdle();
    expect(f.sent).toHaveLength(1);
  });

  it("is checked again when the link is used, so removing an address stops a link already sent", async () => {
    const token = await askSignup("invited@example.com");
    vi.stubEnv("REGISTRATION_ALLOWLIST", "someone.else@example.com");
    expect((await post("complete", { token, password: PASSWORD })).status).toBe(400);
    expect(f.users).toEqual([]);
  });

  it("a row for an address that was never invited can't create an account either", async () => {
    f.tokens.push({ id: hash("a".repeat(43)), purpose: "SIGNUP", email: "stranger@example.com", userId: null, expiresAt: new Date(Date.now() + 60_000), createdAt: new Date() });
    expect((await post("complete", { token: "a".repeat(43), password: PASSWORD })).status).toBe(400);
    expect(f.users).toEqual([]);
  });

  it("links come only from APP_ORIGIN, whatever a request's headers claim", async () => {
    await post("register", { email: "invited@example.com" }, { Host: "evil.example", "X-Forwarded-Host": "evil.example" });
    await _accountJobsIdle();
    expect(f.sent[0].text).toContain("https://app.example/register/complete#token=");
    expect(f.sent[0].text).not.toContain("evil.example");
  });

  it("a real server with no APP_ORIGIN sends no link at all", async () => {
    vi.stubEnv("APP_ORIGIN", "");
    origin = ORIGIN;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await post("register", { email: "invited@example.com" });
    await _accountJobsIdle();
    expect(f.sent).toEqual([]);
    expect(f.tokens).toEqual([]);
  });
});

describe("limits on email", () => {
  it("the cooldown is read from the token row, per address and purpose", async () => {
    await askSignup("new@example.com");
    await post("register", { email: "new@example.com" });
    await _accountJobsIdle();
    expect(f.sent).toHaveLength(1);
    // Nothing in memory holds this: a fresh row is all it takes, which is what survives a restart.
    f.tokens[0].createdAt = new Date(Date.now() - 60_001);
    await post("register", { email: "new@example.com" });
    await _accountJobsIdle();
    expect(f.sent).toHaveLength(2);
    await makeUser("both@example.com");
    await post("forgot", { email: "both@example.com" });
    await _accountJobsIdle();
    expect(f.sent).toHaveLength(3);
  });

  it("at most 5 live tokens per address and purpose", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 7; i++) {
      await post("register", { email: "new@example.com" });
      await _accountJobsIdle();
      advance(60_001);
    }
    expect(f.tokens).toHaveLength(5);
    expect(f.sent).toHaveLength(5);
  });

  it("a global cap, counted from the table, stops all new tokens", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 200; i++) f.tokens.push({ id: `t${i}`, purpose: "SIGNUP", email: `u${i}@example.com`, userId: null, expiresAt: new Date(Date.now() + 86_400_000), createdAt: new Date(Date.now() - 1000) });
    await post("register", { email: "new@example.com" });
    await _accountJobsIdle();
    expect(f.sent).toEqual([]);
    expect(f.tokens).toHaveLength(200);
    expect(warn.mock.calls.flat().join(" ")).toContain("global-cap");
  });

  it("issuing a token purges expired ones, for anyone", async () => {
    f.tokens.push({ id: "old", purpose: "SIGNUP", email: "abandoned@example.com", userId: null, expiresAt: new Date(Date.now() - 1), createdAt: new Date(Date.now() - 90_000_000) });
    await askSignup("new@example.com");
    expect(f.tokens.map((t) => t.email)).toEqual(["new@example.com"]);
  });

  it.each(["register", "forgot", "complete", "reset"] as const)("%s: limits each client, without blocking another", async (route) => {
    const body = route === "register" || route === "forgot" ? { email: "x@example.com" } : { token: "x".repeat(43), password: PASSWORD };
    const from = { "X-Forwarded-For": "198.51.100.9" };
    for (let i = 0; i < 10; i++) await post(route, body, from);
    expect((await post(route, body, from)).status).toBe(429);
    expect((await post(route, body, { "X-Forwarded-For": "198.51.100.10" })).status).not.toBe(429);
    advance(15 * 60_000 + 1);
    expect((await post(route, body, from)).status).not.toBe(429);
  });
});

describe("a failed send", () => {
  it("a definite rejection removes its token, so it doesn't hold the cooldown", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    f.send = async () => { throw new MailRejected("no"); };
    await post("register", { email: "new@example.com" });
    await _accountJobsIdle();
    expect(f.tokens).toEqual([]);
    f.send = null;
    await post("register", { email: "new@example.com" });
    await _accountJobsIdle();
    expect(f.tokens).toHaveLength(1);
  });

  it("anything else keeps its token, as the email may have arrived, and the limits keep counting it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    f.send = async () => { throw new Error("timed out"); };
    await post("register", { email: "new@example.com" });
    await _accountJobsIdle();
    expect(f.tokens).toHaveLength(1);
    await post("register", { email: "new@example.com" });
    await _accountJobsIdle();
    expect(f.sent).toHaveLength(1);
  });

  it("a hung provider can't stop later jobs: the queue moves on at its deadline, and aborts the send", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let aborted = false;
    f.send = (_m, signal) => new Promise(() => { signal.addEventListener("abort", () => { aborted = true; }); });
    let later = false;
    await post("register", { email: "hung@example.com" });
    enqueueAccountJob("later", async () => { later = true; });
    await vi.advanceTimersByTimeAsync(0);
    await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(0);
    await new Promise((resolve) => setImmediate(resolve));
    expect(later).toBe(false);
    await vi.advanceTimersByTimeAsync(JOB_DEADLINE_MS + 1);
    await _accountJobsIdle();
    expect(later).toBe(true);
    expect(aborted).toBe(true);
    expect(warn.mock.calls.flat().join(" ")).toContain("deadline-passed");
  });

  it("a failing job doesn't stop the next one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let later = false;
    enqueueAccountJob("bad", async () => { throw new Error("boom"); });
    enqueueAccountJob("later", async () => { later = true; });
    await _accountJobsIdle();
    expect(later).toBe(true);
    expect(warn.mock.calls.flat().join(" ")).toContain("[account-mail] bad: failed");
  });
});

describe("password reset", () => {
  it("changes the password, ends every session, and removes every token, without signing in", async () => {
    const user = await makeUser();
    signIn(user.id, "phone");
    signIn(user.id, "laptop");
    const token = await askReset(user.email);
    expect(f.tokens[0].purpose).toBe("PASSWORD_RESET");
    expect(f.tokens[0].userId).toBe(user.id);
    expect((await post("reset", { token, password: NEW_PASSWORD })).status).toBe(200);
    expect(f.sessions).toEqual([]);
    expect(f.tokens).toEqual([]);
    expect(f.cookieSets).toEqual([]);
    expect(f.cookies.has("fit_session")).toBe(false);
    expect(f.cookieDeletes).toContain("fit_device");
    expect((await post("login", { email: user.email, password: PASSWORD })).status).toBe(401);
    expect((await post("login", { email: user.email, password: NEW_PASSWORD })).status).toBe(200);
  });

  it("notifies by email, with no token in the notice", async () => {
    const user = await makeUser();
    const token = await askReset(user.email);
    await post("reset", { token, password: NEW_PASSWORD });
    await _accountJobsIdle();
    const notice = f.sent.find((m) => m.kind === "password-changed")!;
    expect(notice.to).toBe(user.email);
    expect(notice.text).not.toMatch(/#token=/);
  });

  it("reuse and expiry fail, and leave the password alone", async () => {
    const user = await makeUser();
    const before = user.passwordHash;
    const token = await askReset(user.email);
    vi.setSystemTime((f.tokens[0].expiresAt as Date).getTime() + 1);
    expect((await post("reset", { token, password: NEW_PASSWORD })).status).toBe(400);
    expect(f.users[0].passwordHash).toBe(before);
    vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
    const fresh = await askReset(user.email);
    vi.setSystemTime((f.tokens.at(-1)!.expiresAt as Date).getTime() - 1);
    expect((await post("reset", { token: fresh, password: NEW_PASSWORD })).status).toBe(200);
    expect((await post("reset", { token: fresh, password: "a third long passphrase" })).status).toBe(400);
    expect((await post("login", { email: user.email, password: NEW_PASSWORD })).status).toBe(200);
  });

  it("a token is good only for its own purpose, in both directions", async () => {
    const user = await makeUser();
    const resetToken = await askReset(user.email);
    expect((await post("complete", { token: resetToken, password: NEW_PASSWORD })).status).toBe(400);
    const signupToken = await askSignup("new@example.com");
    expect((await post("reset", { token: signupToken, password: NEW_PASSWORD })).status).toBe(400);
    expect(f.tokens).toHaveLength(2);
    expect(f.users).toHaveLength(1);
  });

  it("purpose is checked by itself, with no other rule to catch a mismatch", async () => {
    const user = await makeUser();
    const before = user.passwordHash;
    const later = new Date(Date.now() + 60_000);
    // A reset row for an address with no account would otherwise create one.
    f.tokens.push({ id: hash("r".repeat(43)), purpose: "PASSWORD_RESET", email: "nobody@example.com", userId: null, expiresAt: later, createdAt: new Date() });
    expect((await post("complete", { token: "r".repeat(43), password: NEW_PASSWORD })).status).toBe(400);
    expect(f.users).toHaveLength(1);
    // A sign-up row with a user on it would otherwise reset that user's password.
    f.tokens.push({ id: hash("s".repeat(43)), purpose: "SIGNUP", email: user.email, userId: user.id, expiresAt: later, createdAt: new Date() });
    expect((await post("reset", { token: "s".repeat(43), password: NEW_PASSWORD })).status).toBe(400);
    expect(f.users[0].passwordHash).toBe(before);
    expect(f.tokens).toHaveLength(2);
  });

  it("a reset removes other pending links, so an older email can't undo it", async () => {
    const user = await makeUser();
    const older = await askReset(user.email);
    advance(60_001);
    const newer = await askReset(user.email);
    expect(f.tokens).toHaveLength(2);
    expect((await post("reset", { token: newer, password: NEW_PASSWORD })).status).toBe(200);
    expect(f.tokens).toEqual([]);
    expect((await post("reset", { token: older, password: "a third long passphrase" })).status).toBe(400);
    expect((await post("login", { email: user.email, password: NEW_PASSWORD })).status).toBe(200);
  });

  it("parallel use gives exactly one success", async () => {
    const user = await makeUser();
    const token = await askReset(user.email);
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => post("reset", { token, password: `${NEW_PASSWORD} ${i}` }, { "X-Forwarded-For": "203.0.113.201" })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400, 400, 400]);
  });

  it("an account deleted before the transaction leaves a refusal and nothing else", async () => {
    const user = await makeUser();
    const token = await askReset(user.email);
    f.beforeTransaction = () => { f.users.length = 0; };
    expect((await post("reset", { token, password: NEW_PASSWORD })).status).toBe(400);
    expect(f.users).toEqual([]);
  });

  it("locks the user before touching the token, the same order as deletion", async () => {
    const user = await makeUser();
    const token = await askReset(user.email);
    f.calls.length = 0;
    await post("reset", { token, password: NEW_PASSWORD });
    const lock = f.calls.indexOf("raw:FOR UPDATE");
    expect(lock).toBeGreaterThan(-1);
    expect(f.calls.indexOf("accountToken.deleteMany")).toBeGreaterThan(lock);
    expect(f.calls.indexOf("user.update")).toBeGreaterThan(lock);
  });
});

describe("a login already past its password check", () => {
  it("can't leave a session behind if a reset commits meanwhile", async () => {
    const user = await makeUser();
    f.beforeTransaction = () => { user.passwordHash = "changed by a reset"; };
    const res = await post("login", { email: user.email, password: PASSWORD });
    expect(res.status).toBe(401);
    expect(f.sessions).toEqual([]);
    expect(f.cookieSets).toEqual([]);
  });

  it("holds the row while it compares, and stores the session inside that", async () => {
    const user = await makeUser();
    await post("login", { email: user.email, password: PASSWORD });
    const lock = f.calls.indexOf("raw:FOR SHARE");
    expect(lock).toBeGreaterThan(-1);
    expect(f.calls.indexOf("session.create")).toBeGreaterThan(lock);
  });
});

describe("change password", () => {
  it("needs the current password, and a wrong one changes nothing", async () => {
    const user = await makeUser();
    const before = user.passwordHash;
    signIn(user.id);
    expect((await post("change", { currentPassword: "not the right one", newPassword: NEW_PASSWORD })).status).toBe(403);
    expect(f.users[0].passwordHash).toBe(before);
  });

  it("needs a session", async () => {
    await makeUser();
    expect((await post("change", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(401);
  });

  it("works with no profile: the route has no access gate", async () => {
    const user = await makeUser();
    signIn(user.id);
    expect((await post("change", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(200);
  });

  it("keeps a new session here, ends every other, and removes pending links", async () => {
    const user = await makeUser();
    signIn(user.id, "other device");
    await askReset(user.email);
    signIn(user.id, "this device");
    const old = f.sessions.map((s) => s.id);
    expect((await post("change", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(200);
    expect(f.sessions).toHaveLength(1);
    expect(old).not.toContain(f.sessions[0].id);
    expect(f.sessions[0].id).toBe(hash(f.cookies.get("fit_session")!));
    expect(f.tokens).toEqual([]);
    expect(f.cookieSets).toContain("fit_device");
    expect((await post("login", { email: user.email, password: NEW_PASSWORD })).status).toBe(200);
    await _accountJobsIdle();
    expect(f.sent.some((m) => m.kind === "password-changed" && m.to === user.email)).toBe(true);
  });

  it("can't overwrite a reset that committed after it verified the old password", async () => {
    const user = await makeUser();
    signIn(user.id);
    f.beforeTransaction = () => { user.passwordHash = "the owner's new password"; };
    expect((await post("change", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(409);
    expect(f.users[0].passwordHash).toBe("the owner's new password");
  });

  it("shares the re-authentication limit, so a stolen session gets one allowance of guesses", async () => {
    const user = await makeUser();
    signIn(user.id);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await post("change", { currentPassword: "wrong guess", newPassword: NEW_PASSWORD })).status);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(403));
    expect(statuses[10]).toBe(429);
  });
});

describe("every route refuses what it should before doing anything", () => {
  it.each(["register", "complete", "forgot", "reset", "change"] as const)("%s: a mismatched Origin gets 403", async (route) => {
    origin = "https://evil.example";
    expect((await post(route, {})).status).toBe(403);
    expect(f.calls).toEqual([]);
  });

  it.each(["register", "forgot"] as const)("%s: an invalid address gets 400 and queues nothing", async (route) => {
    expect((await post(route, { email: "not-an-email" })).status).toBe(400);
    await _accountJobsIdle();
    expect(f.calls).toEqual([]);
  });

  it.each(["register", "complete", "forgot", "reset"] as const)("%s: an oversized body gets 413", async (route) => {
    expect((await post(route, { email: "a@example.com", token: "x".repeat(43), password: "x".repeat(5000) })).status).toBe(413);
    expect(f.calls).toEqual([]);
  });

  it("a body that stalls is abandoned at its deadline", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { POST } = await routes.register();
    const stalled = new ReadableStream({ start() {} });
    const pending = POST(new NextRequest(`${ORIGIN}/api/x`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, Host: "localhost:3000", "X-Forwarded-For": "203.0.113.202" }, body: stalled, duplex: "half" } as never));
    await vi.advanceTimersByTimeAsync(10_001);
    expect((await pending).status).toBe(408);
  });
});

describe("secrets stay out of logs", () => {
  it("a provider error holding the address and token is never printed", async () => {
    const logged: unknown[][] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, method).mockImplementation((...args) => { logged.push(args); });
    f.send = async (m) => { throw new Error(`provider refused ${m.to} with ${m.text}`); };
    await post("register", { email: "secret.person@example.com" });
    await _accountJobsIdle();
    const token = tokenIn(f.sent[0]);
    expect(logged.length).toBeGreaterThan(0);
    const text = logged.flat().map(String).join(" ");
    expect(text).not.toContain("secret.person");
    expect(text).not.toContain(token);
    expect(text).toContain("[account-mail] signup: send-failed");
  });

  it("the whole flow prints nothing about the person", async () => {
    const logged: unknown[][] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, method).mockImplementation((...args) => { logged.push(args); });
    const token = await askSignup("secret.person@example.com");
    await post("complete", { token, password: PASSWORD });
    const reset = await askReset("secret.person@example.com");
    await post("reset", { token: reset, password: NEW_PASSWORD });
    await post("complete", { token: "x".repeat(43), password: PASSWORD });
    await _accountJobsIdle();
    const text = logged.flat().map(String).join(" ");
    for (const secret of ["secret.person", token, reset, PASSWORD, NEW_PASSWORD]) expect(text).not.toContain(secret);
  });
});

describe("deletion and export", () => {
  it("deletion removes tokens by user and by address, which no cascade reaches for sign-up", async () => {
    const { deleteAccount } = await import("./delete");
    const user = await makeUser();
    await askReset(user.email);
    f.tokens.push({ id: "signup", purpose: "SIGNUP", email: user.email, userId: null, expiresAt: new Date(Date.now() + 60_000), createdAt: new Date() });
    f.tokens.push({ id: "other", purpose: "SIGNUP", email: "someone.else@example.com", userId: null, expiresAt: new Date(Date.now() + 60_000), createdAt: new Date() });
    expect(await deleteAccount(user.id)).toBe(true);
    expect(f.tokens.map((t) => t.id)).toEqual(["other"]);
  });
});
