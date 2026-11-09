import Link from "next/link";
import { requireProfile } from "@/lib/server/profile";
import { history } from "@/lib/server/nutrition/entries";
import { localToday } from "@/lib/server/nutrition/targets";
import { fmtG, fmtKcal, fromIsoDate, PROTEIN_ON_TARGET_THRESHOLD, proteinAgainstTarget, summarizePeriod } from "@/lib/nutrition";
import { chartDayLabel, daysIn, periodLabel, resolvePeriod, shiftPeriod } from "@/lib/nutrition-range";
import { Card, PageHeader, SectionTitle, Stat, cx } from "@/components/ui";
import { DailyIntakeChart, WeeklyTrendChart } from "@/components/nutrition/history-charts";
import { RangeJump } from "@/components/nutrition/date-picker";
import { Page } from "@/components/page";

export const metadata = { title: "Nutrition history" };
const TREND_WEEKS = 8;
const fmtDay = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o }).format(fromIsoDate(d));

/**
 * UI-08: a week (the default, as before) or a custom range chosen in the calendar. The averages, the days and the daily
 * chart follow the chosen period; the trend stays an 8-week chart, labelled with the weeks it covers.
 */
export default async function NutritionHistoryPage({ searchParams }: { searchParams: Promise<{ week?: string; from?: string; to?: string }> }) {
  const { user, profile } = await requireProfile();
  const today = localToday(profile.timezone);
  const { period, error } = resolvePeriod(await searchParams, today);
  const isWeek = period.kind === "week";
  const thisWeek = period.kind === "week" && period.thisWeek;
  const span = daysIn(period.from, period.to);

  // One query covers the chosen period and the 8 weeks of the trend, both ending on the period's last day.
  const h = await history(user.id, profile, period.to, Math.max(span, TREND_WEEKS * 7));
  const weekDays = h.days.slice(-span);
  const s = summarizePeriod(weekDays.filter((d) => d.date <= today));
  const trendDays = h.days.slice(-TREND_WEEKS * 7);
  const trend = Array.from({ length: TREND_WEEKS }, (_, i) => {
    const days = trendDays.slice(i * 7, i * 7 + 7).filter((d) => d.date <= today);
    const sum = summarizePeriod(days);
    return { label: fmtDay(trendDays[i * 7].date, { month: "short", day: "numeric" }), kcal: sum.avg?.kcal ?? null, protein: sum.avg?.protein ?? null };
  });
  const chart = weekDays.map((d) => ({ label: chartDayLabel(d.date, span), kcal: d.date <= today && d.entries > 0 ? d.totals.kcal : null, target: d.target?.kcal ?? null }));
  const label = periodLabel(period);
  const prev = shiftPeriod(period, -1, today);
  const next = shiftPeriod(period, 1, today);
  const trendLabel = `${fmtDay(trendDays[0].date, { month: "short", day: "numeric" })} – ${fmtDay(trendDays.at(-1)!.date, { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <Page width="wide">
      <PageHeader title="History" subtitle="Nutrition over time" back="/nutrition" />
      <nav aria-label={isWeek ? "Week" : "Period"} className="lg:max-w-md flex items-center justify-between gap-1 rounded-2xl bg-surface-2 p-1">
        {prev ? <Link href={prev} aria-label="Previous week" className="grid h-9 w-10 shrink-0 place-items-center rounded-xl text-lg hover:bg-surface">‹</Link> : <span className="h-9 w-10" aria-hidden />}
        <RangeJump from={period.from} to={period.to} today={today} label={label} />
        {next ? (
          <Link href={next} aria-label="Next week" className="grid h-9 w-10 shrink-0 place-items-center rounded-xl text-lg hover:bg-surface">›</Link>
        ) : <span className="grid h-9 w-10 shrink-0 place-items-center text-lg text-muted/40" aria-hidden>›</span>}
      </nav>
      {!thisWeek && <Link href="/nutrition/history" className="mt-1.5 inline-block text-xs font-medium text-accent-ink" data-testid="history-this-week">Back to this week</Link>}
      {error && <p role="alert" className="mt-2 rounded-xl border border-line-strong bg-surface-2 px-3 py-2 text-sm font-medium text-fg lg:max-w-md" data-testid="history-range-error">{error} Showing this week instead.</p>}

      <div className="grid gap-x-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
      <section className="min-w-0">
      <SectionTitle>{isWeek ? "Weekly averages" : "Averages for this period"}</SectionTitle>
      <Card className="p-4">
        {s.avg ? (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              <Stat label="Avg calories" value={`${fmtKcal(s.avg.kcal)} kcal`} sub={s.avgTargetKcal ? `Avg target ${fmtKcal(s.avgTargetKcal)}` : undefined} />
              <Stat label="Days logged" value={`${s.daysLogged} / ${s.days}`} sub={thisWeek ? "Days so far this week; averages use logged days that report the value" : "Averages use logged days that report the value"} />
              <Stat label="Avg protein" value={`${fmtG(s.avg.protein)} g`} sub={`C ${fmtG(s.avg.carbs)} g · F ${fmtG(s.avg.fat)} g`} />
              <Stat label="Protein consistency" value={s.proteinDaysWithTarget ? `${s.proteinOnTargetDays} / ${s.proteinDaysWithTarget} days` : "—"}
                sub={s.proteinDaysWithTarget ? `Days ≥ ${Math.round(PROTEIN_ON_TARGET_THRESHOLD * 100)} % of protein target` : undefined} />
            </div>
            <div className="mt-4 border-t border-line pt-3"><DailyIntakeChart data={chart} /></div>
            {chart.some((c) => c.target != null) && <p className="mt-1 text-xs text-muted">Bars: calories consumed. Dashed line: the target in force on each day.</p>}
          </>
        ) : <p className="text-sm text-muted">{isWeek ? "Nothing logged this week." : "Nothing logged in this period."}</p>}
      </Card>
      </section>

      <section className="min-w-0">
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
      </section>
      </div>

      <SectionTitle>{TREND_WEEKS}-week trend · {trendLabel}</SectionTitle>
      <Card className="p-4">
        {trend.some((t) => t.kcal != null) ? (
          <>
            <WeeklyTrendChart data={trend} />
            <p className="mt-1 text-xs text-muted">Weekly average calories (left axis) and protein in g (right axis), over logged days.</p>
          </>
        ) : <p className="text-sm text-muted">Log food for a few weeks to see your intake trend.</p>}
      </Card>
    </Page>
  );
}
