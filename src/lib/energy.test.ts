import { describe, expect, it } from "vitest";
import { ageFromBirthDate, mifflinStJeorBmr, suggestCalories } from "./energy";

describe("Mifflin-St Jeor", () => {
  it("matches the published equation for men", () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5
    expect(mifflinStJeorBmr({ sex: "MALE", weightKg: 80, heightCm: 180, age: 30 })).toBe(1780);
  });
  it("matches the published equation for women", () => {
    // 10*60 + 6.25*165 - 5*28 - 161 = 600 + 1031.25 - 140 - 161
    expect(mifflinStJeorBmr({ sex: "FEMALE", weightKg: 60, heightCm: 165, age: 28 })).toBeCloseTo(1330.25);
  });
});

describe("suggestCalories", () => {
  const base = { sex: "MALE" as const, weightKg: 80, heightCm: 180, age: 30, activity: "MODERATE" as const };
  it("maintenance equals TDEE", () => {
    const s = suggestCalories({ ...base, goal: "MAINTENANCE" });
    expect(s.tdee).toBe(Math.round(1780 * 1.55));
    expect(s.target).toBe(Math.round((1780 * 1.55) / 10) * 10);
  });
  it("caps the fat-loss deficit at 500 kcal", () => {
    const s = suggestCalories({ ...base, goal: "FAT_LOSS" });
    expect(s.tdee - s.target).toBeLessThanOrEqual(505);
    expect(s.tdee - s.target).toBeGreaterThan(400);
  });
  it("never suggests below the floor", () => {
    const s = suggestCalories({ sex: "FEMALE", weightKg: 45, heightCm: 150, age: 60, activity: "SEDENTARY", goal: "FAT_LOSS" });
    expect(s.target).toBeGreaterThanOrEqual(1200);
    expect(s.floorApplied).toBe(true);
  });
  it("caps the surplus at 350 kcal", () => {
    const s = suggestCalories({ ...base, activity: "VERY_ACTIVE", goal: "MUSCLE_GAIN" });
    expect(s.target - s.tdee).toBeLessThanOrEqual(355);
  });
});

describe("ageFromBirthDate", () => {
  it("handles birthdays not yet reached this year", () => {
    expect(ageFromBirthDate(new Date("1990-12-31"), new Date("2026-11-03"))).toBe(35);
    expect(ageFromBirthDate(new Date("1990-01-01"), new Date("2026-11-03"))).toBe(36);
  });
});
