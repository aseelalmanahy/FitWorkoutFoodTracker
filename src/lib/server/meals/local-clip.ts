import "server-only";
import path from "node:path";
import type { LabelImage } from "@/lib/server/labels/extractor";
import type { MEAL_CATEGORIES } from "@/lib/meal-identification";
import type { MealIdentifier } from "./identifier";
import SPEC from "./local-model.json";
import { localMealModelProblem } from "./local-model-files";

export { localMealModelProblem };

/**
 * Meal-photo suggestions on this server, with no paid service and no network request (AI-02): CLIP ViT-B/32 (MIT),
 * at a pinned revision, from the Git-ignored .cache/models folder (scripts/meal-model-fetch.cjs), its files checked
 * against their recorded SHA-256 before first use. Enabled by MEAL_RECOGNITION=local.
 *
 * It compares the whole photo with a fixed list of dishes and foods, so it names one main dish, as "possible", with
 * the closest alternatives in its note; other foods on the plate aren't listed. It says nothing about amounts or
 * nutrition, which the person chooses from the food database, as with any suggestion. Measured in the app on 35 labelled
 * Wikimedia Commons photos (local-clip.test.ts): the right food first in 23 (66%), among the three named in 30 (86%),
 * about 0.1 s a photo on this machine. One, a small steak on a large plate, was taken for no food at all.
 */
export const LOCAL_MEAL_ID = `local:clip-vit-base-patch32@${SPEC.revision.slice(0, 7)}`;

// The Food-101 dishes and everyday foods, with the category the review screen shows. Names avoid amount words
// ("cupcakes", not "cup cakes"), which the meal schema rejects.
type MealCategory = (typeof MEAL_CATEGORIES)[number];
const FOODS: [string, MealCategory][] = [
  ["apple pie", "dessert"], ["baby back ribs", "meat"], ["baklava", "dessert"], ["beef carpaccio", "meat"], ["beef tartare", "meat"],
  ["beet salad", "vegetable"], ["beignets", "dessert"], ["bibimbap", "mixed_dish"], ["bread pudding", "dessert"], ["breakfast burrito", "mixed_dish"],
  ["bruschetta", "grain"], ["caesar salad", "mixed_dish"], ["cannoli", "dessert"], ["caprese salad", "mixed_dish"], ["carrot cake", "dessert"],
  ["ceviche", "fish"], ["cheesecake", "dessert"], ["cheese plate", "dairy"], ["chicken curry", "mixed_dish"], ["chicken quesadilla", "mixed_dish"],
  ["chicken wings", "meat"], ["chocolate cake", "dessert"], ["chocolate mousse", "dessert"], ["churros", "dessert"], ["clam chowder", "mixed_dish"],
  ["club sandwich", "mixed_dish"], ["crab cakes", "fish"], ["creme brulee", "dessert"], ["croque madame", "mixed_dish"], ["cupcakes", "dessert"],
  ["deviled eggs", "egg"], ["donuts", "dessert"], ["dumplings", "mixed_dish"], ["edamame", "legume"], ["eggs benedict", "egg"],
  ["escargots", "other"], ["falafel", "legume"], ["filet mignon", "meat"], ["fish and chips", "mixed_dish"], ["foie gras", "meat"],
  ["french fries", "vegetable"], ["french onion soup", "mixed_dish"], ["french toast", "grain"], ["fried calamari", "fish"], ["fried rice", "grain"],
  ["frozen yogurt", "dessert"], ["garlic bread", "grain"], ["gnocchi", "grain"], ["greek salad", "mixed_dish"], ["grilled cheese sandwich", "mixed_dish"],
  ["grilled salmon", "fish"], ["guacamole", "sauce"], ["gyoza", "mixed_dish"], ["hamburger", "mixed_dish"], ["hot and sour soup", "mixed_dish"],
  ["hot dog", "mixed_dish"], ["huevos rancheros", "egg"], ["hummus", "legume"], ["ice cream", "dessert"], ["lasagna", "mixed_dish"],
  ["lobster bisque", "mixed_dish"], ["lobster roll sandwich", "mixed_dish"], ["macaroni and cheese", "mixed_dish"], ["macarons", "dessert"], ["miso soup", "mixed_dish"],
  ["mussels", "fish"], ["nachos", "mixed_dish"], ["omelette", "egg"], ["onion rings", "vegetable"], ["oysters", "fish"],
  ["pad thai", "mixed_dish"], ["paella", "mixed_dish"], ["pancakes", "grain"], ["panna cotta", "dessert"], ["peking duck", "meat"],
  ["pho", "mixed_dish"], ["pizza", "mixed_dish"], ["pork chop", "meat"], ["poutine", "mixed_dish"], ["prime rib", "meat"],
  ["pulled pork sandwich", "mixed_dish"], ["ramen", "mixed_dish"], ["ravioli", "grain"], ["red velvet cake", "dessert"], ["risotto", "grain"],
  ["samosa", "mixed_dish"], ["sashimi", "fish"], ["scallops", "fish"], ["seaweed salad", "vegetable"], ["shrimp and grits", "mixed_dish"],
  ["spaghetti bolognese", "mixed_dish"], ["spaghetti carbonara", "mixed_dish"], ["spring rolls", "mixed_dish"], ["steak", "meat"], ["strawberry shortcake", "dessert"],
  ["sushi", "fish"], ["tacos", "mixed_dish"], ["takoyaki", "mixed_dish"], ["tiramisu", "dessert"], ["tuna tartare", "fish"], ["waffles", "grain"],
  ["apple", "fruit"], ["banana", "fruit"], ["orange", "fruit"], ["grapes", "fruit"], ["strawberries", "fruit"], ["broccoli", "vegetable"],
  ["carrots", "vegetable"], ["green salad", "vegetable"], ["white rice", "grain"], ["bread", "grain"], ["boiled eggs", "egg"],
  ["chicken breast", "meat"], ["oatmeal", "grain"], ["yogurt", "dairy"], ["spaghetti", "grain"],
];
// Things a photo might show instead of food, so "no food here" can be said rather than a dish forced.
const NOT_FOOD = ["a document or receipt", "a person's face", "a pet", "a landscape", "a room", "an empty plate", "a screenshot"];
export const LOCAL_MEAL_FOODS = FOODS.map(([name]) => name);

