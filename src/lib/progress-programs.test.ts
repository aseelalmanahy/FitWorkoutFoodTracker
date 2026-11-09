import { describe, expect, it } from "vitest";
import { groupProgressByProgram, NOT_IN_A_PROGRAM, type ProgressSessionInput } from "./progress-programs";
import { overviewByExercise } from "./progress-overview";
import { compareToPrevious, summarizeSets } from "./overload";

const TZ = "America/New_York";
const set = (weightKg: number, reps: number, isWarmup = false) => ({ weightKg, reps, isWarmup });
const PPL = { id: "ppl", name: "Push Pull Legs" };
const UL = { id: "ul", name: "Upper Lower" };
let n = 0;
const session = (iso: string, program: ProgressSessionInput["program"], exercises: [string, (string | null), ReturnType<typeof set>[]][], name = "Workout"): ProgressSessionInput => ({
  id: `s${++n}`, name, startedAt: new Date(iso), program,
  exercises: exercises.map(([exerciseId, machine, sets]) => ({ exerciseId, name: exerciseId, gymEquipmentId: machine, machineName: machine, sets })),
});

describe("groupProgressByProgram (UI-02)", () => {
  it("groups by program, then month, then workout, newest first, with no program last", () => {
    const g = groupProgressByProgram([
      session("2026-10-05T14:00:00Z", PPL, [["bench", null, [set(60, 8)]]]),
      session("2026-11-02T14:00:00Z", PPL, [["bench", null, [set(62.5, 8)]]]),
      session("2026-11-03T14:00:00Z", null, [["curl", null, [set(10, 12)]]]),
      session("2026-11-01T14:00:00Z", UL, [["squat", null, [set(100, 5)]]]),
    ], TZ);
    expect(g.map((p) => p.name)).toEqual(["Push Pull Legs", "Upper Lower", NOT_IN_A_PROGRAM]);
    expect(g[0].workoutCount).toBe(2);
    expect(g[0].months.map((m) => [m.key, m.label, m.workouts.length])).toEqual([["2026-11", "November 2026", 1], ["2026-10", "October 2026", 1]]);
    expect(g[2].id).toBeNull();
  });

  it("puts a workout in the month of its local date, not UTC's", () => {
    // 03:00 UTC on November 1 is still October 31 in New York.
    const g = groupProgressByProgram([session("2026-11-01T03:00:00Z", PPL, [["bench", null, [set(60, 8)]]])], TZ);
    expect(g[0].months[0].key).toBe("2026-10");
  });

  it("compares each workout with the previous workout of the same exercise, across programs", () => {
    const g = groupProgressByProgram([
      session("2026-11-01T14:00:00Z", PPL, [["bench", null, [set(60, 8)]]]),
      session("2026-11-05T14:00:00Z", UL, [["bench", null, [set(62.5, 8)]]]),
      session("2026-11-09T14:00:00Z", UL, [["bench", null, [set(62.5, 8)]]]),
      session("2026-11-12T14:00:00Z", UL, [["bench", null, [set(60, 8)]]]),
    ], TZ);
    const ul = g.find((p) => p.id === "ul")!.months[0].workouts.map((w) => w.exercises[0].status);
    expect(ul).toEqual(["decreased", "matched", "improved"]); // newest first; the first UL bench beats the PPL one: no false Baseline
    expect(g.find((p) => p.id === "ppl")!.months[0].workouts[0].exercises[0].status).toBe("first");
  });

  it("never compares across machines (WT-03)", () => {
    const g = groupProgressByProgram([
      session("2026-11-01T14:00:00Z", PPL, [["press", null, [set(60, 10)]]]),
      session("2026-11-03T14:00:00Z", PPL, [["press", "hammer", [set(120, 10)]]]),
      session("2026-11-05T14:00:00Z", PPL, [["press", null, [set(55, 10)]]]),
    ], TZ);
    const [latest, onMachine, first] = g[0].months[0].workouts.map((w) => w.exercises[0]);
    expect(onMachine).toMatchObject({ status: "first", machineName: "hammer" });
    expect(latest.status).toBe("decreased"); // against 60 kg with no machine, not the machine's 120 kg
    expect(first.status).toBe("first");
  });

  it("gives the latest workout the same status as the Exercise progress card", () => {
    const sessions = [
      session("2026-11-01T14:00:00Z", PPL, [["row", null, [set(50, 10), set(50, 9)]]]),
      session("2026-11-04T14:00:00Z", null, [["row", null, [set(50, 10), set(50, 10)]]]),
    ];
    const latest = groupProgressByProgram(sessions, TZ).find((p) => p.id === null)!.months[0].workouts[0].exercises[0];
    const o = overviewByExercise(sessions.flatMap((s) => s.exercises.map((e) => ({ exerciseId: e.exerciseId, gymEquipmentId: e.gymEquipmentId, sessionId: s.id, date: s.startedAt, sets: e.sets })))).get("row")!;
    const card = compareToPrevious(summarizeSets(o.history.at(-2)!.sets), summarizeSets(o.history.at(-1)!.sets)).status;
    expect(latest.status).toBe(card);
  });

  it("merges an exercise done twice in one workout, and gives no status without working sets", () => {
    const g = groupProgressByProgram([
      session("2026-11-01T14:00:00Z", PPL, [["bench", null, [set(60, 8)]], ["fly", null, [set(20, 10)]], ["bench", null, [set(60, 6)]]]),
      session("2026-11-02T14:00:00Z", PPL, [["bench", null, [set(40, 10, true)]]]),
    ], TZ);
    const [warmupOnly, both] = g[0].months[0].workouts;
    expect(both.exercises.map((e) => [e.exerciseId, e.summary.workingSets])).toEqual([["bench", 2], ["fly", 1]]);
    expect(warmupOnly.exercises[0].status).toBeNull();
  });

  it("returns nothing for no workouts", () => {
    expect(groupProgressByProgram([], TZ)).toEqual([]);
  });
});
