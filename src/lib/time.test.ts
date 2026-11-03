import { describe, expect, it } from "vitest";
import { localParts, localWeekRange, zonedMidnight } from "./time";

describe("time helpers", () => {
  it("computes weekday Monday-first", () => {
    // 2026-11-03 is a Tuesday
    expect(localParts(new Date("2026-11-03T12:00:00Z"), "UTC").weekday).toBe(1);
  });
  it("uses the local date, not UTC", () => {
    // 02:00 UTC Tuesday is still Monday evening in New York
    expect(localParts(new Date("2026-11-03T02:00:00Z"), "America/New_York").weekday).toBe(0);
  });
  it("finds local midnight across zones", () => {
    expect(zonedMidnight(2026, 7, 1, "America/New_York").toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(zonedMidnight(2026, 1, 1, "Asia/Tokyo").toISOString()).toBe("2025-12-31T15:00:00.000Z");
  });
  it("week range spans Monday to Monday", () => {
    const r = localWeekRange(new Date("2026-11-05T12:00:00Z"), "UTC");
    expect(r.start.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });
  it("handles DST change inside the week (US fall back 2026-11-01)", () => {
    const r = localWeekRange(new Date("2026-11-04T12:00:00Z"), "America/New_York");
    expect(r.start.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
});
