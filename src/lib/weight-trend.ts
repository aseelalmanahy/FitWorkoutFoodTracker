/**
 * A smoothed weight trend. Daily weight swings with water and food, so change is read from the trend and not from any
 * single weigh-in.
 *
 * Method: an exponentially weighted average, by calendar days, with a 10-day time constant. Each entry moves the trend
 * toward itself by 1 - e^(-days since the last entry / 10), so a gap counts as time passing, and a missing day is never
 * a value. The first entry starts the trend. The constant is a judgement, in the range commonly used for this. It's a
 * way of reading noisy numbers, says nothing about body composition, and predicts nothing.
 */
export const TREND_TIME_CONSTANT_DAYS = 10;
/** Change is measured over about this many days, or from the first entry if the log is newer. */
export const CHANGE_WINDOW_DAYS = 28;
/** Fewer days than this between the first and last entries is noise, so no change is stated. */
export const MIN_CHANGE_SPAN_DAYS = 7;

export interface WeightPoint { date: string; weightKg: number }
export interface TrendPoint extends WeightPoint { trendKg: number }
export interface TrendChange { changeKg: number; fromDate: string; toDate: string }

const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** Oldest first. Dates are unique, as the table allows one entry a day. */
export function weightTrend(points: WeightPoint[]): TrendPoint[] {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out: TrendPoint[] = [];
  for (const p of sorted) {
    const last = out.at(-1);
    if (!last) { out.push({ ...p, trendKg: p.weightKg }); continue; }
    const carried = 1 - Math.exp(-daysBetween(last.date, p.date) / TREND_TIME_CONSTANT_DAYS);
    out.push({ ...p, trendKg: last.trendKg + carried * (p.weightKg - last.trendKg) });
  }
  return out;
}

/** The trend's change to its latest point. Null until the log spans long enough to say anything. */
export function trendChange(trend: TrendPoint[]): TrendChange | null {
  const latest = trend.at(-1);
  if (!latest || daysBetween(trend[0].date, latest.date) < MIN_CHANGE_SPAN_DAYS) return null;
  const inWindow = trend.filter((p) => daysBetween(p.date, latest.date) >= CHANGE_WINDOW_DAYS).at(-1) ?? trend[0];
  return { changeKg: latest.trendKg - inWindow.trendKg, fromDate: inWindow.date, toDate: latest.date };
}
