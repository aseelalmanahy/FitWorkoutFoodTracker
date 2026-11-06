// Phase 4.1: the trend, the goal card and the weight routes. The routes run with an in-memory database, so isolation
// here means every query names the owner. Real rows and real browsers are in scripts/weight-progress.test.cjs and
// scripts/e2e-weight.cjs, which need MIG-04 applied.
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { goalCardCopy, goalProgress, type Goal } from "./goal-progress";
import { CHANGE_WINDOW_DAYS, MIN_CHANGE_SPAN_DAYS, TREND_TIME_CONSTANT_DAYS, trendChange, weightTrend } from "./weight-trend";

type Row = { id: string; userId: string; kind: string; date: Date; value: number };
const f = vi.hoisted(() => ({
  rows: [] as Row[],
  wheres: [] as Record<string, unknown>[],
  profile: { timezone: "UTC" } as null | { timezone: string },
  userId: "me",
}));
vi.mock("@/lib/server/db", () => ({
  prisma: {
    profile: { findUnique: async () => (f.profile ? { birthDate: new Date("1990-01-01"), ...f.profile } : null) },
    bodyMetric: {
      findMany: async ({ where }: { where: { userId: string } }) => { f.wheres.push(where); return f.rows.filter((r) => r.userId === where.userId).sort((a, b) => a.date.getTime() - b.date.getTime()); },
      upsert: async ({ where, create, update }: { where: { userId_kind_date: { userId: string; date: Date } }; create: Row; update: { value: number } }) => {
        const { userId, date } = where.userId_kind_date;
        f.wheres.push({ userId });
        const found = f.rows.find((r) => r.userId === userId && r.date.getTime() === date.getTime());
        if (found) { found.value = update.value; return found; }
        const row = { ...create, id: `w${f.rows.length + 1}` };
        f.rows.push(row);
        return row;
      },
      deleteMany: async ({ where }: { where: { id: string; userId: string } }) => {
        f.wheres.push(where);
        const before = f.rows.length;
        f.rows = f.rows.filter((r) => !(r.id === where.id && r.userId === where.userId));
        return { count: before - f.rows.length };
      },
    },
  },
}));
vi.mock("@/lib/server/auth", () => ({ getCurrentUser: async () => ({ id: f.userId, email: "me@example.com" }) }));

const ORIGIN = "http://localhost:3000";
const ctx = (params: object = {}) => ({ params: Promise.resolve(params) }) as never;
const req = (method: string, body?: unknown, origin = ORIGIN) => new NextRequest(`${ORIGIN}/api/weight`, { method, headers: { "Content-Type": "application/json", Origin: origin, Host: "localhost:3000" }, body: body === undefined ? undefined : JSON.stringify(body) });
const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);

describe("the trend", () => {
  it("starts at the first entry, and has nothing to say with no entries", () => {
    expect(weightTrend([])).toEqual([]);
    expect(weightTrend([{ date: day(0), weightKg: 80 }])[0].trendKg).toBe(80);
  });
  it("moves toward each entry by the stated method", () => {
    const [, second] = weightTrend([{ date: day(0), weightKg: 80 }, { date: day(1), weightKg: 81 }]);
    expect(second.trendKg).toBeCloseTo(80 + (1 - Math.exp(-1 / TREND_TIME_CONSTANT_DAYS)), 10);
  });
  it("sorts by date, whatever order they arrive in", () => {
    const a = weightTrend([{ date: day(2), weightKg: 82 }, { date: day(0), weightKg: 80 }, { date: day(1), weightKg: 81 }]);
    expect(a.map((p) => p.date)).toEqual([day(0), day(1), day(2)]);
  });
  it("damps a one-day swing, which is why change is read from it", () => {
    const flat = Array.from({ length: 20 }, (_, i) => ({ date: day(i), weightKg: 80 }));
    const trend = weightTrend([...flat, { date: day(20), weightKg: 83 }]);
    expect(trend.at(-1)!.trendKg - 80).toBeLessThan(0.5);
  });
  it("treats a missing day as time passing, and never as a zero", () => {
    const gap = weightTrend([{ date: day(0), weightKg: 80 }, { date: day(30), weightKg: 80 }]);
    expect(gap[1].trendKg).toBe(80);
    const after = weightTrend([{ date: day(0), weightKg: 80 }, { date: day(100), weightKg: 70 }]);
    expect(after[1].trendKg).toBeGreaterThan(69.9);
    expect(after[1].trendKg).toBeLessThan(70.1);
  });
  it("catches up further after a longer gap than after a day", () => {
    const one = weightTrend([{ date: day(0), weightKg: 80 }, { date: day(1), weightKg: 70 }])[1].trendKg;
    const ten = weightTrend([{ date: day(0), weightKg: 80 }, { date: day(10), weightKg: 70 }])[1].trendKg;
    expect(ten).toBeLessThan(one);
  });
});

