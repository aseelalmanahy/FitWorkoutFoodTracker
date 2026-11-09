// IMG-01: a real three-day workout image read as "No exercises with sets and repetitions were found". The fixtures
// are the text the server's recognizer gives for that image: before the fix (read at its native 399 px) and after it
// (enlarged to 1200 px), and for a second real plan with separate sets and reps columns.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fixOcrConfusions, parseWorkoutText, splitOcrRow } from "./parse";
import { matchExercise } from "./match";

const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const seed = readFileSync(path.join(__dirname, "..", "..", "..", "prisma", "seed.ts"), "utf8");
const library = [...seed.matchAll(/\["([A-Z][^"]+)", "[A-Z_]+"/g)].map((m, i) => ({ id: `e${i}`, name: m[1], userId: null }));

const EXPECTED = {
  MONDAY: ["Barbell Bench Press", "Incline Dumbbell Press", "Dumbbell Shoulder Press", "Cable Flyes", "Tricep Pushdowns", "Overhead Tricep Extension"],
  WEDNESDAY: ["Pull-Ups / Lat Pulldowns", "Barbell Bent Over Rows", "Seated Cable Rows", "Face Pulls", "Barbell Curls", "Hammer Curls"],
  FRIDAY: ["Barbell Squats", "Romanian Deadlifts", "Leg Press", "Leg Extensions", "Lying Leg Curls", "Standing Calf Raises"],
};

describe("IMG-01: the three-day table image", () => {
  const draft = parseWorkoutText(fixture("three-day-table.ocr.txt"), { ocr: true });

  it("reads three days, on the right weekdays", () => {
    expect(draft.days.map((d) => [d.name, d.weekday])).toEqual([["MONDAY", 0], ["WEDNESDAY", 2], ["FRIDAY", 4]]);
  });

  it("reads all 18 exercises under the right day, each 3 sets of 8-12", () => {
    for (const day of draft.days) {
      const names = day.exercises.map((e) => e.name);
      // Exactly as printed, except one word the recognizer misread ("Leg" as "Log"), which is left as read: the
      // review shows it, and offers Lying Leg Curl first (below), rather than changing it silently.
      const expected = EXPECTED[day.name as keyof typeof EXPECTED].map((n) => (n === "Lying Leg Curls" ? "Lying Log Curls" : n));
      expect(names).toEqual(expected);
      for (const e of day.exercises) expect([e.sets, e.repsMin, e.repsMax, e.weight, e.restSeconds]).toEqual([3, 8, 12, null, null]);
    }
    expect(draft.days.flatMap((d) => d.exercises)).toHaveLength(18);
  });

  it("keeps the logo's and watermark's letters out of the exercises, and lists them instead", () => {
    const names = draft.days.flatMap((d) => d.exercises.map((e) => e.name));
    expect(names.some((n) => /FITNESS|SHANDI|^[a-z]{1,2}\b/i.test(n))).toBe(false);
    expect(draft.unparsed.some((u) => /FITNESS/.test(u))).toBe(true);
    expect(draft.days.every((d) => d.notes.length === 0)).toBe(true); // stray text isn't made into notes
  });

  it("matches what it can for certain, and never silently picks for the rest", () => {
    const matches = draft.days.flatMap((d) => d.exercises.map((e) => [e.name, matchExercise(e.name, library)] as const));
    const exact = matches.filter(([, m]) => m.kind === "exact").map(([n, m]) => [n, m.kind === "exact" ? m.exercise.name : ""]);
    expect(exact).toEqual([
      ["Barbell Bench Press", "Barbell Bench Press"], ["Incline Dumbbell Press", "Dumbbell Incline Press"], ["Cable Flyes", "Cable Fly"],
      ["Tricep Pushdowns", "Triceps Pushdown"], ["Seated Cable Rows", "Seated Cable Row"], ["Face Pulls", "Face Pull"],
      ["Barbell Curls", "Barbell Curl"], ["Hammer Curls", "Hammer Curl"], ["Romanian Deadlifts", "Romanian Deadlift"],
      ["Leg Press", "Leg Press"], ["Leg Extensions", "Leg Extension"], ["Standing Calf Raises", "Standing Calf Raise"],
    ].filter(([n]) => exact.some(([x]) => x === n)));
    expect(exact.length).toBeGreaterThanOrEqual(11);
    // The uncertain ones are offered, with the right exercise first, and left for the person to choose.
    const first = (n: string) => { const m = matchExercise(n, library); return m.kind === "choose" ? m.suggestions[0]?.name : `exact:${m.exercise.name}`; };
    expect(first("Barbell Squats")).toBe("Back Squat");
    expect(first("Lying Log Curls")).toBe("Lying Leg Curl");
    expect(first("Pull-Ups / Lat Pulldowns")).toBe("Lat Pulldown");
    expect(first("Dumbbell Shoulder Press")).toBe("Seated Dumbbell Shoulder Press");
    expect(first("Barbell Bent Over Rows")).toBe("Barbell Row");
  });

  it("before the fix (read at the image's own size): nothing is invented, the lines are listed, and the message says why", () => {
    const before = parseWorkoutText(fixture("three-day-table.native.ocr.txt"), { ocr: true });
    expect(before.days).toEqual([]);
    expect(before.unparsed.length).toBeGreaterThan(5);
    expect(before.warnings.join(" ")).toMatch(/couldn't be read clearly/);
  });
});

describe("a real plan with separate sets and reps columns", () => {
  const draft = parseWorkoutText(fixture("sets-reps-columns.ocr.txt"), { ocr: true });
  const ex = draft.days.flatMap((d) => d.exercises);
  it("reads all 21 rows with their own sets and reps", () => {
    expect(ex).toHaveLength(21);
    expect(ex.map((e) => `${e.sets}x${e.repsMin}-${e.repsMax}`)).toEqual([
      "3x6-8", "3x10-12", "3x6-8", "3x10-12", "2x6-8", "2x10-15", "2x10-15",
      "3x8-12", "3x8-12", "3x10-15", "3x10-15", "2x10-15", "2x10-15", "2x10-15",
      "3x10-15", "3x8-12", "3x10-15", "3x10-15", "2x10-15", "2x10-15", "2x10-15",
    ]);
    expect(ex[0].name).toBe("BENCH PRESS");
    expect(ex.at(-1)!.name).toBe("SKULL CRUSHERS");
  });
});

describe("OCR rows", () => {
  it("fixes misreads only next to the numbers or in a weekday", () => {
    expect(fixOcrConfusions("Cable Flyes   3 sets of B-12 reps")).toBe("Cable Flyes   3 sets of 8-12 reps");
    expect(fixOcrConfusions("Lying Leg Curls  3 sots of 8-12 reps")).toBe("Lying Leg Curls  3 sets of 8-12 reps");
    expect(fixOcrConfusions("Squat 3 sets of 8:12")).toBe("Squat 3 sets of 8-12");
    expect(fixOcrConfusions("MON DAY")).toBe("MONDAY");
    expect(fixOcrConfusions("FRID AY")).toBe("FRIDAY");
    expect(fixOcrConfusions("Bulgarian Split Squat")).toBe("Bulgarian Split Squat"); // a B in a word is left alone
  });
  it("splits a table row: the day cell, the name next to the sets, anything else set aside", () => {
    expect(splitOcrRow("MONDAY         + Barbell Bench Press                3 sets of 8-12 reps")).toEqual({ lines: ["MONDAY", "Barbell Bench Press 3 sets of 8-12 reps"], setAside: [] });
    expect(splitOcrRow("SH           ITNESS      • Leg Extensions           3 sets of 8-12 reps")).toEqual({ lines: ["Leg Extensions 3 sets of 8-12 reps"], setAside: ["SH", "ITNESS"] });
    expect(splitOcrRow("SHANDIGER FITNESS | 4 Face Pulls          3 sets of 8-12 reps").lines).toEqual(["Face Pulls 3 sets of 8-12 reps"]);
    expect(splitOcrRow("BENCH PRESS                         3               6-8").lines).toEqual(["BENCH PRESS 3 x 6-8"]);
    expect(splitOcrRow("WIDE GRIP FRONT LAT PULLDOWN 3               8-12").lines).toEqual(["WIDE GRIP FRONT LAT PULLDOWN 3 x 8-12"]);
    expect(splitOcrRow("s |ncline Dumbbell Press                3 sets of 8-12 reps").lines).toEqual(["Incline Dumbbell Press 3 sets of 8-12 reps"]);
  });
  it("doesn't turn numbers it can't place into sets and reps", () => {
    // A weight and reps column, or a cell over 20 sets, isn't read as sets: those rows stay unread for the person.
    expect(parseWorkoutText("Bench   80   5", { ocr: true }).days).toEqual([]);
    expect(parseWorkoutText("Bench   135   5", { ocr: true }).days).toEqual([]);
  });
});

describe("typed text and documents are unchanged", () => {
  it("doesn't apply the OCR corrections or row splitting without the OCR flag", () => {
    const typed = parseWorkoutText("Cable Flyes   3 sets of B-12 reps\nBENCH PRESS   3   6-8");
    const ex = typed.days.flatMap((d) => d.exercises);
    // As before the fix: "B-12" isn't taken as 8-12 (the sets alone are read), and separate columns aren't joined.
    expect(ex.map((e) => [e.name, e.sets, e.repsMin, e.repsMax])).toEqual([["Cable Flyes", 3, null, null]]);
    expect(typed.days[0].notes).toEqual(["BENCH PRESS 3 6-8"]);
  });
  it("still reads the documented plan lines as before", () => {
    const d = parseWorkoutText("Strength Block\nMonday - Upper\nBarbell Bench Press 4x6-8 @ 80kg\nPull-Up 3x8");
    expect(d.days.map((x) => [x.name, x.exercises.length])).toEqual([["Monday - Upper", 2]]);
  });
});
