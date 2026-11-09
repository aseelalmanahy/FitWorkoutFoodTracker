import { describe, expect, it } from "vitest";
import { daysIn, MAX_RANGE_DAYS, periodLabel, rangeProblem, resolvePeriod, shiftPeriod } from "./nutrition-range";

const TODAY = "2026-11-09"; // a Monday

describe("UI-08 nutrition history periods", () => {
  it("defaults to this week, and keeps ?week working", () => {
    expect(resolvePeriod({}, TODAY)).toEqual({ period: { kind: "week", from: "2026-11-09", to: "2026-11-15", thisWeek: true }, error: null });
    expect(resolvePeriod({ week: "2026-10-28" }, TODAY).period).toEqual({ kind: "week", from: "2026-10-26", to: "2026-11-01", thisWeek: false });
    expect(resolvePeriod({ week: "2027-01-04" }, TODAY).period).toMatchObject({ from: "2026-11-09", thisWeek: true });
  });

  it("accepts a valid custom range", () => {
    expect(resolvePeriod({ from: "2026-10-01", to: "2026-10-20" }, TODAY)).toEqual({ period: { kind: "range", from: "2026-10-01", to: "2026-10-20" }, error: null });
    expect(daysIn("2026-10-01", "2026-10-20")).toBe(20);
  });

  it("refuses a reversed, invalid, future, too long or half-given range, with a reason, and shows this week", () => {
    expect(rangeProblem("2026-10-20", "2026-10-01", TODAY)).toMatch(/start date is after the end/);
    expect(rangeProblem("2026-02-30", "2026-03-01", TODAY)).toMatch(/isn't a valid date/);
    expect(rangeProblem("2026-11-01", "2026-11-10", TODAY)).toMatch(/future/);
    expect(rangeProblem("2026-01-01", "2026-11-01", TODAY)).toBe(`Choose a range of up to ${MAX_RANGE_DAYS} days.`);
    expect(rangeProblem("2026-10-01", undefined, TODAY)).toMatch(/both/);
    const r = resolvePeriod({ from: "2026-10-20", to: "2026-10-01" }, TODAY);
    expect(r.error).toMatch(/after the end/);
    expect(r.period).toMatchObject({ kind: "week", thisWeek: true });
  });

  it("moves by whole weeks, never past today", () => {
    const week = resolvePeriod({ week: "2026-10-26" }, TODAY).period;
    expect(shiftPeriod(week, -1, TODAY)).toBe("/nutrition/history?week=2026-10-19");
    expect(shiftPeriod(week, 2, TODAY)).toBe("/nutrition/history");
    expect(shiftPeriod(resolvePeriod({}, TODAY).period, 1, TODAY)).toBeNull();
    const range = resolvePeriod({ from: "2026-10-01", to: "2026-10-20" }, TODAY).period;
    expect(shiftPeriod(range, -1, TODAY)).toBe("/nutrition/history?from=2026-09-24&to=2026-10-13");
    expect(shiftPeriod(range, 3, TODAY)).toBeNull();
  });

  it("labels periods accurately", () => {
    expect(periodLabel(resolvePeriod({}, TODAY).period)).toBe("This week");
    expect(periodLabel(resolvePeriod({ week: "2026-10-26" }, TODAY).period)).toBe("Oct 26 – Nov 1, 2026");
    expect(periodLabel({ kind: "range", from: "2025-12-20", to: "2026-01-10" })).toBe("Dec 20, 2025 – Jan 10, 2026");
  });
});
