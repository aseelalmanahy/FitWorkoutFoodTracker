// D0, D1, D2: runs one reader over one recorded evaluation set and scores it with ./score. Skipped unless asked for:
//   AI_EVAL_KIND=label|meal  AI_EVAL_SET=<manifest.json>  AI_EVAL_DIR=<folder of its photos>
//   AI_EVAL_READER=local (default) | ollama (AI_EVAL_OLLAMA_MODEL, optional AI_EVAL_OLLAMA_URL; D1) | provider (D2)
//   AI_EVAL_DERIVE=none (default) | rotate90 | rotate180 | rotate270 | dim   derived from the set's own photos
//   AI_EVAL_REPORT_OUT=<file.md>
//   npx vitest run src/lib/server/eval/run.eval.test.ts
// The provider is refused unless AI_EVAL_APPROVAL names the owner's approval (D2a: public sets only; D2b: the owner's
// own photos), AI_EVAL_MAX_IMAGES caps the requests, and the provider's own settings are set. Every photo goes through
// the upload's validation first, so only the cleaned copy reaches any reader, as in the app. "dim" is simulated low
// light and the rotations simulated orientation: both are derived from real photos, and reported as such.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { validateImage } from "@/lib/server/images/validate";
import type { LabelExtractor } from "@/lib/server/labels/extractor";
import type { MealIdentifier } from "@/lib/server/meals/identifier";
import { createOllamaLabelExtractor, createOllamaMealIdentifier } from "./ollama";
import { scoreLabel, scoreMeal, totalLabels, totalMeals, type LabelExpectation, type MealExpectation, type MealScore } from "./score";

const env = process.env;
const KIND = env.AI_EVAL_KIND;
const READER = env.AI_EVAL_READER ?? "local";
const DERIVE = env.AI_EVAL_DERIVE ?? "none";

type LabelPhoto = { file: string; code?: string; product?: string | null; photo?: string; source?: string; reference: LabelExpectation };
type MealPhoto = { file: string; food?: string; accept?: string[]; kind?: MealExpectation["kind"]; foods?: MealExpectation["foods"]; photo?: string; source?: string };
type Manifest = { license?: string; public?: boolean; photos: (LabelPhoto & MealPhoto)[] };

