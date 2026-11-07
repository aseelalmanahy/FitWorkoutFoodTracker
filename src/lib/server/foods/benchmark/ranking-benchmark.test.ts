// RC-01: the food-search relevance benchmark. 12 queries, recorded from USDA and Open Food Facts on 2026-11-07, ranked
// three ways: the providers' own order, the first ranker (v1, frozen copy) and the current one. Set BENCHMARK_OUT to a
// file path to write the full comparison as Markdown.
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rankFoods } from "../rank";
import { rankFoods as rankFoodsV1 } from "./rank-v1";
import { loadCandidates, runBenchmark, summarize, type Measure, type Ranker } from "./run";

const RANKERS: Record<string, Ranker> = { "provider order": (_q, f) => f, "ranker v1": rankFoodsV1, current: rankFoods };
const results = Object.fromEntries(Object.entries(RANKERS).map(([k, r]) => [k, runBenchmark(r)])) as Record<string, Measure[]>;
const summaries = Object.fromEntries(Object.entries(results).map(([k, ms]) => [k, summarize(ms)]));

function report(): string {
  const { recordedAt } = loadCandidates();
  const keys = Object.keys(RANKERS);
  const rows = Object.keys(summaries[keys[0]]) as (keyof (typeof summaries)[string])[];
  let md = `# Food-search relevance benchmark\n\nRecorded ${recordedAt}. 12 queries × 2 sources = 24 cases, top 25 shown per source.\n\n| Measure | ${keys.join(" | ")} |\n|---|${keys.map(() => "---").join("|")}|\n`;
  for (const r of rows) md += `| ${r} | ${keys.map((k) => String(summaries[k][r])).join(" | ")} |\n`;
  md += `\n## Per query: rank of the first ideal result (— none shown; n/a none in the candidates), and wrong results in the top 5\n\n| Query | Source | Ideal in candidates | ${keys.map((k) => `${k}: first ideal / wrong@5`).join(" | ")} |\n|---|---|---|${keys.map(() => "---").join("|")}|\n`;
  results[keys[0]].forEach((m, i) => {
    md += `| ${m.query} | ${m.source === "USDA" ? "USDA" : "OFF"} | ${m.idealInCandidates} | ${keys.map((k) => { const x = results[k][i]; return `${x.idealInCandidates ? x.firstIdeal ?? "—" : "n/a"} / ${x.wrongInTop5}`; }).join(" | ")} |\n`;
  });
  md += `\n## Current ranker: top 5 per case\n\n`;
  for (const m of results.current) md += `- **${m.query}** (${m.source === "USDA" ? "USDA" : "OFF"}): ${m.top5.join("; ")}\n`;
  return md;
}

describe("food-search relevance benchmark (RC-01)", () => {
  it("writes its report when asked", () => {
    if (process.env.BENCHMARK_OUT) writeFileSync(process.env.BENCHMARK_OUT, report());
    expect(results.current).toHaveLength(24);
  });
  it("keeps the measured gains: the ideal result first in 23 of 24 cases, at most 13 wrong results in the top fives, no look-alikes in the top tens", () => {
    const s = summaries.current;
    expect(s.top1Ideal).toBeGreaterThanOrEqual(23);
    expect(s.wrongInTop5).toBeLessThanOrEqual(13);
    expect(s.lookAlikesInTop10).toBe(0);
    expect(s.completeInTop5).toBeGreaterThanOrEqual(summaries["ranker v1"].completeInTop5);
  });
  it("is never worse than the first ranker on any single query", () => {
    results.current.forEach((m, i) => {
      const v1 = results["ranker v1"][i];
      expect(m.firstIdeal ?? 99, `${m.query} (${m.source})`).toBeLessThanOrEqual(v1.firstIdeal ?? 99);
      expect(m.wrongInTop5, `${m.query} (${m.source})`).toBeLessThanOrEqual(v1.wrongInTop5);
    });
  });
  it("only reorders: every record shown is the provider's own, attributed to it", () => {
    expect(summaries.current.allAttributed).toBe(true);
  });
});
