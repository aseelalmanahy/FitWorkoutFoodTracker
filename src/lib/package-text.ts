/**
 * Phase 4: the words on a package that could name it, from OCR text, for the person to choose a search from. Lines
 * with mostly letters are kept, as product names and brands are; lines that are mostly numbers, nutrition terms or
 * marketing claims are dropped, so "High protein" or "120 kcal" can never become a search, let alone a value.
 */
const NUTRITION = /\b(kcal|calories?|kj|energy|protein|fat|carb(?:ohydrate)?s?|sugars?|fib(?:re|er)|salt|sodium|per\s*100|serving|nutrition|ingredients?|allergens?|best before|use by|net (?:wt|weight)|e\d{3}|%)\b/i;
const CLAIMS = /\b(high|low|rich|source of|free|light|lite|natural|organic|new|improved|recipe|no added|reduced|zero sugar|gluten)\b/i;

export const MAX_PACKAGE_LINES = 12;

export function packageTextLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.normalize("NFKC").replace(/[^\p{L}\p{N}&'’.\- ]+/gu, " ").replace(/\s+/g, " ").trim();
    const letters = (line.match(/\p{L}/gu) ?? []).length;
    if (letters < 3 || letters / Math.max(1, line.replace(/\s/g, "").length) < 0.7) continue;
    if (NUTRITION.test(line) || (CLAIMS.test(line) && line.split(" ").length <= 4)) continue;
    const cut = line.slice(0, 60).trim();
    if (!out.some((x) => x.toLowerCase() === cut.toLowerCase())) out.push(cut);
    if (out.length >= MAX_PACKAGE_LINES) break;
  }
  return out;
}
