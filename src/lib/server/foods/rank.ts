// Relevance order for provider search results (FOOD-02, revised for RC-01). It only reorders the providers' own
// records: nothing is added, removed, merged or changed, so names, values and attribution are exactly what the
// provider returned. Measured on a recorded benchmark of 12 common searches (benchmark/), against the providers' own
// order and the first version.
//
// USDA names read "Food, modifier, modifier", so the first part or two say what the food is. The order prefers, in turn:
//   1. a name that is the query itself, or whose first part, or first two parts in either order ("Rice, white" for
//      "white rice"), are exactly the query's words;
//   2. a name whose leading part is made of the query's words, with fewer extra words;
//   3. a name containing every word of the query anywhere;
//   4. the generic record: USDA's "NFS" (not further specified) and plain forms (raw, whole, plain…) over a different
//      food made from it (malted milk, rice flour, oatmeal cookies) or a mixed dish ("rice, with milk"), unless the
//      query names that form itself;
//   5. complete nutrition, a household serving, then the provider's own order. Later records identical in name, brand
//      and values to one above sink below distinct records, so the first screen isn't filled with copies.
// "Whole" and "raw" count as the plain form, so for "large egg" the whole egg comes before the white and the yolk,
// and for "milk" whole milk before other kinds. Otherwise no variety is preferred: reduced-fat, low-fat and nonfat
// milk keep the provider's order between them. The words are general, not tuned to a query; the benchmark judgments
// were written before this version. Known gap: USDA "bread" still lists flavoured breads first, as nothing in the
// records says which variety is the everyday one.
import type { NormalizedFood } from "./types";

/** Lowercase words, without punctuation, each reduced to a simple singular so "eggs" matches "egg". */
export function foodWords(text: string): string[] {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9%.]+/).filter((w) => w.length > 0 && w !== "." && w !== "or" && w !== "and" && w !== "with")
    .map(singular);
}

export function singular(w: string): string {
  if (w.length <= 3) return w;
  if (/ies$/.test(w)) return `${w.slice(0, -3)}y`; // berries → berry
  if (/(?:ch|sh|x|ss|o)es$/.test(w)) return w.slice(0, -2); // potatoes → potato, peaches → peach
  if (/[^s]s$/.test(w)) return w.slice(0, -1); // eggs → egg, bananas → banana
  return w;
}

/** A word list in the same reduced form as foodWords, plural spellings included ("cookies" reduces to "cooky"). */
const wordSet = (words: string[]) => new Set(words.flatMap((w) => [singular(w), singular(`${w}s`)]));

/** The first one or two comma-separated parts, which in USDA names say what the food is ("Rice, white"). */
const parts = (name: string, n: number) => name.split(",").slice(0, n).join(" ");

// Words that say how a food was prepared. Unless the query asks for one, the unprepared "raw" record comes first.
const PREPARATIONS = wordSet(["raw", "cooked", "baked", "boiled", "fried", "roasted", "grilled", "dried", "dehydrated", "canned", "frozen", "steamed"]);
// Words that make a different food from the one named: a derivative, a product made from it, or a dish.
const DERIVED = wordSet([
  "malted", "evaporated", "condensed", "dried", "dry", "powder", "powdered", "dehydrated", "flour", "puffed", "pickled",
  "creamed", "deviled", "benedict", "imitation", "substitute", "babyfood", "flavored", "sweetened", "chocolate",
  "candy", "cookie", "biscuit", "bar", "cake", "muffin", "chip", "cracker", "pudding", "jerky", "soup", "stew", "salad",
  "sandwich", "pie", "nugget", "patty", "roll", "noodle", "cereal", "smoothie", "shake", "dessert", "dip", "dressing",
  "lunchmeat", "deli", "frankfurter", "sausage", "bologna", "cured", "corned",
]);
// Words that mark the plain, generic form of a food.
const PLAIN = wordSet(["raw", "whole", "plain", "fresh", "regular", "natural", "unsweetened", "fluid"]);

type Rankable = Pick<NormalizedFood, "name" | "per100"> & Partial<Pick<NormalizedFood, "brand" | "servings">>;

const sameWords = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join(" ") === [...b].sort().join(" ");

/** Higher is more relevant. Exposed for tests. */
export function relevance(query: string, food: Rankable): number {
  const q = foodWords(query);
  if (!q.length) return 0;
  const name = foodWords(food.name);
  const lead1 = foodWords(parts(food.name, 1));
  const lead2 = foodWords(parts(food.name, 2));
  const has = (list: string[], w: string) => list.includes(w);
  const asked = (w: string) => has(q, w);
  const extraWords = (list: string[]) => list.filter((w) => !asked(w));
  let score = 0;
  if (sameWords(name, q)) score += 1000;
  // The food's leading part is exactly what was asked for, in either word order.
  if (sameWords(lead1, q) || sameWords(lead2, q)) score += 100;
  // Extra words in the leading part count heavily against a record: it says what the food is.
  if (q.every((w) => has(lead1, w))) score += 400 - 100 * extraWords(lead1).length;
  else if (q.every((w) => has(lead2, w))) score += 350 - 100 * extraWords(lead2).length;
  else if (has(lead1, q[0])) score += 150;
  if (q.every((w) => has(name, w))) score += 200;
  const extra = extraWords(name);
  score -= 5 * extra.length;
  // A different food made from this one, unless the query names it ("malted milk" finds malted milk).
  score -= 120 * extra.filter((w) => DERIVED.has(w)).length;
  // A mixed dish, "Rice, cooked, with milk", unless its other words were asked for.
  if (/(^|[\s,])with\s/i.test(food.name) && extra.length > 0) score -= 80;
  // USDA's own word for the generic record.
  if (has(name, "nfs") && !asked("nfs")) score += 60;
  if (extra.some((w) => PLAIN.has(w))) score += 15;
  if (has(name, "raw") && !q.some((w) => PREPARATIONS.has(w))) score += 8;
  const values = [food.per100.kcal, food.per100.protein, food.per100.carbs, food.per100.fat];
  if (values.every((v) => v !== null)) score += 20;
  else if (values.every((v) => v === null)) score -= 40;
  if (food.servings?.some((s) => s.label !== "100 g" && s.label !== "100 ml")) score += 3;
  return score;
}

/** Name, brand and values together: records that would look identical in the list. */
const lookAlike = (f: Rankable) => `${f.name.toLowerCase().trim()}|${(f.brand ?? "").toLowerCase().trim()}|${JSON.stringify(f.per100)}`;

/** The same records, most relevant first. Ties keep the provider's order; later look-alikes sink below distinct ones. */
export function rankFoods<T extends Rankable>(query: string, foods: T[]): T[] {
  const scored = foods.map((f, i) => ({ f, i, s: relevance(query, f) })).sort((a, b) => b.s - a.s || a.i - b.i);
  const seen = new Set<string>();
  const first: typeof scored = [];
  const copies: typeof scored = [];
  for (const x of scored) {
    const k = lookAlike(x.f);
    (seen.has(k) ? copies : first).push(x);
    seen.add(k);
  }
  return [...first, ...copies].map((x) => x.f);
}
