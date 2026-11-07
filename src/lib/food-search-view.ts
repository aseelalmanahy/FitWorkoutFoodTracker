// What the add-food search shows, worked out from the last answer, the current query and the chosen source.
// Pure, so it can be tested without a browser. Nothing here invents a result: it only decides which of the
// server's records are shown, and how an empty or failed search is explained.
import type { SearchResponse, SearchSource } from "@/lib/server/foods/service";

export type Filter = "ALL" | SearchSource;

export const MIN_QUERY_LENGTH = 2;
/**
 * The external providers are asked only from this many characters (FOOD-01). Two letters match too much to be useful
 * there, and each provider search counts against a small per-person allowance (Open Food Facts: 4 a minute).
 * My foods, a query on this app's own data, starts at two.
 */
export const MIN_EXTERNAL_QUERY_LENGTH = 3;

export const FILTERS: { v: Filter; label: string; description: string }[] = [
  { v: "ALL", label: "All sources", description: "Search across the available sources." },
  { v: "USDA", label: "USDA foods", description: "Foods supplied by USDA FoodData Central." },
  { v: "OPEN_FOOD_FACTS", label: "Packaged foods", description: "Products supplied by Open Food Facts." },
  { v: "CUSTOM", label: "My foods", description: "Foods you created." },
];

export const SOURCE_ORDER: SearchSource[] = ["CUSTOM", "USDA", "OPEN_FOOD_FACTS"];

export const SOURCE_LABEL: Record<SearchSource, string> = { CUSTOM: "My foods", USDA: "USDA foods", OPEN_FOOD_FACTS: "Packaged foods" };
export const SOURCE_NOTE: Record<SearchSource, string> = { CUSTOM: "Foods you created", USDA: "USDA FoodData Central", OPEN_FOOD_FACTS: "Open Food Facts (ODbL)" };

const NO_MATCH: Record<Filter, (q: string) => string> = {
  ALL: (q) => `No results for "${q}"`,
  USDA: (q) => `No USDA results for "${q}"`,
  OPEN_FOOD_FACTS: (q) => `No packaged-food results for "${q}"`,
  CUSTOM: (q) => `None of your foods match "${q}"`,
};

export type SearchView =
  /** Fewer than two characters: nothing is searched, and recent foods are offered. */
  | { state: "idle" }
  /** No answer yet covers this query and filter. Any earlier answer belongs to something else, so it isn't shown. */
  | { state: "loading" }
  /** The whole request failed for this query and filter. */
  | { state: "failed"; message: string }
  | {
      state: "results";
      sections: SearchSource[];
      total: number;
      /** Sources in view that couldn't be searched, so an absence there means nothing. */
      unavailable: SourceError[];
      /** Counts for the sources actually searched. A source that wasn't searched has none, rather than a guessed 0. */
      counts: Partial<Record<SearchSource, number>>;
    }
  | {
      state: "empty";
      /** "no_match": every source in view answered, with nothing. "unavailable": every source in view failed. "partly": some failed, and the rest had nothing. */
      kind: "no_match" | "unavailable" | "partly";
      title: string;
      unavailable: SourceError[];
      /** Matches in sources that were searched but are hidden by the filter. */
      elsewhere: { source: SearchSource; count: number }[];
      /** Sources not searched for this filter, so nothing is said about them. */
      unsearched: SearchSource[];
      /** The query is too short for the external providers, so only My foods was searched. */
      tooShortForProviders: boolean;
      counts: Partial<Record<SearchSource, number>>;
    };

type SourceError = SearchResponse["errors"][number];

/**
 * The sources asked for under each filter. A filter on one external source never calls the other one.
 * My foods is a query on this app's own database, with no provider call, so it comes along: that's what lets an
 * empty filtered view say "Found in My foods" without guessing.
 */
export function sourcesFor(filter: Filter, query?: string): SearchSource[] {
  if (query !== undefined && query.trim().length < MIN_EXTERNAL_QUERY_LENGTH) return ["CUSTOM"];
  return filter === "ALL" ? [...SOURCE_ORDER] : filter === "CUSTOM" ? ["CUSTOM"] : ["CUSTOM", filter];
}

/** The search request for a query and filter. Only the filter's sources are named, so only they are searched. */
export function searchPath(query: string, filter: Filter): string {
  return `/api/foods/search?q=${encodeURIComponent(query.trim())}&sources=${sourcesFor(filter, query).join(",")}`;
}

/** Identifies one request, so a failure is shown only against the same query and sources. */
export const requestKey = (query: string, filter: Filter) => `${query.trim()}|${sourcesFor(filter, query).join(",")}`;

/** The answer is for exactly this query. The server trims the query as the client does, so they compare directly. */
export const isCurrent = (data: SearchResponse | null, query: string): data is SearchResponse =>
  data !== null && data.query === query.trim();

/** The answer is for this query and searched every source this filter needs, so it can be shown without asking again. */
export const covers = (data: SearchResponse | null, query: string, filter: Filter): data is SearchResponse =>
  isCurrent(data, query) && sourcesFor(filter, query).every((s) => data.sources.includes(s));

export function searchView(args: { query: string; filter: Filter; data: SearchResponse | null; failure: { key: string; message: string } | null }): SearchView {
  const q = args.query.trim();
  if (q.length < MIN_QUERY_LENGTH) return { state: "idle" };
  if (args.failure && args.failure.key === requestKey(q, args.filter)) return { state: "failed", message: args.failure.message };
  if (!covers(args.data, q, args.filter)) return { state: "loading" };
  const data = args.data;

  const searched = SOURCE_ORDER.filter((s) => data.sources.includes(s));
  const counts: Partial<Record<SearchSource, number>> = Object.fromEntries(searched.map((s) => [s, data.results[s].length]));
  const sections = SOURCE_ORDER.filter((s) => args.filter === "ALL" || args.filter === s);
  const total = sections.reduce((n, s) => n + (counts[s] ?? 0), 0);
  const unavailable = data.errors.filter((e) => sections.includes(e.source));
  if (total > 0) return { state: "results", sections, total, unavailable, counts };

  const elsewhere = searched.filter((s) => !sections.includes(s) && (counts[s] ?? 0) > 0).map((source) => ({ source, count: counts[source]! }));
  const unsearched = SOURCE_ORDER.filter((s) => !searched.includes(s));
  // My foods never fails on its own, so it counts as answered whenever it's in view.
  const answered = sections.filter((s) => !unavailable.some((e) => e.source === s));
  const kind = unavailable.length === 0 ? "no_match" : answered.length === 0 ? "unavailable" : "partly";
  const title = kind === "unavailable"
    ? `${args.filter === "ALL" ? "Food sources" : SOURCE_LABEL[args.filter]} couldn't be searched right now`
    : kind === "partly" ? "Search is partly unavailable"
    : data.barcode ? `No product matches barcode ${q}${args.filter === "ALL" ? "" : ` in ${SOURCE_LABEL[args.filter]}`}`
    : NO_MATCH[args.filter](q);
  return { state: "empty", kind, title, unavailable, elsewhere, unsearched, counts, tooShortForProviders: q.length < MIN_EXTERNAL_QUERY_LENGTH };
}

/** Wording for the local stand-in, so the demo never suggests it holds the real catalogs. */
export function localTestNotice(sources: SearchResponse["localTestSources"]): string | null {
  if (!sources.length) return null;
  const names = sources.map((s) => (s === "USDA" ? "USDA" : "Open Food Facts"));
  return `Test data: ${names.join(" and ")} results come from a small local test sample, not the full ${sources.length > 1 ? "catalogs" : "catalog"}. Many common foods won't be found here.`;
}
