/**
 * Phase 3: turns the text of a workout plan into an editable draft, deterministically, with no AI. What it can't read
 * for certain stays empty and is listed, never filled in: sets, repetitions, weights, rest and weekdays are taken only
 * as written. A weight without a unit, a rest without one, "AMRAP", timed sets, percentages and RPE are kept, word for
 * word, in the exercise's notes, for the person to turn into values. Pure: the same text always gives the same draft.
 */

export type WeightUnit = "kg" | "lb";
export interface DraftExercise {
  /** The plan's own words for the exercise, as written. */
  name: string;
  sets: number | null;
  repsMin: number | null;
  repsMax: number | null;
  weight: { value: number; unit: WeightUnit } | null;
  restSeconds: number | null;
  notes: string[];
  /** A superset or circuit label, such as "A" for A1 and A2. */
  group: string | null;
  /** The line it came from, so the person can compare. */
  source: string;
}
export interface DraftDay { name: string; weekday: number | null; notes: string[]; exercises: DraftExercise[] }
export interface Draft { programName: string | null; days: DraftDay[]; unparsed: string[]; warnings: string[] }

export const IMPORT_LIMITS = { maxLines: 3000, maxDays: 14, maxExercisesPerDay: 40, maxNameChars: 120 } as const;

const WEEKDAYS: [RegExp, number][] = [
  [/\bmon(?:day)?\b/i, 0], [/\btue(?:s|sday)?\b/i, 1], [/\bwed(?:nesday)?\b/i, 2], [/\bthu(?:r|rs|rsday)?\b/i, 3],
  [/\bfri(?:day)?\b/i, 4], [/\bsat(?:urday)?\b/i, 5], [/\bsun(?:day)?\b/i, 6],
];
/** Only a full weekday name, or a three-letter one standing alone, names a day of the week. */
export function weekdayOf(header: string): number | null {
  const found = WEEKDAYS.filter(([re]) => re.test(header)).map(([, d]) => d);
  return found.length === 1 ? found[0] : null; // "Mon/Thu" is two days: not guessed
}

const clean = (line: string) => line
  .normalize("NFKC")
  .replace(/[‐-―−]/g, "-")
  .replace(/[×✕✖]/g, "x")
  .replace(/^\s*(?:[-*•·▪◦>]+|\(?\d{1,2}[.)]\s)\s*/, "")
  .replace(/\s+/g, " ")
  .trim();

// Sets x reps, optionally a range: "3x8", "3 x 8-10", "4 sets of 12", "3 sets x 10 reps", "3x 8 to 12".
const SETS_REPS = /\b(\d{1,2})\s*(?:x|sets?\s*(?:of|x)?)\s*(\d{1,3})(?:\s*(?:-|to)\s*(\d{1,3}))?(?:\s*reps?)?\b/i;
const SETS_ONLY = /\b(\d{1,2})\s*sets?\b/i;
const SETS_SPECIAL = /\b(\d{1,2})\s*(?:x|sets?\s*(?:of|x)?)\s*(amrap|max|failure|to failure|\d+\s*(?:s|sec|secs|seconds|min|mins|minutes)\b)/i;
const WEIGHT = /(?:@\s*)?\b(\d{1,4}(?:[.,]\d{1,2})?)\s*(kg|kgs|kilos?|kilograms?|lb|lbs|pounds?)\b/i;
// The whole number, then not a unit or percent: without the first lookahead, "@ 70%" would backtrack to read "7".
const BARE_AT = /@\s*(\d{1,4}(?:[.,]\d{1,2})?)(?![\d.,])(?!\s*(?:%|kg|kgs|kilo|lb|lbs|pound|rpe))/i;
const REST = /\brest(?:\s*period)?\s*[:=]?\s*(\d{1,3}(?:[.,]\d)?)\s*(s|sec|secs|seconds|m|min|mins|minutes)?\b|\b(\d{1,2}):([0-5]\d)\s*(?:min\s*)?rest\b|\b(\d{1,3})\s*(s|sec|secs|seconds|min|mins|minutes)\s*rest\b/i;
const GROUP = /^([A-H])\s*([1-9])\s*[.):-]?\s+/i;
const NOTE_WORTHY = /\b(rpe\s*\d+(?:\.\d)?|rir\s*\d|\d{1,3}\s*%(?:\s*(?:of\s*)?1\s*rm)?|tempo\s*[\dx]{3,4}|amrap|to failure|each (?:side|leg|arm)|per (?:side|leg|arm)|superset|circuit|drop ?set|warm[- ]?up)\b/gi;
const DAY_HEADER = /^(?:(?:week\s*\d+\s*[,-]?\s*)?(?:day|session|workout)\s*(?:\d{1,2}|[a-h])\b|(?:mon|tues?|wed|thur?s?|fri|sat|sun)(?:day|nesday|rsday|urday)?\b|(?:push|pull|legs?|upper|lower|full[- ]body|arms?|chest|back|shoulders?|core|cardio)\b(?:\s*(?:day|body|session|workout|[a-h]|\d))*\s*:?$)/i;
const REST_DAY = /^(?:.*\b(?:rest|off|recovery)\s*day\b.*|rest|off)$/i;
const NOTE_LINE = /^(?:notes?|tips?|comments?|warm[- ]?up|cool[- ]?down|instructions?)\b\s*[:-]?/i;

