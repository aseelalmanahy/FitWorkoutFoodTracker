import "server-only";
import path from "node:path";
import type { LabelExtraction } from "@/lib/label-extraction";
import { LabelExtractionError, type LabelExtractor, type LabelImage } from "./extractor";
import { parseLabelText } from "./text-parse";

/**
 * Label reading on this server, with no paid service and no network request (AI-01): tesseract.js 6.0.1 with its
 * English data from node_modules (@tesseract.js-data/eng 1.0.0, 4.0.0_best_int). Enabled by LABEL_OCR=local.
 *
 * It sees only the clean image copy from validation. Its text becomes a conservative draft (text-parse.ts), and the
 * person checks every value on the review screen. A photo may be sideways, so up to four orientations are tried
 * (then, for a small photo, the same four enlarged), stopping at the first that reads as a nutrition label. Nothing is
 * stored or cached on disk.
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
      let best: LabelExtraction | null = null;
      for (const { angle, width } of attempts) {
        if (signal.aborted) throw new LabelExtractionError("timeout");
        const prepared = await sharp(image.bytes).rotate(angle).resize({ width }).grayscale().normalize().png().toBuffer();
        let text: string;
        try {
          ({ data: { text } } = await w.recognize(prepared));
        } catch {
          throw new LabelExtractionError("unavailable");
        }
        const reading = parseLabelText(text);
        if (!best || yieldOf(reading) > yieldOf(best)) best = reading;
        if (reading.isNutritionLabel) break;
      }
      return best!;
    },
  };
}
