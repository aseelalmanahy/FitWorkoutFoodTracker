/**
 * Time-zone aware calendar helpers. Weekday index: 0 = Monday … 6 = Sunday.
 */
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

interface LocalParts {
  year: number;
  month: number; // 1–12
  day: number;
  weekday: number; // 0 = Monday
}

const WD: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { year: +get("year"), month: +get("month"), day: +get("day"), weekday: WD[get("weekday")] };
}

/** Offset (ms) of `timeZone` from UTC at instant `date`. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(date);
  const g = (t: string) => +p.find((x) => x.type === t)!.value;
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** UTC instant of local midnight for the given local calendar date. */
export function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  let ts = guess - tzOffsetMs(new Date(guess), timeZone);
  // Re-evaluate once in case a DST transition lies between guess and result.
  ts = guess - tzOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

export function startOfLocalDay(date: Date, timeZone: string): Date {
  const p = localParts(date, timeZone);
  return zonedMidnight(p.year, p.month, p.day, timeZone);
}

/** Monday 00:00 local → following Monday 00:00 local, as UTC instants. */
export function localWeekRange(date: Date, timeZone: string): { start: Date; end: Date } {
  const p = localParts(date, timeZone);
  const mondayUtc = new Date(Date.UTC(p.year, p.month - 1, p.day - p.weekday));
  const nextUtc = new Date(Date.UTC(p.year, p.month - 1, p.day - p.weekday + 7));
  return {
    start: zonedMidnight(mondayUtc.getUTCFullYear(), mondayUtc.getUTCMonth() + 1, mondayUtc.getUTCDate(), timeZone),
    end: zonedMidnight(nextUtc.getUTCFullYear(), nextUtc.getUTCMonth() + 1, nextUtc.getUTCDate(), timeZone),
  };
}

export function formatLocalDate(date: Date, timeZone: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat("en-US", { timeZone, ...opts }).format(date);
}
