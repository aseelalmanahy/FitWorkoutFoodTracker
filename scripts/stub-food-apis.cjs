// Local stand-in for USDA FoodData Central and Open Food Facts, returning
// payloads in their documented response shapes. Used only for automated tests
// in environments without network access to the real APIs.
//   node scripts/stub-food-apis.cjs [port]
// Then run the app with:
//   FDC_BASE_URL=http://localhost:<port>/fdc/v1 OFF_BASE_URL=http://localhost:<port>/off FDC_API_KEY=stub
// Special queries: "timeout" → no response for 15 s, "error" → HTTP 500.
// STUB_LOG=1 logs each request URL and whether an X-Api-Key header was present.
// STUB_LOG_FILE=<path> also appends those lines to a file (used by provider-protection tests).
// "ratelimit" → HTTP 429 with Retry-After: 30; barcode 0000000000500 → HTTP 500.
// Malformed-but-valid-JSON (HTTP 200): search query "malformed" (USDA and OFF), USDA food id
// 990000, OFF barcode 0000000000600. Barcodes 77 + 11 digits return a generated valid product.
// OFF text search is served at /off/search (Search-a-licious shape, used by the app).
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
// Similar names with different nutrition, so nothing may ever treat them as one food.
const flat = (kcal, protein, carbs, fat) => [[1008, "208", "KCAL", kcal], [1003, "203", "G", protein], [1005, "205", "G", carbs], [1004, "204", "G", fat]].map(([nutrientId, nutrientNumber, unitName, value]) => ({ nutrientId, nutrientNumber, unitName, value }));
usdaFoods.push(
  { fdcId: 900101, description: "Yogurt, Greek, plain, nonfat", dataType: "SR Legacy", foodNutrients: flat(59, 10.2, 3.6, 0.4) },
  { fdcId: 900102, description: "Yogurt, Greek, plain, whole milk", dataType: "Foundation", foodNutrients: flat(97, 9, 4, 5) },
  { fdcId: 900201, description: "Beef, steak, sirloin, grilled", dataType: "Survey (FNDDS)", foodNutrients: flat(243, 26, 0, 15) },
);
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
  // Search hits without nutrients (real Search-a-licious hits can lack them): the full product has them, or doesn't.
  { code: "8800000000011", product_name: "Preview granola", brands: "Example", serving_size: "40 g", serving_quantity: 40, previewOnly: true,
    nutriments: { "energy-kcal_100g": 450, proteins_100g: 10, carbohydrates_100g: 60, fat_100g: 18 } },
  { code: "8800000000028", product_name: "Preview empty snack", brands: "Example", previewOnly: true },
  { code: "8800000000103", product_name: "Greek Yogurt 2% Fat", brands: "Hillside", serving_size: "170 g", serving_quantity: 170, nutriments: { "energy-kcal_100g": 73, proteins_100g: 9.9, carbohydrates_100g: 3.9, fat_100g: 2 } },
  { code: "8800000000110", product_name: "Greek Yogurt Honey", brands: "Hillside", nutriments: { "energy-kcal_100g": 120, proteins_100g: 8, carbohydrates_100g: 16 } },
  { code: "8800000000127", product_name: "Premium White Rice", brands: "Goldgrain", serving_size: "45 g", serving_quantity: 45, nutriments: { "energy-kcal_100g": 355, proteins_100g: 7, carbohydrates_100g: 79, fat_100g: 0.6 } },
];

const send = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };

function handle(req, res, body = {}) {
  const url = new URL(req.url, "http://x");
  // STUB_LOG=1: log request URL and header *presence* (never header values) for key-exposure checks.
  const line = JSON.stringify({ path: req.url, hasApiKeyHeader: !!req.headers["x-api-key"], userAgent: req.headers["user-agent"] });
  if (process.env.STUB_LOG) console.log(line);
  if (process.env.STUB_LOG_FILE) require("node:fs").appendFileSync(process.env.STUB_LOG_FILE, line + "\n");
  const q = String(body.query || url.searchParams.get("query") || url.searchParams.get("search_terms") || url.searchParams.get("q") || "").toLowerCase();
  if (q === "timeout") return setTimeout(() => send(res, 200, { foods: [], products: [] }), 15000);
  if (q === "error") return send(res, 500, { error: "internal" });
  if (q === "ratelimit") { res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "30" }); return res.end(JSON.stringify({ error: "OVER_RATE_LIMIT" })); }
  if (url.pathname.endsWith("/product/0000000000500.json")) return send(res, 500, { error: "internal" });
  if (q === "malformed") return send(res, 200, url.pathname.startsWith("/fdc/") ? { unexpected: true } : { count: 1, products: "nope", hits: "nope" });
  if (url.pathname === "/fdc/v1/food/990000") return send(res, 200, { foo: 1 });
  if (url.pathname.endsWith("/product/0000000000600.json")) return send(res, 200, { status: 1 });
  const gen = url.pathname.match(/^\/off\/api\/v2\/product\/(77\d{11})\.json$/); // generated valid product (never cached)
  if (gen) return send(res, 200, { status: 1, code: gen[1], product: { code: gen[1], product_name: `Generated ${gen[1]}`, nutriments: { "energy-kcal_100g": 100 } } });
  if (url.pathname.startsWith("/fdc/v1/")) {
    if (!req.headers["x-api-key"]) return send(res, 403, { error: { code: "API_KEY_MISSING" } });
    if (url.pathname === "/fdc/v1/foods/search") {
      const foods = usdaFoods.filter((f) => q.split(/\s+/).every((w) => f.description.toLowerCase().includes(w)));
      return send(res, 200, { totalHits: foods.length, currentPage: 1, foods });
    }
    const m = url.pathname.match(/^\/fdc\/v1\/food\/(\d+)$/);
    if (m) {
      const listed = usdaFoods.find((f) => String(f.fdcId) === m[1]);
      const detail = usdaDetail[m[1]] ?? (listed && { ...listed, foodNutrients: listed.foodNutrients.map((n) => ({ nutrient: { id: n.nutrientId, number: n.nutrientNumber, unitName: n.unitName.toLowerCase() }, amount: n.value })), foodPortions: [] });
      return detail ? send(res, 200, detail) : send(res, 404, { error: "not found" });
    }
  }
  if (url.pathname === "/off/search") {
    const hits = offProducts.filter((p) => p.product_name.toLowerCase().includes(q)).map((p) => ({ ...p, brands: p.brands ? [p.brands] : [], nutriments: p.previewOnly ? undefined : p.nutriments }));
    return send(res, 200, { hits, count: hits.length, page: 1, page_size: 20, page_count: 1, took: 1, timed_out: false, is_count_exact: true, debug: { query: {} } });
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
}

http.createServer((req, res) => {
  if (req.method !== "POST") return handle(req, res);
  let raw = ""; // USDA search sends its parameters as a JSON body
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    let body = {};
    try { body = JSON.parse(raw); } catch { /* handled as an empty query */ }
    handle(req, res, body);
  });
}).listen(port, () => console.log(`stub food APIs on :${port}`));
