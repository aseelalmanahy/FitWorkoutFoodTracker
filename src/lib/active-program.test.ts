import { describe, expect, it } from "vitest";
import { buildWeek, defaultSpread, proposeWeekdays, scheduleChanges, scheduleVersion } from "./active-program";

const slot = (weekday: number, templateId: string, position = 0) => ({ weekday, templateId, position });

describe("UI-06 active program rules", () => {
  it("suggests a spread for 1 to 7 days, and nothing past seven", () => {
    expect(defaultSpread(3)).toEqual([0, 2, 4]);
    expect(defaultSpread(4)).toEqual([0, 1, 3, 4]);
    expect(defaultSpread(7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(defaultSpread(0)).toEqual([]);
    const p = proposeWeekdays(["a", "b", "c", "d", "e", "f", "g", "h"], []);
    expect(p.h).toEqual([]);
    expect(p.a).toEqual([0]);
  });

  it("keeps the weekdays a program's days already have, and suggests free days for the rest", () => {
    const slots = [slot(1, "a"), slot(4, "a"), slot(5, "b"), slot(0, "other")];
    expect(proposeWeekdays(["a", "b", "c"], slots)).toEqual({ a: [1, 4], b: [5], c: [0] }); // c's spread day (Fri) is taken: the next free one
    expect(proposeWeekdays(["a", "b", "c"], [slot(0, "a")])).toEqual({ a: [0], b: [2], c: [4] });
  });

  it("builds the week in program order, and refuses a day with more than three", () => {
    expect(buildWeek(["a", "b"], { a: [0], b: [0, 3] })).toEqual([["a", "b"], [], [], ["b"], [], [], []]);
    expect(() => buildWeek(["a", "b", "c", "d"], { a: [2], b: [2], c: [2], d: [2] })).toThrow(/at most 3/);
    expect(() => buildWeek(["a"], { a: [7] })).toThrow(/out of range/);
  });

  it("lists exactly what's removed and added", () => {
    const slots = [slot(0, "solo"), slot(2, "a"), slot(4, "other")];
    const week = buildWeek(["a", "b"], { a: [2], b: [4] });
    expect(scheduleChanges(slots, week)).toEqual({ removed: [{ weekday: 0, templateId: "solo" }, { weekday: 4, templateId: "other" }], added: [{ weekday: 4, templateId: "b" }] });
  });

  it("changes the version when, and only when, the schedule changes", () => {
    const a = [slot(0, "x"), slot(2, "y")];
    expect(scheduleVersion(a)).toBe(scheduleVersion([...a].reverse()));
    expect(scheduleVersion(a)).not.toBe(scheduleVersion([slot(0, "x"), slot(3, "y")]));
    expect(scheduleVersion([])).not.toBe(scheduleVersion(a));
  });
});
