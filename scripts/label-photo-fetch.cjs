// AI-01 / RC-03: fetches real nutrition-label photographs from Open Food Facts, with the values its contributors
// entered for them, to measure on-device label reading on real packets. Read-only, no app or database.
//   node scripts/label-photo-fetch.cjs <manifest.json> <image folder>
// The photos are under CC BY-SA 3.0 (Open Food Facts contributors) and stay in the Git-ignored image folder; the
// manifest keeps each product's code, photo address, attribution and reference values. One search per country (the
// most-scanned products with a selected nutrition photo and completed nutrition facts), then for each product one
// product read and one photo download, a second apart, within Open Food Facts' published limits.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const UA = "FitWorkoutFoodTracker/0.2 (https://github.com/aseelalmanahy/fitworkoutfoodtracker) label-reading evaluation";
const [manifestPath, imageDir] = process.argv.slice(2);
if (!manifestPath || !imageDir) { console.error("Usage: node scripts/label-photo-fetch.cjs <manifest.json> <image folder>"); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEYS = { kcal: "energy-kcal", protein: "proteins", carbs: "carbohydrates", fat: "fat", fiber: "fiber" };
const SETS = [{ country: "united-states", lang: "en", count: 15 }, { country: "united-kingdom", lang: "en", count: 10 }];

async function search({ country, count }) {
  const q = `states_tags:"en:nutrition-photo-selected" AND states_tags:"en:nutrition-facts-completed" AND countries_tags:"en:${country}"`;
  const params = new URLSearchParams({ q, page_size: String(count * 3), fields: "code", sort_by: "-unique_scans_n" });
  const r = await fetch(`https://search.openfoodfacts.org/search?${params}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`search answered ${r.status}`);
  const products = [];
  for (const { code } of (await r.json()).hits ?? []) {
    if (products.length >= count * 2) break;
    await sleep(1000);
    const pr = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=code,product_name,brands,selected_images,nutriments,nutrition_data_per,serving_size`, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (pr.ok) { const body = await pr.json(); if (body.product) products.push({ code, ...body.product }); }
  }
  return products;
}

(async () => {
  fs.mkdirSync(imageDir, { recursive: true });
  const photos = [];
  for (const [i, set] of SETS.entries()) {
    if (i) await sleep(7000);
    let taken = 0;
    for (const p of await search(set)) {
      if (taken >= set.count) break;
      const display = p.selected_images?.nutrition?.display?.[set.lang] ?? p.selected_images?.nutrition?.display?.en;
      if (!display || !/^\d{6,14}$/.test(p.code)) continue;
      const url = display.replace(/\.400\.jpg$/, ".full.jpg");
      const file = `${p.code}.jpg`;
      await sleep(1000);
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      if (!r.ok) { console.log(`skip ${p.code}: photo answered ${r.status}`); continue; }
      fs.writeFileSync(path.join(imageDir, file), Buffer.from(await r.arrayBuffer()));
      const n = p.nutriments ?? {};
      const values = (suffix) => Object.fromEntries(Object.entries(KEYS).map(([k, key]) => [k, typeof n[`${key}${suffix}`] === "number" ? n[`${key}${suffix}`] : null]));
      photos.push({
        code: p.code, country: set.country, product: p.product_name ?? null, brand: p.brands ?? null, photo: url, file,
        referencePer: p.nutrition_data_per ?? null, servingSize: p.serving_size ?? null,
        reference: { per100g: values("_100g"), perServing: values("_serving") },
      });
      taken++;
      console.log(`${p.code} (${set.country}): ${p.product_name ?? "?"}`);
    }
  }
  fs.writeFileSync(manifestPath, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    license: "Photos: Open Food Facts contributors, CC BY-SA 3.0 (https://world.openfoodfacts.org). Reference values: Open Food Facts, Open Database License; contents under the Database Contents License. The reference values were typed by contributors and can themselves be wrong.",
    photos,
  }, null, 1));
  console.log(`${photos.length} photos; manifest ${manifestPath}`);
})().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
