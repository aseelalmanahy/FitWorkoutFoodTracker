/**
 * Reads a nutrition label from a PDF page's embedded text, only when it's clear. Pure functions, with
 * no AI. It knows a fixed set of rows and column layouts, and everything else is ignored, so sentences
 * in a document, including ones addressed to a program, mean nothing here. Anything unclear stays
 * unread for a person to resolve. The result goes through the same strict schema as provider output.
 */
import { parseLabelExtraction, type LabelColumn, type LabelExtraction } from "../label-extraction";
import { NUTRIENT_KEYS, type NutrientKey } from "../nutrition";

/** One line of a page, with its cells in reading order. Cells were separated by a visible gap. */
export type PageLine = string[];

export interface TextItem {
  str: string;
  /** PDF text matrix: [a, b, c, d, x, y]. */
  transform: number[];
  width: number;
  height?: number;
}

/** Rebuilds lines from positioned text, top to bottom. Items on one baseline form a line, and a wide gap starts a cell. */
export function linesFromTextItems(items: TextItem[]): PageLine[] {
  const usable = items.filter((i) => i.str.trim() !== "" && Array.isArray(i.transform) && i.transform.length >= 6);
  const sorted = [...usable].sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  const groups: TextItem[][] = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    const size = Math.abs(item.transform[3]) || item.height || 10;
    if (last && Math.abs(last[0].transform[5] - item.transform[5]) <= size * 0.4) last.push(item);
    else groups.push([item]);
  }
  return groups.map((group) => {
    const ordered = [...group].sort((a, b) => a.transform[4] - b.transform[4]);
    const cells: string[] = [];
    let end = Number.NEGATIVE_INFINITY;
    for (const item of ordered) {
      const x = item.transform[4];
      const size = Math.abs(item.transform[3]) || item.height || 10;
      if (cells.length === 0 || x - end > size * 1.5) cells.push(item.str.trim());
      else cells[cells.length - 1] = `${cells[cells.length - 1]}${x - end > size * 0.15 ? " " : ""}${item.str.trim()}`;
      end = x + (item.width || 0);
    }
    return cells;
  });
}

/**
 * No real label row is this long. Longer lines aren't parsed at all, as the patterns below can take
 * time proportional to the square of a line's length, and this runs on the page's main thread.
 */
const MAX_LINE_CHARS = 500;
const isShort = (line: PageLine) => line.reduce((n, cell) => n + cell.length, 0) <= MAX_LINE_CHARS;

const HEADING = /\b(nutrition(?:al)?\s+(?:facts|information|declaration|values?)|typical\s+values?)\b/gi;
const headingCount = (line: PageLine) => (line.join(" ").match(HEADING) ?? []).length;

const ROWS: { key: NutrientKey; pattern: RegExp; exclude?: RegExp }[] = [
  { key: "kcal", pattern: /^(calories|energy)\b/i, exclude: /calories\s+from/i },
  { key: "fat", pattern: /^(total\s+)?fats?\b/i, exclude: /satur|trans|mono|poly/i },
  { key: "carbs", pattern: /^(total\s+)?carbohydrates?\b|^carbs?\b/i },
  { key: "fiber", pattern: /^(dietary\s+)?fib(er|re)\b/i },
  { key: "protein", pattern: /^proteins?\b/i },
];

interface Basis { basis: LabelColumn["basis"]; heading: string; position: number }

/** Column headings in the order they're printed. A "% daily value" column holds no amounts, so it isn't one. */
function findColumns(lines: PageLine[]): Basis[] {
  const patterns: [LabelColumn["basis"], RegExp][] = [
    ["per_100g", /\b(?:per\s+|\/\s*)?100\s*g\b/i],
    ["per_100ml", /\b(?:per\s+|\/\s*)?100\s*ml\b/i],
    ["per_serving", /\b(?:per\s+(?:\d+(?:[.,]\d+)?\s*(?:g|ml)\s+)?(?:serving|portion)|amount\s+per\s+serving)\b(?:\s*\([^)]*\))?/i],
  ];
  for (const line of lines) {
    if (ROWS.some((r) => r.pattern.test(line[0] ?? ""))) break; // headings come before the first row
    const found: Basis[] = [];
    const text = line.join("   ");
    for (const [basis, pattern] of patterns) {
      const match = pattern.exec(text);
      if (match) found.push({ basis, heading: match[0].trim(), position: match.index });
    }
    if (found.length > 0) return found.sort((a, b) => a.position - b.position);
  }
  return [];
}

interface Amount { printed: string; value: number | null; unit: string | null }

