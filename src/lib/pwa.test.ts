// Phase 1: the service worker's one rule for what may be stored, and the manifest's install fields.
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

const ORIGIN = "https://app.example.invalid";
let cacheable: (url: URL, request: { method: string }) => boolean;
beforeAll(() => {
  (globalThis as unknown as { self: unknown }).self = { location: { origin: ORIGIN }, addEventListener: () => {} };
  ({ cacheable } = createRequire(import.meta.url)(path.join(process.cwd(), "public", "sw.js")));
});
const may = (p: string, method = "GET", origin = ORIGIN) => cacheable(new URL(p, origin), { method });

describe("what the service worker may store", () => {
  it("only build files, icons and the offline page, by GET, from this site, with no query", () => {
    for (const p of ["/_next/static/chunks/app-1a2b.js", "/_next/static/css/x.css", "/icons/icon-192.png", "/offline.html"]) expect(may(p), p).toBe(true);
  });
  it("never a page, an API answer, an upload, an image, a query or another site", () => {
    for (const p of ["/dashboard", "/nutrition/scan", "/feedback", "/admin/feedback", "/api/nutrition/day", "/api/feedback", "/api/account/export", "/manifest.webmanifest", "/sw.js", "/_next/image?url=x", "/_next/static/chunks/a.js?v=1", "/icons/../api/profile", "/"]) expect(may(p), p).toBe(false);
    expect(may("/_next/static/a.js", "POST")).toBe(false);
    expect(may("/_next/static/a.js", "GET", "https://cdn.example")).toBe(false);
  });
  it("names no API or signed-in path in what it pre-caches, and leaves every non-page request alone", () => {
    const sw = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
    expect(sw).toMatch(/addAll\(\[OFFLINE, "\/icons\/icon-192\.png"\]\)/);
    expect(sw).not.toMatch(/\/api\//);
    expect(sw).toMatch(/request\.mode === "navigate"/);
  });
});

describe("the manifest", () => {
  it("installs standalone, starts on the dashboard, under the working product name", () => {
    const m = manifest();
    expect(m).toMatchObject({ name: "FitWorkoutFoodTracker", display: "standalone", start_url: "/dashboard", scope: "/" });
    expect((m.short_name ?? "").length).toBeLessThanOrEqual(12);
  });
  it("has 192 and 512 icons and a maskable one, each present at its stated size", async () => {
    const icons = manifest().icons ?? [];
    expect(icons.map((i) => i.purpose)).toEqual(expect.arrayContaining(["any", "maskable"]));
    for (const icon of [...icons, { src: "/icons/apple-touch-icon.png", sizes: "180x180" }]) {
      const file = path.join(process.cwd(), "public", icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      const meta = await sharp(file).metadata();
      expect(`${meta.width}x${meta.height}`).toBe(icon.sizes);
    }
  });
});
