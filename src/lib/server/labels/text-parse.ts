// Turns the text an OCR engine read from a nutrition label into a LabelExtraction (AI-01), conservatively.
//
// OCR on a photo makes characteristic mistakes. Measured on rendered labels, tesseract read "55g" as "559", "12 g" as
// "129", "3,6 g" as "3649" and, worst, "9,0 g" as "90g". So:
//  - a gram amount is read only with its unit printed and recognized; a bare number where a unit belongs is unreadable,
//    as its last digit may be the unit;
//  - nothing is ever filled in, rounded, converted or inferred: a field not found is absent (null), never 0;
//  - every read field keeps the exact text it came from, and checkLabelExtraction then flags what doesn't add up
//    (energy against macros, per-serving against per-100, impossible amounts), for the person to correct;
//  - product name and brand aren't guessed from text: the person types them on the review screen.
// The result is a draft for the review screen, never a record.
import type { LabelExtraction } from "@/lib/label-extraction";
import type { NutrientKey } from "@/lib/nutrition";

type Column = LabelExtraction["columns"][number];
type Basis = Column["basis"];
type NField = Column[NutrientKey];

const absent = (): NField => ({ status: "absent", value: null, unit: null, printed: null, reason: null });
const unreadable = (printed: string | null, reason: string): NField => ({ status: "unreadable", value: null, unit: null, printed: printed?.slice(0, 200) ?? null, reason });
const read = (value: number, unit: string, printed: string): NField => ({ status: "read", value, unit, printed: printed.slice(0, 200), reason: null });

/** OCR noise that lands between a number and its unit, or around the table. */
const clean = (line: string) => line.replace(/[|¢©®«»_]/g, " ").replace(/\s+/g, " ").trim();

/** A decimal written either way: "6,5" and "6.5" are 6.5. A thousands group ("1,580") is read as thousands. */
export function labelNumber(token: string): number | null {
  if (/^\d{1,3}[.,]\d{3}$/.test(token) && !/^0[.,]/.test(token)) return Number(token.replace(/[.,]/, ""));
  if (/^\d+([.,]\d+)?$/.test(token)) return Number(token.replace(",", "."));
  return null;
}

interface Token { text: string; value: number | null; unit: string | null }
/** Amounts on a line, in order, without percentages of daily value. */
export function amounts(line: string): Token[] {
  const out: Token[] = [];
  for (const m of line.matchAll(/(<\s*)?(\d+(?:[.,]\d+)?)\s*(kcal|kj|cal|mg|g|ml)?(?![a-z0-9]|\s*%)/gi)) {
    if (m[1]) { out.push({ text: m[0].trim(), value: null, unit: null }); continue; } // "<0.5 g": not an exact amount
    out.push({ text: m[0].trim(), value: labelNumber(m[2]), unit: m[3] ? m[3].toLowerCase().replace(/^kj$/, "kJ") : null });
  }
  return out;
}

const NUTRIENT_LINES: Record<NutrientKey, RegExp> = {
  kcal: /^(calories|energy|energie|cal\b)/i,
  fat: /^(total\s+)?fat\b/i,
  carbs: /^(total\s+)?carbohydrates?\b/i,
  fiber: /^(dietary\s+)?fib(er|re)\b/i,
  protein: /^proteins?\b/i,
};
/** Lines about a part of another nutrient, which must never be taken for the nutrient itself. */
const SUB_NUTRIENT = /^(saturated|trans|poly|mono|of which|sugars?|total sugars|added|incl)/i;

function findLine(lines: string[], k: NutrientKey): string | null {
  return lines.find((l) => NUTRIENT_LINES[k].test(l) && !SUB_NUTRIENT.test(l)) ?? null;
}

