// AI-01 through the real on-device OCR: generated label images, read by tesseract.js with its language data from
// node_modules. Generated images are clean, so this proves the pipeline works, not accuracy on real photos, which
// needs real labels photographed by a person.
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { checkLabelExtraction, parseLabelExtraction } from "@/lib/label-extraction";
import { createLocalLabelExtractor, LOCAL_OCR_ID } from "./local-ocr";

const LINES = ["Nutrition Facts", "8 servings per container", "Serving size 2/3 cup (55g)", "Amount per serving", "Calories 230",
  "Total Fat 8g", "Saturated Fat 1g", "Total Carbohydrate 37g", "Dietary Fiber 4g", "Total Sugars 12g", "Protein 3g"];

async function labelImage(lines: string[], rotate = 0): Promise<Uint8Array> {
  const h = 60 + lines.length * 44;
  const text = lines.map((l, i) => `<text x="24" y="${56 + i * 44}" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="${i === 0 || i === 4 ? 700 : 400}">${l}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${h}"><rect width="100%" height="100%" fill="#fff"/>${text}</svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).rotate(rotate, { background: "#fff" }).png().toBuffer());
}
const signal = () => new AbortController().signal;

describe("on-device label reading", () => {
  it("uses only language data shipped in node_modules", () => {
    const dir = path.join(process.cwd(), "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int");
    expect(existsSync(path.join(dir, "eng.traineddata.gz"))).toBe(true);
    expect(createLocalLabelExtractor().id).toBe(LOCAL_OCR_ID);
  });

  it("reads a label image into a valid draft for the review screen", async () => {
    const out = await createLocalLabelExtractor().extract({ bytes: await labelImage(LINES), mediaType: "image/png" }, signal());
    const parsed = parseLabelExtraction(out);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const e = parsed.extraction;
    expect(e.isNutritionLabel).toBe(true);
    const c = e.columns[0];
    // Each value is either read exactly, or left unreadable for the person: never a different number.
    for (const [k, want] of [["kcal", 230], ["fat", 8], ["carbs", 37], ["fiber", 4], ["protein", 3]] as const) {
      expect([want, null], k).toContain(c[k].value);
    }
    expect(["kcal", "fat", "carbs", "protein"].filter((k) => c[k as "kcal"].status === "read").length).toBeGreaterThanOrEqual(3);
    expect(checkLabelExtraction(e).some((f) => f.code === "invalid_number")).toBe(false);
  }, 120_000);

  it("reads a label photographed sideways", async () => {
    const out = (await createLocalLabelExtractor().extract({ bytes: await labelImage(LINES, 90), mediaType: "image/png" }, signal())) as { isNutritionLabel: boolean };
    expect(out.isNutritionLabel).toBe(true);
  }, 120_000);

  it("says plainly when an image isn't a label", async () => {
    const out = (await createLocalLabelExtractor().extract({ bytes: await labelImage(["Thank you for shopping with us", "See you soon"]), mediaType: "image/png" }, signal())) as { isNutritionLabel: boolean; columns: unknown[] };
    expect(out.isNutritionLabel).toBe(false);
    expect(out.columns).toEqual([]);
  }, 120_000);
});
