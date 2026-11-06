import { describe, expect, it } from "vitest";
import { nutritionTargetSchema, profileSchema } from "./validation";

const profile = {
  name: "Sam", birthDate: "1990-01-01", sex: "MALE", heightCm: 180, currentWeightKg: 80, goalWeightKg: null, goal: "MAINTENANCE",
  activityLevel: "MODERATE", experience: "BEGINNER", workoutDaysPerWeek: 3, unitSystem: "METRIC", timezone: "UTC",
};

describe("profileSchema", () => {
  it.each(["2000-02-30", "2001-02-29", "1990-1-1", "not a date"])("refuses the malformed date %s", (birthDate) => {
    expect(profileSchema.safeParse({ ...profile, birthDate }).success).toBe(false);
  });
  it("holds no age rule, so an age message can't leak through validation", () => {
    expect(profileSchema.safeParse({ ...profile, birthDate: "2020-01-01" }).success).toBe(true);
  });
  it("T13: drops calorieTargetOverride, so a sent value can't reach the column", () => {
    const parsed = profileSchema.parse({ ...profile, calorieTargetOverride: 800 });
    expect("calorieTargetOverride" in parsed).toBe(false);
  });
  const REQUIRED = { name: "Sam", birthDate: "1990-01-01", unitSystem: "METRIC", timezone: "UTC" };
  const OPTIONAL = ["sex", "heightCm", "currentWeightKg", "goalWeightKg", "goal", "activityLevel", "experience", "workoutDaysPerWeek"];
  it("T45: needs only the four used fields, and adds no value of its own", () => {
    expect(profileSchema.parse(REQUIRED)).toEqual(REQUIRED);
  });
  it.each(Object.keys(REQUIRED))("still requires %s: omitted and null are both refused", (field) => {
    const omitted: Record<string, unknown> = { ...REQUIRED };
    delete omitted[field];
    expect(profileSchema.safeParse(omitted).success).toBe(false);
    expect(profileSchema.safeParse({ ...REQUIRED, [field]: null }).success).toBe(false);
  });
  it.each(OPTIONAL)("keeps %s omitted, null and a value distinct", (field) => {
    const omitted = profileSchema.parse(REQUIRED);
    expect(field in omitted).toBe(false);
    const cleared = profileSchema.parse({ ...REQUIRED, [field]: null }) as Record<string, unknown>;
    expect(field in cleared).toBe(true);
    expect(cleared[field]).toBeNull();
    const value = (profile as Record<string, unknown>)[field] ?? 75;
    expect((profileSchema.parse({ ...REQUIRED, [field]: value }) as Record<string, unknown>)[field]).toBe(value);
  });
  it("keeps a zero as a zero", () => {
    expect(profileSchema.parse({ ...REQUIRED, workoutDaysPerWeek: 0 }).workoutDaysPerWeek).toBe(0);
  });
  it.each([["sex", ""], ["heightCm", 99], ["heightCm", ""], ["currentWeightKg", 301], ["goalWeightKg", 29], ["goal", "NONE"], ["activityLevel", 0], ["experience", ""], ["workoutDaysPerWeek", 8], ["workoutDaysPerWeek", 2.5]])("refuses %s = %j, so a blank never clears", (field, value) => {
    expect(profileSchema.safeParse({ ...REQUIRED, [field]: value }).success).toBe(false);
  });
});

describe("nutritionTargetSchema", () => {
  it("keeps its data range unchanged", () => {
    for (const kcal of [800, 8000]) expect(nutritionTargetSchema.safeParse({ kcal, proteinG: 0, fatG: 0 }).success).toBe(true);
    for (const kcal of [799, 8001]) expect(nutritionTargetSchema.safeParse({ kcal, proteinG: 0, fatG: 0 }).success).toBe(false);
  });
  it("T30: an omitted macro key is refused, and never becomes 0", () => {
    expect(nutritionTargetSchema.safeParse({ kcal: 2000, proteinG: 100 }).success).toBe(false);
    expect(nutritionTargetSchema.safeParse({ kcal: 2000, fatG: 50 }).success).toBe(false);
    expect(nutritionTargetSchema.safeParse({ kcal: 2000 }).success).toBe(false);
  });
  it("T41: null means not set, and zero stays zero", () => {
    expect(nutritionTargetSchema.parse({ kcal: 2000, proteinG: null, fatG: null })).toEqual({ kcal: 2000, proteinG: null, fatG: null });
    expect(nutritionTargetSchema.parse({ kcal: 2000, proteinG: 0, fatG: null })).toEqual({ kcal: 2000, proteinG: 0, fatG: null });
  });
  it("T41: calories can't be null, so a form or client bug can't stop a target", () => {
    expect(nutritionTargetSchema.safeParse({ kcal: null, proteinG: null, fatG: null }).success).toBe(false);
    expect(nutritionTargetSchema.safeParse({ proteinG: null, fatG: null }).success).toBe(false);
  });
});
