// AI-01 through the real on-device OCR: generated label images, read by tesseract.js with its language data from
// node_modules. Generated images are clean, so this proves the pipeline works, not accuracy on real photos, which
// needs real labels photographed by a person.
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
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

// Section 5 of the release directive: realistic variations, through the real OCR. Generated images, so this measures
// robustness to each condition, not accuracy on real packets. The rule checked everywhere: each value is either read
// exactly as printed, or left empty for the person; never a different number.
type Look = { font?: string; rotate?: number; blur?: number; brightness?: number; contrast?: number; gradient?: boolean; size?: number };
async function render(lines: string[], look: Look = {}): Promise<Uint8Array> {
  const size = look.size ?? 30;
  const step = Math.round(size * 1.45);
  const h = 60 + lines.length * step;
  const font = look.font ?? "Arial, Helvetica, sans-serif";
  const text = lines.map((l, i) => `<text x="24" y="${50 + i * step}" font-family="${font}" font-size="${size}" font-weight="${i === 0 ? 700 : 400}">${l}</text>`).join("");
  const shade = look.gradient ? `<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>` : "";
  let img = sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="820" height="${h}"><rect width="100%" height="100%" fill="#fff"/>${text}${shade}</svg>`));
  if (look.blur) img = sharp(await img.png().toBuffer()).blur(look.blur);
  if (look.brightness || look.contrast) img = sharp(await img.png().toBuffer()).linear(look.contrast ?? 1, (1 - (look.contrast ?? 1)) * 128).modulate({ brightness: look.brightness ?? 1 });
  if (look.rotate) img = sharp(await img.png().toBuffer()).rotate(look.rotate, { background: "#fff" });
  return new Uint8Array(await img.png().toBuffer());
}
const read = async (bytes: Uint8Array) => {
  const parsed = parseLabelExtraction(await createLocalLabelExtractor().extract({ bytes, mediaType: "image/png" }, signal()));
  if (!parsed.ok) throw new Error("the extraction isn't valid input for the review screen");
  return parsed.extraction;
};
const US = { kcal: 230, fat: 8, carbs: 37, fiber: 4, protein: 3 } as const;
/** Every value read is exact; returns how many were read, for the report. */
function exactOrEmpty(c: { [k: string]: { value: number | null; status: string } }, want: Record<string, number>): number {
  for (const [k, v] of Object.entries(want)) expect([v, null], k).toContain(c[k].value);
  return Object.keys(want).filter((k) => c[k].value !== null).length;
}

describe("realistic variations: never a wrong value", () => {
  // Set LABEL_REPORT_OUT to a file to get how much each variation read (values read of 5, and the serving).
  const report: string[] = [];
  afterAll(() => { if (process.env.LABEL_REPORT_OUT) writeFileSync(process.env.LABEL_REPORT_OUT, `${report.join("\n")}\n`); });
  it.each([
    ["Times New Roman", { font: "Times New Roman, serif" }],
    ["Courier New", { font: "Courier New, monospace" }],
    ["Verdana", { font: "Verdana, sans-serif" }],
    ["Georgia", { font: "Georgia, serif" }],
    ["small print (20 px)", { size: 20 }],
    ["slight blur", { blur: 1.2 }],
    ["heavy blur", { blur: 3 }],
    ["dim light", { brightness: 0.55 }],
    ["low contrast", { contrast: 0.4 }],
    ["uneven light (shadow across)", { gradient: true }],
    ["upside down", { rotate: 180 }],
    ["turned left", { rotate: 270 }],
    ["slightly tilted (4°)", { rotate: 4 }],
  ] as [string, Look][])("%s", async (name, look) => {
    const t0 = Date.now();
    const e = await read(await render(LINES, look));
    const ms = Date.now() - t0;
    if (!e.isNutritionLabel) { expect(e.columns).toEqual([]); report.push(`| ${name} | not recognized as a label | 0 of 5 | no | ${ms} |`); return; } // said plainly: nothing guessed
    const n = exactOrEmpty(e.columns[0] as never, US);
    if (e.servingSize.status === "read") expect([e.servingSize.amount, e.servingSize.unit]).toEqual([55, "g"]);
    report.push(`| ${name} | label | ${n} of 5 | ${e.servingSize.status === "read" ? "55 g" : "left for the person"} | ${ms} |`);
  }, 120_000);

  it("an unusual serving size is read with its own amount, or left for the person", async () => {
    for (const [line, amount] of [["Serving size 1 bar (37.5g)", 37.5], ["Serving size 3 pieces (113 g)", 113]] as const) {
      const e = await read(await render(["Nutrition Facts", line, "Amount per serving", "Calories 190", "Total Fat 7g", "Total Carbohydrate 26g", "Protein 6g"]));
      expect(e.isNutritionLabel).toBe(true);
      if (e.servingSize.status === "read") expect(e.servingSize.amount).toBe(amount);
      exactOrEmpty(e.columns[0] as never, { kcal: 190, fat: 7, carbs: 26, protein: 6 });
    }
  }, 120_000);

  it("per 100 g and per portion columns are kept apart, each with its own values", async () => {
    const e = await read(await render(["Nutrition information", "Per 100 g     Per 30 g portion", "Energy 1580 kJ / 375 kcal   474 kJ / 113 kcal", "Fat 6.5 g   2.0 g", "Carbohydrate 62 g   19 g", "Protein 12 g   3.6 g"], { size: 26 }));
    expect(e.isNutritionLabel).toBe(true);
    const per100 = e.columns.find((c) => c.basis === "per_100g");
    const portion = e.columns.find((c) => c.basis === "per_serving");
    expect(per100 && portion).toBeTruthy();
    exactOrEmpty(per100 as never, { kcal: 375, fat: 6.5, carbs: 62, protein: 12 });
    exactOrEmpty(portion as never, { kcal: 113, fat: 2, carbs: 19, protein: 3.6 });
  }, 120_000);

  it("a nutrient the label doesn't print stays absent, never 0", async () => {
    const e = await read(await render(["Nutrition Facts", "Amount per serving", "Calories 120", "Total Fat 2g", "Total Carbohydrate 22g", "Protein 4g"]));
    expect(e.columns[0].fiber).toMatchObject({ status: "absent", value: null });
  }, 120_000);

  it("values that contradict each other are read as printed, and flagged for the person", async () => {
    const e = await read(await render(["Nutrition Facts", "Amount per serving", "Calories 900", "Total Fat 8g", "Total Carbohydrate 37g", "Protein 3g"]));
    exactOrEmpty(e.columns[0] as never, { kcal: 900, fat: 8, carbs: 37, protein: 3 });
    if (e.columns[0].kcal.value !== null && e.columns[0].fat.value !== null && e.columns[0].carbs.value !== null && e.columns[0].protein.value !== null) {
      expect(checkLabelExtraction(e).some((f) => f.code === "energy_macro_mismatch")).toBe(true);
    }
  }, 120_000);
});
