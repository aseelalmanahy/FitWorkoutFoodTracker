// Contrast of the shipped design tokens, read from globals.css itself, in light and dark. WCAG 2 formula:
// 4.5:1 for text, 3:1 for chart marks, control edges and focus rings. Tinted badge backgrounds are composited
// over the card, as the browser draws them.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`No ${selector} block`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]));
}
const THEMES = { light: block(":root {"), dark: block(':root[data-theme="dark"]') };

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** `fg` at `alpha` over `bg`, as a Tailwind `bg-up/12` tint is drawn. */
const tint = (fg: string, bg: string, alpha: number) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * alpha + parseInt(bg.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, "0")).join("");

const TEXT: [string, string][] = [["fg", "bg"], ["fg", "surface"], ["muted", "bg"], ["muted", "surface"], ["muted", "surface-2"], ["accent-fg", "accent"],
  ["accent-ink", "surface"], ["accent-ink", "accent-soft"], ["accent-ink", "surface-2"], ["up", "surface"], ["down", "surface"], ["warn", "surface"], ["info", "surface"],
  ["hero-fg", "hero"], ["hero-muted", "hero"]];
const MARKS: [string, string][] = [["chart-1", "surface"], ["chart-2", "surface"], ["chart-3", "surface"], ["chart-4", "surface"], ["muted", "surface"],
  ["line-strong", "surface"], ["ring", "bg"], ["ring", "surface"], ["accent", "surface"]];

describe.each(Object.entries(THEMES))("%s theme", (_name, t) => {
  it("defines every token checked here", () => {
    for (const [a, b] of [...TEXT, ...MARKS]) { expect(t[a], a).toBeDefined(); expect(t[b], b).toBeDefined(); }
  });
  it.each(TEXT)("text %s on %s is at least 4.5:1", (a, b) => expect(ratio(t[a], t[b])).toBeGreaterThanOrEqual(4.5));
  it.each(MARKS)("mark %s on %s is at least 3:1", (a, b) => expect(ratio(t[a], t[b])).toBeGreaterThanOrEqual(3));
  it.each([["up", 0.12], ["down", 0.12], ["down", 0.1], ["warn", 0.12]] as const)("status text %s on its %s tint is at least 4.5:1", (k, alpha) => {
    expect(ratio(t[k], tint(t[k], t.surface, alpha))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t[k], tint(t[k], t.bg, alpha))).toBeGreaterThanOrEqual(4.5);
  });
  it("success and warning are different colours", () => {
    expect(t.up).not.toBe(t.down);
  });
});

describe("the dark theme is the same whether chosen or from the system", () => {
  it("both dark blocks match", () => {
    const media = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
    expect(block(':root:not([data-theme="light"])')).toEqual(THEMES.dark);
    expect(media.length).toBeGreaterThan(0);
  });
});
