import type { Profile } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { accessStateFor } from "@/lib/eligibility";
import { profileToValues } from "./serialize";

const required = { userId: "u1", name: "Sam", birthDate: new Date("1990-01-01T00:00:00Z"), unitSystem: "METRIC", timezone: "UTC", updatedAt: new Date(), calorieTargetOverride: null } as const;
const empty = { sex: null, heightCm: null, currentWeightKg: null, goalWeightKg: null, goal: null, activityLevel: null, experience: null, workoutDaysPerWeek: null } as const;

describe("profileToValues", () => {
  it("passes every null through, with nothing invented", () => {
    expect(profileToValues({ ...required, ...empty } as Profile)).toEqual({ name: "Sam", birthDate: "1990-01-01", unitSystem: "METRIC", timezone: "UTC", ...empty });
  });
  it("keeps legacy values exactly, including zero workout days", () => {
    const legacy = { sex: "FEMALE", heightCm: 170.33, currentWeightKg: 60.125, goalWeightKg: 55, goal: "MAINTENANCE", activityLevel: "LIGHT", experience: "BEGINNER", workoutDaysPerWeek: 0 } as const;
    expect(profileToValues({ ...required, ...legacy } as Profile)).toEqual({ name: "Sam", birthDate: "1990-01-01", unitSystem: "METRIC", timezone: "UTC", ...legacy });
  });
  it("doesn't expose the unused override", () => {
    expect("calorieTargetOverride" in profileToValues({ ...required, ...empty, calorieTargetOverride: 800 } as Profile)).toBe(false);
  });
});

describe("the access gate reads only the date of birth", () => {
  it("lets an adult with every optional field null in", () => {
    expect(accessStateFor({ birthDate: required.birthDate } as Profile)).toBe("ok");
  });
  it("still restricts someone under the minimum with every optional field null", () => {
    const year = new Date().getUTCFullYear();
    expect(accessStateFor({ birthDate: new Date(Date.UTC(year - 10, 0, 1)) } as Profile)).toBe("restricted");
  });
});
