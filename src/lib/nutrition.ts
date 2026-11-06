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
export const NUTRIENT_LABELS_SHORT: Record<NutrientKey, string> = { kcal: "calories", protein: "protein", carbs: "carbs", fat: "fat", fiber: "fiber" };

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
export function scaleNutrients(per100: Nutrients, amount: number, decimals = 2): Nutrients {
  const out = {} as Nutrients;
  for (const k of NUTRIENT_KEYS) {
    const v = per100[k];
    out[k] = v == null ? null : round((v * amount) / 100, decimals);
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

/** A stored row. A null kcal means the person stopped using a target from this date. */
export interface TargetRow {
  effectiveFrom: string;
  kcal: number | null;
  /** Null means "not set", and never 0. */
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  source: "SUGGESTED" | "MANUAL";
}

/** A target actually in force: it always has calories, and any macro may be "not set". */
export interface DatedTarget extends TargetRow {
  kcal: number;
}

/**
 * The target in force on `date`: latest effectiveFrom <= date. A stopped row wins like any other and
 * means no target, so every caller's existing no-target handling covers stopped days.
 */
export function targetForDate<T extends { effectiveFrom: string; kcal: number | null }>(targets: T[], date: string): (T & { kcal: number }) | null {
  let best: T | null = null;
  for (const t of targets) {
    if (t.effectiveFrom <= date && (!best || t.effectiveFrom > best.effectiveFrom)) best = t;
  }
  return best && best.kcal !== null ? (best as T & { kcal: number }) : null;
}

/** Comparison for one macro. Null when it isn't set, which is different from a target of 0. */
export function macroAgainstTarget(target: number | null, consumed: number) {
  return target === null ? null : { target, ...remaining(target, consumed), ...progress(consumed, target) };
}

/** How a macro target reads anywhere it's shown. A null is never displayed as 0. */
export const fmtMacroTarget = (grams: number | null) => (grams === null ? "Not set" : `${grams} g`);

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
  const withTarget = logged.filter((d) => d.target && d.target.proteinG !== null && d.target.proteinG > 0);
  const targeted = logged.filter((d) => d.target);
  return {
    days: days.length,
    daysLogged: logged.length,
    avg: logged.length ? { kcal: avgOf("kcal"), protein: avgOf("protein"), carbs: avgOf("carbs"), fat: avgOf("fat") } : null,
    avgTargetKcal: targeted.length ? Math.round(targeted.reduce((s, d) => s + d.target!.kcal, 0) / targeted.length) : null,
    proteinOnTargetDays: withTarget.filter((d) => d.totals.protein >= PROTEIN_ON_TARGET_THRESHOLD * d.target!.proteinG!).length,
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

// ─── Plausibility limits (per 100 g or 100 ml) ──────────────────────────────
/**
 * Physical bounds used to reject data-entry errors before persistence.
 *  - Energy: pure fat is ≈ 900 kcal/100 g (9 kcal/g × 100 g), the maximum for
 *    any food. A 5 % allowance for label rounding gives 950 kcal.
 *  - Mass nutrients: a 100 g portion can't contain more than 100 g of any
 *    nutrient, or more than 100 g of protein + carbohydrate + fat combined.
 *  - Per 100 ml, mass can exceed 100 g for dense liquids (e.g. honey ≈ 1.4 g/ml),
 *    so 150 g is allowed. Energy keeps the same limit, since oils are < 1 g/ml.
 * These limits also keep every stored value well inside the database's
 * DECIMAL precision.
 */
export const PLAUSIBLE_KCAL_PER_100 = 950;
export const plausibleMassPer100 = (basis: "G" | "ML") => (basis === "ML" ? 150 : 100);
/** Largest serving or consumed amount accepted, in g or ml. */
export const MAX_SERVING_AMOUNT = 5000;
export const MIN_SERVING_AMOUNT = 0.1;
export const MAX_ENTRY_AMOUNT = 100_000;

/** Names of nutrients outside physical limits (empty array = plausible). */
export function implausibleNutrients(per100: Nutrients, basis: "G" | "ML"): NutrientKey[] {
  const out: NutrientKey[] = [];
  const maxMass = plausibleMassPer100(basis);
  if (per100.kcal != null && (per100.kcal < 0 || per100.kcal > PLAUSIBLE_KCAL_PER_100)) out.push("kcal");
  for (const k of ["protein", "carbs", "fat", "fiber"] as const) {
    const v = per100[k];
    if (v != null && (v < 0 || v > maxMass)) out.push(k);
  }
  // Sum check over macros that are individually plausible: if those still can't fit
  // in 100 units, it can't be told which is wrong, so all of them are rejected.
  const macros = (["protein", "carbs", "fat"] as const).filter((k) => per100[k] != null && !out.includes(k));
  if (macros.reduce((sum, k) => sum + per100[k]!, 0) > maxMass) out.push(...macros);
  return out;
}

/**
 * For external data: implausible values are treated as not reported (null),
 * never stored. A macro sum that is impossible makes all three macros unknown,
 * since it can't be told which one is wrong.
 */
export function sanitizePer100(per100: Nutrients, basis: "G" | "ML"): { per100: Nutrients; rejected: NutrientKey[] } {
  const rejected = implausibleNutrients(per100, basis);
  const clean = { ...per100 };
  for (const k of rejected) clean[k] = null;
  return { per100: clean, rejected };
}
