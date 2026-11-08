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
  it("leave nothing of a name made only of hidden characters", () => {
    for (const n of [cp(0x2066), cp(0x3164), cp(0x115f), cp(0x200b, 0x202e), cp(0x00ad), " "]) expect(cleanName(n), JSON.stringify(n)).toBe("");
  });
  it("keep what real text needs (joiners, selectors, tags) as typed, while comparing names without them", () => {
    const persian = `${cp(0x645, 0x6cc)}${cp(0x200c)}${cp(0x62e, 0x648, 0x627, 0x647, 0x645)}`; // a word that needs ZWNJ
    expect(cleanName(persian)).toBe(persian);
    const family = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467); // an emoji sequence held together by ZWJ
    expect(cleanName(`Gym ${family}`)).toBe(`Gym ${family}`);
    const scotland = cp(0x1f3f4, 0xe0067, 0xe0062, 0xe0073, 0xe0063, 0xe0074, 0xe007f); // a subdivision flag, by tags
    expect(cleanName(`Gym ${scotland}`)).toBe(`Gym ${scotland}`);
    expect(cleanName(`Gym${cp(0xfe0f)}`)).toBe(`Gym${cp(0xfe0f)}`);
    // Compared without them, so none of them makes a second name that looks the same.
    for (const n of [`${cafe}${cp(0x200d)}`, `Ca${cp(0x200c)}f${cp(0xe9)}`, `${cafe}${cp(0xfe0f)}`, `${cafe}${cp(0xe0041)}`]) expect(nameKey(n), JSON.stringify(n)).toBe(nameKey(cafe));
  });
  it("say a name of only joiners has nothing visible, which the schema refuses", async () => {
    expect(nameKey(cp(0x200d, 0x200c, 0xfe0f))).toBe("");
    const { gymSchema } = await import("./gym-schemas");
    expect(gymSchema.safeParse({ name: cp(0x200d, 0x200c) }).success).toBe(false);
    expect(gymSchema.safeParse({ name: cp(0x200b, 0x2066) }).success).toBe(false);
    expect(gymSchema.safeParse({ name: `Gym ${cp(0x1f468, 0x200d, 0x1f469)}` }).success).toBe(true);
  });
  it("fold case beyond lower-casing, and keep visible differences", () => {
    expect(nameKey("Straße")).toBe(nameKey("STRASSE"));
    expect(nameKey("Home gym")).not.toBe(nameKey("Home gym 2"));
    expect(cleanName("City   Gym")).toBe("City Gym");
  });
});
