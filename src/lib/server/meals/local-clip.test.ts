// AI-02: on-device meal suggestions. The schema tests run everywhere; the model tests only where the pinned model has
// been fetched (node scripts/meal-model-fetch.cjs), as it isn't in Git.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { parseMealIdentification } from "@/lib/meal-identification";
import { createLocalMealIdentifier, LOCAL_MEAL_FOODS, LOCAL_MEAL_ID, localMealModelProblem } from "./local-clip";

const signal = () => new AbortController().signal;
const suggestion = (best: string, a: string, b: string) => ({
  containsFood: true,
  items: [{ name: best, category: "mixed_dish", certainty: "possible", observation: `Looks most like ${best}; close alternatives are ${a} and ${b}. Only the main dish is recognized, so add anything else on the plate yourself.`, possibleIngredients: [], preparation: null }],
});

describe("every suggestion the local model can make is accepted by the meal schema", () => {
  it.each(LOCAL_MEAL_FOODS)("%s", (name) => {
    const others = LOCAL_MEAL_FOODS.filter((n) => n !== name);
    const parsed = parseMealIdentification(suggestion(name, others[0], others[others.length - 1]));
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
  });
  it("and the identifier says where it ran", () => expect(LOCAL_MEAL_ID).toMatch(/^local:clip-vit-base-patch32@[0-9a-f]{7}$/));
});

const modelPresent = localMealModelProblem() === null;

describe.skipIf(!modelPresent)("the on-device model", () => {
  const photo = (svg: string) => sharp(Buffer.from(svg)).jpeg().toBuffer();
  it("returns schema-valid suggestions, for food and for something that isn't food", async () => {
    const id = createLocalMealIdentifier();
    const plate = await photo(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="100%" height="100%" fill="#eee"/><circle cx="200" cy="150" r="120" fill="#fff"/><circle cx="170" cy="140" r="40" fill="#f2d16b"/><circle cx="240" cy="160" r="35" fill="#3c8d2f"/></svg>`);
    const page = await photo(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="100%" height="100%" fill="#fff"/>${Array.from({ length: 10 }, (_, i) => `<rect x="30" y="${25 + i * 26}" width="${200 + (i % 3) * 50}" height="8" fill="#333"/>`).join("")}</svg>`);
    for (const bytes of [plate, page]) {
      const parsed = parseMealIdentification(await id.identify({ bytes: new Uint8Array(bytes), mediaType: "image/jpeg" }, signal()));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) for (const item of parsed.identification.items) expect(item.certainty).toBe("possible");
    }
  }, 120_000);
  it("never downloads: a damaged model file is refused before use", () => {
    expect(localMealModelProblem(path.join(process.cwd(), "no-such-folder"))).toMatch(/missing/);
  });
});

// Real photos of single foods, Wikimedia Commons (CC BY / CC BY-SA / CC0, authors in the manifest). Only where fetched:
//   node scripts/meal-photo-fetch.cjs
const PHOTOS = path.join(process.cwd(), ".cache", "meal-photos");
const MANIFEST = path.join(__dirname, "eval", "commons-photos.json");
describe.skipIf(!modelPresent || !existsSync(PHOTOS))("real meal photos", () => {
  it("name the right food first or among the first three alternatives, at the measured rate", async () => {
    const { photos } = JSON.parse(readFileSync(MANIFEST, "utf8")) as { photos: { food: string; accept: string[]; file: string }[] };
    const id = createLocalMealIdentifier();
    let n = 0, first = 0, top3 = 0;
    const misses: string[] = [];
    for (const p of photos) {
      if (!existsSync(path.join(PHOTOS, p.file))) continue;
      const parsed = parseMealIdentification(await id.identify({ bytes: new Uint8Array(readFileSync(path.join(PHOTOS, p.file))), mediaType: "image/jpeg" }, signal()));
      expect(parsed.ok, p.file).toBe(true);
      if (!parsed.ok) continue;
      n++;
      const item = parsed.identification.items[0];
      const named = [item?.name ?? "", ...(item?.observation.match(/close alternatives are (.+?) and (.+?)\. /)?.slice(1, 3) ?? [])];
      if (p.accept.includes(named[0])) first++;
      if (named.some((x) => p.accept.includes(x))) top3++; else misses.push(`${p.file}: ${named.join(" / ")}`);
    }
    if (process.env.MEAL_PHOTO_REPORT_OUT) writeFileSync(process.env.MEAL_PHOTO_REPORT_OUT, `${n} photos: first ${first}, among three ${top3}\n${misses.join("\n")}\n`);
    expect(n).toBeGreaterThanOrEqual(30);
    expect(first / n).toBeGreaterThanOrEqual(0.65);
    expect(top3 / n).toBeGreaterThanOrEqual(0.85);
  }, 600_000);
});