describe("change", () => {
  it("says nothing until the log spans a week, as less is noise", () => {
    expect(trendChange([])).toBeNull();
    expect(trendChange(weightTrend([{ date: day(0), weightKg: 80 }]))).toBeNull();
    expect(trendChange(weightTrend([{ date: day(0), weightKg: 80 }, { date: day(MIN_CHANGE_SPAN_DAYS - 1), weightKg: 79 }]))).toBeNull();
    expect(trendChange(weightTrend([{ date: day(0), weightKg: 80 }, { date: day(MIN_CHANGE_SPAN_DAYS), weightKg: 79 }]))).not.toBeNull();
  });
  it("comes from the trend, not from weigh-ins", () => {
    const trend = weightTrend([{ date: day(0), weightKg: 80 }, { date: day(10), weightKg: 78 }]);
    const change = trendChange(trend)!;
    expect(change.changeKg).toBeCloseTo(trend[1].trendKg - 80, 10);
    expect(change.changeKg).not.toBe(-2);
  });
  it("measures over its window when the log is older, and names the date it starts from", () => {
    const entries = Array.from({ length: 90 }, (_, i) => ({ date: day(i), weightKg: 90 - i * 0.1 }));
    const change = trendChange(weightTrend(entries))!;
    expect(change.toDate).toBe(day(89));
    expect(change.fromDate).toBe(day(89 - CHANGE_WINDOW_DAYS));
  });
});

describe("goal progress", () => {
  const trend = weightTrend([{ date: day(0), weightKg: 80 }, { date: day(10), weightKg: 78 }]);
  const latest = trend.at(-1)!.trendKg;
  const of = (goal: Goal | null, goalWeightKg: number | null = null, t = trend, recentRecords = 0) => goalProgress({ goal, goalWeightKg, trend: t, recentRecords });

  it("no goal asks for one, and invents none", () => expect(of(null)).toEqual({ kind: "choose-goal" }));
  it.each(["FAT_LOSS", "MUSCLE_GAIN"] as const)("%s compares the trend with the goal weight", (goal) => {
    expect(of(goal, 70)).toEqual({ kind: "weight-goal", goal, trendKg: latest, goalKg: 70, differenceKg: latest - 70 });
  });
  it("a weight goal with no goal weight asks for one", () => expect(of("FAT_LOSS").kind).toBe("set-goal-weight"));
  it("a weight goal with no entries asks for one, as logging is optional", () => expect(of("FAT_LOSS", 70, []).kind).toBe("log-weight"));
  it("strength shows records, and needs no weight", () => expect(of("STRENGTH", null, [], 3)).toEqual({ kind: "strength", recentRecords: 3 }));
  it("maintenance is the distance from the first logged weight", () => {
    expect(of("MAINTENANCE")).toEqual({ kind: "maintenance", startKg: 80, trendKg: latest, differenceKg: latest - 80 });
  });
  it("maintenance needs two entries, as one is its own starting point", () => {
    expect(of("MAINTENANCE", null, weightTrend([{ date: day(0), weightKg: 80 }])).kind).toBe("log-weight");
  });
});

describe("the goal card", () => {
  const trend = weightTrend([{ date: day(0), weightKg: 80 }, { date: day(10), weightKg: 78 }]);
  const render = (goal: Goal | null, goalWeightKg: number | null = null, units: "METRIC" | "IMPERIAL" = "METRIC", t = trend, records = 0) =>
    Object.values(goalCardCopy(goalProgress({ goal, goalWeightKg, trend: t, recentRecords: records }), units)).flatMap((v) => (typeof v === "object" ? [v.label] : v ?? [])).join(" | ");
  const ALL: [Goal | null, number | null][] = [[null, null], ["FAT_LOSS", 70], ["FAT_LOSS", 90], ["MUSCLE_GAIN", 85], ["MAINTENANCE", null], ["STRENGTH", null]];

  it.each(ALL)("predicts nothing, gives no percentage, and doesn't judge: %s", (goal, gw) => {
    expect(render(goal, gw)).not.toMatch(/by [A-Z][a-z]+ \d|weeks? (left|to go)|days? (left|to go)|expected|on track|predict|%|great|well done|too (low|high|heavy|light)|overweight|underweight|healthy|ideal|you should/i);
  });
  it("muscle gain isn't presented as weight gain", () => {
    expect(render("MUSCLE_GAIN", 85)).toContain("Weight alone doesn't show muscle");
    expect(render("FAT_LOSS", 70)).not.toMatch(/muscle/i);
  });
  it("states the difference plainly, in either direction", () => {
    expect(render("FAT_LOSS", 70)).toContain("About 8.7 kg above your goal weight of 70 kg");
    expect(render("FAT_LOSS", 90)).toContain("About 11.3 kg below your goal weight of 90 kg");
  });
  it("uses the account's units", () => {
    const html = render("FAT_LOSS", 70, "IMPERIAL");
    expect(html).toContain(" lb");
    expect(html).not.toContain(" kg");
  });
  it("shows the trend, and not the latest weigh-in", () => {
    expect(render("FAT_LOSS", 70)).toContain("Trend 78.7 kg");
    expect(render("FAT_LOSS", 70)).not.toContain("78 kg");
  });
  it("level with a number isn't called reaching it, and has no direction", () => {
    const html = render("FAT_LOSS", 70, "METRIC", weightTrend([{ date: day(0), weightKg: 70 }]));
    expect(html).toContain("About level with your goal weight of 70 kg");
    expect(html).not.toMatch(/reached|above|below/i);
  });
  it("uses no colour that reads as good or bad", () => {
    expect(readFileSync("src/components/progress/goal-card.tsx", "utf8")).not.toMatch(/-(up|down|danger|success|red|green)\b/);
  });
});

