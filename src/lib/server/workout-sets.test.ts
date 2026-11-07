// Phase 4.0.6: logging a set can't log it twice, and /previous answers as /history does. In-memory database. Real rows
// are in scripts/workout-sets.test.cjs, and a lost response in a browser in scripts/e2e-readiness.cjs.
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; sessionExerciseId: string; setNumber: number; reps: number; weightKg: number; isWarmup: boolean; rpe: number | null };
const f = vi.hoisted(() => ({
  rows: [] as Row[],
  user: "me",
  visible: true,
  status: "IN_PROGRESS",
  exerciseWhere: null as unknown,
  /** Stands in for a second attempt getting there between this one's lookup and its write. */
  raceWith: null as null | Row,
  next: 0,
  /** What happened, in order, to show that the lock comes first and that everything else is inside it. */
  events: [] as string[],
  inTx: false,
  /** The workout's row has gone by the time the lock looks for it. */
  gone: false,
  /** What the transaction fails with, as when the database is too busy. */
  failure: null as unknown,
  dropped: 0,
  updated: null as unknown,
}));
vi.mock("@/lib/server/auth", () => ({
  getCurrentUser: async () => ({ id: f.user, email: "me@example.com" }),
  limitLockWait: (tx: { $executeRaw: (s: TemplateStringsArray) => Promise<number> }) => tx.$executeRaw`SET LOCAL lock_timeout = '4s'`,
}));
/** What a transaction is handed. A call through it says so as it starts, so one through the outer client shows as "outside". */
const throughTx = <T extends object>(client: T): T => new Proxy(client, {
  get(target, key) {
    const value = (target as Record<string | symbol, unknown>)[key];
    if (typeof value === "function") return (...args: unknown[]) => { f.inTx = true; try { return (value as (...a: unknown[]) => unknown).apply(target, args); } finally { f.inTx = false; } };
    return value && typeof value === "object" ? throughTx(value as object) : value;
  },
});
vi.mock("@/lib/server/db", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const { prisma } = await import("@/lib/server/db");
      if (f.failure) throw f.failure;
      return fn(throughTx(prisma));
    },
    $executeRaw: async (strings: TemplateStringsArray) => { f.events.push(`${f.inTx ? "tx" : "outside"}:limit`); expect(strings.join("")).toMatch(/SET LOCAL lock_timeout/); return 0; },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      f.events.push(`${f.inTx ? "tx" : "outside"}:lock`);
      if (!/FOR UPDATE/.test(strings.join(""))) throw new Error("not a lock");
      return values[1] === "me" && !f.gone ? [{ status: f.status }] : [];
    },
    workoutSession: {
      findMany: async () => [],
      findFirst: async ({ where }: { where: { userId: string } }) => (where.userId === "me" ? { id: "s", status: f.status } : null),
      update: async ({ data }: { data: unknown }) => { f.events.push(`${f.inTx ? "tx" : "outside"}:update`); f.updated = data; return { id: "s", ...(data as object) }; },
    },
    profile: { findUnique: async () => ({ birthDate: new Date("1990-01-01") }) },
    exercise: { findFirst: async ({ where }: { where: unknown }) => { f.exerciseWhere = where; return f.visible ? { id: "ex" } : null; } },
    sessionExercise: {
      findFirst: async ({ where }: { where: { id: string; session: { userId: string } } }) => (where.session.userId === "me" && where.id === "se" ? { id: "se", sessionId: "s", session: { status: "stale, and not to be used" } } : null),
      findMany: async () => [],
      deleteMany: async () => { f.events.push(`${f.inTx ? "tx" : "outside"}:drop`); f.dropped++; return { count: 0 }; },
    },
    setEntry: {
      count: async () => { f.events.push(`${f.inTx ? "tx" : "outside"}:count`); return f.rows.length; },
      findUnique: async ({ where }: { where: { id: string } }) => f.rows.find((r) => r.id === where.id) ?? null,
      findMany: async () => [],
      aggregate: async () => ({ _max: { setNumber: f.rows.length ? Math.max(...f.rows.map((r) => r.setNumber)) : null } }),
      create: async ({ data }: { data: Omit<Row, "id"> & { id?: string } }) => {
        f.events.push(`${f.inTx ? "tx" : "outside"}:create`);
        if (f.raceWith) { f.rows.push(f.raceWith); f.raceWith = null; }
        if (data.id && f.rows.some((r) => r.id === data.id)) throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" });
        const row = { ...data, id: data.id ?? `auto${++f.next}` };
        f.rows.push(row);
        return row;
      },
    },
  },
}));

