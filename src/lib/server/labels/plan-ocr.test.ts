// IMG-01, end to end through the real on-server recognizer (tesseract.js, no network) and the parser's OCR mode.
// Generated images cover each layout; the owner's real images, which aren't committed (third-party graphics), are
// read too when they're present in the Git-ignored .cache/plan-images folder.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { recognizePlanText } from "./local-ocr";
import { validateImage } from "../images/validate";
import { parseWorkoutText } from "@/lib/workout-import/parse";

const read = async (png: Buffer) => parseWorkoutText(await recognizePlanText(new Uint8Array(png), new AbortController().signal), { ocr: true });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** A plan drawn as text on white: rows of cells at x positions, one row per line. */
async function drawn(rows: [number, string][][], { width, height, size }: { width: number; height: number; size: number }) {
  const lineH = Math.round(size * 1.6);
  const text = rows.map((cells, i) => cells.map(([x, t]) => `<text x="${x}" y="${(i + 2) * lineH}" font-family="Arial" font-size="${size}" fill="#111">${esc(t)}</text>`).join("")).join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/>${text}</svg>`)).png().toBuffer();
}
const DAYS: [string, string[]][] = [
  ["MONDAY", ["Barbell Bench Press", "Incline Dumbbell Press", "Cable Flyes"]],
  ["WEDNESDAY", ["Seated Cable Rows", "Face Pulls", "Barbell Curls", "Hammer Curls"]],
  ["FRIDAY", ["Romanian Deadlifts", "Leg Press"]],
];
const summary = (d: Awaited<ReturnType<typeof read>>) => d.days.map((x) => [x.name, x.weekday, x.exercises.map((e) => `${e.name} ${e.sets}x${e.repsMin}-${e.repsMax}`)]);
const expected = (reps: string) => DAYS.map(([day, ex], i) => [day, [0, 2, 4][i], ex.map((e) => `${e} ${reps}`)]);

describe("plan images through the real recognizer (IMG-01)", { timeout: 120_000 }, () => {
  it("a small three-column table, day | exercise | sets & reps, as a phone saves it (420 px wide)", async () => {
    const rows = DAYS.flatMap(([day, ex]) => ex.map((e, i): [number, string][] => [...(i === 0 ? [[10, day] as [number, string]] : []), [120, e], [300, "3 sets of 8-12 reps"]]));
    expect(summary(await read(await drawn(rows, { width: 420, height: 420, size: 10 })))).toEqual(expected("3x8-12"));
  });

  it("separate sets and reps columns", async () => {
    const rows = DAYS.flatMap(([day, ex]): [number, string][][] => [[[20, day]], ...ex.map((e): [number, string][] => [[20, e.toUpperCase()], [420, "4"], [520, "6-10"]])]);
    const d = await read(await drawn([[[20, "EXERCISE"], [420, "SETS"], [520, "REPS"]], ...rows], { width: 640, height: 520, size: 16 }));
    expect(d.days.map((x) => [x.name, x.exercises.map((e) => `${e.sets}x${e.repsMin}-${e.repsMax}`)])).toEqual(DAYS.map(([day, ex]) => [day, ex.map(() => "4x6-10")]));
  });

  it("a list without a table, several days, different counts per day", async () => {
    const rows = DAYS.flatMap(([day, ex]): [number, string][][] => [[[20, `${day[0]}${day.slice(1).toLowerCase()}`]], ...ex.map((e): [number, string][] => [[40, `${e} 3x10`]])]);
    const d = await read(await drawn(rows, { width: 900, height: 560, size: 22 }));
    expect(d.days.map((x) => [x.weekday, x.exercises.length])).toEqual([[0, 3], [2, 4], [4, 2]]);
    expect(d.days.flatMap((x) => x.exercises).every((e) => e.sets === 3 && e.repsMin === 10 && e.repsMax === 10)).toBe(true);
  });

  it("a partly unreadable image: what's readable is kept, nothing is invented for the rest", async () => {
    const clear = await drawn([[[20, "MONDAY"]], [[20, "Leg Press 3x12"]], [[20, "Leg Extension 3x15"]]], { width: 900, height: 300, size: 24 });
    // The lower part is blurred past reading.
    const smudged = await sharp(clear).composite([{ input: await sharp(clear).extract({ left: 0, top: 120, width: 900, height: 180 }).blur(12).toBuffer(), left: 0, top: 120 }]).png().toBuffer();
    const d = await read(smudged);
    const ex = d.days.flatMap((x) => x.exercises);
    expect(ex.map((e) => e.name)).toContain("Leg Press");
    expect(ex.every((e) => e.sets !== null && e.repsMin !== null)).toBe(true); // only rows that were read
    expect(ex.length).toBeLessThan(2);
  });

  const REAL = path.join(process.cwd(), ".cache", "plan-images", "failed-3day.jpg");
  it.skipIf(!existsSync(REAL))("the owner's real image that failed, as uploaded (through the upload's own re-encoding): 3 days, 18 exercises, 3 x 8-12 each", async () => {
    const v = await validateImage(new Uint8Array(readFileSync(REAL)));
    if (!v.ok) throw new Error(`the upload check refused it: ${v.code}`);
    for (const bytes of [v.sanitized, new Uint8Array(readFileSync(REAL))]) {
      const d = parseWorkoutText(await recognizePlanText(bytes, new AbortController().signal), { ocr: true });
      expect(d.days.map((x) => [x.name, x.weekday, x.exercises.length])).toEqual([["MONDAY", 0, 6], ["WEDNESDAY", 2, 6], ["FRIDAY", 4, 6]]);
      expect(d.days.flatMap((x) => x.exercises).map((e) => `${e.sets}x${e.repsMin}-${e.repsMax}`)).toEqual(Array(18).fill("3x8-12"));
    }
  });
});