const num = (s: string) => Number(s.replace(",", "."));

/** One line as an exercise, or null if it doesn't read as one (no sets and reps, or sets alone). */
export function parseExerciseLine(raw: string): DraftExercise | null {
  let line = clean(raw);
  if (!line) return null;
  const notes: string[] = [];
  let group: string | null = null;
  const g = GROUP.exec(line);
  if (g) { group = g[1].toUpperCase(); line = line.slice(g[0].length); }

  const special = SETS_SPECIAL.exec(line);
  const sr = special ? null : SETS_REPS.exec(line);
  const so = special || sr ? null : SETS_ONLY.exec(line);
  const first = special ?? sr ?? so;
  if (!first) return null;
  const name = line.slice(0, first.index).replace(/[\s:,;|(–-]+$/, "").replace(/^[\s:,;|-]+/, "").trim();
  if (!/[A-Za-z]{2}/.test(name) || name.length > IMPORT_LIMITS.maxNameChars) return null;

  const sets = Number(first[1]);
  let repsMin: number | null = null, repsMax: number | null = null;
  if (sr) {
    repsMin = Number(sr[2]);
    repsMax = sr[3] ? Number(sr[3]) : repsMin;
    if (repsMax < repsMin || repsMin < 1) { notes.push(`Reps as written: ${sr[0]}`); repsMin = repsMax = null; }
  } else if (special) {
    notes.push(`Reps as written: ${special[2]}`);
  }

  let weight: DraftExercise["weight"] = null;
  const w = WEIGHT.exec(line);
  if (w) {
    const unit: WeightUnit = /^k/i.test(w[2]) ? "kg" : "lb";
    weight = { value: num(w[1]), unit };
  } else {
    const bare = BARE_AT.exec(line);
    if (bare) notes.push(`Weight as written, with no unit: ${bare[1]}`);
  }

  let restSeconds: number | null = null;
  const r = REST.exec(line);
  if (r) {
    if (r[3] !== undefined) restSeconds = Number(r[3]) * 60 + Number(r[4]);
    else if (r[5] !== undefined) restSeconds = Math.round(num(r[5]) * (/^m/i.test(r[6]) ? 60 : 1));
    else if (r[2]) restSeconds = Math.round(num(r[1]) * (/^m/i.test(r[2]) ? 60 : 1));
    else notes.push(`Rest as written, with no unit: ${r[1]}`);
  }

  for (const m of line.slice(first.index + first[0].length).matchAll(NOTE_WORTHY)) notes.push(m[0]);
  const paren = [...line.matchAll(/\(([^)]{2,120})\)/g)].map((m) => m[1].trim()).filter((t) => !SETS_REPS.test(t) && !WEIGHT.test(t));
  notes.push(...paren);
  if (sets < 1 || sets > 20) return null;
  return { name, sets, repsMin, repsMax, weight, restSeconds, notes: [...new Set(notes.map((n) => n.trim()).filter(Boolean))], group, source: raw.trim().slice(0, 300) };
}

function isDayHeader(line: string): boolean {
  if (SETS_REPS.test(line) || SETS_SPECIAL.test(line) || line.length > 60) return false;
  return DAY_HEADER.test(line) || (/:$/.test(line) && /[A-Za-z]{3}/.test(line) && !NOTE_LINE.test(line) && line.split(" ").length <= 6);
}

