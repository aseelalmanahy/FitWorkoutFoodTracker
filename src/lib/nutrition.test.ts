import { describe, expect, it } from "vitest";
import {
  addDays, carbsFromRemainder, entryNutrients, isIsoDate, macroKcal, mondayOf, progress, remaining,
  scaleNutrients, sumNutrients, summarizePeriod, targetForDate, type DaySummary, type Nutrients,
} from "./nutrition";
import { suggestMacros } from "./energy";

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
  it("are internally consistent with the energy target", () => {
    for (const goal of ["FAT_LOSS", "MUSCLE_GAIN", "MAINTENANCE", "STRENGTH"] as const) {
      for (const kcal of [1200, 1800, 2500, 3500]) {
        const m = suggestMacros({ kcal, weightKg: 80, goal });
        const e = macroKcal(m.proteinG, m.carbsG, m.fatG);
        expect(e).toBeLessThanOrEqual(kcal);
        expect(kcal - e).toBeLessThan(4 + 1e-9);
        expect(m.carbsG).toBeGreaterThanOrEqual(0);
      }
    }
  });
  it("uses 1.6 g/kg protein for muscle gain and 2.0 g/kg for fat loss", () => {
    expect(suggestMacros({ kcal: 2800, weightKg: 80, goal: "MUSCLE_GAIN" }).proteinG).toBe(128);
    expect(suggestMacros({ kcal: 2200, weightKg: 80, goal: "FAT_LOSS" }).proteinG).toBe(160);
  });
  it("uses goal weight as protein reference for fat loss", () => {
    expect(suggestMacros({ kcal: 2200, weightKg: 120, goalWeightKg: 90, goal: "FAT_LOSS" }).proteinG).toBe(180);
  });
  it("fits protein and fat inside very low energy targets", () => {
    const m = suggestMacros({ kcal: 800, weightKg: 150, goal: "FAT_LOSS" });
    expect(macroKcal(m.proteinG, m.carbsG, m.fatG)).toBeLessThanOrEqual(800);
  });
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
