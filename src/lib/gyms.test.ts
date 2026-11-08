import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EQUIPMENT_KINDS, EQUIPMENT_LABELS, cleanName, nameKey } from "./gyms";

const cp = (...points: number[]) => String.fromCodePoint(...points);

describe("gyms constants", () => {
  it("label every kind of equipment", () => {
    expect(Object.keys(EQUIPMENT_LABELS).sort()).toEqual([...EQUIPMENT_KINDS].sort());
  });
  it("stay free of zod, so the client pages importing them don't ship its eval probe past the CSP", () => {
    expect(readFileSync(join(__dirname, "gyms.ts"), "utf8")).not.toMatch(/from ["']zod["']/);
  });
});

describe("gym and machine names", () => {
  const cafe = `Caf${cp(0xe9)}`;
  it("lose every invisible, bidi and default-ignorable character, so look-alikes are one name", () => {
    const lookAlikes = [
      `${cafe}${cp(0x2066)}`, // bidi isolate (Trojan Source)
      `Ca${cp(0x202e)}f${cp(0xe9)}`, // right-to-left override
      `Ca${cp(0x200b)}f${cp(0xe9)}`, // zero-width space
      `Ca${cp(0x00ad)}f${cp(0xe9)}`, // soft hyphen
      `Ca${cp(0x034f)}f${cp(0xe9)}`, // combining grapheme joiner
      `Ca${cp(0x061c)}f${cp(0xe9)}`, // Arabic letter mark
      `${cafe}${cp(0xfe0f)}`, // variation selector
      `${cafe}${cp(0xe0041)}`, // tag character
      `Cafe${cp(0x0301)}`, // decomposed accent
      `  ${cafe.toUpperCase()}  `,
    ];
    for (const n of lookAlikes) expect(nameKey(n), JSON.stringify(n)).toBe(nameKey(cafe));
    expect(cleanName(`${cafe}${cp(0x2066)}`)).toBe(cafe);
  });
  it("leave nothing of a name made only of invisible characters, which the schema then refuses", () => {
    for (const n of [cp(0x2066), cp(0x3164), cp(0x115f), cp(0x200b, 0x202e), cp(0x00ad), " "]) expect(cleanName(n), JSON.stringify(n)).toBe("");
  });
  it("fold case beyond lower-casing, and keep visible differences", () => {
    expect(nameKey("Straße")).toBe(nameKey("STRASSE"));
    expect(nameKey("Home gym")).not.toBe(nameKey("Home gym 2"));
    expect(cleanName("City   Gym")).toBe("City Gym");
  });
});
