import { describe, expect, it } from "vitest";
import {
  addDays, carbsFromRemainder, entryNutrients, isIsoDate, macroKcal, mondayOf, progress, remaining,
  scaleNutrients, sumNutrients, summarizePeriod, targetForDate, type DaySummary, type Nutrients,
} from "./nutrition";

const per100: Nutrients = { kcal: 200, protein: 10, carbs: 25, fat: 7.5, fiber: null };

describe("serving-size scaling", () => {
  it("spec example: 200 kcal/serving × 1.5 servings = 300 kcal", () => {
    // a 100 g serving of a 200 kcal/100 g food
    expect(entryNutrients(per100, 100, 1.5).kcal).toBe(300);
  });
  it("scales by grams", () => {
    const n = scaleNutrients(per100, 37);
    expect(n).toEqual({ kcal: 74, protein: 3.7, carbs: 9.25, fat: 2.78, fiber: null });
  });
  it("keeps missing nutrients missing instead of zero", () => {
    expect(entryNutrients(per100, 50, 2).fiber).toBeNull();
  });
  it("zero quantity contributes zero", () => {
    expect(entryNutrients(per100, 50, 0).kcal).toBe(0);
  });
  it("avoids binary float artefacts", () => {
    expect(entryNutrients({ ...per100, protein: 1.1 }, 30, 1).protein).toBe(0.33);
  });
});

describe("totals", () => {
  it("sums known values and flags incomplete nutrients", () => {
    const t = sumNutrients([
      { kcal: 100, protein: 5, carbs: 10, fat: 2, fiber: 1 },
      { kcal: 250.5, protein: 20.25, carbs: 0, fat: 9, fiber: null },
    ]);
    expect(t.kcal).toBe(350.5);
    expect(t.protein).toBe(25.25);
    expect(t.fiber).toBe(1);
    expect(t.incomplete).toEqual(["fiber"]);
  });
  it("empty day totals zero", () => {
    expect(sumNutrients([]).kcal).toBe(0);
  });
});

describe("remaining and progress", () => {
  it("reports over-target intake without negative remaining", () => {
    expect(remaining(2000, 2350)).toEqual({ remaining: 0, over: 350 });
    expect(remaining(2000, 1850)).toEqual({ remaining: 150, over: 0 });
  });
  it("caps bar fraction but keeps ratio", () => {
    expect(progress(250, 200)).toEqual({ fraction: 1, ratio: 1.25 });
    expect(progress(10, 0).fraction).toBe(0);
  });
});

describe("macro targets", () => {
  it("derives carbs from remainder", () => {
    expect(carbsFromRemainder(2000, 150, 60)).toBe(215); // 2000-600-540=860/4
    expect(carbsFromRemainder(1000, 200, 100)).toBeNull();
  });
});

describe("targets by date", () => {
  const targets = [
    { effectiveFrom: "2026-10-01", kcal: 2400 },
    { effectiveFrom: "2026-10-20", kcal: 2200 },
  ];
  it("uses the latest target effective on or before the date", () => {
    expect(targetForDate(targets, "2026-10-19")?.kcal).toBe(2400);
    expect(targetForDate(targets, "2026-10-20")?.kcal).toBe(2200);
    expect(targetForDate(targets, "2026-11-05")?.kcal).toBe(2200);
  });
  it("returns null before the first target", () => {
    expect(targetForDate(targets, "2026-09-30")).toBeNull();
  });
});

describe("calendar dates", () => {
  it("validates ISO dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-2-3")).toBe(false);
  });
  it("adds days across month/year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("finds Monday", () => {
    expect(mondayOf("2026-11-03")).toBe("2026-11-02");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
  });
});

