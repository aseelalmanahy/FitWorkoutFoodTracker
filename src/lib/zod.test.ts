import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "./zod";

const SRC = join(__dirname, "..");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
});

describe("zod is configured before any schema is built", () => {
  it("runs jitless, so it never probes for eval (a CSP violation in browsers)", () => {
    expect(z.config().jitless).toBe(true);
  });
  it("is imported from @/lib/zod everywhere, never from zod directly", () => {
    const direct = files(SRC).filter((f) => !f.endsWith(join("lib", "zod.ts")) && /from ["']zod(\/[^"']*)?["']/.test(readFileSync(f, "utf8")));
    expect(direct.map((f) => relative(SRC, f))).toEqual([]);
  });
});