const ORIGIN = "http://localhost:3000";
const KEY = "abcdefghijklmnop1234";
const ctx = (params: object) => ({ params: Promise.resolve(params) }) as never;
const post = (body: unknown, key?: string) => new NextRequest(`${ORIGIN}/api/sessions/s/exercises/se/sets`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: ORIGIN, Host: "localhost:3000", ...(key ? { "Idempotency-Key": key } : {}) },
  body: JSON.stringify(body),
});
const SET = { weightKg: 60, reps: 8, isWarmup: false };
const params = { id: "s", seId: "se" };
const sets = () => import("@/app/api/sessions/[id]/exercises/[seId]/sets/route");

beforeEach(() => { f.rows = []; f.user = "me"; f.visible = true; f.status = "IN_PROGRESS"; f.raceWith = null; f.next = 0; f.events = []; f.inTx = false; f.gone = false; f.failure = null; f.dropped = 0; f.updated = null; });

describe("logging a set", () => {
  it("a retry with the same key returns the set that was saved, and adds nothing", async () => {
    const { POST } = await sets();
    const first = await (await POST(post(SET, KEY), ctx(params))).json();
    const second = await (await POST(post(SET, KEY), ctx(params))).json();
    expect(second.set.id).toBe(first.set.id);
    expect(f.rows).toHaveLength(1);
  });
  it("takes the workout's row before anything else, and writes inside that transaction", async () => {
    const { POST } = await sets();
    await POST(post(SET, KEY), ctx(params));
    expect(f.events).toEqual(["tx:limit", "tx:lock", "tx:create"]);
  });
  it("goes by the status it read under the lock, not one read earlier", async () => {
    const { POST } = await sets();
    f.status = "COMPLETED";
    expect((await POST(post(SET), ctx(params))).status).toBe(409);
    expect(f.events).toEqual(["tx:limit", "tx:lock"]);
  });
  it("a workout gone by the time of the lock is not found, and nothing is written", async () => {
    const { POST } = await sets();
    f.gone = true;
    expect((await POST(post(SET), ctx(params))).status).toBe(404);
    expect(f.rows).toEqual([]);
  });
  it.each([["ran out of time", "P2028"], ["found no free connection", "P2024"]])("a transaction that %s says to try again, with nothing saved", async (_name, code) => {
    const { POST } = await sets();
    f.failure = new Prisma.PrismaClientKnownRequestError("busy", { code, clientVersion: "test" });
    const res = await POST(post(SET, KEY), ctx(params));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(f.rows).toEqual([]);
  });
  it("a second attempt that loses a race returns the first, and adds nothing", async () => {
    const { POST } = await sets();
    const { idempotentId } = await import("@/lib/server/idempotency");
    f.raceWith = { id: idempotentId("set", "me", KEY), sessionExerciseId: "se", setNumber: 1, reps: 8, weightKg: 60, isWarmup: false, rpe: null };
    const res = await POST(post(SET, KEY), ctx(params));
    expect(res.status).toBe(200);
    expect((await res.json()).set.id).toBe(f.rows[0].id);
    expect(f.rows).toHaveLength(1);
  });
  it("a race lost to different values is a conflict", async () => {
    const { POST } = await sets();
    const { idempotentId } = await import("@/lib/server/idempotency");
    f.raceWith = { id: idempotentId("set", "me", KEY), sessionExerciseId: "se", setNumber: 1, reps: 5, weightKg: 60, isWarmup: false, rpe: null };
    expect((await POST(post(SET, KEY), ctx(params))).status).toBe(409);
    expect(f.rows).toHaveLength(1);
  });
  it.each([["reps", { reps: 9 }], ["weight", { weightKg: 61 }], ["warm-up", { isWarmup: true }], ["effort", { rpe: 8 }]])("the same key with a different %s is a conflict, and changes nothing", async (_name, change) => {
    const { POST } = await sets();
    await POST(post(SET, KEY), ctx(params));
    const res = await POST(post({ ...SET, ...change }, KEY), ctx(params));
    expect(res.status).toBe(409);
    expect((await res.json()).details.reason).toBe("idempotency_conflict");
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0]).toMatchObject({ reps: 8, weightKg: 60, isWarmup: false, rpe: null });
  });
  it("no key logs each one, as before", async () => {
    const { POST } = await sets();
    await POST(post(SET), ctx(params));
    await POST(post(SET), ctx(params));
    expect(f.rows.map((r) => r.setNumber)).toEqual([1, 2]);
  });
  it("different keys are different sets", async () => {
    const { POST } = await sets();
    await POST(post(SET, KEY), ctx(params));
    await POST(post(SET, `${KEY}x`), ctx(params));
    expect(f.rows.map((r) => r.setNumber)).toEqual([1, 2]);
  });
  it("one person's key can't reach another's set", async () => {
    const { idempotentId } = await import("@/lib/server/idempotency");
    expect(idempotentId("set", "me", KEY)).not.toBe(idempotentId("set", "them", KEY));
    expect(idempotentId("set", "me", KEY)).not.toBe(idempotentId("entry", "me", KEY));
  });
  it("refuses a malformed key, and stores nothing", async () => {
    const { POST } = await sets();
    expect((await POST(post(SET, "short"), ctx(params))).status).toBe(400);
    expect(f.rows).toEqual([]);
  });
  it("someone else's session exercise reads as not existing, before any key is looked at", async () => {
    const { POST } = await sets();
    f.user = "them";
    expect((await POST(post(SET, KEY), ctx(params))).status).toBe(404);
    expect((await POST(post(SET, "short"), ctx(params))).status, "a malformed key gets the same answer, so ownership comes first").toBe(404);
    expect(f.rows).toEqual([]);
  });
  it("a finished workout takes no new set, with or without a key", async () => {
    const { POST } = await sets();
    f.status = "COMPLETED";
    expect((await POST(post(SET, KEY), ctx(params))).status).toBe(409);
    expect((await POST(post(SET), ctx(params))).status).toBe(409);
    expect(f.rows).toEqual([]);
  });
  it("an honest retry after the workout was finished still gets the set it saved", async () => {
    const { POST } = await sets();
    const first = await (await POST(post(SET, KEY), ctx(params))).json();
    f.status = "COMPLETED";
    const retry = await POST(post(SET, KEY), ctx(params));
    expect(retry.status).toBe(200);
    expect((await retry.json()).set.id).toBe(first.set.id);
    expect(f.rows).toHaveLength(1);
  });
});