type Classifier = (image: unknown, labels: string[], options: { hypothesis_template: string }) => Promise<{ label: string; score: number }[]>;
let ready: Promise<{ classify: Classifier; RawImage: { fromBlob(b: Blob): Promise<unknown> } }> | null = null;

function load() {
  ready ??= (async () => {
    const problem = localMealModelProblem();
    if (problem) throw new Error(problem);
    const { env, pipeline, RawImage } = await import("@huggingface/transformers");
    env.cacheDir = path.join(process.cwd(), ".cache", "models");
    env.allowRemoteModels = false; // never a download at run time
    const classify = (await pipeline("zero-shot-image-classification", SPEC.model, { revision: SPEC.revision, dtype: SPEC.dtype as "q8" })) as unknown as Classifier;
    return { classify, RawImage: RawImage as unknown as { fromBlob(b: Blob): Promise<unknown> } };
  })().catch((err) => { ready = null; throw err; });
  return ready;
}

const LABELS = [...FOODS.map(([name]) => `${name}, a type of food`), ...NOT_FOOD];

export function createLocalMealIdentifier(): MealIdentifier {
  return {
    id: LOCAL_MEAL_ID,
    async identify(image: LabelImage, signal: AbortSignal): Promise<unknown> {
      const { classify, RawImage } = await load();
      if (signal.aborted) throw new Error("aborted");
      const raw = await RawImage.fromBlob(new Blob([new Uint8Array(image.bytes)], { type: image.mediaType }));
      const ranked = (await classify(raw, LABELS, { hypothesis_template: "a photo of {}." })).map((r) => r.label);
      if (signal.aborted) throw new Error("aborted");
      if (NOT_FOOD.includes(ranked[0])) return { containsFood: false, items: [] };
      const foods = ranked.filter((l) => !NOT_FOOD.includes(l)).map((l) => l.replace(/, a type of food$/, ""));
      const [best, ...rest] = foods;
      const category = FOODS.find(([name]) => name === best)?.[1] ?? "unknown";
      return {
        containsFood: true,
        items: [{
          name: best,
          category,
          certainty: "possible",
          observation: `Looks most like ${best}; close alternatives are ${rest[0]} and ${rest[1]}. Only the main dish is recognized, so add anything else on the plate yourself.`,
          possibleIngredients: [],
          preparation: null,
        }],
      };
    },
  };
}