/** Why this run may not go ahead, before any reader is made or any photo read. */
export function runProblems(e: Record<string, string | undefined>, manifest: Manifest): string[] {
  const p: string[] = [];
  if (!["label", "meal"].includes(e.AI_EVAL_KIND ?? "")) p.push("AI_EVAL_KIND must be label or meal");
  if (!["local", "ollama", "provider"].includes(e.AI_EVAL_READER ?? "local")) p.push("AI_EVAL_READER must be local, ollama or provider");
  if (!["none", "rotate90", "rotate180", "rotate270", "dim"].includes(e.AI_EVAL_DERIVE ?? "none")) p.push("AI_EVAL_DERIVE isn't one of none, rotate90, rotate180, rotate270, dim");
  if ((e.AI_EVAL_READER ?? "local") === "ollama" && !e.AI_EVAL_OLLAMA_MODEL) p.push("AI_EVAL_OLLAMA_MODEL is required for ollama (D1)");
  if (e.AI_EVAL_READER === "provider") {
    const approval = e.AI_EVAL_APPROVAL;
    if (approval !== "D2a" && approval !== "D2b") p.push("the provider needs AI_EVAL_APPROVAL=D2a (public sets) or D2b (the owner's photos): the owner's approval to send these images and spend");
    const publicSet = manifest.public === true || (Boolean(manifest.license) && manifest.photos.every((x) => /^https:\/\//.test(x.photo ?? x.source ?? "")));
    if (approval === "D2a" && !publicSet) p.push("D2a covers public sets only, and this set's photos aren't all public, licensed and sourced");
    const max = Number(e.AI_EVAL_MAX_IMAGES);
    if (!Number.isInteger(max) || max < 1) p.push("AI_EVAL_MAX_IMAGES must cap the number of images sent");
    else if (max < manifest.photos.length) p.push(`AI_EVAL_MAX_IMAGES (${max}) is below this set's ${manifest.photos.length} photos, so the run would be partial`);
    if (!e.ANTHROPIC_API_KEY || !(e.AI_EVAL_KIND === "meal" ? e.MEAL_IDENTIFICATION_MODEL : e.LABEL_EXTRACTION_MODEL)) p.push("the provider's key and model settings aren't set");
  }
  return p;
}

async function derive(bytes: Buffer): Promise<Buffer> {
  if (DERIVE === "none") return bytes;
  const img = sharp(bytes).rotate(); // apply any stored orientation first, so a rotation is relative to what a person sees
  if (DERIVE === "dim") return img.linear(0.3, 0).jpeg({ quality: 90 }).toBuffer();
  return img.rotate(Number(DERIVE.slice("rotate".length))).jpeg({ quality: 90 }).toBuffer();
}

async function makeLabelReader(): Promise<LabelExtractor> {
  if (READER === "ollama") return createOllamaLabelExtractor({ model: env.AI_EVAL_OLLAMA_MODEL!, url: env.AI_EVAL_OLLAMA_URL });
  if (READER === "provider") { const { createAnthropicLabelExtractor } = await import("@/lib/server/labels/anthropic"); return createAnthropicLabelExtractor({ apiKey: env.ANTHROPIC_API_KEY!, model: env.LABEL_EXTRACTION_MODEL! }); }
  const { createLocalLabelExtractor } = await import("@/lib/server/labels/local-ocr");
  return createLocalLabelExtractor();
}
async function makeMealReader(): Promise<MealIdentifier> {
  if (READER === "ollama") return createOllamaMealIdentifier({ model: env.AI_EVAL_OLLAMA_MODEL!, url: env.AI_EVAL_OLLAMA_URL });
  if (READER === "provider") { const { createAnthropicMealIdentifier } = await import("@/lib/server/meals/anthropic"); return createAnthropicMealIdentifier({ apiKey: env.ANTHROPIC_API_KEY!, model: env.MEAL_IDENTIFICATION_MODEL! }); }
  const { createLocalMealIdentifier } = await import("@/lib/server/meals/local-clip");
  return createLocalMealIdentifier();
}
const mealRef = (p: MealPhoto): MealExpectation => p.kind && p.foods ? { kind: p.kind, foods: p.foods } : { kind: "single", foods: [{ name: p.food ?? "", accept: p.accept ?? [] }] };

describe.skipIf(!KIND)("evaluation run", () => {
  it(`${KIND} set, ${READER} reader, derived: ${DERIVE}`, async () => {
    const manifest = JSON.parse(readFileSync(env.AI_EVAL_SET ?? "", "utf8")) as Manifest;
    const problems = runProblems(env, manifest);
    if (problems.length) throw new Error(`REFUSED (nothing was read or sent): ${problems.join("; ")}`);
    const dir = env.AI_EVAL_DIR ?? "";
    const photos = [...new Map(manifest.photos.map((p) => [p.file, p])).values()].filter((p) => existsSync(path.join(dir, p.file)));
    expect(photos.length, "photos present").toBeGreaterThan(0);
    const rows: string[] = [];
    const signal = () => AbortSignal.timeout(120_000);
    const labelScores = [], mealScores: { ref: MealExpectation; score: MealScore }[] = [], wrong: string[] = [];
    let rejected = 0, ms = 0;
    const reader = KIND === "label" ? await makeLabelReader() : await makeMealReader();
    for (const p of photos) {
      const v = await validateImage(new Uint8Array(await derive(readFileSync(path.join(dir, p.file)))));
      if (!v.ok) { rejected++; rows.push(`| ${p.file} | rejected by validation: ${v.code} |`); continue; }
      const image = { bytes: v.sanitized, mediaType: v.mediaType };
      const t0 = Date.now();
      const raw = await ("extract" in reader ? reader.extract(image, signal()) : reader.identify(image, signal())).catch((e: Error) => ({ error: e.message }));
      ms += Date.now() - t0;
      if (KIND === "label") {
        const s = scoreLabel(raw, p.reference);
        labelScores.push(s);
        wrong.push(...s.wrongDetails.map((d) => `${p.file}: ${d}`));
        rows.push(`| ${p.file} | ${s.schemaOk ? (s.recognized ? "label" : "not a label") : "refused by schema"} | ${s.expected} | ${s.right} | ${s.wrong} | ${s.leftEmpty} | ${s.unchecked} |`);
      } else {
        const ref = mealRef(p);
        const s = scoreMeal(raw, ref);
        mealScores.push({ ref, score: s });
        rows.push(`| ${p.file} | ${ref.kind} | ${ref.foods.map((f) => f.name).join(", ")} | ${s.schemaOk ? s.names.join(", ") || "(nothing)" : "refused by schema"} | ${s.first ? "yes" : ""} | ${s.top3 ? "yes" : ""} | ${s.found}/${ref.foods.length} | ${s.wrongSuggestions} |`);
      }
    }
    const totals = KIND === "label" ? totalLabels(labelScores) : totalMeals(mealScores);
    const summary = `${KIND}, ${reader.id}, ${DERIVE === "none" ? "photos as recorded" : `derived: ${DERIVE} (simulated)`}, ${photos.length} photos (${rejected} rejected by validation), ${Math.round(ms / Math.max(1, photos.length - rejected))} ms each: ${JSON.stringify(totals)}`;
    console.log(summary);
    if (env.AI_EVAL_REPORT_OUT) {
      const head = KIND === "label" ? "| Photo | Result | Expected | Right | Wrong | Left empty | Unchecked |\n|---|---|---|---|---|---|---|" : "| Photo | Kind | Foods | Suggested | First | Among three | Found | Wrong |\n|---|---|---|---|---|---|---|---|";
      writeFileSync(env.AI_EVAL_REPORT_OUT, [`# Evaluation: ${path.basename(env.AI_EVAL_SET ?? "")}`, "", manifest.license ? `Photos: ${manifest.license}` : "", "", summary, "", head, ...rows, "", ...(wrong.length ? ["## Values that differ from the reference, to check by eye", "", ...wrong.map((w) => `- ${w}`)] : []), ""].join("\n"));
    }
  }, 3_600_000);
});

describe("evaluation run refusals", () => {
  const publicSet: Manifest = { license: "CC BY-SA", photos: [{ file: "a.jpg", photo: "https://images.openfoodfacts.org/a.jpg", reference: { per100g: null, perServing: null } }] };
  const ownSet: Manifest = { photos: [{ file: "mine.jpg", reference: { per100g: null, perServing: null } }] };
  const provider = { AI_EVAL_KIND: "label", AI_EVAL_READER: "provider", AI_EVAL_MAX_IMAGES: "1", ANTHROPIC_API_KEY: "k", LABEL_EXTRACTION_MODEL: "m" };
  it("the provider runs only with a named approval, a cap covering the whole set, and its settings", () => {
    expect(runProblems({ ...provider }, publicSet).join()).toMatch(/AI_EVAL_APPROVAL=D2a/);
    expect(runProblems({ ...provider, AI_EVAL_APPROVAL: "yes" }, publicSet).join()).toMatch(/AI_EVAL_APPROVAL=D2a/);
    expect(runProblems({ ...provider, AI_EVAL_APPROVAL: "D2a", AI_EVAL_MAX_IMAGES: "" }, publicSet).join()).toMatch(/cap/);
    expect(runProblems({ ...provider, AI_EVAL_APPROVAL: "D2a", ANTHROPIC_API_KEY: "" }, publicSet).join()).toMatch(/key and model/);
    expect(runProblems({ ...provider, AI_EVAL_APPROVAL: "D2a" }, publicSet)).toEqual([]);
  });
  it("D2a covers public, licensed, sourced photos only; the owner's own photos need D2b", () => {
    expect(runProblems({ ...provider, AI_EVAL_APPROVAL: "D2a" }, ownSet).join()).toMatch(/public sets only/);
    expect(runProblems({ ...provider, AI_EVAL_APPROVAL: "D2b" }, ownSet)).toEqual([]);
  });
  it("local and Ollama runs need no approval here, but Ollama needs its model named; unknown settings are refused", () => {
    expect(runProblems({ AI_EVAL_KIND: "meal" }, ownSet)).toEqual([]);
    expect(runProblems({ AI_EVAL_KIND: "meal", AI_EVAL_READER: "ollama" }, ownSet).join()).toMatch(/AI_EVAL_OLLAMA_MODEL/);
    expect(runProblems({ AI_EVAL_KIND: "meal", AI_EVAL_DERIVE: "blur" }, ownSet).join()).toMatch(/AI_EVAL_DERIVE/);
    expect(runProblems({ AI_EVAL_KIND: "x" }, ownSet).join()).toMatch(/AI_EVAL_KIND/);
  });
});
