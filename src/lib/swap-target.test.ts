import { describe, expect, it } from "vitest";
import { targetForExercise } from "./swap-target";

const latPulldown = { sets: 3, repsMin: 10, repsMax: 12, weightKg: 45 };

describe("targetForExercise (WT-04)", () => {
  it("keeps the whole target for the planned exercise itself", () => {
    expect(targetForExercise(latPulldown, { swappedIn: false })).toEqual(latPulldown);
  });
  it("drops only the weight for a swapped-in exercise: sets and reps still describe the workout", () => {
    expect(targetForExercise(latPulldown, { swappedIn: true })).toEqual({ sets: 3, repsMin: 10, repsMax: 12, weightKg: null });
  });
  it("never changes the plan's own target object", () => {
    const t = { ...latPulldown };
    targetForExercise(t, { swappedIn: true });
    expect(t.weightKg).toBe(45);
  });
  it("no plan, no target", () => {
    expect(targetForExercise(null, { swappedIn: true })).toBeNull();
  });
});