/** Lines of text, as a plan's PDF, document, OCR or typed text gives them. */
export function parseWorkoutText(text: string, { fallbackName = null }: { fallbackName?: string | null } = {}): Draft {
  const lines = text.split(/\r?\n/).slice(0, IMPORT_LIMITS.maxLines);
  const draft: Draft = { programName: null, days: [], unparsed: [], warnings: [] };
  let day: DraftDay | null = null;
  const openDay = (name: string) => {
    if (draft.days.length >= IMPORT_LIMITS.maxDays) { draft.warnings.push(`Only the first ${IMPORT_LIMITS.maxDays} days are read.`); return null; }
    day = { name: name.replace(/:$/, "").trim().slice(0, 80) || `Day ${draft.days.length + 1}`, weekday: weekdayOf(name), notes: [], exercises: [] };
    draft.days.push(day);
    return day;
  };
  for (const raw of lines) {
    const line = clean(raw);
    if (!line) continue;
    if (REST_DAY.test(line)) continue;
    const exercise = parseExerciseLine(raw);
    if (exercise) {
      const d = day ?? openDay(draft.programName && draft.days.length === 0 ? "Workout" : `Day ${draft.days.length + 1}`);
      if (!d) continue;
      if (d.exercises.length >= IMPORT_LIMITS.maxExercisesPerDay) { draft.warnings.push(`${d.name}: only the first ${IMPORT_LIMITS.maxExercisesPerDay} exercises are read.`); continue; }
      d.exercises.push(exercise);
      continue;
    }
    if (isDayHeader(line)) { openDay(line); continue; }
    if (!draft.programName && draft.days.length === 0 && line.length <= 80 && /[A-Za-z]{3}/.test(line)) { draft.programName = line; continue; }
    const current = day as DraftDay | null;
    if (current && (NOTE_LINE.test(line) || current.exercises.length > 0)) { current.notes.push(line.slice(0, 300)); continue; }
    draft.unparsed.push(line.slice(0, 300));
  }
  draft.programName ??= fallbackName;
  draft.days = draft.days.filter((d) => d.exercises.length > 0);
  if (draft.days.length === 0) draft.warnings.push("No exercises with sets and repetitions were found. Check the file, or type the plan in.");
  const unitless = draft.days.flatMap((d) => d.exercises).filter((e) => e.notes.some((n) => /with no unit/.test(n))).length;
  if (unitless) draft.warnings.push(`${unitless} weight or rest value${unitless === 1 ? " has" : "s have"} no unit, so ${unitless === 1 ? "it was" : "they were"} left empty and kept in the notes.`);
  return draft;
}

