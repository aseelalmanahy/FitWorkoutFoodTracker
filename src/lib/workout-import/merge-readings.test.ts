import { describe, expect, it } from "vitest";
import { fillMissingReps, rowsMissingReps } from "./merge-readings";
import { parseWorkoutText } from "./parse";

const first = [
  "MONDAY         + Barbell Bench Press          3 sets of 8-12 reps",
  "* Tricep Pushdowns                            3 sets of B12 reps",
  "Cable Flyes                                   3 sets of 8-12 reps",
].join("\n");
const rows = (t: string) => parseWorkoutText(t, { ocr: true }).days.flatMap((d) => d.exercises.map((e) => `${d.name}: ${e.name} ${e.sets}x${e.repsMin}-${e.repsMax}`));

describe("fillMissingReps (IMG-01)", () => {
  it("finds the row read without its reps", () => {
    expect(rowsMissingReps(first).map((e) => e.name)).toEqual(["Tricep Pushdowns"]);
  });

  it("takes the reps from a second reading that agrees on the exercise and its sets", () => {
    const second = "MONDAY  Barbell Bench Press   3 sets of 8-12 reps\nTricep Pushdowns    3 sets of 8-12 reps\nCable Flyes   3 sets of 8-12 reps";
    const { text, filled } = fillMissingReps(first, second);
    expect(filled).toBe(1);
    expect(rows(text)).toEqual(["MONDAY: Barbell Bench Press 3x8-12", "MONDAY: Tricep Pushdowns 3x8-12", "MONDAY: Cable Flyes 3x8-12"]);
  });

  it("leaves the row for the person when the readings disagree on the sets", () => {
    expect(fillMissingReps(first, "Tricep Pushdowns   4 sets of 8-12 reps").filled).toBe(0);
  });

  it("leaves it when the second reading names the exercise differently or not at all", () => {
    expect(fillMissingReps(first, "Tricep Pushdown Bar   3 sets of 8-12 reps").filled).toBe(0);
    expect(fillMissingReps(first, "Cable Flyes   3 sets of 8-12 reps").filled).toBe(0);
  });

  it("leaves it when the second reading has that exercise twice", () => {
    expect(fillMissingReps(first, "Tricep Pushdowns   3 sets of 8-12 reps\nTricep Pushdowns   3 sets of 10-15 reps").filled).toBe(0);
  });

  it("changes nothing when nothing is missing", () => {
    const complete = "Leg Press   3 sets of 10-12 reps";
    expect(fillMissingReps(complete, "Leg Press   3 sets of 8 reps")).toEqual({ text: complete, filled: 0 });
  });
});
