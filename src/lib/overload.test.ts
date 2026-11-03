import { describe, expect, it } from "vitest";
import { compareToPrevious, computeRecords, epley1rm, summarizeSets } from "./overload";

const s = (weightKg: number, reps: number, isWarmup = false) => ({ weightKg, reps, isWarmup });

describe("summarizeSets", () => {
  it("ignores warm-ups and computes volume load", () => {
    const sum = summarizeSets([s(20, 10, true), s(50, 12), s(50, 10), s(50, 9)]);
    expect(sum.workingSets).toBe(3);
    expect(sum.volumeKg).toBe(50 * 31);
    expect(sum.topWeightKg).toBe(50);
    expect(sum.repsAtTopWeight).toBe(12);
  });
  it("uses reps at the heaviest weight", () => {
    const sum = summarizeSets([s(60, 5), s(70, 3), s(70, 2)]);
    expect(sum.topWeightKg).toBe(70);
    expect(sum.repsAtTopWeight).toBe(3);
  });
});

describe("epley1rm", () => {
  it("returns the load for a single", () => expect(epley1rm(100, 1)).toBe(100));
  it("applies Epley", () => expect(epley1rm(100, 10)).toBeCloseTo(133.33, 1));
  it("refuses high-rep extrapolation", () => expect(epley1rm(100, 20)).toBeNull());
});

describe("compareToPrevious", () => {
  it("flags a first session", () => {
    expect(compareToPrevious(null, summarizeSets([s(50, 10)])).status).toBe("first");
  });
  it("spec example: 50×10 → 50×12 is improvement via reps", () => {
    const c = compareToPrevious(summarizeSets([s(50, 10)]), summarizeSets([s(50, 12)]));
    expect(c.status).toBe("improved");
    expect(c.reps).toBe("up");
    expect(c.deltas.reps).toBe(2);
  });
  it("weight increase is improvement", () => {
    const c = compareToPrevious(summarizeSets([s(50, 10)]), summarizeSets([s(55, 8)]));
    expect(c.status).toBe("improved");
    expect(c.weight).toBe("up");
  });
  it("identical performance is matched", () => {
    const c = compareToPrevious(summarizeSets([s(50, 10), s(50, 10)]), summarizeSets([s(50, 10), s(50, 10)]));
    expect(c.status).toBe("matched");
  });
  it("fewer reps at same weight is a decrease", () => {
    const c = compareToPrevious(summarizeSets([s(50, 10)]), summarizeSets([s(50, 8)]));
    expect(c.status).toBe("decreased");
  });
  it("same top set but extra set is a volume improvement", () => {
    const c = compareToPrevious(summarizeSets([s(50, 10)]), summarizeSets([s(50, 10), s(50, 8)]));
    expect(c.status).toBe("improved");
    expect(c.volume).toBe("up");
  });
  it("lighter but more volume is mixed", () => {
    const c = compareToPrevious(summarizeSets([s(60, 5)]), summarizeSets([s(50, 10), s(50, 10)]));
    expect(c.status).toBe("mixed");
  });
  it("bodyweight movements compare reps", () => {
    const c = compareToPrevious(summarizeSets([s(0, 8), s(0, 8)]), summarizeSets([s(0, 8), s(0, 7)]));
    expect(c.status).toBe("decreased");
  });
});

describe("computeRecords", () => {
  it("flags PRs only when strictly beaten after the baseline", () => {
    const r = computeRecords([
      { sessionId: "a", date: new Date("2026-01-01"), sets: [s(50, 10)] },
      { sessionId: "b", date: new Date("2026-01-08"), sets: [s(50, 10)] },
      { sessionId: "c", date: new Date("2026-01-15"), sets: [s(55, 8)] },
    ]);
    expect(r.prsBySession.has("a")).toBe(false);
    expect(r.prsBySession.has("b")).toBe(false);
    expect(r.prsBySession.get("c")).toContain("heaviestWeight");
    expect(r.current.heaviestWeight?.value).toBe(55);
  });
});
