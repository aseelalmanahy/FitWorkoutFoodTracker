// RC-01: records what USDA FoodData Central and Open Food Facts return for the benchmark queries, exactly as the app
// asks for them (the same endpoints, parameters and candidate counts), so ranking can be measured offline and again
// later against the same input. Only the fields the app reads are kept. Read-only: no database is touched.
//   node --env-file=<a file with FDC_API_KEY> scripts/food-benchmark-record.cjs <output.json>
// Open Food Facts asks for at most 10 searches a minute, so its searches are 7 s apart. The key is never printed.
"use strict";
const fs = require("node:fs");

const QUERIES = ["milk", "whole milk", "white rice", "cooked rice", "egg", "large egg", "chicken breast", "banana", "oatmeal", "greek yogurt", "bread", "beef"];
const USDA_CANDIDATES = 50; // service.ts SEARCH_CANDIDATES
const OFF_CANDIDATES = 40;
const USDA_TYPES = ["Foundation", "SR Legacy", "Survey (FNDDS)"]; // usda.ts USDA_GENERIC_TYPES
const NUTRIENT_IDS = new Set([1008, 2047, 2048, 1003, 1005, 1050, 1004, 1079]); // usda.ts NUTRIENTS
const NUTRIENT_NUMBERS = new Set(["208", "957", "958", "203", "205", "205.2", "204", "291"]);
const OFF_FIELDS = ["code", "product_name", "product_name_en", "generic_name", "brands", "serving_size", "serving_quantity", "serving_quantity_unit", "product_quantity_unit", "nutriments"];
const OFF_NUTRIMENTS = /^(energy-kcal|energy-kj|energy|proteins|carbohydrates|fat|fiber)(_100g|_unit)?$/;
const UA = "FitWorkoutFoodTracker/0.2 (https://github.com/aseelalmanahy/fitworkoutfoodtracker) food-search benchmark";

const out = process.argv[2];
const key = (process.env.FDC_API_KEY ?? "").trim();
if (!out || !key) { console.error("Usage: node --env-file=<file with FDC_API_KEY> scripts/food-benchmark-record.cjs <output.json>"); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plain = (q) => q.replace(/[+\-=&|><!(){}[\]^"~*?:\\/]/g, " ").replace(/\s+/g, " ").trim(); // openfoodfacts.ts plainSearchTerms

async function usda(query) {
  const r = await fetch("https://api.nal.usda.gov/fdc/v1/foods/search", {
    method: "POST", headers: { "X-Api-Key": key, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ query, pageSize: USDA_CANDIDATES, dataType: USDA_TYPES }),
  });
  if (!r.ok) throw new Error(`USDA answered ${r.status} for "${query}"`);
  const data = await r.json();
  return data.foods.map((f) => ({
    fdcId: f.fdcId, description: f.description, dataType: f.dataType,
    foodNutrients: (f.foodNutrients ?? []).filter((n) => NUTRIENT_IDS.has(n.nutrientId) || NUTRIENT_NUMBERS.has(String(n.nutrientNumber)))
      .map((n) => ({ nutrientId: n.nutrientId, nutrientNumber: n.nutrientNumber, unitName: n.unitName, value: n.value })),
    foodMeasures: (f.foodMeasures ?? []).map((m) => ({ disseminationText: m.disseminationText, gramWeight: m.gramWeight })),
  }));
}

async function off(query) {
  const params = new URLSearchParams({ q: plain(query), page_size: String(OFF_CANDIDATES), langs: "en", fields: OFF_FIELDS.join(",") });
  const r = await fetch(`https://search.openfoodfacts.org/search?${params}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`Open Food Facts answered ${r.status} for "${query}"`);
  const data = await r.json();
  return data.hits.map((h) => {
    const kept = {};
    for (const f of OFF_FIELDS) if (h[f] !== undefined && f !== "nutriments") kept[f] = h[f];
    kept.nutriments = Object.fromEntries(Object.entries(h.nutriments ?? {}).filter(([k]) => OFF_NUTRIMENTS.test(k)));
    return kept;
  });
}

(async () => {
  const recorded = {
    recordedAt: new Date().toISOString(),
    attribution: "USDA FoodData Central (public domain, CC0). Open Food Facts (Open Database License; contents under the Database Contents License), https://world.openfoodfacts.org",
    request: { usda: { endpoint: "POST /fdc/v1/foods/search", pageSize: USDA_CANDIDATES, dataType: USDA_TYPES }, off: { endpoint: "search.openfoodfacts.org/search", page_size: OFF_CANDIDATES, langs: "en" } },
    queries: {},
  };
  for (const [i, q] of QUERIES.entries()) {
    if (i) await sleep(7000);
    recorded.queries[q] = { usda: await usda(q), off: await off(q) };
    console.log(`${q}: USDA ${recorded.queries[q].usda.length}, Open Food Facts ${recorded.queries[q].off.length}`);
  }
  fs.writeFileSync(out, JSON.stringify(recorded, null, 1));
  console.log(`Recorded ${QUERIES.length} queries to ${out} (${fs.statSync(out).size} bytes).`);
})().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
