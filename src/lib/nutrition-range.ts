import { addDays, fromIsoDate, isIsoDate, mondayOf } from "./nutrition";

/**
 * UI-08: the period Nutrition history shows: a Monday-to-Sunday week (the default, as before), or a custom range the
 * person picked. Dates are local calendar dates ("YYYY-MM-DD") in the person's time zone, kept as strings.
 */
export const MAX_RANGE_DAYS = 92;

export type Period =
  | { kind: "week"; from: string; to: string; thisWeek: boolean }
  | { kind: "range"; from: string; to: string };

/** Whole days from a to b, inclusive. */
export const daysIn = (from: string, to: string) => Math.round((fromIsoDate(to).getTime() - fromIsoDate(from).getTime()) / 86_400_000) + 1;

/** Why a custom range can't be shown, or null when it can. */
export function rangeProblem(from: string | undefined, to: string | undefined, today: string): string | null {
  if (!from || !to) return "Choose both a start and an end date.";
  if (!isIsoDate(from) || !isIsoDate(to)) return "One of the dates isn't a valid date.";
  if (from > to) return "The start date is after the end date.";
  if (to > today) return "The end date is in the future.";
  if (daysIn(from, to) > MAX_RANGE_DAYS) return `Choose a range of up to ${MAX_RANGE_DAYS} days.`;
  return null;
}

/** The period from the address: ?from&to when valid, else ?week (a week up to this one), else this week. */
export function resolvePeriod(q: { from?: string; to?: string; week?: string }, today: string): { period: Period; error: string | null } {
  const thisWeek = mondayOf(today);
  const asked = q.from !== undefined || q.to !== undefined;
  const error = asked ? rangeProblem(q.from, q.to, today) : null;
  if (asked && !error) return { period: { kind: "range", from: q.from!, to: q.to! }, error: null };
  const week = q.week && isIsoDate(q.week) ? (mondayOf(q.week) > thisWeek ? thisWeek : mondayOf(q.week)) : thisWeek;
  return { period: { kind: "week", from: week, to: addDays(week, 6), thisWeek: week === thisWeek }, error };
}

/** The same-length period shifted by whole weeks, never ending after today; null if it would. */
export function shiftPeriod(p: Period, weeks: number, today: string): string | null {
  if (p.kind === "week") {
    const week = addDays(p.from, weeks * 7);
    if (week > mondayOf(today)) return null;
    return week === mondayOf(today) ? "/nutrition/history" : `/nutrition/history?week=${week}`;
  }
  const from = addDays(p.from, weeks * 7);
  const to = addDays(p.to, weeks * 7);
  if (to > today) return null;
  return `/nutrition/history?from=${from}&to=${to}`;
}

const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o }).format(fromIsoDate(d));

/** "This week", "Nov 2 – 8, 2026", or "Oct 3 – Nov 1, 2026". */
export function periodLabel(p: Period): string {
  if (p.kind === "week" && p.thisWeek) return "This week";
  const sameYear = p.from.slice(0, 4) === p.to.slice(0, 4);
  return `${fmt(p.from, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })} – ${fmt(p.to, { month: "short", day: "numeric", year: "numeric" })}`;
}

/** Day labels for the period's chart: weekdays for a week, dates for anything longer. */
export const chartDayLabel = (date: string, days: number) => fmt(date, days <= 7 ? { weekday: "short" } : { month: "short", day: "numeric" });

export const dayLabel = (date: string) => fmt(date, { weekday: "short", month: "short", day: "numeric" });