/** The columns a label prints, in order, from its heading line; or one per-serving column for a US-style label. */
function columnsOf(lines: string[]): { basis: Basis; heading: string | null; serving: { amount: number; unit: string; printed: string } | null }[] {
  for (const line of lines) {
    const hundred = /per\s*100\s*(g|ml)\b/i.exec(line);
    const portion = /per\s*(?:(\d+(?:[.,]\d+)?)\s*(g|ml)\s*)?(portion|serving)/i.exec(line);
    if (!hundred && !portion) continue;
    const cols: { at: number; basis: Basis; heading: string; serving: { amount: number; unit: string; printed: string } | null }[] = [];
    if (hundred) cols.push({ at: hundred.index, basis: hundred[1].toLowerCase() === "ml" ? "per_100ml" : "per_100g", heading: hundred[0], serving: null });
    if (portion) {
      const amount = portion[1] ? labelNumber(portion[1]) : null;
      cols.push({ at: portion.index, basis: "per_serving", heading: portion[0], serving: amount !== null && portion[2] ? { amount, unit: portion[2].toLowerCase(), printed: portion[0] } : null });
    }
    return cols.sort((a, b) => a.at - b.at).map(({ basis, heading, serving }) => ({ basis, heading, serving }));
  }
  if (lines.some((l) => /amount per serving|nutrition facts|serving size|servings? per container/i.test(l))) return [{ basis: "per_serving", heading: null, serving: null }];
  return [{ basis: "other", heading: null, serving: null }];
}

function nutrientFor(k: NutrientKey, line: string | null, columnIndex: number, columnCount: number): NField {
  if (!line) return absent();
  const label = line.match(NUTRIENT_LINES[k])?.[0] ?? "";
  let tokens = amounts(line.slice(label.length));
  if (k === "kcal") {
    // Energy is often "1580 kJ / 375 kcal" per column: take kcal when printed, else kJ, which the checks flag, unconverted.
    const kcal = tokens.filter((t) => t.unit === "kcal" || t.unit === "cal");
    const kj = tokens.filter((t) => t.unit === "kJ");
    tokens = kcal.length ? kcal : kj.length ? kj : tokens;
  }
  const t = tokens[columnCount > 1 ? columnIndex : 0];
  if (!t) return unreadable(line, "No amount was found for this column.");
  if (t.value === null) return unreadable(t.text, "This isn't an exact amount, so nothing was assumed.");
  if (k === "kcal") {
    if (t.unit === "kJ") return read(t.value, "kJ", t.text);
    // "Calories 230" carries its unit in the word itself; an "Energy" figure needs its unit printed.
    if (t.unit === "kcal" || t.unit === "cal") return read(t.value, "kcal", t.text);
    if (/^calories|^cal\b/i.test(label)) return read(t.value, "kcal", `${label} ${t.text}`);
    return unreadable(t.text, "The energy unit couldn't be read, so it isn't known whether this is kcal or kJ.");
  }
  if (t.unit === "g" || t.unit === "mg") return read(t.value, t.unit, t.text);
  return unreadable(t.text, "The unit wasn't recognized, and a unit misread as a digit would change the amount. Please check the label.");
}

/** A gram amount whose last digit may be a misread "g": "37g" read as "379g". */
const MAYBE_DOUBLED_G = /\d9\s*g$/i;
const withoutTrailing9 = (f: NField) => Number(String(f.printed).replace(/9\s*g$/i, "").replace(",", "."));
const MACRO_KCAL = { protein: 4, carbs: 4, fat: 9 } as const;
const energyAgrees = (kcal: number, g: Record<keyof typeof MACRO_KCAL, number>) => {
  const fromMacros = g.protein * 4 + g.carbs * 4 + g.fat * 9;
  return Math.abs(kcal - fromMacros) <= Math.max(15, kcal * 0.2);
};

/**
 * OCR reads "g" as "9" even when the unit then looks present ("37g" → "379g"). When a column's amounts contradict
 * each other and dropping such a trailing 9 would resolve it, that amount is made unreadable, never corrected: the
 * person reads the real figure off the label. Two contradictions are checked: energy against protein, carbohydrate
 * and fat (4/4/9 kcal per gram), and fibre above carbohydrate (fibre is part of it on a US label).
 */
