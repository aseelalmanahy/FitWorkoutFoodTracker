/**
 * Food-photo gap: from the words read on a package's front to a short list of candidate products, for the person to
 * confirm one. Candidates are only records the approved food search returned (Open Food Facts, USDA, the person's
 * own foods), ordered by how many of the package's words they share. Nothing here makes or changes a value: a
 * candidate's nutrition is the provider's, shown as it came, and one with none can't be chosen.
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

export type Candidate = SearchItem & { shared: number };

/** At most MAX_CANDIDATES, most shared words first; ties keep the provider's own order, packaged products first. */
export function rankCandidates(response: Pick<SearchResponse, "results">, lines: string[]): Candidate[] {
  const read = words(lines.join(" "));
  const all = SOURCE_ORDER.flatMap((s) => response.results[s] ?? []);
  const seen = new Set<string>();
  const scored = all.flatMap((item, order) => {
    if (seen.has(item.key)) return [];
    seen.add(item.key);
    const shared = [...words(`${item.brand ?? ""} ${item.name}`)].filter((w) => read.has(w)).length;
    return [{ item: { ...item, shared }, order }];
  });
  return scored.sort((a, b) => b.item.shared - a.item.shared || a.order - b.order).slice(0, MAX_CANDIDATES).map((x) => x.item);
}
