/**
 * What a meal photo may produce: tentative food identities, and nothing that can be measured. This
 * output is untrusted. There are no number fields, any unexpected key rejects the response whole, and
 * so does text holding a number or a word for an amount, apart from a short list of exact food names.
 * Separately, nothing reads text as a number: these strings are only shown, or used as a search term
 * a person accepted. So no quantity or nutrition value from a photo can reach a calculation.
 */
import { z } from "zod";

export const MAX_IDENTIFICATION_CHARS = 32_000;
const MAX_ITEMS = 12;
const MAX_INGREDIENTS = 8;

export const MEAL_CATEGORIES = ["grain", "vegetable", "fruit", "meat", "fish", "egg", "dairy", "legume", "nut_or_seed", "mixed_dish", "beverage", "dessert", "sauce", "other", "unknown"] as const;

/** Words only, never a number: a model's confidence scores would be invented. */
export const MEAL_CERTAINTY = ["likely", "possible", "unknown"] as const;

/** Whole words, in any alphabet: \b alone treats the "g" of "gâteau" as a word. */
const words = (alternatives: string) => `(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`;

const NUMBER_WORDS = "two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";

/**
 * Exact names where an amount word or number is part of the food, not a claim about it. Only these
 * are set aside, and everything else in the text is still checked, so "7 Up, 300 calories" fails.
 * A leading digit, decimal or hyphen doesn't match, so "17 up" and "twenty-seven-layer" stay rejected.
 */
const FOOD_NAMES = new RegExp(
  "(?<![\\p{L}\\p{N}.,/-])(?:" + [
    "7[ -]?up", "seven[ -]up", "v-?8", "a\\.?1\\.? sauce", "00 flour", "heinz 57", "3 musketeers",
    `(?:[2-9]|1[0-2]|${NUMBER_WORDS})-(?:bean|cheese|layer|grain|spice|seed)`,
    "three bean salad", "seven layer (?:dip|salad)", "five spice", "(?:three|four) cheese pizza",
    "pound cake", "quarter pounder", "half[- ]and[- ]half", "half-moon cookies?", "half-sour pickles?",
    "thousand island", "hundreds and thousands", "one[- ]pot", "one[- ]pan", "two-bite",
    "gram flour", "(?:black|green|bengal) gram", "peanut butter cups?", "fruit cups?", "cup noodles",
  ].join("|") + ")(?![\\p{L}\\p{N}])",
  "giu",
);

const AMOUNT_WORDS = [
  "kcal", "kcals", "kj", "calorie", "calories", "cal", "cals", "kilocalorie", "kilocalories", "kilojoule", "kilojoules", "joule", "joules",
  "g(?!['’])", "gm", "gms", "gram", "grams", "gramme", "grammes", "kg", "kgs", "kilogram", "kilograms", "mg", "mcg", "milligram", "milligrams", "microgram", "micrograms", "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds",
  "ml", "mls", "cl", "dl", "millilitre", "millilitres", "milliliter", "milliliters", "l(?!['’])", "litre", "litres", "liter", "liters", "pint", "pints", "quart", "quarts", "gallon", "gallons",
  "cup", "cups", "tablespoon", "tablespoons", "teaspoon", "teaspoons", "tbsp", "tbs", "tsp",
  "serving", "servings", "portion", "portions", "helping", "helpings", "amount", "amounts", "quantity", "quantities", "percent", "percentage", "per cent",
  "one", NUMBER_WORDS, "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "hundreds", "thousand", "thousands", "million", "millions",
  "dozen", "dozens", "half", "halves", "third", "thirds", "quarter", "quarters", "couple", "pair", "pairs", "several", "few", "many", "multiple", "numerous",
  "weigh", "weighs", "weighed", "weight", "weighing", "density", "volume", "mass", "macro", "macros", "macronutrient", "macronutrients", "micronutrient", "micronutrients", "nutrient", "nutrients", "nutrition", "nutritional", "nutritious",
].join("|");

const NUTRIENT = "protein|proteins|fat|fats|carb|carbs|carbohydrate|carbohydrates|fib(?:er|re)|sugar|sugars|sodium|iron|calcium|potassium|vitamin|vitamins|mineral|minerals|cholesterol";
const MEASURE = "lots?|plenty|loads?|tons?|handful|handfuls|mouthful|mouthfuls|spoonful|spoonfuls|scoop|scoops|pinch|pinches|dash|dashes|drizzle|splash|bowl|bowls|bowlful|plate|plates|plateful|glass|glasses|mug|mugs|can|cans|bottle|bottles|jar|jars|piece|pieces|slice|slices|stack|stacks|pile|piles";

