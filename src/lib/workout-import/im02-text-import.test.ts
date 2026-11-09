// IM-02: the owner's text plan ("workout 1.txt": three full-body days, several "A or B" rows). Its saved plans held
// exercises that weren't in the file. Reproduced: parsing, grouping and matching were right (this file), so the
// wrong exercises came from the manual choice step, which now has Skip and a summary before saving. One parsing
// defect was found and fixed here: a timed set ("3 sets x 30-60 seconds") was read as 30-60 repetitions.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkoutText } from "./parse";
import { matchExercise, normalizeExerciseName } from "./match";

const text = readFileSync(path.join(__dirname, "fixtures", "three-day-alternatives.txt"), "utf8");
const seed = readFileSync(path.join(__dirname, "..", "..", "..", "prisma", "seed.ts"), "utf8");
const library = [...seed.matchAll(/\["([A-Z][^"]+)", "[A-Z_]+"/g)].map((m, i) => ({ id: `e${i}`, name: m[1], userId: null }));
const draft = parseWorkoutText(text);
const sr = (e: { sets: number | null; repsMin: number | null; repsMax: number | null }) => `${e.sets}x${e.repsMin}-${e.repsMax}`;

describe("IM-02: the three-day text plan", () => {
  it("reads three days, in order, with their own names", () => {
    expect(draft.programName).toBe("Sample Workout Structure (60-75 minutes per session):");
    expect(draft.days.map((d) => d.name)).toEqual(["Day 1: Full Body A (Quad/Push Focus)", "Day 2: Full Body B (Hinge/Pull Focus)", "Day 3: Full Body C (Power & Accessory Focus)"]);
  });

  it("keeps every exercise under its own day, in order, as written, with its sets and reps", () => {
    expect(draft.days.map((d) => d.exercises.map((e) => `${e.name} ${sr(e)}`))).toEqual([
      ["Barbell or Goblet Squat 3x6-10", "Incline Dumbbell Bench Press 3x8-12", "Seated Cable Row or Barbell Row 3x8-12", "Romanian Deadlift 3x8-12", "Dumbbell Lateral Raises 3x12-15", "Plank or Core exercise 3xnull-null"],
      ["Romanian Deadlift or Trap Bar Deadlift 3x6-8", "Overhead Barbell or Dumbbell Press 3x8-12", "Lat Pulldown or Pull-ups 3x8-12", "Leg Press or Bulgarian Split Squats 3x8-12", "Bicep Curls & Tricep Pushdowns (Superset) 3x10-15", "Hanging Leg Raises 3x10-15"],
      ["Front Squat or Leg Press 3x8-12", "Flat Dumbbell Bench Press or Push-ups 3x8-12", "Chest-Supported Row 3x8-12", "Leg Curls 3x10-15", "Calf Raises 3x15-15", "Face Pulls (Rear Delts/Posture) 3x12-15"],
    ]);
  });

  it("reads a timed set as a time, not as repetitions, and keeps it as written for the person", () => {
    const plank = draft.days[0].exercises[5];
    expect([plank.repsMin, plank.repsMax]).toEqual([null, null]);
    expect(plank.notes).toContain("Reps as written: 30-60 seconds");
  });

  it("chooses an exercise by itself only when it's the same exercise, never one the row doesn't name", () => {
    const exact = draft.days.flatMap((d) => d.exercises).map((e) => [e.name, matchExercise(e.name, library)] as const).filter(([, m]) => m.kind === "exact");
    expect(exact.map(([n, m]) => [n, m.kind === "exact" ? m.exercise.name : ""])).toEqual([
      ["Romanian Deadlift", "Romanian Deadlift"], ["Dumbbell Lateral Raises", "Dumbbell Lateral Raise"],
      ["Hanging Leg Raises", "Hanging Leg Raise"], ["Chest-Supported Row", "Chest-Supported Row"],
    ]);
    for (const [n, m] of exact) if (m.kind === "exact") expect(normalizeExerciseName(m.exercise.name)).toBe(normalizeExerciseName(n));
  });

  it("offers both exercises of an \"A or B\" row, and the right ones first, for the person to choose", () => {
    const top = (name: string, k = 2) => { const m = matchExercise(name, library); return m.kind === "choose" ? m.suggestions.slice(0, k).map((s) => s.name) : [`exact:${m.exercise.name}`]; };
    expect(top("Seated Cable Row or Barbell Row")).toEqual(["Seated Cable Row", "Barbell Row"]);
    expect(top("Lat Pulldown or Pull-ups")).toEqual(["Lat Pulldown", "Pull-Up"]);
    expect(top("Leg Press or Bulgarian Split Squats").sort()).toEqual(["Bulgarian Split Squat", "Leg Press"]);
    expect(top("Front Squat or Leg Press")).toEqual(["Front Squat", "Leg Press"]);
    expect(top("Romanian Deadlift or Trap Bar Deadlift")).toEqual(["Romanian Deadlift", "Deadlift"]);
    expect(top("Leg Curls")).toEqual(["Lying Leg Curl", "Seated Leg Curl"]);
    expect(top("Face Pulls (Rear Delts/Posture)", 1)).toEqual(["Face Pull"]);
    expect(top("Barbell or Goblet Squat", 1)).toEqual(["Back Squat"]);
  });
});
