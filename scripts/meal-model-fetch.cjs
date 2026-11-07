// AI-02: downloads the on-device meal-photo model once, at a pinned revision, into the Git-ignored .cache/models
// folder, and prints each file's SHA-256 for src/lib/server/meals/local-model.json. The app never downloads: at run
// time it loads only these local files, after checking those hashes. Run once on a machine that will use
// MEAL_RECOGNITION=local:
//   node scripts/meal-model-fetch.cjs
// The model is OpenAI's CLIP ViT-B/32 (MIT), converted to ONNX by Xenova, about 150 MB. Nothing about the app, its
// database or any user is sent; only the model files are requested from huggingface.co.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "lib", "server", "meals", "local-model.json"), "utf8"));
const CACHE = path.join(__dirname, "..", ".cache", "models");

(async () => {
  const { env, pipeline } = await import("@huggingface/transformers");
  env.cacheDir = CACHE;
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  const t0 = Date.now();
  await pipeline("zero-shot-image-classification", SPEC.model, { revision: SPEC.revision, dtype: SPEC.dtype });
  const dir = path.join(CACHE, ...SPEC.model.split("/"));
  const files = {};
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else files[path.relative(dir, p).replace(/\\/g, "/")] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); } };
  walk(dir);
  console.log(`Downloaded ${SPEC.model} at ${SPEC.revision} in ${Math.round((Date.now() - t0) / 1000)} s, into ${dir}.`);
  const expected = SPEC.files ?? {};
  const mismatched = Object.entries(expected).filter(([f, h]) => files[f] !== h);
  if (Object.keys(expected).length && !mismatched.length) console.log("Every file matches the recorded SHA-256.");
  else if (mismatched.length) { console.error(`MISMATCH: ${mismatched.map(([f]) => f).join(", ")} differ from local-model.json. Don't use them.`); process.exit(1); }
  else console.log(JSON.stringify(files, null, 2));
})().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
