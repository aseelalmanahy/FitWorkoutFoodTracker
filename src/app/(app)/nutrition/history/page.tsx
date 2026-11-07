import Link from "next/link";
import { requireProfile } from "@/lib/server/profile";
import { history } from "@/lib/server/nutrition/entries";
import { localToday } from "@/lib/server/nutrition/targets";
import { addDays, fmtG, fmtKcal, fromIsoDate, isIsoDate, mondayOf, PROTEIN_ON_TARGET_THRESHOLD, proteinAgainstTarget, summarizePeriod } from "@/lib/nutrition";
import { Card, PageHeader, SectionTitle, Stat, cx } from "@/components/ui";
import { DailyIntakeChart, WeeklyTrendChart } from "@/components/nutrition/history-charts";

export const metadata = { title: "Nutrition history" };
const TREND_WEEKS = 8;
const fmtDay = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o }).format(fromIsoDate(d));

export default async function NutritionHistoryPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { user, profile } = await requireProfile();
  const today = localToday(profile.timezone);
  const raw = (await searchParams).week;
  const thisWeek = mondayOf(today);
  const week = raw && isIsoDate(raw) ? (mondayOf(raw) > thisWeek ? thisWeek : mondayOf(raw)) : thisWeek;
  const weekEnd = addDays(week, 6);

  // One query covers the selected week and the preceding trend weeks.
  const h = await history(user.id, profile, weekEnd, TREND_WEEKS * 7);
  const weekDays = h.days.slice(-7);
  const s = summarizePeriod(weekDays.filter((d) => d.date <= today));
  const trend = Array.from({ length: TREND_WEEKS }, (_, i) => {
    const days = h.days.slice(i * 7, i * 7 + 7).filter((d) => d.date <= today);
    const sum = summarizePeriod(days);
    return { label: fmtDay(h.days[i * 7].date, { month: "short", day: "numeric" }), kcal: sum.avg?.kcal ?? null, protein: sum.avg?.protein ?? null };
  });
  const chart = weekDays.map((d) => ({ label: fmtDay(d.date, { weekday: "short" }), kcal: d.date <= today && d.entries > 0 ? d.totals.kcal : null, target: d.target?.kcal ?? null }));
  const weekLabel = `${fmtDay(week, { month: "short", day: "numeric" })} – ${fmtDay(weekEnd, { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <>
      <PageHeader title="History" subtitle="Nutrition over time" back="/nutrition" />
      <nav aria-label="Week" className="flex items-center justify-between rounded-2xl bg-surface-2 p-1">
        <Link href={`/nutrition/history?week=${addDays(week, -7)}`} aria-label="Previous week" className="grid h-9 w-10 place-items-center rounded-xl text-lg hover:bg-surface">‹</Link>
        <span className="text-sm font-semibold">{week === thisWeek ? "This week" : weekLabel}</span>
        {week < thisWeek ? (
          <Link href={`/nutrition/history?week=${addDays(week, 7)}`} aria-label="Next week" className="grid h-9 w-10 place-items-center rounded-xl text-lg hover:bg-surface">›</Link>
        ) : <span className="grid h-9 w-10 place-items-center text-lg text-muted/40" aria-hidden>›</span>}
      </nav>

      <SectionTitle>Weekly averages</SectionTitle>
      <Card className="p-4">
        {s.avg ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Avg calories" value={`${fmtKcal(s.avg.kcal)} kcal`} sub={s.avgTargetKcal ? `Avg target ${fmtKcal(s.avgTargetKcal)}` : undefined} />
              <Stat label="Days logged" value={`${s.daysLogged} / ${s.days}`} sub={week === thisWeek ? "Days so far this week; averages use logged days that report the value" : "Averages use logged days that report the value"} />
              <Stat label="Avg protein" value={`${fmtG(s.avg.protein)} g`} sub={`C ${fmtG(s.avg.carbs)} g · F ${fmtG(s.avg.fat)} g`} />
              <Stat label="Protein consistency" value={s.proteinDaysWithTarget ? `${s.proteinOnTargetDays} / ${s.proteinDaysWithTarget} days` : "—"}
                sub={s.proteinDaysWithTarget ? `Days ≥ ${Math.round(PROTEIN_ON_TARGET_THRESHOLD * 100)} % of protein target` : undefined} />
            </div>
            <div className="mt-4 border-t border-line pt-3"><DailyIntakeChart data={chart} /></div>
            {chart.some((c) => c.target != null) && <p className="mt-1 text-xs text-muted">Bars: calories consumed. Dashed line: the target in force on each day.</p>}
          </>
        ) : <p className="text-sm text-muted">Nothing logged this week.</p>}
      </Card>

      <SectionTitle>Days</SectionTitle>
      <Card className="divide-y divide-line">
        {[...weekDays].reverse().filter((d) => d.date <= today).map((d) => {
          const verdict = proteinAgainstTarget(d);
          const partial = d.totals.incomplete.some((k) => k !== "fiber");
          return (
            <Link key={d.date} href={d.date === today ? "/nutrition" : `/nutrition?date=${d.date}`} className="flex items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="block text-sm font-semibold">{fmtDay(d.date, { weekday: "short", month: "short", day: "numeric" })}</span>
                <span className="num text-xs text-muted">{d.entries ? `P ${fmtG(d.totals.protein)} · C ${fmtG(d.totals.carbs)} · F ${fmtG(d.totals.fat)} g${partial ? " · incomplete" : ""}` : "Not logged"}</span>
              </span>
              <span className="num text-right">
                <span className="block text-sm font-semibold">{d.entries ? fmtKcal(d.totals.kcal) : "—"}{d.target && <span className="font-normal text-muted"> / {fmtKcal(d.target.kcal)}</span>}</span>
                {(verdict === "on" || verdict === "below") && <span className={cx("text-[11px]", verdict === "on" ? "text-up" : "text-muted")}>{verdict === "on" ? "Protein on target" : "Protein below target"}</span>}
              </span>
            </Link>
          );
        })}
      </Card>

      <SectionTitle>{TREND_WEEKS}-week trend</SectionTitle>
      <Card className="p-4">
        {trend.some((t) => t.kcal != null) ? (
          <>
            <WeeklyTrendChart data={trend} />
            <p className="mt-1 text-xs text-muted">Weekly average calories (left axis) and protein in g (right axis), over logged days.</p>
          </>
        ) : <p className="text-sm text-muted">Log food for a few weeks to see your intake trend.</p>}
      </Card>
    </>
  );
}
