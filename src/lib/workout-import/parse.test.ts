// Phase 3: plans as people write them. Every value in a draft must be one the plan states; everything else is empty.
import { describe, expect, it } from "vitest";
import { matchExercise, normalizeExerciseName, type LibraryExercise } from "./match";
import { parseExerciseLine, parseWorkoutTable, parseWorkoutText, weekdayOf } from "./parse";

describe("one exercise line", () => {
  it("sets, a rep range, a weight with its unit, and rest", () => {
    expect(parseExerciseLine("Barbell Bench Press 4x8-10 @ 60kg, rest 90s")).toMatchObject({ name: "Barbell Bench Press", sets: 4, repsMin: 8, repsMax: 10, weight: { value: 60, unit: "kg" }, restSeconds: 90, notes: [] });
    expect(parseExerciseLine("• Squat – 5 sets of 5 reps @ 225 lbs (rest 3 min)")).toMatchObject({ name: "Squat", sets: 5, repsMin: 5, repsMax: 5, weight: { value: 225, unit: "lb" }, restSeconds: 180 });
    expect(parseExerciseLine("3. Lat Pulldown: 3 × 12, 2:00 rest")).toMatchObject({ name: "Lat Pulldown", sets: 3, repsMin: 12, repsMax: 12, restSeconds: 120 });
  });
  it("leaves out what isn't stated, and keeps what can't be stored as values in the notes, word for word", () => {
    expect(parseExerciseLine("Deadlift 3x5")).toMatchObject({ weight: null, restSeconds: null, notes: [] });
    const unitless = parseExerciseLine("Overhead Press 3x8 @ 40 rest 90")!;
    expect(unitless).toMatchObject({ weight: null, restSeconds: null });
    expect(unitless.notes).toEqual(["Weight as written, with no unit: 40", "Rest as written, with no unit: 90"]);
    expect(parseExerciseLine("Pull-Up 3xAMRAP")).toMatchObject({ sets: 3, repsMin: null, repsMax: null, notes: ["Reps as written: AMRAP"] });
    expect(parseExerciseLine("Plank 3 x 45s")).toMatchObject({ sets: 3, repsMin: null, notes: ["Reps as written: 45s"] });
    expect(parseExerciseLine("Front Squat 4x6 @ 70% 1RM, RPE 8")!.notes).toEqual(["70% 1RM", "RPE 8"]);
    expect(parseExerciseLine("Leg Press 3 sets")).toMatchObject({ sets: 3, repsMin: null, repsMax: null });
  });
  it("supersets keep their group", () => {
    expect(parseExerciseLine("A1. Dumbbell Curl 3x12")).toMatchObject({ name: "Dumbbell Curl", group: "A" });
    expect(parseExerciseLine("a2) Triceps Pushdown 3x12")).toMatchObject({ name: "Triceps Pushdown", group: "A" });
  });
  it("isn't fooled by text that only looks like one", () => {
    for (const not of ["Week 1", "Rest day", "Notes: drink water", "3x a week", "2024 programme", "Bench 25x8", "x 3x8"]) expect(parseExerciseLine(not), not).toBeNull();
  });
});

describe("weekdays", () => {
  it("only an unambiguous weekday name counts", () => {
    expect(weekdayOf("Monday – Push")).toBe(0);
    expect(weekdayOf("Day 3 (Wed): Legs")).toBe(2);
    expect(weekdayOf("Day 1")).toBeNull();
    expect(weekdayOf("Mon/Thu: Upper")).toBeNull();
    expect(weekdayOf("Monster circuit")).toBeNull();
  });
});

describe("a whole plan", () => {
  const split = `Hypertrophy Block A

Monday – Push
Barbell Bench Press 4x8-10 @ 60kg
Overhead Press 3x8 @ 40
Notes: keep 2 reps in reserve

Wednesday – Pull
Pull-Up 3xAMRAP
Barbell Row 4x8 @ 135 lb, rest 2 min
Rest day

Friday: Legs
Squat 5x5
Squat 3x8
Romanian Deadlift 3x10`;
  const draft = parseWorkoutText(split);
  it("names the program and finds each day, with its weekday only when stated", () => {
    expect(draft.programName).toBe("Hypertrophy Block A");
    expect(draft.days.map((d) => [d.name, d.weekday, d.exercises.length])).toEqual([["Monday - Push", 0, 2], ["Wednesday - Pull", 2, 2], ["Friday: Legs", 4, 3]]);
  });
  it("keeps a repeated exercise as written, twice, in order", () => {
    expect(draft.days[2].exercises.map((e) => `${e.name} ${e.sets}x${e.repsMin}`)).toEqual(["Squat 5x5", "Squat 3x8", "Romanian Deadlift 3x10"]);
  });
  it("puts notes with their day and says what it left empty", () => {
    expect(draft.days[0].notes).toEqual(["Notes: keep 2 reps in reserve"]);
    expect(draft.warnings.join(" ")).toMatch(/1 weight or rest value has no unit/);
  });
  it("a single workout with no headings becomes one day; a file of nothing says so", () => {
    expect(parseWorkoutText("Squat 3x5\nBench 3x5").days).toHaveLength(1);
    const none = parseWorkoutText("Just some text\nwith nothing in it");
    expect(none.days).toEqual([]);
    expect(none.warnings.join()).toMatch(/No exercises/);
  });
  it("numbered days with no weekday stay unscheduled", () => {
    const d = parseWorkoutText("Day 1\nSquat 3x5\nDay 2\nBench Press 3x5");
    expect(d.days.map((x) => [x.name, x.weekday])).toEqual([["Day 1", null], ["Day 2", null]]);
  });
  it("is bounded: at most 14 days and 40 exercises a day are read, and it says so", () => {
    const many = Array.from({ length: 20 }, (_, i) => `Day ${i + 1}\n` + Array.from({ length: 45 }, (_, j) => `Move ${j} 3x10`).join("\n")).join("\n");
    const d = parseWorkoutText(many);
    expect(d.days).toHaveLength(14);
    expect(d.days.every((x) => x.exercises.length === 40)).toBe(true);
    expect(d.warnings.join()).toMatch(/first 14 days.*first 40 exercises|first 40 exercises/);
  });
});

