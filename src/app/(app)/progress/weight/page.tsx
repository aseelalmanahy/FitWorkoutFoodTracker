import Link from "next/link";
import { requireProfile } from "@/lib/server/profile";
import { localToday } from "@/lib/server/nutrition/targets";
import { getWeightEntries } from "@/lib/server/weight";
import { formatMass, massUnit, toDisplayMass } from "@/lib/units";
import { trendChange, weightTrend } from "@/lib/weight-trend";
import { Card, EmptyState, PageHeader, SectionTitle, Stat } from "@/components/ui";
import { DeleteWeightButton, WeightLogForm } from "@/components/progress/weight-log";
import { WeightChart } from "@/components/progress/weight-chart";

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
    <>
      <PageHeader title="Weight" subtitle="Optional. Log it if it helps, and skip any day" back="/progress" />
      <WeightLogForm today={today} units={units} />

      {!latest ? (
        <div className="mt-4"><EmptyState title="No weight logged yet" body="Once you've logged a few days, a smoothed trend appears here." /></div>
      ) : (
        <>
          <SectionTitle>Trend</SectionTitle>
          <Card className="p-4">
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Trend" value={formatMass(latest.trendKg, units)} />
              <Stat label="Change" value={change ? signed(change.changeKg) : "—"} sub={change ? `About, since ${fmtDate(change.fromDate)}` : "Needs a week or more of entries"} />
            </div>
            {trend.length > 1 && (
              <div className="mt-4 border-t border-line pt-3">
                <WeightChart
                  unit={massUnit(units)}
                  data={trend.map((p) => ({ label: fmtDate(p.date), weight: toDisplayMass(p.weightKg, units), trend: toDisplayMass(p.trendKg, units) }))}
                />
              </div>
            )}
            <p className="mt-3 text-xs text-muted">Daily weight moves with water and food, so the trend is a smoothed average, and days you didn&apos;t log are simply left out. It doesn&apos;t show body composition, or predict anything.</p>
          </Card>

          <SectionTitle>Entries</SectionTitle>
          <Card className="divide-y divide-line">
            {shown.map((p) => (
              <div key={p.date} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{fmtDate(p.date)}</span>
                  <span className="num text-xs text-muted">Trend {formatMass(p.trendKg, units)}</span>
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
        </>
      )}
    </>
  );
}