const AMOUNT = /(<\s*)?(\d+(?:[.,]\d+)?)\s*(kcal|kj|cal|mg|mcg|µg|g|ml)?(?![\w%.,])(?!\s*%)/gi;

function toNumber(digits: string, unit: string | null): number | null {
  // "1,200" could be 1200 or 1.2, so it's kept as printed. A person decides.
  if (/^\d{1,3},\d{3}$/.test(digits)) return null;
  void unit;
  return Number(digits.replace(",", "."));
}

function amountsIn(text: string): Amount[] {
  const out: Amount[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const unit = m[3] ?? null;
    out.push({ printed: m[0].trim(), value: m[1] ? null : toNumber(m[2], unit), unit });
  }
  return out;
}

/** The amounts in a row, one group for each column. Energy can print kJ and kcal together as one group. */
function rowGroups(key: NutrientKey, cells: string[]): Amount[][] {
  const texts = cells.map((c) => c.trim()).filter((c) => c !== "" && !/^\d+(?:[.,]\d+)?\s*%$/.test(c));
  const isEnergy = key === "kcal";
  const groups: Amount[][] = [];
  for (const text of texts) {
    if (/^(tr|trace)$/i.test(text)) {
      groups.push([{ printed: text, value: null, unit: null }]);
      continue;
    }
    const amounts = amountsIn(text);
    if (!isEnergy) {
      for (const a of amounts) groups.push([a]);
    } else {
      // A kJ amount followed by kcal, or kcal followed by kJ, is one column's energy.
      for (let i = 0; i < amounts.length; i++) {
        const [a, b] = [amounts[i], amounts[i + 1]];
        const pair = b && a.unit && b.unit && a.unit.toLowerCase() !== b.unit.toLowerCase() && [a.unit, b.unit].every((u) => /^(kj|kcal|cal)$/i.test(u));
        if (pair) {
          groups.push([a, b]);
          i++;
        } else groups.push([a]);
      }
    }
  }
  return groups;
}

const absent = () => ({ status: "absent", value: null, unit: null, printed: null, reason: null }) as const;
const unreadable = (reason: string) => ({ status: "unreadable", value: null, unit: null, printed: null, reason }) as const;

function fieldFromGroup(key: NutrientKey, group: Amount[]): LabelColumn[NutrientKey] {
  const printed = group.map((a) => a.printed).join(" / ");
  // With both printed, kcal is the value, as a label's own kJ is only another unit for it.
  const chosen = key === "kcal" ? (group.find((a) => /^k?cal$/i.test(a.unit ?? "")) ?? group[0]) : group[0];
  return { status: "read", value: chosen.value, unit: chosen.unit, printed, reason: null };
}

