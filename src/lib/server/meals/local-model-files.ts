import SPEC from "./local-model.json";

// The startup preflight runs from instrumentation, which Next.js also compiles for the edge runtime, where node: modules
// can't be imported. process.getBuiltinModule loads them at run time, in Node only, unseen by the bundler.
const node = () => ({
  fs: process.getBuiltinModule("node:fs") as typeof import("node:fs"),
  crypto: process.getBuiltinModule("node:crypto") as typeof import("node:crypto"),
  path: process.getBuiltinModule("node:path") as typeof import("node:path"),
});

/** The on-device meal model's folder: Git-ignored, filled by scripts/meal-model-fetch.cjs (AI-02). */
export const localMealModelDir = (root = process.cwd()) => node().path.join(root, ".cache", "models", ...SPEC.model.split("/"));

/** Why the on-device meal model can't be used, or null: every file present and matching its recorded SHA-256. */
export function localMealModelProblem(root = process.cwd()): string | null {
  const { fs, crypto, path } = node();
  for (const [file, sha] of Object.entries(SPEC.files)) {
    const p = path.join(localMealModelDir(root), ...file.split("/"));
    if (!fs.existsSync(p)) return `the model file ${file} is missing: run node scripts/meal-model-fetch.cjs`;
    if (crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") !== sha) return `the model file ${file} doesn't match its recorded SHA-256`;
  }
  return null;
}
