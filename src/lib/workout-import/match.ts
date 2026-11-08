/**
 * Phase 3: matching a plan's exercise names to the library. Only an exact match, after normalizing case, accents,
 * punctuation and plurals, is chosen automatically. Anything else (abbreviations such as "RDL", other wordings,
 * typos) gets ranked suggestions, and the person chooses one, or makes their own exercise. Never a silent guess.
 */
export type LibraryExercise = { id: string; name: string; userId: string | null };
export type Match = { kind: "exact"; exercise: LibraryExercise } | { kind: "choose"; suggestions: LibraryExercise[] };

const ABBREVIATIONS: Record<string, string> = {
  db: "dumbbell", dbs: "dumbbell", bb: "barbell", kb: "kettlebell", ohp: "overhead press", rdl: "romanian deadlift", sldl: "stiff leg deadlift",
  bp: "bench press", lat: "lat", ez: "ez", bw: "bodyweight", ext: "extension", alt: "alternating",
};

/** Lower case, no accents or punctuation, single spaces, and plural words made singular ("presses" stays "press"). */
export function normalizeExerciseName(name: string): string {
  return name
    .normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()
    .split(" ").map((w) => (w.length > 3 && w.endsWith("es") && /(ss|sh|ch|x)es$/.test(w) ? w.slice(0, -2) : w.length >= 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}
const tokens = (name: string) => new Set(normalizeExerciseName(name).split(" ").flatMap((w) => (ABBREVIATIONS[w] ?? w).split(" ")).filter(Boolean));

/** How alike two names are, from shared words, abbreviations expanded: 0 to 1. For ranking suggestions only. */
export function similarity(a: string, b: string): number {
  const x = tokens(a), y = tokens(b);
  const shared = [...x].filter((t) => y.has(t)).length;
  return shared === 0 ? 0 : shared / new Set([...x, ...y]).size;
}

/** The person's own exercise wins over a built-in one with the same name, as it's the one they've been using. */
export function matchExercise(name: string, library: LibraryExercise[], limit = 5): Match {
  const key = normalizeExerciseName(name);
  const exact = library.filter((e) => normalizeExerciseName(e.name) === key);
  if (exact.length) return { kind: "exact", exercise: exact.find((e) => e.userId !== null) ?? exact[0] };
  const ranked = library.map((e) => ({ e, s: similarity(name, e.name) })).filter((r) => r.s > 0).sort((p, q) => q.s - p.s || p.e.name.localeCompare(q.e.name));
  return { kind: "choose", suggestions: ranked.slice(0, limit).map((r) => r.e) };
}
