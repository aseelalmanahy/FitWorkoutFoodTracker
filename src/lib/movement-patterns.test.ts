// Multi-gym: the reviewed alternatives. Every built-in exercise has a pattern; alternatives share it, never only a muscle.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUILT_IN_PATTERNS, contextKey, findAlternatives, type CandidateExercise } from "./movement-patterns";

const seed = readFileSync(path.join(process.cwd(), "prisma", "seed.ts"), "utf8");
const builtIns = [...seed.matchAll(/\["([^"]+)", "([A-Z_]+)", "([A-Z_]+)"\]/g)].map((m, i) => ({ id: `b${i}`, name: m[1], muscle: m[2], userId: null, equipment: m[3] as CandidateExercise["equipment"] }));
const byName = (n: string) => builtIns.find((b) => b.name === n)!;

describe("the reviewed map", () => {
  it("covers exactly the built-in library", () => {
    expect(Object.keys(BUILT_IN_PATTERNS).sort()).toEqual(builtIns.map((b) => b.name).sort());
  });
  it("never pairs exercises only because they share a muscle", () => {
    const names = (n: string) => findAlternatives(byName(n), builtIns, { equipment: null }).map((a) => a.name);
    expect(names("Barbell Bench Press")).toEqual(["Dumbbell Bench Press", "Machine Chest Press", "Push-Up"]);
    expect(names("Barbell Bench Press")).not.toContain("Cable Fly"); // same muscle, different movement
    expect(names("Deadlift")).toEqual(["Romanian Deadlift"]);
    expect(names("Back Squat")).not.toContain("Leg Extension"); // same muscle, different movement
    expect(names("Cable Fly")).toEqual([]); // nothing reviewed as equivalent
  });
});

describe("at a gym", () => {
  const bench = byName("Barbell Bench Press");
  it("marks what the gym has; bodyweight always; available first", () => {
    const alts = findAlternatives(bench, builtIns, { equipment: ["MACHINE"] });
    expect(alts.map((a) => [a.name, a.available])).toEqual([["Machine Chest Press", true], ["Push-Up", true], ["Dumbbell Bench Press", false]]);
  });
  it("puts the person's earlier swaps first, including their own exercises, labelled as such", () => {
    const mine: CandidateExercise = { id: "u1", name: "Smith Machine Press", userId: "me", equipment: "MACHINE" };
    const alts = findAlternatives(bench, [...builtIns, mine], { equipment: ["MACHINE", "DUMBBELL"], usedBefore: ["u1"] });
    expect(alts[0]).toMatchObject({ name: "Smith Machine Press", reason: "used-before", pattern: null });
    expect(alts.filter((a) => a.reason === "same-pattern").map((a) => a.name)).toEqual(["Dumbbell Bench Press", "Machine Chest Press", "Push-Up"]);
  });
  it("a person's own planned exercise has no reviewed pattern: only their earlier swaps are offered", () => {
    expect(findAlternatives({ id: "u9", name: "Landmine Press", userId: "me" }, builtIns, { equipment: null })).toEqual([]);
  });
});

it("history context: the exercise plus the machine, or the shared history", () => {
  expect(contextKey("e1", null)).toBe("e1|");
  expect(contextKey("e1", undefined)).toBe("e1|");
  expect(contextKey("e1", "m1")).toBe("e1|m1");
});
