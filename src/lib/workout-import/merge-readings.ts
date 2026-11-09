import { parseWorkoutText, type DraftExercise } from "./parse";
import { normalizeExerciseName } from "./match";

/**
 * IMG-01: two readings of the same plan image, at different sizes. The recognizer's misreads depend on the scale
 * ("3 sets of B12 reps" at one size, "3 sets of 8-12 reps" at another), so a row whose repetitions weren't read in
 * the first reading takes them from the second, but only when the second reading has the very same exercise name
 * and the same number of sets, and its repetitions are complete. Nothing else changes, and nothing is guessed: a
 * row the two readings don't agree on stays as the first reading left it, for the person to fill in.
 */
export const rowsMissingReps = (text: string): DraftExercise[] =>
  parseWorkoutText(text, { ocr: true }).days.flatMap((d) => d.exercises).filter((e) => e.sets !== null && e.repsMin === null);

export function fillMissingReps(first: string, second: string): { text: string; filled: number } {
  const missing = rowsMissingReps(first);
  if (!missing.length) return { text: first, filled: 0 };
  const complete = new Map<string, DraftExercise[]>();
  for (const e of parseWorkoutText(second, { ocr: true }).days.flatMap((d) => d.exercises)) {
    if (e.sets === null || e.repsMin === null || e.repsMax === null) continue;
    const k = normalizeExerciseName(e.name);
    complete.set(k, [...(complete.get(k) ?? []), e]);
  }
  const lines = first.split(/\r?\n/);
  let filled = 0;
  for (const m of missing) {
    const candidates = complete.get(normalizeExerciseName(m.name)) ?? [];
    // One agreeing row only: a name the second reading has twice can't say which one this is.
    if (candidates.length !== 1 || candidates[0].sets !== m.sets) continue;
    const e = candidates[0];
    const at = lines.findIndex((l) => l.includes(m.name) && /\d/.test(l.slice(l.indexOf(m.name) + m.name.length)));
    if (at < 0 || lines.findIndex((l, i) => i > at && l.includes(m.name)) >= 0) continue; // the row must be unambiguous
    // The second reading's whole row after the name: its sets, reps and anything else it read (a weight, a rest).
    const tail = e.source.includes(e.name) ? e.source.slice(e.source.indexOf(e.name) + e.name.length).trim() : "";
    if (!tail) continue;
    const end = lines[at].indexOf(m.name) + m.name.length;
    lines[at] = `${lines[at].slice(0, end)}   ${tail}`;
    filled++;
  }
  return { text: lines.join("\n"), filled };
}
