/**
 * Food-photo gap: from the words read on a package's front to a short list of candidate products, for the person to
 * confirm one. Candidates are only records the approved food search returned (Open Food Facts, USDA, the person's
 * own foods). Nothing here makes or changes a value: a candidate's nutrition is the provider's, shown as it came; one
 * with none can't be chosen, and one missing some says which.
 *
 * Not offered, as they would mislead: a record sharing no word with the package, and one sharing only its brand (the
 * same maker's other products). Records that would look identical in the list (same name, brand, unit and values)
 * are shown once. A record matching fewer than half the words searched is marked as a partial match.
 */
import type { SearchItem, SearchResponse, SearchSource } from "@/lib/server/foods/service";

export const MAX_CANDIDATES = 5;
export const MAX_QUERY_LENGTH = 60;
/** Packaged products are what a package photo shows, so their source comes first. */
const SOURCE_ORDER: SearchSource[] = ["OPEN_FOOD_FACTS", "CUSTOM", "USDA"];

const words = (s: string) => new Set(s.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2));

/** The first search: the first two lines read, which are usually the brand and the product's name. */
export function packageQuery(lines: string[]): string {
  return lines.slice(0, 2).join(" ").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH).trim();
}

export type Candidate = SearchItem & {
  /** How many of the package's words the record's name and brand share. */
  shared: number;
  /** Those words, to show why it was offered. */
  matched: string[];
  /** Fewer than half the searched words matched: shown, but marked, so it's checked against the package. */
  partial: boolean;
};

const looksSame = (a: SearchItem, b: SearchItem) =>
  a.name.trim().toLowerCase() === b.name.trim().toLowerCase() && (a.brand ?? "").trim().toLowerCase() === (b.brand ?? "").trim().toLowerCase()
  && a.basisUnit === b.basisUnit && JSON.stringify(a.per100) === JSON.stringify(b.per100);

/**
 * At most MAX_CANDIDATES: most shared words first, then records with every nutrient before ones missing some, then
 * ones with nutrition before ones with none, then the provider's own order, packaged products first.
 */
export function rankCandidates(response: Pick<SearchResponse, "results">, lines: string[], query = packageQuery(lines)): Candidate[] {
  // What the person searched counts as the package's words too: they may have corrected a word the photo misread.
  const read = words(`${lines.join(" ")} ${query}`);
  const searched = words(query);
  const seen: SearchItem[] = [];
  const scored: { item: Candidate; order: number }[] = [];
  SOURCE_ORDER.flatMap((s) => response.results[s] ?? []).forEach((item, order) => {
    if (seen.some((x) => x.key === item.key || looksSame(x, item))) return;
    seen.push(item);
    const inName = [...words(item.name)].filter((w) => read.has(w));
    const matched = [...words(`${item.brand ?? ""} ${item.name}`)].filter((w) => read.has(w));
    if (!matched.length || (!inName.length && matched.length < 2)) return; // nothing, or only the brand, in common
    const hits = [...searched].filter((w) => matched.includes(w)).length;
    scored.push({ item: { ...item, shared: matched.length, matched, partial: searched.size > 0 && hits * 2 < searched.size }, order });
  });
  const rank = (c: Candidate) => (c.complete ? 2 : c.hasNutrition ? 1 : 0);
  return scored
    .sort((a, b) => b.item.shared - a.item.shared || rank(b.item) - rank(a.item) || a.order - b.order)
    .slice(0, MAX_CANDIDATES)
    .map((x) => x.item);
}

/** The record the app resolved is the one the person chose, never another. */
export const isSameRecord = (c: Pick<SearchItem, "source" | "sourceId" | "foodId">, food: { id: string; source: string; sourceId: string }) =>
  c.source === food.source && (c.source === "CUSTOM" ? c.foodId === food.id : c.sourceId === food.sourceId);
