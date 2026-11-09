import { describe, expect, it } from "vitest";
import { overviewByExercise, type ExerciseSessionRow } from "./progress-overview";
import { compareToPrevious, summarizeSets } from "./overload";

const set = (weightKg: number, reps: number) => ({ weightKg, reps, isWarmup: false });
const day = (d: number) => new Date(Date.UTC(2026, 9, d, 14));
const row = (sessionId: string, d: number, gymEquipmentId: string | null, sets: ReturnType<typeof set>[], exerciseId = "legpress"): ExerciseSessionRow =>
  ({ exerciseId, gymEquipmentId, sessionId, date: day(d), sets });

describe("overviewByExercise (WT-03)", () => {
  it("counts sessions done only on a named machine (was 0)", () => {
    const o = overviewByExercise([row("s1", 1, "lifefitness", [set(95, 12)]), row("s2", 8, "lifefitness", [set(100, 12)])]).get("legpress")!;
    expect(o.sessions).toBe(2);
    expect(o.latestContext).toBe("lifefitness");
    expect(o.history.map((h) => h.sessionId)).toEqual(["s1", "s2"]);
  });

  it("counts every context, once per session", () => {
    const o = overviewByExercise([
      row("s1", 1, null, [set(60, 10)]),
      row("s2", 3, "hammer", [set(120, 10)]),
      row("s3", 5, "hammer", [set(125, 10)]),
      row("s3", 5, "hammer", [set(125, 8)]), // the same exercise twice in one session
    ]).get("legpress")!;
    expect(o.sessions).toBe(3);
  });

  it("never compares or combines weights across machines", () => {
    // Free-weight 60 kg, then a machine at 120 kg, then free weight again at 62.5 kg.
    const o = overviewByExercise([
      row("s1", 1, null, [set(60, 10)]),
      row("s2", 3, "hammer", [set(120, 10)]),
      row("s3", 5, null, [set(62.5, 10)]),
    ]).get("legpress")!;
    expect(o.latestContext).toBeNull();
    expect(o.history.map((h) => h.sessionId)).toEqual(["s1", "s3"]); // the machine session isn't the "previous" one
    const [prev, last] = o.history.map((h) => summarizeSets(h.sets));
    expect(last.topWeightKg).toBe(62.5);
    expect(compareToPrevious(prev, last).status).toBe("improved"); // against 60 kg, not "down" against the machine's 120
  });

  it("keeps exercises apart", () => {
    const m = overviewByExercise([row("s1", 1, null, [set(50, 8)], "bench"), row("s1", 1, "lifefitness", [set(100, 12)], "legpress")]);
    expect(m.get("bench")!.sessions).toBe(1);
    expect(m.get("legpress")!.latestContext).toBe("lifefitness");
  });
});
