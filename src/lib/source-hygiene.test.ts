import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// "Trojan Source": bidi controls and zero-width characters make code read differently from how it runs. Tests that
// need such characters build them with String.fromCodePoint or write an escape, never the raw character.
const ROOT = join(__dirname, "..", "..");
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (e.name === "node_modules" || e.name.startsWith(".") ? [] : walk(join(dir, e.name))) : /\.(ts|tsx|cjs|mjs|js|sql|json)$/.test(e.name) ? [join(dir, e.name)] : []);
const RAW = new RegExp(`[${[[0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2069]].map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join("")}${String.fromCodePoint(0xfeff)}]`, "u");

describe("source files", () => {
  it("hold no raw bidi control or zero-width character", () => {
    const files = ["src", "scripts", "prisma"].flatMap((d) => walk(join(ROOT, d)));
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((f) => RAW.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f))).toEqual([]);
  });
});