describe("tables", () => {
  it("by header, with a day column, a unit in the header, and empty cells left empty", () => {
    const d = parseWorkoutTable([
      ["Upper/Lower plan"],
      ["Day", "Exercise", "Sets", "Reps", "Weight (kg)", "Rest (s)", "Notes"],
      ["Upper (Mon)", "Bench Press", "4", "6-8", "80", "120", ""],
      ["Upper (Mon)", "Seated Cable Row", "3", "10", "", "", "squeeze"],
      ["Lower (Thu)", "Squat", "", "5", "100", "180", ""],
      ["Lower (Thu)", "Calf Raise", "4", "AMRAP", "", "60", ""],
    ]);
    expect(d.programName).toBe("Upper/Lower plan");
    expect(d.days.map((x) => [x.name, x.weekday])).toEqual([["Upper (Mon)", 0], ["Lower (Thu)", 3]]);
    expect(d.days[0].exercises[0]).toMatchObject({ name: "Bench Press", sets: 4, repsMin: 6, repsMax: 8, weight: { value: 80, unit: "kg" }, restSeconds: 120 });
    expect(d.days[0].exercises[1]).toMatchObject({ weight: null, restSeconds: null, notes: ["squeeze"] });
    expect(d.days[1].exercises[0]).toMatchObject({ name: "Squat", sets: null, repsMin: 5 });
    expect(d.days[1].exercises[1]).toMatchObject({ repsMin: null, notes: ["Reps as written: AMRAP"] });
  });
  it("a weight with no unit anywhere is left empty and noted", () => {
    const d = parseWorkoutTable([["Exercise", "Sets", "Reps", "Weight"], ["Deadlift", "3", "5", "140"]]);
    expect(d.days[0].exercises[0]).toMatchObject({ weight: null, notes: ["Weight as written, with no unit: 140"] });
    expect(d.warnings.join()).toMatch(/no unit/);
  });
  it("a table without a header is read as lines", () => {
    expect(parseWorkoutTable([["Squat", "3x5"], ["Bench Press", "3x5"]]).days[0].exercises.map((e) => e.name)).toEqual(["Squat", "Bench Press"]);
  });
});

describe("matching the library", () => {
  const lib: LibraryExercise[] = [
    { id: "b1", name: "Barbell Bench Press", userId: null }, { id: "b2", name: "Romanian Deadlift", userId: null }, { id: "b3", name: "Pull-Up", userId: null },
    { id: "b4", name: "Deadlift", userId: null }, { id: "b5", name: "Dumbbell Curl", userId: null }, { id: "u1", name: "Pull Up", userId: "me" },
  ];
  it("normalizes case, punctuation and plurals only", () => {
    expect(normalizeExerciseName("Pull-Ups")).toBe("pull up");
    expect(normalizeExerciseName("Bench Presses")).toBe("bench press");
    expect(normalizeExerciseName("Crème  Squats!")).toBe("creme squat");
  });
  it("an exact match is chosen, the person's own first; anything else is a choice", () => {
    expect(matchExercise("barbell bench press", lib)).toEqual({ kind: "exact", exercise: lib[0] });
    expect(matchExercise("Pull ups", lib)).toEqual({ kind: "exact", exercise: lib[5] });
    const rdl = matchExercise("RDL", lib);
    expect(rdl.kind).toBe("choose");
    expect(rdl.kind === "choose" && rdl.suggestions[0].name).toBe("Romanian Deadlift");
    const db = matchExercise("DB Curls", lib);
    expect(db.kind === "choose" && db.suggestions[0].name).toBe("Dumbbell Curl");
    expect(matchExercise("Bench", lib).kind).toBe("choose");
    expect(matchExercise("Zercher Carry", lib)).toEqual({ kind: "choose", suggestions: [] });
  });
});
