// Local stand-in for USDA FoodData Central and Open Food Facts, returning
// payloads in their documented response shapes. Used only for automated tests
// in environments without network access to the real APIs.
//   node scripts/stub-food-apis.cjs [port]
// Then run the app with:
//   FDC_BASE_URL=http://localhost:<port>/fdc/v1 OFF_BASE_URL=http://localhost:<port>/off FDC_API_KEY=stub
// Special queries: "timeout" → no response for 15 s, "error" → HTTP 500.
// STUB_LOG=1 logs each request URL and whether an X-Api-Key header was present.
const http = require("node:http");
const port = Number(process.argv[2] || 4010);

const usdaFoods = [
  {
    fdcId: 173944, description: "Bananas, raw", dataType: "SR Legacy",
    foodNutrients: [
      { nutrientId: 1008, nutrientNumber: "208", unitName: "KCAL", value: 89 },
      { nutrientId: 1003, nutrientNumber: "203", unitName: "G", value: 1.09 },
      { nutrientId: 1005, nutrientNumber: "205", unitName: "G", value: 22.84 },
      { nutrientId: 1004, nutrientNumber: "204", unitName: "G", value: 0.33 },
      { nutrientId: 1079, nutrientNumber: "291", unitName: "G", value: 2.6 },
    ],
    foodMeasures: [{ disseminationText: "1 medium", gramWeight: 118 }],
  },
  {
    fdcId: 171477, description: "Chicken, broilers or fryers, breast, meat only, cooked, roasted", dataType: "SR Legacy",
    foodNutrients: [
      { nutrientId: 1008, nutrientNumber: "208", unitName: "KCAL", value: 165 },
      { nutrientId: 1003, nutrientNumber: "203", unitName: "G", value: 31.02 },
      { nutrientId: 1005, nutrientNumber: "205", unitName: "G", value: 0 },
      { nutrientId: 1004, nutrientNumber: "204", unitName: "G", value: 3.57 },
    ],
  },
  { fdcId: 999001, description: "Rice, white, cooked (no energy reported)", dataType: "Survey (FNDDS)",
    foodNutrients: [{ nutrientId: 1003, nutrientNumber: "203", unitName: "G", value: 2.7 }] },
];
const usdaDetail = {
  173944: { ...usdaFoods[0], foodNutrients: usdaFoods[0].foodNutrients.map((n) => ({ nutrient: { id: n.nutrientId, number: n.nutrientNumber, unitName: n.unitName.toLowerCase() }, amount: n.value })),
    foodPortions: [{ gramWeight: 118, amount: 1, modifier: "medium (7\" to 7-7/8\" long)", measureUnit: { name: "undetermined" } }, { gramWeight: 150, amount: 1, modifier: "cup, sliced", measureUnit: { name: "undetermined" } }] },
  171477: { ...usdaFoods[1], foodNutrients: usdaFoods[1].foodNutrients.map((n) => ({ nutrient: { id: n.nutrientId, number: n.nutrientNumber, unitName: n.unitName.toLowerCase() }, amount: n.value })),
    foodPortions: [{ gramWeight: 172, amount: 1, modifier: "breast, bone and skin removed", measureUnit: { name: "undetermined" } }] },
  999001: { ...usdaFoods[2], foodNutrients: [{ nutrient: { id: 1003, number: "203", unitName: "g" }, amount: 2.7 }], foodPortions: [] },
};
const offProducts = [
  { code: "3017624010966", product_name: "Nutella", brands: "Ferrero", serving_size: "15 g", serving_quantity: 15,
    nutriments: { "energy-kcal_100g": 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9 } },
  { code: "5000112637922", product_name: "Cola Zero", brands: "Example", serving_size: "330 ml", serving_quantity: 330, serving_quantity_unit: "ml",
    nutriments: { "energy-kj_100g": 1.4, proteins_100g: 0, carbohydrates_100g: 0, fat_100g: 0 } },
  // Reproduces audit finding D1: a crowd-sourced data-entry error (54,000,000 kcal/100 g).
  { code: "1234567890123", product_name: "Data-entry error product", brands: "Example", serving_size: "40 g", serving_quantity: 40,
    nutriments: { "energy-kcal_100g": 54000000, proteins_100g: 6, carbohydrates_100g: 50, fat_100g: 30 } },
];

const send = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  // STUB_LOG=1: log request URL and header *presence* (never header values) for key-exposure checks.
  if (process.env.STUB_LOG) console.log(JSON.stringify({ path: req.url, hasApiKeyHeader: !!req.headers["x-api-key"], userAgent: req.headers["user-agent"] }));
  const q = (url.searchParams.get("query") || url.searchParams.get("search_terms") || "").toLowerCase();
  if (q === "timeout") return setTimeout(() => send(res, 200, { foods: [], products: [] }), 15000);
  if (q === "error") return send(res, 500, { error: "internal" });
  if (url.pathname.startsWith("/fdc/v1/")) {
    if (!req.headers["x-api-key"]) return send(res, 403, { error: { code: "API_KEY_MISSING" } });
    if (url.pathname === "/fdc/v1/foods/search") {
      const foods = usdaFoods.filter((f) => q.split(/\s+/).every((w) => f.description.toLowerCase().includes(w)));
      return send(res, 200, { totalHits: foods.length, currentPage: 1, foods });
    }
    const m = url.pathname.match(/^\/fdc\/v1\/food\/(\d+)$/);
    if (m) return usdaDetail[m[1]] ? send(res, 200, usdaDetail[m[1]]) : send(res, 404, { error: "not found" });
  }
  if (url.pathname === "/off/cgi/search.pl") {
    const products = offProducts.filter((p) => p.product_name.toLowerCase().includes(q));
    return send(res, 200, { count: products.length, page: 1, products });
  }
  const pm = url.pathname.match(/^\/off\/api\/v2\/product\/(\d+)\.json$/);
  if (pm) {
    const p = offProducts.find((x) => x.code === pm[1]);
    return send(res, 200, p ? { status: 1, code: p.code, product: p } : { status: 0, status_verbose: "product not found" });
  }
  send(res, 404, { error: "not found" });
}).listen(port, () => console.log(`stub food APIs on :${port}`));
