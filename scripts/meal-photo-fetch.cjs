// AI-02: fetches the labelled meal photos listed in src/lib/server/meals/eval/commons-photos.json from Wikimedia
// Commons, at 640 px wide, into the Git-ignored .cache/meal-photos folder, for the on-device model's evaluation.
// Read-only: no app or database. Each photo keeps the license and author recorded in the manifest.
//   node scripts/meal-photo-fetch.cjs
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const { photos } = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "lib", "server", "meals", "eval", "commons-photos.json"), "utf8"));
const DIR = path.join(ROOT, ".cache", "meal-photos");
const UA = "FitWorkoutFoodTracker-eval/0.1 (https://github.com/aseelalmanahy/fitworkoutfoodtracker; meal-photo evaluation)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  let fetched = 0;
  for (const p of photos) {
    if (fs.existsSync(path.join(DIR, p.file))) continue;
    const u = new URL("https://commons.wikimedia.org/w/api.php");
    for (const [k, v] of Object.entries({ action: "query", titles: p.title, prop: "imageinfo", iiprop: "url", iiurlwidth: "640", format: "json" })) u.searchParams.set(k, v);
    const info = Object.values((await (await fetch(u, { headers: { "User-Agent": UA } })).json()).query.pages)[0]?.imageinfo?.[0];
    if (!info?.thumburl) { console.log(`skip ${p.file}: not found`); continue; }
    await sleep(400);
    const r = await fetch(info.thumburl, { headers: { "User-Agent": UA } });
    if (!r.ok) { console.log(`skip ${p.file}: ${r.status}`); continue; }
    fs.writeFileSync(path.join(DIR, p.file), Buffer.from(await r.arrayBuffer()));
    fetched++;
  }
  console.log(`${fetched} fetched; ${fs.readdirSync(DIR).length} of ${photos.length} present in ${DIR}`);
})().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
