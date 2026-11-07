// RC-01: measures a ranking on the recorded provider answers, through the app's own normalization, as the app shows
// them (the top 25 of each source). Reproducible: the input is the recorded file, not the live services.
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeUsdaFood } from "../usda";
import { normalizeOffProduct } from "../openfoodfacts";
import type { NormalizedFood } from "../types";
import { JUDGMENTS, type Judgment } from "./judgments";

export const RECORDING = path.join(__dirname, "recorded-2026-11-07.json");
const SHOWN = 25; // service.ts SEARCH_SHOWN
const OFF_PRODUCT_CODE = /^\d{6,14}$/; // openfoodfacts.ts

type Recorded = { recordedAt: string; queries: Record<string, { usda: Record<string, unknown>[]; off: Record<string, unknown>[] }> };
export type Ranker = (query: string, foods: NormalizedFood[]) => NormalizedFood[];

export function loadCandidates(): { recordedAt: string; queries: Record<string, { USDA: NormalizedFood[]; OPEN_FOOD_FACTS: NormalizedFood[] }> } {
  const rec = JSON.parse(readFileSync(RECORDING, "utf8")) as Recorded;
  const queries: Record<string, { USDA: NormalizedFood[]; OPEN_FOOD_FACTS: NormalizedFood[] }> = {};
  for (const [q, r] of Object.entries(rec.queries)) {
    queries[q] = {
      USDA: r.usda.map(normalizeUsdaFood).filter((f): f is NormalizedFood => f !== null),
      OPEN_FOOD_FACTS: r.off.map(normalizeOffProduct).filter((f): f is NormalizedFood => f !== null && OFF_PRODUCT_CODE.test(f.sourceId)),
    };
  }
  return { recordedAt: rec.recordedAt, queries };
}

const label = (f: NormalizedFood) => (f.brand ? `${f.name} [${f.brand}]` : f.name);
const complete = (f: NormalizedFood) => [f.per100.kcal, f.per100.protein, f.per100.carbs, f.per100.fat].every((v) => v !== null);
const hasServing = (f: NormalizedFood) => f.servings.some((s) => s.label !== "100 g" && s.label !== "100 ml");
const lookAlike = (f: NormalizedFood) => `${f.name.toLowerCase().trim()}|${(f.brand ?? "").toLowerCase().trim()}|${JSON.stringify(f.per100)}`;

export interface Measure {
  query: string; source: "USDA" | "OPEN_FOOD_FACTS";
  idealInCandidates: number; firstIdeal: number | null; top1Ideal: boolean; idealInTop3: boolean;
  wrongInTop5: number; lookAlikesInTop10: number; completeInTop5: number; servingInTop5: number; attributed: boolean;
  top5: string[];
}

function measure(query: string, source: Measure["source"], shown: NormalizedFood[], all: NormalizedFood[], j: Judgment): Measure {
  const isIdeal = (f: NormalizedFood) => j.ideal.test(f.name) && !j.wrong.test(f.name);
  const idx = shown.findIndex(isIdeal);
  const top5 = shown.slice(0, 5);
  const seen = new Set<string>();
  let lookAlikes = 0;
  for (const f of shown.slice(0, 10)) { const k = lookAlike(f); if (seen.has(k)) lookAlikes++; seen.add(k); }
  return {
    query, source,
    idealInCandidates: all.filter(isIdeal).length,
    firstIdeal: idx >= 0 ? idx + 1 : null,
    top1Ideal: idx === 0,
    idealInTop3: idx >= 0 && idx < 3,
    wrongInTop5: top5.filter((f) => j.wrong.test(f.name)).length,
    lookAlikesInTop10: lookAlikes,
    completeInTop5: top5.filter(complete).length,
    servingInTop5: top5.filter(hasServing).length,
    attributed: shown.every((f) => f.source === source && f.sourceId.length > 0),
    top5: top5.map(label),
  };
}

export function runBenchmark(rank: Ranker): Measure[] {
  const { queries } = loadCandidates();
  const out: Measure[] = [];
  for (const [q, c] of Object.entries(queries)) {
    const j = JUDGMENTS[q];
    if (!j) throw new Error(`no judgment for "${q}"`);
    out.push(measure(q, "USDA", rank(q, [...c.USDA]).slice(0, SHOWN), c.USDA, j.usda));
    out.push(measure(q, "OPEN_FOOD_FACTS", rank(q, [...c.OPEN_FOOD_FACTS]).slice(0, SHOWN), c.OPEN_FOOD_FACTS, j.off));
  }
  return out;
}

export function summarize(ms: Measure[]) {
  const n = (p: (m: Measure) => boolean) => ms.filter(p).length;
  const answerable = ms.filter((m) => m.idealInCandidates > 0);
  return {
    cases: ms.length,
    answerable: answerable.length,
    top1Ideal: n((m) => m.top1Ideal),
    idealInTop3: n((m) => m.idealInTop3),
    meanFirstIdeal: Math.round((answerable.reduce((s, m) => s + (m.firstIdeal ?? 26), 0) / Math.max(1, answerable.length)) * 10) / 10,
    wrongInTop5: ms.reduce((s, m) => s + m.wrongInTop5, 0),
    lookAlikesInTop10: ms.reduce((s, m) => s + m.lookAlikesInTop10, 0),
    completeInTop5: ms.reduce((s, m) => s + m.completeInTop5, 0),
    servingInTop5: ms.reduce((s, m) => s + m.servingInTop5, 0),
    allAttributed: ms.every((m) => m.attributed),
  };
}