describe("period summary", () => {
  const T = (kcal: number, proteinG: number) => ({ effectiveFrom: "2026-01-01", kcal, proteinG, carbsG: 0, fatG: 0, source: "MANUAL" as const });
  const day = (date: string, kcal: number, protein: number, entries = 1, target = T(2000, 150)): DaySummary => ({
    date, entries, target, totals: { kcal, protein, carbs: 0, fat: 0, fiber: 0, incomplete: [] },
  });
  it("averages over logged days only and counts protein consistency", () => {
    const s = summarizePeriod([
      day("2026-11-02", 2000, 150),
      day("2026-11-03", 1800, 120),
      day("2026-11-04", 0, 0, 0),
      day("2026-11-05", 2200, 135), // 135 ≥ 0.9×150
    ]);
    expect(s.daysLogged).toBe(3);
    expect(s.avg?.kcal).toBe(2000);
    expect(s.avg?.protein).toBe(135);
    expect(s.proteinOnTargetDays).toBe(2);
    expect(s.proteinDaysWithTarget).toBe(3);
  });
  it("uses each day's own historical target", () => {
    const s = summarizePeriod([day("2026-11-02", 2000, 150, 1, T(2400, 150)), day("2026-11-03", 2000, 150, 1, T(2000, 150))]);
    expect(s.avgTargetKcal).toBe(2200);
  });
  it("returns null averages when nothing logged", () => {
    expect(summarizePeriod([day("2026-11-02", 0, 0, 0)]).avg).toBeNull();
  });
});

import { implausibleNutrients, sanitizePer100, PLAUSIBLE_KCAL_PER_100 } from "./nutrition";

describe("plausibility limits", () => {
  const ok: Nutrients = { kcal: 884, protein: 0, carbs: 0, fat: 100, fiber: null }; // olive oil
  it("accepts real extremes (pure fat, 100 g sugar, whey isolate)", () => {
    expect(implausibleNutrients(ok, "G")).toEqual([]);
    expect(implausibleNutrients({ kcal: 387, protein: 0, carbs: 100, fat: 0, fiber: 0 }, "G")).toEqual([]);
    expect(implausibleNutrients({ kcal: 370, protein: 90, carbs: 2, fat: 1, fiber: null }, "G")).toEqual([]);
  });
  it("rejects the reproduced 54,000,000 kcal/100 g provider value as not reported", () => {
    const r = sanitizePer100({ kcal: 54_000_000, protein: 6, carbs: 50, fat: 30, fiber: null }, "G");
    expect(r.rejected).toEqual(["kcal"]);
    expect(r.per100).toEqual({ kcal: null, protein: 6, carbs: 50, fat: 30, fiber: null });
  });
  it("rejects the reproduced 12,500 kcal and 250 g protein per 100 g", () => {
    expect(implausibleNutrients({ kcal: 12_500, protein: 250, carbs: 0, fat: 0, fiber: null }, "G").sort()).toEqual(["kcal", "protein"]);
  });
  it("energy limit is 900 kcal (pure fat) plus 5 %", () => {
    expect(PLAUSIBLE_KCAL_PER_100).toBe(950);
    expect(implausibleNutrients({ ...ok, kcal: 950 }, "G")).toEqual([]);
    expect(implausibleNutrients({ ...ok, kcal: 951 }, "G")).toEqual(["kcal"]);
  });
  it("an impossible macro sum makes all macros unknown", () => {
    const r = sanitizePer100({ kcal: 500, protein: 60, carbs: 60, fat: 10, fiber: null }, "G");
    expect(r.per100).toEqual({ kcal: 500, protein: null, carbs: null, fat: null, fiber: null });
  });
  it("allows up to 150 g per 100 ml for dense liquids", () => {
    expect(implausibleNutrients({ kcal: 430, protein: 0, carbs: 116, fat: 0, fiber: null }, "ML")).toEqual([]); // honey by volume
    expect(implausibleNutrients({ kcal: 430, protein: 0, carbs: 116, fat: 0, fiber: null }, "G")).toEqual(["carbs"]);
  });
  it("rejects negative values", () => {
    expect(implausibleNutrients({ kcal: -1, protein: null, carbs: null, fat: null, fiber: null }, "G")).toEqual(["kcal"]);
  });
});
