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
  it.each(["sex", "goal", "activityLevel", "experience", "workoutDaysPerWeek", "unitSystem"])("requires %s, with no default", (field) => {
    const body: Record<string, unknown> = { ...profile };
    delete body[field];
    expect(profileSchema.safeParse(body).success).toBe(false);
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
