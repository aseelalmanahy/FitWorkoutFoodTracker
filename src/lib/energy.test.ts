import { describe, expect, it } from "vitest";
import { ageFromBirthDate } from "./energy";

describe("ageFromBirthDate", () => {
  it("handles birthdays not yet reached this year", () => {
    expect(ageFromBirthDate(new Date("1990-12-31"), new Date("2026-11-03"))).toBe(35);
    expect(ageFromBirthDate(new Date("1990-01-01"), new Date("2026-11-03"))).toBe(36);
  });
});
