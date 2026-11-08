import "server-only";
import path from "node:path";
import type { LabelExtraction } from "@/lib/label-extraction";
import { LabelExtractionError, type LabelExtractor, type LabelImage } from "./extractor";
import { mergeReadings, parseLabelText } from "./text-parse";

/**
 * Label reading on this server, with no paid service and no network request (AI-01): tesseract.js 6.0.1 with its
 * English data from node_modules (@tesseract.js-data/eng 1.0.0, 4.0.0_best_int). Enabled by LABEL_OCR=local.
 *
 * It sees only the clean image copy from validation. Its text becomes a conservative draft (text-parse.ts), and the
 * person checks every value on the review screen. A photo may be sideways, so up to four orientations are tried
 * (then, for a small photo, the same four enlarged), stopping at the first that reads as a nutrition label. That
 * orientation is then read a second time, in black and white, and only values both readings agree on are kept
 * (mergeReadings): OCR's misreads depend on how the image is prepared. Nothing is stored or cached on disk.
 */
export const LOCAL_OCR_ID = "local:tesseract.js-6.0.1:eng-4.0.0_best_int";
const LANG_PATH = path.join(process.cwd(), "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int");
const ORIENTATIONS = [0, 90, 270, 180];

type Worker = { recognize(image: Buffer): Promise<{ data: { text: string } }>; setParameters(p: Record<string, string>): Promise<unknown> };
let workerPromise: Promise<Worker> | null = null;

/** One worker per server process, made on first use. It handles one image at a time, in order. */
function worker(): Promise<Worker> {
  workerPromise ??= (async () => {
    const { createWorker } = await import("tesseract.js");
    const w = await createWorker("eng", 1, { langPath: LANG_PATH, gzip: true, cacheMethod: "none", logger: () => {}, errorHandler: () => {} });
    // A label is one block of text; spaces between columns are kept so the columns stay apart.
    await w.setParameters({ tessedit_pageseg_mode: "6" as never, preserve_interword_spaces: "1" });
    return w as unknown as Worker;
  })().catch((err) => {
    workerPromise = null; // try again next time, rather than keep a broken worker
    throw err;
  });
  return workerPromise;
}

/** How much a reading found: a label with more fields read beats one with fewer. */
const yieldOf = (e: LabelExtraction) =>
  (e.isNutritionLabel ? 100 : 0) + e.columns.flatMap((c) => [c.kcal, c.protein, c.carbs, c.fat, c.fiber]).filter((f) => f.status === "read").length;

export function createLocalLabelExtractor(): LabelExtractor {
  return {
    id: LOCAL_OCR_ID,
    async extract(image: LabelImage, signal: AbortSignal): Promise<LabelExtraction> {
      let w: Worker;
      try {
        w = await worker();
      } catch {
        throw new LabelExtractionError("unavailable");
      }
      const sharp = (await import("sharp")).default;
      const meta = await sharp(image.bytes).metadata();
      // Read at the photo's own size first: enlarging or sharpening measurably turns "g" into "9" ("37g" → "379g").
      // Very large photos are reduced, which also bounds the time. A small photo is enlarged only if it didn't read.
      const native = Math.min(meta.width ?? 1600, 2400);
      const attempts = ORIENTATIONS.map((angle) => ({ angle, width: native }));
      if (native < 1200) attempts.push(...ORIENTATIONS.map((angle) => ({ angle, width: 2000 })));
      // Light text on a dark panel is read inverted, as the recognizer expects dark text on a light ground.
      const dark = (await sharp(image.bytes).grayscale().stats()).channels[0].mean < 110;
      const tone = (img: import("sharp").Sharp) => (dark ? img.grayscale().negate({ alpha: false }) : img.grayscale());
      const recognize = async (prepared: Buffer) => {
        if (signal.aborted) throw new LabelExtractionError("timeout");
        try {
          return parseLabelText((await w.recognize(prepared)).data.text);
        } catch {
          throw new LabelExtractionError("unavailable");
        }
      };
      let best: { reading: LabelExtraction; angle: number; width: number } | null = null;
      for (const { angle, width } of attempts) {
        const reading = await recognize(await tone(sharp(image.bytes).rotate(angle).resize({ width })).normalize().png().toBuffer());
        if (!best || yieldOf(reading) > yieldOf(best.reading)) best = { reading, angle, width };
        if (reading.isNutritionLabel) break;
      }
      if (!best!.reading.isNutritionLabel) return best!.reading;
      // The second reading: the same orientation and size, in black and white.
      const second = await recognize(await tone(sharp(image.bytes).rotate(best!.angle).resize({ width: best!.width })).normalize().threshold(140).png().toBuffer());
      return mergeReadings(best!.reading, second);
    },
  };
}

const letters = (s: string) => (s.match(/[A-Za-z]/g) ?? []).length;
export const MAX_PLAN_TEXT_CHARS = 20_000;

/**
 * Phase 3: the plain text of a workout plan's page, photo or screenshot, by the same on-device worker and with no
 * network request. Upright first; a photo taken sideways is tried in the other orientations only if little was read.
 * Returns text only: nothing is interpreted, stored or logged here.
 */
export async function recognizePlanText(bytes: Uint8Array, signal: AbortSignal): Promise<string> {
  let w: Worker;
  try {
    w = await worker();
  } catch {
    throw new LabelExtractionError("unavailable");
  }
  const sharp = (await import("sharp")).default;
  let best = "";
  for (const angle of ORIENTATIONS) {
    if (signal.aborted) throw new LabelExtractionError("timeout");
    const prepared = await sharp(bytes).rotate(angle).grayscale().normalize().png().toBuffer();
    let text: string;
    try {
      text = (await w.recognize(prepared)).data.text;
    } catch {
      throw new LabelExtractionError("unavailable");
    }
    if (letters(text) > letters(best)) best = text;
    if (letters(best) >= 40) break;
  }
  return best.slice(0, MAX_PLAN_TEXT_CHARS);
}