const AMOUNT_TEXT = new RegExp(
  [
    words(AMOUNT_WORDS),
    words(`(?:${MEASURE})\\s+of`),
    words("full\\s+of|packed\\s+with|loaded\\s+with"),
    words("(?:high|low|rich)\\s+in"),
    words(`source\\s+of\\s+(?:${NUTRIENT})`),
    words(`(?:${NUTRIENT})[- ]rich`),
    words(`(?:${NUTRIENT}|energy)\\s+(?:content|value)`),
  ].join("|"),
  "iu",
);

/** Compatibility forms become plain ones (１５０ to 150, ½ to 1⁄2) and invisible characters go, so neither hides a word. */
const comparable = (text: string) => text.normalize("NFKC").replace(/\p{Cf}/gu, "");

/**
 * True when text states or implies an amount, or can't be checked. It's about what the words claim,
 * not the food, and it fails closed. Digits are any script's, and letters must be Latin: the word
 * list is English, so another alphabet could say anything, including lookalike letters for "calories".
 */
export const statesAnAmount = (text: string) => {
  const clean = comparable(text).replace(FOOD_NAMES, " ");
  return /[\p{N}%]/u.test(clean) || /(?!\p{Script=Latin})\p{L}/u.test(clean) || AMOUNT_TEXT.test(clean);
};

const NUTRITION_REMARK = new RegExp(
  words(`(?:${NUTRIENT})(?!\\s+(?:bars?|shakes?|powder|balls?|cookies?|free))|(?:high|low)[- ](?:${NUTRIENT})|healthy|lean\\s+(?:source|choice)`).replace("sugar|sugars|", "").replace("iron|", "").replace("mineral|minerals|", ""),
  "iu",
);

/**
 * What can be seen is never about nutrition, even where a food's name might be, as in "low-fat yogurt".
 * Words with everyday visible meanings are left out here: sugar, a cast iron pan, mineral water.
 */
export const remarksOnNutrition = (text: string) => NUTRITION_REMARK.test(comparable(text));

const safeText = (max: number) => z.string().trim().min(1).max(max).refine((t) => !statesAnAmount(t), "Amounts and nutrition aren't allowed");
const visibleText = (max: number) => safeText(max).refine((t) => !remarksOnNutrition(t), "Nutrition isn't something a photo shows");

const mealItem = z.strictObject({
  /** Null when it can't be identified at all. */
  name: safeText(120).nullable(),
  category: z.enum(MEAL_CATEGORIES),
  certainty: z.enum(MEAL_CERTAINTY),
  /** What can actually be seen, as distinct from what it might be. */
  observation: visibleText(200),
  possibleIngredients: z.array(safeText(80)).max(MAX_INGREDIENTS),
  /** Only when it can be seen. */
  preparation: visibleText(80).nullable(),
}).superRefine((item, ctx) => {
  if (item.certainty === "unknown" && item.name !== null) ctx.addIssue({ code: "custom", message: "An unknown item has no name" });
  if (item.certainty !== "unknown" && item.name === null) ctx.addIssue({ code: "custom", message: "A likely or possible item needs a name" });
});

export const mealIdentificationSchema = z.strictObject({
  containsFood: z.boolean(),
  items: z.array(mealItem).max(MAX_ITEMS),
}).superRefine((value, ctx) => {
  if (!value.containsFood && value.items.length > 0) ctx.addIssue({ code: "custom", message: "No food means no items" });
});

export type MealIdentification = z.infer<typeof mealIdentificationSchema>;
export type MealItem = MealIdentification["items"][number];

export type MealIdentificationParse = { ok: true; identification: MealIdentification } | { ok: false; reason: "too_large" | "not_json" | "schema" };

/** Accepts JSON text or a parsed value. A response that fails in any way is rejected whole. */
export function parseMealIdentification(raw: unknown): MealIdentificationParse {
  let value = raw;
  if (typeof raw === "string") {
    if (raw.length > MAX_IDENTIFICATION_CHARS) return { ok: false, reason: "too_large" };
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "not_json" };
    }
  } else {
    let size: number | undefined;
    try {
      size = JSON.stringify(raw)?.length;
    } catch {
      return { ok: false, reason: "schema" };
    }
    if (size !== undefined && size > MAX_IDENTIFICATION_CHARS) return { ok: false, reason: "too_large" };
  }
  const parsed = mealIdentificationSchema.safeParse(value);
  return parsed.success ? { ok: true, identification: parsed.data } : { ok: false, reason: "schema" };
}
