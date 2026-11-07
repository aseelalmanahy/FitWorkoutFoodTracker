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
}));
vi.mock("@/lib/server/auth", () => ({ getCurrentUser: async () => ({ id: f.user, email: "me@example.com" }) }));
vi.mock("@/lib/server/db", () => ({
  prisma: {
    profile: { findUnique: async () => ({ birthDate: new Date("1990-01-01") }) },
    exercise: { findFirst: async ({ where }: { where: unknown }) => { f.exerciseWhere = where; return f.visible ? { id: "ex" } : null; } },
    sessionExercise: {
      findFirst: async ({ where }: { where: { id: string; session: { userId: string } } }) => (where.session.userId === "me" && where.id === "se" ? { id: "se", session: { status: f.status } } : null),
      findMany: async () => [],
    },
    workoutSession: { findMany: async () => [] },
    setEntry: {
      findUnique: async ({ where }: { where: { id: string } }) => f.rows.find((r) => r.id === where.id) ?? null,
      findMany: async () => [],
      aggregate: async () => ({ _max: { setNumber: f.rows.length ? Math.max(...f.rows.map((r) => r.setNumber)) : null } }),
      create: async ({ data }: { data: Omit<Row, "id"> & { id?: string } }) => {
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

beforeEach(() => { f.rows = []; f.user = "me"; f.visible = true; f.status = "IN_PROGRESS"; f.raceWith = null; f.next = 0; });

describe("logging a set", () => {
  it("a retry with the same key returns the set that was saved, and adds nothing", async () => {
    const { POST } = await sets();
    const first = await (await POST(post(SET, KEY), ctx(params))).json();
    const second = await (await POST(post(SET, KEY), ctx(params))).json();
    expect(second.set.id).toBe(first.set.id);
    expect(f.rows).toHaveLength(1);
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
