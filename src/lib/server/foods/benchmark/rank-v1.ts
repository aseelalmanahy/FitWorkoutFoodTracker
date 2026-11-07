// FROZEN COPY of rank.ts as of 0bdce20 (FOOD-02 v1), kept only as the benchmark baseline for RC-01. Not used by the app.
// Relevance order for provider search results (FOOD-02). It only reorders the providers' own records: nothing is
// added, removed, merged or changed, so names, values and attribution are exactly what the provider returned.
//
// The providers' own order puts, for "milk", "Coconut milk" and "Crackers, milk" ahead of milk, and for "banana",
// banana powder ahead of a raw banana. USDA names read "Food, modifier, modifier", so the part before the first
// comma says what the food is. The order below prefers, in turn:
//   1. a name that is the query itself, or its singular or plural;
//   2. a name whose leading part is made of the query's words (milk, whole … over crackers, milk);
//   3. a name containing every word of the query anywhere;
//   4. fewer extra words, so the plain food comes before the prepared or processed one, and "raw" (USDA's word for
//      the unprepared food) before other preparations, unless the query names a preparation;
//   5. a record with complete nutrition, and then the provider's own order.
// No preference is invented about which variety someone means: among "egg white", "egg whole" and "egg yolk", for
// "large egg", the provider's order stands.
import type { NormalizedFood } from "../types";

/** Lowercase words, without punctuation, each reduced to a simple singular so "eggs" matches "egg". */
export function foodWords(text: string): string[] {
  return text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
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

/** The first one or two comma-separated parts, which in USDA names say what the food is ("Rice, white"). */
const parts = (name: string, n: number) => name.split(",").slice(0, n).join(" ");

// Words that say how a food was prepared. Unless the query asks for one, the unprepared "raw" record comes first.
const PREPARATIONS = new Set(["raw", "cooked", "baked", "boiled", "fried", "roasted", "grilled", "dried", "dehydrated", "canned", "frozen", "steamed"]);

/** Higher is more relevant. Exposed for tests. */
export function relevance(query: string, food: Pick<NormalizedFood, "name" | "per100">): number {
  const q = foodWords(query);
  if (!q.length) return 0;
  const name = foodWords(food.name);
  const lead1 = foodWords(parts(food.name, 1));
  const lead2 = foodWords(parts(food.name, 2));
  const has = (list: string[], w: string) => list.includes(w);
  const extra = (list: string[]) => list.filter((w) => !has(q, w)).length;
  let score = 0;
  if (name.join(" ") === q.join(" ")) score += 1000;
  if (lead1.join(" ") === q.join(" ")) score += 100;
  // Extra words in the leading part count heavily against a record: it says what the food is.
  if (q.every((w) => has(lead1, w))) score += 400 - 100 * extra(lead1);
  else if (q.every((w) => has(lead2, w))) score += 350 - 100 * extra(lead2);
  else if (has(lead1, q[0])) score += 150;
  if (q.every((w) => has(name, w))) score += 200;
  score -= 5 * extra(name);
  if (has(name, "raw") && !q.some((w) => PREPARATIONS.has(w))) score += 8;
  const values = [food.per100.kcal, food.per100.protein, food.per100.carbs, food.per100.fat];
  if (values.every((v) => v !== null)) score += 20;
  else if (values.every((v) => v === null)) score -= 40;
  return score;
}

/** The same records, most relevant first. Ties keep the provider's order. */
export function rankFoods<T extends Pick<NormalizedFood, "name" | "per100">>(query: string, foods: T[]): T[] {
  return foods.map((f, i) => ({ f, i, s: relevance(query, f) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.f);
}