function distrustDoubledG(c: Column): Column {
  const out = { ...c };
  const suspect = (k: NutrientKey) => out[k].status === "read" && out[k].unit === "g" && MAYBE_DOUBLED_G.test(out[k].printed ?? "");
  const reason = "The last digit may be a misread \"g\" (\"37g\" read as \"379g\"): this amount doesn't agree with the others. Please check the label.";
  const macros = Object.keys(MACRO_KCAL) as (keyof typeof MACRO_KCAL)[];
  if (out.kcal.status === "read" && out.kcal.unit === "kcal" && macros.every((k) => out[k].status === "read" && out[k].unit === "g")) {
    const g = Object.fromEntries(macros.map((k) => [k, out[k].value!])) as Record<keyof typeof MACRO_KCAL, number>;
    const kcal = out.kcal.value!;
    if (!energyAgrees(kcal, g)) {
      const candidates = macros.filter(suspect);
      // Smallest set of suspects whose trailing 9 explains the disagreement: one at a time, then all of them.
      const sets = [...candidates.map((k) => [k]), ...(candidates.length > 1 ? [candidates] : [])];
      const fix = sets.find((set) => energyAgrees(kcal, { ...g, ...Object.fromEntries(set.map((k) => [k, withoutTrailing9(out[k])])) }));
      for (const k of fix ?? []) out[k] = unreadable(out[k].printed, reason);
    }
  }
  if (c.basis === "per_serving" && out.carbs.status === "read" && out.fiber.status === "read" && out.fiber.value! > out.carbs.value! && suspect("fiber")
      && withoutTrailing9(out.fiber) <= out.carbs.value!) {
    out.fiber = unreadable(out.fiber.printed, reason);
  }
  // Once this image is shown to turn "g" into "9", every other amount in the column ending "9g" is in doubt too.
  if ((Object.keys(out) as (keyof Column)[]).some((k) => k !== "basis" && k !== "printedHeading" && (out[k] as NField).reason === reason)) {
    for (const k of ["protein", "carbs", "fat", "fiber"] as const) if (suspect(k)) out[k] = unreadable(out[k].printed, reason);
  }
  return out;
}

export function parseLabelText(raw: string): LabelExtraction {
  const lines = raw.split(/\r?\n/).map(clean).filter(Boolean);
  const cols = columnsOf(lines);
  const nutrientLines = Object.fromEntries((Object.keys(NUTRIENT_LINES) as NutrientKey[]).map((k) => [k, findLine(lines, k)])) as Record<NutrientKey, string | null>;
  const found = Object.values(nutrientLines).filter(Boolean).length;

  // Serving size: a US "Serving size 2/3 cup (55g)" line, preferring the metric amount; or a "per 30 g portion" heading.
  let servingSize: LabelExtraction["servingSize"] = { status: "absent", amount: null, unit: null, printed: null, reason: null };
  const servingLine = lines.find((l) => /serving size/i.test(l));
  if (servingLine) {
    const rest = servingLine.replace(/.*serving size/i, "").trim();
    const metric = /\((\d+(?:[.,]\d+)?)\s*(g|ml)\)/i.exec(rest) ?? /(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i.exec(rest);
    const amount = metric ? labelNumber(metric[1]) : null;
    servingSize = amount !== null && metric
      ? { status: "read", amount, unit: metric[2].toLowerCase(), printed: rest.slice(0, 200), reason: null }
      : { status: "unreadable", amount: null, unit: null, printed: rest.slice(0, 200) || servingLine.slice(0, 200), reason: "The amount and unit of a serving couldn't be read with certainty." };
  } else {
    const heading = cols.find((c) => c.serving)?.serving;
    if (heading) servingSize = { status: "read", amount: heading.amount, unit: heading.unit, printed: heading.printed, reason: null };
  }

  let servingsPerContainer: LabelExtraction["servingsPerContainer"] = { status: "absent", value: null, printed: null, reason: null };
  for (const l of lines) {
    const m = /((?:about\s+)?(\d+(?:[.,]\d+)?)\s+servings?\s+per\s+container)/i.exec(l) ?? /(servings?\s+per\s+container\s*(?:about\s*)?(\d+(?:[.,]\d+)?))/i.exec(l);
    const value = m ? labelNumber(m[2]) : null;
    if (m && value !== null) { servingsPerContainer = { status: "read", value, printed: m[1].slice(0, 200), reason: null }; break; }
  }

  const columns: Column[] = cols.map((c, i) => ({
    basis: c.basis,
    printedHeading: c.heading,
    kcal: nutrientFor("kcal", nutrientLines.kcal, i, cols.length),
    protein: nutrientFor("protein", nutrientLines.protein, i, cols.length),
    carbs: nutrientFor("carbs", nutrientLines.carbs, i, cols.length),
    fat: nutrientFor("fat", nutrientLines.fat, i, cols.length),
    fiber: nutrientFor("fiber", nutrientLines.fiber, i, cols.length),
  })).map(distrustDoubledG);

  return {
    isNutritionLabel: found >= 2,
    productName: { status: "absent", value: null, printed: null, reason: null },
    brand: { status: "absent", value: null, printed: null, reason: null },
    servingSize,
    servingsPerContainer,
    columns: found >= 2 ? columns : [],
  };
}
