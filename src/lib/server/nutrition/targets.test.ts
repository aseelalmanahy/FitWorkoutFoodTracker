// Phase 4.0.1b write rules, with the real logic and an in-memory table. No database is touched, so this
// proves the rules and not the migration: scripts/nutrition-targets.test.cjs covers the real columns.
import type { NutritionTarget, Profile } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { targetForDate } from "@/lib/nutrition";
import { getTargets, localToday, setManualTarget, stopTarget } from "./targets";

const table = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/server/db", () => {
  const key = (r: Record<string, unknown>) => (r.effectiveFrom as Date).getTime();
  const nutritionTarget = {
    findMany: async ({ where }: { where: { userId: string } }) => table.rows.filter((r) => r.userId === where.userId).sort((a, b) => key(a) - key(b)),
    findFirst: async ({ where }: { where: { userId: string } }) => table.rows.filter((r) => r.userId === where.userId).sort((a, b) => key(b) - key(a))[0] ?? null,
    upsert: async ({ where, create, update }: { where: { userId_effectiveFrom: { userId: string; effectiveFrom: Date } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      const { userId, effectiveFrom } = where.userId_effectiveFrom;
      const found = table.rows.find((r) => r.userId === userId && key(r) === effectiveFrom.getTime());
      if (found) return Object.assign(found, update);
      const row = { ...create };
      table.rows.push(row);
      return row;
    },
    deleteMany: async ({ where }: { where: { userId: string } }) => { table.rows = table.rows.filter((r) => r.userId !== where.userId); return { count: 0 }; },
  };
  return { prisma: { nutritionTarget } };
});

const profile = { timezone: "UTC" } as Profile;
const today = localToday("UTC");
const dayOffset = (n: number) => new Date(new Date(`${today}T00:00:00Z`).getTime() + n * 86400000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const row = (userId: string, offset: number, kcal: number | null, source: NutritionTarget["source"] = "MANUAL") => ({
  userId, effectiveFrom: dayOffset(offset), kcal, proteinG: kcal === null ? null : 100, carbsG: kcal === null ? null : 200, fatG: kcal === null ? null : 50, source,
});
const snapshot = () => JSON.parse(JSON.stringify(table.rows));

beforeEach(() => { table.rows = []; });

describe("setManualTarget", () => {
  const save = (proteinG: number | null, fatG: number | null, kcal = 2000) => setManualTarget("a", profile, { kcal, proteinG, fatG });

  it("T41: calories only stores null macros and invents no carbs", async () => {
    expect(await save(null, null)).toMatchObject({ kcal: 2000, proteinG: null, carbsG: null, fatG: null, source: "MANUAL", effectiveFrom: today });
  });
  it("T41: calories with protein, and with fat, derive no carbs", async () => {
    expect(await save(150, null)).toMatchObject({ proteinG: 150, carbsG: null, fatG: null });
    expect(await save(null, 60)).toMatchObject({ proteinG: null, carbsG: null, fatG: 60 });
  });
  it("T41: carbs are derived only when protein and fat are both given", async () => {
    expect(await save(150, 60)).toMatchObject({ proteinG: 150, carbsG: 215, fatG: 60 });
  });
  it("T41: zero stays zero, and counts as given", async () => {
    expect(await save(0, 0)).toMatchObject({ proteinG: 0, carbsG: 500, fatG: 0 });
    expect(await save(0, null)).toMatchObject({ proteinG: 0, carbsG: null, fatG: null });
    expect(await save(null, 0)).toMatchObject({ proteinG: null, carbsG: null, fatG: 0 });
  });
  it("refuses what doesn't fit, including one macro alone, and writes nothing", async () => {
    await expect(save(600, null, 800)).rejects.toThrow(/more energy/);
    await expect(save(null, 100, 800)).rejects.toThrow(/more energy/);
    await expect(save(200, 100, 800)).rejects.toThrow(/more energy/);
    expect(table.rows).toEqual([]);
  });
  it("T42: a row dated tomorrow can't silently replace today's choice", async () => {
    table.rows = [row("a", 1, 2500)];
    const saved = await save(null, null);
    expect(saved.effectiveFrom).toBe(iso(dayOffset(1)));
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].kcal).toBe(2000);
  });
});

describe("stopTarget", () => {
  it("T39: writes one stopped row, and earlier rows are unchanged in every column", async () => {
    table.rows = [row("a", -10, 2500, "SUGGESTED"), row("a", -5, 2200)];
    const before = snapshot();
    const r = await stopTarget("a", profile);
    expect(r.stopped).toBe(true);
    expect(snapshot().slice(0, 2)).toEqual(before);
    expect(table.rows).toHaveLength(3);
    expect(table.rows[2]).toMatchObject({ kcal: null, proteinG: null, carbsG: null, fatG: null, source: "MANUAL" });
    expect(iso(table.rows[2].effectiveFrom as Date)).toBe(today);
  });
  it("T39: today has no target and past days keep theirs", async () => {
    table.rows = [row("a", -5, 2200)];
    await stopTarget("a", profile);
    const rows = await getTargets("a");
    expect(targetForDate(rows, today)).toBeNull();
    expect(targetForDate(rows, iso(dayOffset(-1)))?.kcal).toBe(2200);
    expect(targetForDate(rows, iso(dayOffset(-6)))).toBeNull();
  });
  it("T39: a row set today is replaced, as one row exists per date", async () => {
    table.rows = [row("a", -5, 2200), row("a", 0, 1900)];
    await stopTarget("a", profile);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].kcal).toBe(2200);
    expect(table.rows[1].kcal).toBeNull();
  });
  it("T39: a legacy automatic target can be stopped, and the stop is the person's own", async () => {
    table.rows = [row("a", -1, 1110, "SUGGESTED")];
    await stopTarget("a", profile);
    expect(table.rows[0].source).toBe("SUGGESTED");
    expect(table.rows[1]).toMatchObject({ kcal: null, source: "MANUAL" });
  });
  it("T40: with no target, nothing is written", async () => {
    expect(await stopTarget("a", profile)).toEqual({ stopped: false });
    expect(table.rows).toEqual([]);
  });
  it("T40: repeating it is harmless", async () => {
    table.rows = [row("a", -5, 2200)];
    await stopTarget("a", profile);
    const after = snapshot();
    expect(await stopTarget("a", profile)).toEqual({ stopped: false });
    expect(snapshot()).toEqual(after);
  });
  it("T42: with a row dated tomorrow, the stop still holds tomorrow", async () => {
    table.rows = [row("a", -5, 2200), row("a", 1, 2500)];
    await stopTarget("a", profile);
    const rows = await getTargets("a");
    expect(targetForDate(rows, iso(dayOffset(1)))).toBeNull();
    expect(targetForDate(rows, iso(dayOffset(30)))).toBeNull();
    expect(table.rows.find((r) => r.kcal === 2200)).toBeTruthy();
  });
  it("T39: another person's rows are untouched", async () => {
    table.rows = [row("a", -5, 2200), row("b", -5, 3000)];
    await stopTarget("a", profile);
    expect(table.rows.filter((r) => r.userId === "b")).toEqual([row("b", -5, 3000)]);
    expect(await stopTarget("c", profile)).toEqual({ stopped: false });
  });
  it("a new target after stopping takes effect", async () => {
    table.rows = [row("a", -5, 2200)];
    await stopTarget("a", profile);
    await setManualTarget("a", profile, { kcal: 1900, proteinG: null, fatG: null });
    expect(targetForDate(await getTargets("a"), today)?.kcal).toBe(1900);
  });
});
