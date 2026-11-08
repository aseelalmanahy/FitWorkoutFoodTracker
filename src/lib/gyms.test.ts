import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EQUIPMENT_KINDS, EQUIPMENT_LABELS } from "./gyms";

describe("gyms constants", () => {
  it("label every kind of equipment", () => {
    expect(Object.keys(EQUIPMENT_LABELS).sort()).toEqual([...EQUIPMENT_KINDS].sort());
  });
  it("stay free of zod, so the client pages importing them don't ship its eval probe past the CSP", () => {
    expect(readFileSync(join(__dirname, "gyms.ts"), "utf8")).not.toMatch(/from ["']zod["']/);
  });
});