describe("finishing a workout", () => {
  const session = () => import("@/app/api/sessions/[id]/route");
  const patch = (body: unknown) => new NextRequest(`${ORIGIN}/api/sessions/s`, { method: "PATCH", headers: { "Content-Type": "application/json", Origin: ORIGIN, Host: "localhost:3000" }, body: JSON.stringify(body) });
  const logged = { id: "x", sessionExerciseId: "se", setNumber: 1, reps: 8, weightKg: 60, isWarmup: false, rpe: null };
  it("takes the workout's row first, and does everything else inside that transaction", async () => {
    const { PATCH } = await session();
    f.rows = [logged];
    expect((await PATCH(patch({ finish: true }), ctx({ id: "s" }))).status).toBe(200);
    expect(f.events).toEqual(["tx:limit", "tx:lock", "tx:count", "tx:drop", "tx:update"]);
    expect(f.updated).toMatchObject({ status: "COMPLETED" });
  });
  it("is refused when the row already says finished, and changes nothing", async () => {
    const { PATCH } = await session();
    f.rows = [logged];
    f.status = "COMPLETED";
    expect((await PATCH(patch({ finish: true }), ctx({ id: "s" }))).status).toBe(409);
    expect(f.events).toEqual(["tx:limit", "tx:lock"]);
  });
  it("is refused with no set, and drops nothing", async () => {
    const { PATCH } = await session();
    expect((await PATCH(patch({ finish: true }), ctx({ id: "s" }))).status).toBe(400);
    expect(f.dropped).toBe(0);
    expect(f.updated).toBeNull();
  });
  it("renaming doesn't take the lock, or finish anything", async () => {
    const { PATCH } = await session();
    expect((await PATCH(patch({ name: "New" }), ctx({ id: "s" }))).status).toBe(200);
    expect(f.events).toEqual(["outside:update"]);
    expect(f.updated).toEqual({ name: "New" });
  });
});

describe("an exercise's previous performance", () => {
  const prev = () => import("@/app/api/exercises/[id]/previous/route");
  const get = () => new NextRequest(`${ORIGIN}/api/exercises/ex/previous`, { headers: { Origin: ORIGIN, Host: "localhost:3000" } });
  it("an exercise this person can't see is not found", async () => {
    const { GET } = await prev();
    f.visible = false;
    expect((await GET(get(), ctx({ id: "ex" }))).status).toBe(404);
  });
  it("asks only for what this person can see", async () => {
    const { GET } = await prev();
    f.visible = false;
    await GET(get(), ctx({ id: "ex" }));
    expect(JSON.stringify(f.exerciseWhere)).toContain("me");
  });
});
