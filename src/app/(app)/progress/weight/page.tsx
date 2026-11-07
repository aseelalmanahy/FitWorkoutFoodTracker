import Link from "next/link";
import { requireProfile } from "@/lib/server/profile";
import { localToday } from "@/lib/server/nutrition/targets";
import { getWeightEntries } from "@/lib/server/weight";
import { formatMass, massUnit, toDisplayMass } from "@/lib/units";
import { trendChange, weightTrend } from "@/lib/weight-trend";
import { Card, EmptyState, PageHeader, SectionTitle, Stat } from "@/components/ui";
import { DeleteWeightButton, WeightLogForm } from "@/components/progress/weight-log";
import { WeightChart } from "@/components/progress/weight-chart";
import { Page } from "@/components/page";

export const metadata = { title: "Weight" };

const PAGE = 30;
const fmtDate = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

export default async function WeightPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { user, profile } = await requireProfile();
  const units = profile.unitSystem;
  const today = localToday(profile.timezone);
  const entries = await getWeightEntries(user.id);
  const trend = weightTrend(entries);
  const latest = trend.at(-1);
  const change = trendChange(trend);
  const idByDate = new Map(entries.map((e) => [e.date, e.id]));

  const requested = Number((await searchParams).page);
  const pages = Math.max(1, Math.ceil(trend.length / PAGE));
  const page = Number.isInteger(requested) && requested >= 1 ? Math.min(requested, pages) : 1;
  const newestFirst = [...trend].reverse();
  const shown = newestFirst.slice((page - 1) * PAGE, page * PAGE);

  // A change that rounds to nothing has no direction.
  const signed = (kg: number) => `${toDisplayMass(Math.abs(kg), units) === 0 ? "" : kg > 0 ? "+" : "−"}${formatMass(Math.abs(kg), units)}`;

  return (
    <Page width="wide">
      <PageHeader title="Weight" subtitle="Optional. Log it if it helps, and skip any day" back="/progress" />
      <div className="grid gap-x-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
      <div className="min-w-0 lg:col-start-2 lg:row-start-1">
        <WeightLogForm today={today} units={units} logged={Object.fromEntries(entries.map((e) => [e.date, e.weightKg]))} />
      </div>

      {!latest ? (
        <div className="mt-4 lg:col-start-1 lg:row-start-1 lg:mt-0"><EmptyState title="No weight logged yet" body="Once you've logged more than one day, a smoothed trend appears here." /></div>
      ) : (
        <>
          <section className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <SectionTitle>{trend.length > 1 ? "Trend" : "Logged"}</SectionTitle>
          <Card className="p-4">
            <div className="grid grid-cols-2 gap-4">
              <Stat label={trend.length > 1 ? "Trend" : "Logged"} value={formatMass(latest.trendKg, units)} />
              <Stat label="Change" value={change ? signed(change.changeKg) : "—"} sub={change ? `About, since ${fmtDate(change.fromDate)}` : "Needs entries at least a week apart"} />
            </div>
            {trend.length > 1 && (
              <div className="mt-4 border-t border-line pt-3">
                <WeightChart
                  unit={massUnit(units)}
                  data={trend.map((p) => ({ date: p.date, weight: toDisplayMass(p.weightKg, units), trend: toDisplayMass(p.trendKg, units) }))}
                />
              </div>
            )}
            <p className="mt-3 text-xs text-muted">Daily weight moves with water and food, so the trend is a smoothed average. It lags behind recent changes, so change here can read smaller than it is. Days you didn&apos;t log aren&apos;t counted as zero, and the first entry after a long gap moves the trend further. It doesn&apos;t show body composition, or predict anything.</p>
          </Card>
          </section>

          <section className="min-w-0 lg:col-start-2">
          <SectionTitle>Entries</SectionTitle>
          <Card className="divide-y divide-line">
            {shown.map((p) => (
              <div key={p.date} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{fmtDate(p.date)}</span>
                  {trend.length > 1 && <span className="num text-xs text-muted">Trend {formatMass(p.trendKg, units)}</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span className="num font-semibold">{formatMass(p.weightKg, units)}</span>
                  <DeleteWeightButton id={idByDate.get(p.date)!} label={fmtDate(p.date)} />
                </span>
              </div>
            ))}
          </Card>
          {pages > 1 && (
            <nav aria-label="Pages" className="mt-3 flex justify-between text-sm font-medium">
              {page > 1 ? <Link href={`?page=${page - 1}`}>Newer</Link> : <span />}
              {page < pages ? <Link href={`?page=${page + 1}`}>Older</Link> : <span />}
            </nav>
          )}
          </section>
        </>
      )}
      </div>
    </Page>
  );
}