describe("the weight routes", () => {
  const routes = () => import("@/app/api/weight/route");
  const one = () => import("@/app/api/weight/[id]/route");
  beforeEach(() => { f.rows = []; f.wheres = []; f.profile = { timezone: "UTC" }; f.userId = "me"; });

  it("stores kilograms under the signed-in person, whatever the body claims", async () => {
    const { PUT } = await routes();
    const r = await PUT(req("PUT", { date: "2026-01-05", weightKg: 80.126, userId: "someone-else" }), ctx());
    expect(r.status).toBe(200);
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0].userId).toBe("me");
    expect(f.rows[0].value).toBe(80.13);
  });
  it("one entry a day: logging a date again replaces it", async () => {
    const { PUT } = await routes();
    await PUT(req("PUT", { date: "2026-01-05", weightKg: 80 }), ctx());
    await PUT(req("PUT", { date: "2026-01-05", weightKg: 79 }), ctx());
    expect(f.rows.map((r) => r.value)).toEqual([79]);
  });
  it.each([
    ["below the range", { date: "2026-01-05", weightKg: 29.9 }],
    ["above the range", { date: "2026-01-05", weightKg: 300.1 }],
    ["zero", { date: "2026-01-05", weightKg: 0 }],
    ["not a number", { date: "2026-01-05", weightKg: "80" }],
    ["missing", { date: "2026-01-05" }],
    ["a bad date", { date: "yesterday", weightKg: 80 }],
    ["an impossible date", { date: "2026-02-30", weightKg: 80 }],
    ["a date far in the past", { date: "1999-01-01", weightKg: 80 }],
    ["a date in the future", { date: "2099-01-01", weightKg: 80 }],
  ])("refuses %s, and stores nothing", async (_label, body) => {
    const { PUT } = await routes();
    expect((await PUT(req("PUT", body), ctx())).status).toBe(400);
    expect(f.rows).toEqual([]);
  });
  it("lists only the person's own, with their trend", async () => {
    const { PUT, GET } = await routes();
    await PUT(req("PUT", { date: "2026-01-05", weightKg: 80 }), ctx());
    f.userId = "other";
    await PUT(req("PUT", { date: "2026-01-06", weightKg: 60 }), ctx());
    f.userId = "me";
    const body = await (await GET(req("GET"), ctx())).json();
    expect(body.entries.map((e: { weightKg: number }) => e.weightKg)).toEqual([80]);
    expect(body.trend[0].trendKg).toBe(80);
    expect(JSON.stringify(body)).not.toContain("other");
  });
  it("can't delete someone else's entry, which reads as not existing, and leaves it", async () => {
    const { PUT } = await routes();
    const { DELETE } = await one();
    f.userId = "other";
    await PUT(req("PUT", { date: "2026-01-06", weightKg: 60 }), ctx());
    const id = f.rows[0].id;
    f.userId = "me";
    const theirs = await DELETE(req("DELETE"), ctx({ id }));
    const nobody = await DELETE(req("DELETE"), ctx({ id: "no-such-id" }));
    expect(theirs.status).toBe(404);
    expect(await theirs.text()).toBe(await nobody.text());
    expect(f.rows).toHaveLength(1);
  });
  it("deletes the person's own", async () => {
    const { PUT } = await routes();
    const { DELETE } = await one();
    await PUT(req("PUT", { date: "2026-01-06", weightKg: 60 }), ctx());
    expect((await DELETE(req("DELETE"), ctx({ id: f.rows[0].id }))).status).toBe(200);
    expect(f.rows).toEqual([]);
  });
  it("every query names the owner", async () => {
    const { PUT, GET } = await routes();
    const { DELETE } = await one();
    await PUT(req("PUT", { date: "2026-01-06", weightKg: 60 }), ctx());
    await GET(req("GET"), ctx());
    await DELETE(req("DELETE"), ctx({ id: f.rows[0].id }));
    expect(f.wheres.length).toBeGreaterThanOrEqual(3);
    for (const where of f.wheres) expect(where.userId).toBe("me");
  });
  it("refuses a cross-origin write", async () => {
    const { PUT } = await routes();
    expect((await PUT(req("PUT", { date: "2026-01-05", weightKg: 80 }, "https://evil.example"), ctx())).status).toBe(403);
    expect(f.rows).toEqual([]);
  });
  it("is behind the access gate: no profile gets 409", async () => {
    const { PUT } = await routes();
    f.profile = null;
    expect((await PUT(req("PUT", { date: "2026-01-05", weightKg: 80 }), ctx())).status).toBe(409);
    expect(f.rows).toEqual([]);
  });
});
