// RC-03: on-device label reading on real photographs of real packets, from Open Food Facts (CC BY-SA 3.0), compared
// with the values its contributors entered. Runs only when the photos are present locally:
//   node scripts/label-photo-fetch.cjs src/lib/server/labels/eval/off-photos.json .cache/label-photos
// Each photo goes through the upload's own validation, then the reader, exactly as in the app. A value "agrees" when
// it matches the reference for the same basis (per serving or per 100 g) within rounding; a disagreement isn't proof
// of a misreading, as the reference can be wrong or for an older label, so each one is listed for checking by eye.
// Set LABEL_PHOTO_REPORT_OUT to a file to get the full report. This measures; it isn't the owner's acceptance.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseLabelExtraction } from "@/lib/label-extraction";
import { validateImage } from "@/lib/server/images/validate";
import { createLocalLabelExtractor } from "../local-ocr";

const DIR = path.join(process.cwd(), ".cache", "label-photos");
const MANIFEST = path.join(__dirname, "off-photos.json");
type Ref = Record<"kcal" | "protein" | "carbs" | "fat" | "fiber", number | null>;
type Photo = { code: string; product: string | null; file: string; photo: string; reference: { per100g: Ref; perServing: Ref } };
const KEYS = ["kcal", "protein", "carbs", "fat", "fiber"] as const;
const agrees = (got: number, ref: number) => Math.abs(got - ref) <= Math.max(0.5, Math.abs(ref) * 0.02);

describe.skipIf(!existsSync(DIR))("real label photos (Open Food Facts)", () => {
  it("are read without a single value being invented: each is read, or left with a reason", async () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { photos: Photo[] };
    const unique = [...new Map(manifest.photos.map((p) => [p.code, p])).values()].filter((p) => existsSync(path.join(DIR, p.file)));
    const rows: string[] = [];
    const disagreements: string[] = [];
    const total = { photos: 0, labels: 0, read: 0, agree: 0, disagree: 0, noReference: 0, leftForPerson: 0, servingRead: 0, ms: 0 };
    for (const p of unique) {
      const v = await validateImage(new Uint8Array(readFileSync(path.join(DIR, p.file))));
      if (!v.ok) { rows.push(`| ${p.code} | ${p.product ?? ""} | rejected by validation: ${v.code} | | | | |`); continue; }
      total.photos++;
      const t0 = Date.now();
      const out = await createLocalLabelExtractor().extract({ bytes: v.sanitized, mediaType: v.mediaType }, new AbortController().signal);
      const ms = Date.now() - t0;
      total.ms += ms;
      const parsed = parseLabelExtraction(out);
      expect(parsed.ok, p.code).toBe(true); // always valid input for the review screen
      if (!parsed.ok) continue;
      const e = parsed.extraction;
      if (!e.isNutritionLabel) { rows.push(`| ${p.code} | ${p.product ?? ""} | not recognized as a label | 0 | | | ${ms} |`); continue; }
      total.labels++;
      if (e.servingSize.status === "read") total.servingRead++;
      let read = 0, agree = 0, disagree = 0, left = 0;
      for (const c of e.columns) {
        const ref = c.basis === "per_100g" || c.basis === "per_100ml" ? p.reference.per100g : c.basis === "per_serving" ? p.reference.perServing : null;
        for (const k of KEYS) {
          const f = c[k];
          if (f.status === "unreadable") left++;
          if (f.status !== "read" || f.value === null) continue;
          read++;
          const r = ref?.[k];
          if (r === null || r === undefined || (k === "kcal" && f.unit !== "kcal")) { total.noReference++; continue; }
          if (agrees(f.value, r)) agree++;
          else { disagree++; disagreements.push(`${p.code} ${p.product ?? ""}: ${c.basis} ${k} read ${f.value} ${f.unit} from "${f.printed}", reference ${r}`); }
        }
      }
      total.read += read; total.agree += agree; total.disagree += disagree; total.leftForPerson += left;
      rows.push(`| ${p.code} | ${(p.product ?? "").slice(0, 30)} | ${e.columns.map((c) => c.basis).join(", ")} | ${read} | ${agree} | ${disagree} | ${ms} |`);
    }
    if (process.env.LABEL_PHOTO_REPORT_OUT) {
      writeFileSync(process.env.LABEL_PHOTO_REPORT_OUT, [
        `# On-device label reading on real photos`, ``, `Photos: Open Food Facts contributors, CC BY-SA 3.0. Reference values: Open Food Facts (ODbL), entered by contributors.`, ``,
        `Totals: ${JSON.stringify(total)}`, ``,
        `| Code | Product | Columns read | Values read | Agree | Disagree | ms |`, `|---|---|---|---|---|---|---|`, ...rows, ``,
        `## Disagreements, to check by eye`, ``, ...(disagreements.length ? disagreements.map((d) => `- ${d}`) : ["None."]), ``,
      ].join("\n"));
    }
    expect(total.photos).toBeGreaterThan(0);
  }, 900_000);
});
