import { afterEach, describe, expect, it } from "vitest";
import { accessStateFor, eligibilityOf, MAX_ENTRY_AGE, MIN_ADULT_AGE } from "./eligibility";

// Section 6 of docs/PHASE_4_0_1_IMPLEMENTATION_PLAN.md, row for row.
const TABLE: [string, string, ReturnType<typeof eligibilityOf>][] = [
  ["2008-11-05", "2026-11-04T23:59:00Z", "under_minimum"],
  ["2008-11-05", "2026-11-05T00:00:00Z", "eligible"],
  ["2008-11-05", "2026-11-06T00:00:00Z", "eligible"],
  ["2008-02-28", "2026-02-27T12:00:00Z", "under_minimum"],
  ["2008-02-29", "2026-02-28T12:00:00Z", "under_minimum"],
  ["2008-02-29", "2026-03-01T00:00:00Z", "eligible"],
  ["2026-11-05", "2026-11-05T12:00:00Z", "under_minimum"],
  ["2026-11-06", "2026-11-05T12:00:00Z", "out_of_range"],
  ["1916-11-05", "2026-11-05T00:00:00Z", "eligible"],
  ["1915-11-05", "2026-11-05T00:00:00Z", "out_of_range"],
];

describe("eligibilityOf", () => {
  const original = process.env.TZ;
  afterEach(() => { process.env.TZ = original; });

  it.each(TABLE)("T1: born %s at %s is %s", (birth, at, expected) => {
    expect(eligibilityOf(birth, new Date(at))).toBe(expected);
  });

  it("T1: a leap-day birthday is reached on the day in a leap year", () => {
    expect(eligibilityOf("2012-02-29", new Date("2030-02-28T23:59:00Z"))).toBe("under_minimum");
    expect(eligibilityOf("2012-02-29", new Date("2030-03-01T00:00:00Z"))).toBe("eligible");
    expect(eligibilityOf("2016-02-29", new Date("2034-03-01T00:00:00Z"))).toBe("eligible");
    expect(eligibilityOf("2004-02-29", new Date("2022-02-28T12:00:00Z"))).toBe("under_minimum");
    expect(eligibilityOf("2004-02-29", new Date("2024-02-29T00:00:00Z"))).toBe("eligible");
  });

  it.each(["Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"])("T2: the host time zone %s changes nothing", (tz) => {
    process.env.TZ = tz;
    for (const [birth, at, expected] of TABLE) expect(eligibilityOf(birth, new Date(at))).toBe(expected);
  });

  it("uses the stated limits, and the 110 bound isn't a medical limit", () => {
    expect([MIN_ADULT_AGE, MAX_ENTRY_AGE]).toEqual([18, 110]);
  });
});

describe("accessStateFor", () => {
  const now = new Date("2026-11-05T00:00:00Z");
  const born = (d: string) => ({ birthDate: new Date(`${d}T00:00:00Z`) });

  it("derives the state from what's stored", () => {
    expect(accessStateFor(null, now)).toBe("no_profile");
    expect(accessStateFor(born("2008-11-06"), now)).toBe("restricted");
    expect(accessStateFor(born("2008-11-05"), now)).toBe("ok");
  });
  it("restricts a stored date in the future", () => {
    expect(accessStateFor(born("2030-01-01"), now)).toBe("restricted");
  });
  it("doesn't lock out someone who ages past the data-entry bound", () => {
    expect(accessStateFor(born("1900-01-01"), now)).toBe("ok");
  });
  it("agrees with eligibilityOf at the minimum, as there's one rule", () => {
    for (const [birth, at, expected] of TABLE.filter((r) => r[2] !== "out_of_range")) {
      expect(accessStateFor(born(birth), new Date(at))).toBe(expected === "eligible" ? "ok" : "restricted");
    }
  });
});
