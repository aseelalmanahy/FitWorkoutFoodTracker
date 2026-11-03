/**
 * Nutrition arithmetic. Pure functions, no I/O, shared by client and server.
 *
 * Conventions
 *  - Food nutrition is expressed per 100 basis units (g or ml).
 *  - null = value not reported by the source. It is never treated as 0 for a
 *    single food. In totals it is skipped and the total is flagged incomplete.
 *  - Energy from macros uses Atwater general factors: 4 kcal/g protein and
 *    carbohydrate, 9 kcal/g fat.
 */

export const NUTRIENT_KEYS = ["kcal", "protein", "carbs", "fat", "fiber"] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
export type Nutrients = Record<NutrientKey, number | null>;
export type NutrientTotals = Record<NutrientKey, number> & { incomplete: NutrientKey[] };

export const MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;
export type MealType = (typeof MEAL_TYPES)[number];
export const MEAL_LABELS: Record<MealType, string> = { BREAKFAST: "Breakfast", LUNCH: "Lunch", DINNER: "Dinner", SNACK: "Snacks" };

export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

export const round = (x: number, decimals = 2) => {
  const f = 10 ** decimals;
  return Math.round((x + Number.EPSILON) * f) / f;
};

/** Total amount (g/ml) consumed: servings × serving size. */
export function consumedAmount(servingAmount: number, quantity: number): number {
  return servingAmount * quantity;
}

/** Scale per-100 values to an absolute amount. Missing values stay missing. */
export function scaleNutrients(per100: Nutrients, amount: number): Nutrients {
  const out = {} as Nutrients;
  for (const k of NUTRIENT_KEYS) {
    const v = per100[k];
    out[k] = v == null ? null : round((v * amount) / 100, 2);
  }
  return out;
}

/** Nutrition for `quantity` servings of `servingAmount` g/ml each. */
export function entryNutrients(per100: Nutrients, servingAmount: number, quantity: number): Nutrients {
  return scaleNutrients(per100, consumedAmount(servingAmount, quantity));
}

export function sumNutrients(items: Nutrients[]): NutrientTotals {
  const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, incomplete: [] as NutrientKey[] };
  for (const k of NUTRIENT_KEYS) {
    let missing = false;
    for (const it of items) {
      const v = it[k];
      if (v == null) missing = true;
      else totals[k] += v;
    }
    totals[k] = round(totals[k], 2);
    if (missing) totals.incomplete.push(k);
  }
  return totals;
}

/** Remaining vs target. Over-target intake is reported as `over`, never as negative remaining. */
export function remaining(target: number, consumed: number): { remaining: number; over: number } {
  const diff = target - consumed;
  return diff >= 0 ? { remaining: round(diff, 2), over: 0 } : { remaining: 0, over: round(-diff, 2) };
}

/** Progress fraction for bars. The bar is capped at 1; `ratio` keeps the true value. */
export function progress(consumed: number, target: number): { fraction: number; ratio: number } {
  if (target <= 0) return { fraction: 0, ratio: 0 };
  const ratio = consumed / target;
  return { fraction: Math.min(1, Math.max(0, ratio)), ratio };
}

export const macroKcal = (p: number, c: number, f: number) => p * KCAL_PER_G.protein + c * KCAL_PER_G.carbs + f * KCAL_PER_G.fat;

// ─── Calendar dates (YYYY-MM-DD, time-zone-free) ────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Postgres DATE values arrive as UTC-midnight Date objects. */
export const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);
export const fromIsoDate = (s: string) => new Date(`${s}T00:00:00Z`);

export function addDays(s: string, n: number): string {
  const d = fromIsoDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toIsoDate(d);
}

export function dateRange(start: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}

/** Monday on or before the given date. */
export function mondayOf(s: string): string {
  const wd = (fromIsoDate(s).getUTCDay() + 6) % 7;
  return addDays(s, -wd);
}

// ─── Targets ────────────────────────────────────────────────────────────────

export interface DatedTarget {
  effectiveFrom: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  source: "SUGGESTED" | "MANUAL";
}

/** The target in force on `date`: latest effectiveFrom <= date. */
export function targetForDate<T extends { effectiveFrom: string }>(targets: T[], date: string): T | null {
  let best: T | null = null;
  for (const t of targets) {
    if (t.effectiveFrom <= date && (!best || t.effectiveFrom > best.effectiveFrom)) best = t;
  }
  return best;
}

/**
 * Carbohydrate grams from an energy target after protein and fat.
 * Returns null when protein and fat already exceed the energy target.
 */
export function carbsFromRemainder(kcal: number, proteinG: number, fatG: number): number | null {
  const rest = kcal - proteinG * KCAL_PER_G.protein - fatG * KCAL_PER_G.fat;
  if (rest < 0) return null;
  return Math.floor(rest / KCAL_PER_G.carbs);
}

// ─── History ────────────────────────────────────────────────────────────────

export interface DaySummary {
  date: string;
  entries: number;
  totals: NutrientTotals;
  target: DatedTarget | null;
}

export interface PeriodSummary {
  days: number;
  daysLogged: number;
  /** Averages over logged days only; null when nothing was logged. */
  avg: Record<"kcal" | "protein" | "carbs" | "fat", number> | null;
  avgTargetKcal: number | null;
  /** Logged days with a protein target where intake reached ≥ 90 % of it. */
  proteinOnTargetDays: number;
  proteinDaysWithTarget: number;
}

export const PROTEIN_ON_TARGET_THRESHOLD = 0.9;

export function summarizePeriod(days: DaySummary[]): PeriodSummary {
  const logged = days.filter((d) => d.entries > 0);
  const avgOf = (k: "kcal" | "protein" | "carbs" | "fat") => round(logged.reduce((s, d) => s + d.totals[k], 0) / logged.length, 1);
  const withTarget = logged.filter((d) => d.target && d.target.proteinG > 0);
  const targeted = logged.filter((d) => d.target);
  return {
    days: days.length,
    daysLogged: logged.length,
    avg: logged.length ? { kcal: avgOf("kcal"), protein: avgOf("protein"), carbs: avgOf("carbs"), fat: avgOf("fat") } : null,
    avgTargetKcal: targeted.length ? Math.round(targeted.reduce((s, d) => s + d.target!.kcal, 0) / targeted.length) : null,
    proteinOnTargetDays: withTarget.filter((d) => d.totals.protein >= PROTEIN_ON_TARGET_THRESHOLD * d.target!.proteinG).length,
    proteinDaysWithTarget: withTarget.length,
  };
}

// ─── Display formatting ─────────────────────────────────────────────────────
export const fmtKcal = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));
export const fmtG = (v: number | null | undefined) => (v == null ? "—" : (Math.round(v * 10) / 10).toLocaleString("en-US"));

export function relativeDayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  if (date === addDays(today, 1)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: date.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric" }).format(fromIsoDate(date));
}