/** Rows of a table (CSV, a spreadsheet, a document's table): read by its header if it has one, else as lines. */
export function parseWorkoutTable(rows: string[][], { fallbackName = null }: { fallbackName?: string | null } = {}): Draft {
  const norm = (s: string) => s.trim().toLowerCase();
  const headerAt = rows.findIndex((r) => r.some((c) => /^(exercise|movement|lift|name)s?$/.test(norm(c))) && r.some((c) => /^(sets?|reps?|repetitions)\b/.test(norm(c))));
  if (headerAt < 0) return parseWorkoutText(rows.map((r) => r.filter((c) => c.trim()).join("  ")).join("\n"), { fallbackName });
  const header = rows[headerAt].map(norm);
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const c = { day: col(/^(day|session|workout)\b/), ex: col(/^(exercise|movement|lift|name)s?$/), sets: col(/^sets?\b/), reps: col(/^(reps?|repetitions)\b/), weight: col(/^(weight|load)\b/), unit: col(/^units?$/), rest: col(/^rest\b/), notes: col(/^(notes?|comments?)$/) };
  const headerUnit: WeightUnit | null = c.weight >= 0 ? (/\bkg\b/.test(header[c.weight]) ? "kg" : /\blbs?\b/.test(header[c.weight]) ? "lb" : null) : null;
  const restFactor = c.rest >= 0 ? (/\(s\)|sec/.test(header[c.rest]) ? 1 : /\(m\)|min/.test(header[c.rest]) ? 60 : null) : null;
  const preamble = rows.slice(0, headerAt).map((r) => r.join(" ").trim()).filter(Boolean);
  const draft: Draft = { programName: preamble[0]?.slice(0, 80) ?? fallbackName, days: [], unparsed: preamble.slice(1), warnings: [] };
  let day: DraftDay | null = null;
  let unitless = 0;
  for (const r of rows.slice(headerAt + 1)) {
    const get = (i: number) => (i >= 0 ? clean(r[i] ?? "") : "");
    const dayName = get(c.day);
    if (!day || (dayName && dayName !== day.name)) {
      if (draft.days.length >= IMPORT_LIMITS.maxDays) { draft.warnings.push(`Only the first ${IMPORT_LIMITS.maxDays} days are read.`); break; }
      day = { name: (dayName || "Workout").slice(0, 80), weekday: weekdayOf(dayName), notes: [], exercises: [] };
      draft.days.push(day);
    }
    const name = get(c.ex);
    if (!name || !/[A-Za-z]{2}/.test(name)) continue;
    if (day.exercises.length >= IMPORT_LIMITS.maxExercisesPerDay) continue;
    const notes: string[] = [];
    const setsCell = get(c.sets);
    const sets = /^\d{1,2}$/.test(setsCell) && Number(setsCell) >= 1 && Number(setsCell) <= 20 ? Number(setsCell) : null;
    if (setsCell && sets === null) notes.push(`Sets as written: ${setsCell}`);
    const repsCell = get(c.reps);
    const range = /^(\d{1,3})\s*(?:-|to)\s*(\d{1,3})$/.exec(repsCell) ?? /^(\d{1,3})$/.exec(repsCell);
    let repsMin: number | null = range ? Number(range[1]) : null;
    let repsMax: number | null = range ? Number(range[2] ?? range[1]) : null;
    if (repsMin !== null && repsMax !== null && (repsMin < 1 || repsMax < repsMin)) { repsMin = null; repsMax = null; }
    if (repsCell && repsMin === null) notes.push(`Reps as written: ${repsCell}`);
    let weight: DraftExercise["weight"] = null;
    const weightCell = get(c.weight);
    if (weightCell) {
      const w = WEIGHT.exec(weightCell);
      const unitCell = get(c.unit).toLowerCase();
      const unit: WeightUnit | null = w ? (/^k/i.test(w[2]) ? "kg" : "lb") : /^kg|^kilo/.test(unitCell) ? "kg" : /^lb|^pound/.test(unitCell) ? "lb" : headerUnit;
      const value = w ? num(w[1]) : /^\d{1,4}(?:[.,]\d{1,2})?$/.test(weightCell) ? num(weightCell) : null;
      if (value !== null && unit) weight = { value, unit };
      else {
        notes.push(`Weight as written${value !== null ? ", with no unit" : ""}: ${weightCell}`);
        if (value !== null) unitless++;
      }
    }
    let restSeconds: number | null = null;
    const restCell = get(c.rest);
    if (restCell) {
      const rr = REST.exec(`rest ${restCell}`);
      if (rr && rr[3] !== undefined) restSeconds = Number(rr[3]) * 60 + Number(rr[4]);
      else if (rr && rr[2]) restSeconds = Math.round(num(rr[1]) * (/^m/i.test(rr[2]) ? 60 : 1));
      else if (/^\d{1,4}$/.test(restCell) && restFactor) restSeconds = Number(restCell) * restFactor;
      else {
        notes.push(`Rest as written${/^\d+$/.test(restCell) ? ", with no unit" : ""}: ${restCell}`);
        if (/^\d+$/.test(restCell)) unitless++;
      }
    }
    const note = get(c.notes);
    if (note) notes.push(note.slice(0, 300));
    const g = GROUP.exec(name);
    day.exercises.push({ name: (g ? name.slice(g[0].length) : name).slice(0, IMPORT_LIMITS.maxNameChars), sets, repsMin, repsMax, weight, restSeconds, notes, group: g ? g[1].toUpperCase() : null, source: r.join(" | ").slice(0, 300) });
  }
  draft.days = draft.days.filter((d) => d.exercises.length > 0);
  if (draft.days.length === 0) draft.warnings.push("No exercises were found in the table.");
  if (unitless) draft.warnings.push(`${unitless} weight or rest value${unitless === 1 ? " has" : "s have"} no unit, so ${unitless === 1 ? "it was" : "they were"} left empty and kept in the notes.`);
  return draft;
}