function parseServing(lines: PageLine[], columns: Basis[]): LabelExtraction["servingSize"] {
  const read = (amount: number | null, unit: string | null, printed: string) => ({ status: "read", amount, unit, printed: printed.slice(0, 200), reason: null }) as const;
  for (const line of lines) {
    const text = line.join(" ").trim();
    const match = /serving\s+size\s*:?\s*(.+)$/i.exec(text);
    if (!match) continue;
    const rest = match[1].trim();
    // A metric amount in brackets is the serving's real size: "1 cup (240 mL)".
    const metric = /\(\s*(\d+(?:[.,]\d+)?)\s*(g|ml|kg|l)\s*\)/i.exec(rest);
    if (metric) return read(Number(metric[1].replace(",", ".")), metric[2], rest);
    const plain = /^(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+(?:\s+oz)?)?/.exec(rest);
    if (plain) return read(Number(plain[1].replace(",", ".")), plain[2] ?? null, rest);
    return read(null, null, rest);
  }
  // Otherwise a column heading may state it: "Per serving (30 g)".
  for (const column of columns) {
    if (column.basis !== "per_serving") continue;
    const inHeading = /(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i.exec(column.heading);
    if (inHeading) return read(Number(inHeading[1].replace(",", ".")), inHeading[2], column.heading);
  }
  return { status: "absent", amount: null, unit: null, printed: null, reason: null };
}

function parseServingsPerContainer(lines: PageLine[]): LabelExtraction["servingsPerContainer"] {
  for (const line of lines) {
    const text = line.join(" ").trim();
    const match = /servings?\s+per\s+(?:container|package|pack)\s*:?\s*((?:about\s+)?(\d+(?:[.,]\d+)?))/i.exec(text) ?? /((?:about\s+)?(\d+(?:[.,]\d+)?))\s+servings?\s+per\s+(?:container|package|pack)/i.exec(text);
    if (match) return { status: "read", value: Number(match[2].replace(",", ".")), printed: match[1], reason: null };
  }
  return { status: "absent", value: null, printed: null, reason: null };
}

export type SectionResult =
  | { reliable: true; extraction: LabelExtraction }
  | { reliable: false; reason: string };

/** Reads one label's lines. Its result is either a complete reading, or a reason it can't be trusted. */
export function parseLabelSection(allLines: PageLine[]): SectionResult {
  const lines = allLines.filter(isShort);
  let columns = findColumns(lines);
  const hasServingLine = lines.some((l) => /serving\s+size/i.test(l.join(" ")));
  // The usual US panel has one column of per-serving amounts, with no heading of its own.
  if (columns.length === 0 && hasServingLine) columns = [{ basis: "per_serving", heading: "Per serving", position: 0 }];
  if (columns.length === 0) return { reliable: false, reason: "No per-serving or per-100 column could be identified." };

  const rows = new Map<NutrientKey, { groups: Amount[][]; count: number; tooLong?: boolean }>();
  for (const line of allLines) {
    const joined = line.join(" ");
    const row = ROWS.find((r) => r.pattern.test(joined) && !r.exclude?.test(joined));
    if (!row) continue;
    if (!isShort(line)) {
      rows.set(row.key, { groups: [], count: 1, tooLong: true });
      continue;
    }
    const label = row.pattern.exec(joined)![0];
    const remainder = line.length > 1 ? [line[0].slice(label.length), ...line.slice(1)] : [joined.slice(label.length)];
    const current = rows.get(row.key);
    rows.set(row.key, { groups: rowGroups(row.key, remainder), count: (current?.count ?? 0) + 1 });
  }

  const built: LabelColumn[] = columns.map((column) => ({ basis: column.basis, printedHeading: column.heading.slice(0, 200), kcal: absent(), protein: absent(), carbs: absent(), fat: absent(), fiber: absent() }));
  for (const key of NUTRIENT_KEYS) {
    const row = rows.get(key);
    if (!row) continue;
    built.forEach((column, i) => {
      if (row.tooLong) column[key] = unreadable("This row is too long to be a nutrition value.");
      else if (row.count > 1) column[key] = unreadable("This row appears more than once on the label.");
      else if (row.groups.length !== columns.length) column[key] = unreadable("The values in this row couldn't be matched to the columns.");
      else column[key] = fieldFromGroup(key, row.groups[i]);
    });
  }

  const readable = (k: NutrientKey) => built.every((c) => c[k].status === "read");
  if (!readable("kcal") || !(readable("protein") || readable("carbs") || readable("fat"))) {
    return { reliable: false, reason: "Calories and at least one other value couldn't be read clearly." };
  }

  const none = { status: "absent", value: null, printed: null, reason: null } as const;
  const parsed = parseLabelExtraction({
    isNutritionLabel: true,
    productName: none,
    brand: none,
    servingSize: parseServing(lines, columns),
    servingsPerContainer: parseServingsPerContainer(lines),
    columns: built,
  });
  return parsed.ok ? { reliable: true, extraction: parsed.extraction } : { reliable: false, reason: "The text didn't form a complete reading." };
}

export interface LabelSection {
  /** A line of text near its heading, to help tell labels apart. */
  title: string;
  result: SectionResult;
}

export type PageReading =
  /** Almost no text, so it's probably a scan, and its image is what can be read. */
  | { kind: "scanned"; chars: number }
  /** Text, but no nutrition heading. */
  | { kind: "text"; chars: number; preview: string }
  /** Labels side by side, whose lines can't be attributed to either one. */
  | { kind: "ambiguous"; chars: number; preview: string }
  | { kind: "labels"; chars: number; preview: string; sections: LabelSection[] };

const MIN_TEXT_CHARS = 20;

/** What a page holds. Each section is read only from its own lines, so labels are never combined. */
export function readPage(lines: PageLine[]): PageReading {
  const chars = lines.reduce((n, l) => n + l.join("").length, 0);
  const preview = lines.slice(0, 3).map((l) => l.join(" ")).join(" · ").slice(0, 140);
  if (chars < MIN_TEXT_CHARS) return { kind: "scanned", chars };
  if (lines.some((l) => headingCount(l) > 1)) return { kind: "ambiguous", chars, preview };
  const starts = lines.flatMap((l, i) => (headingCount(l) === 1 ? [i] : []));
  if (starts.length === 0) return { kind: "text", chars, preview };
  const sections = starts.map((start, n) => {
    const own = lines.slice(start, starts[n + 1] ?? lines.length);
    const before = start > 0 ? lines[start - 1].join(" ") : "";
    return { title: (before || own[0].join(" ")).slice(0, 80), result: parseLabelSection(own) };
  });
  return { kind: "labels", chars, preview, sections };
}
