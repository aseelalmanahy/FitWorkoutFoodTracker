import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/server/db";
import { requireProfile } from "@/lib/server/profile";
import { getExerciseHistory, visibleExercises } from "@/lib/server/workouts";
import { compareToPrevious, computeRecords, RECORD_LABELS, summarizeSets, type RecordKind } from "@/lib/overload";
import { formatLocalDate } from "@/lib/time";
import { formatMass, formatVolume, massUnit, round, toDisplayMass } from "@/lib/units";
import { Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { OverloadBadge, PrBadge } from "@/components/overload-badge";
import { ExerciseChart } from "@/components/progress/exercise-chart";
import { Page } from "@/components/page";

export const metadata = { title: "Exercise progress" };

export default async function ExerciseProgressPage({ params }: { params: Promise<{ exerciseId: string }> }) {
  const { exerciseId } = await params;
  const { user, profile } = await requireProfile();
  const exercise = await prisma.exercise.findFirst({ where: { id: exerciseId, ...visibleExercises(user.id) } });
  if (!exercise) notFound();
  const units = profile.unitSystem;
  const tz = profile.timezone;

  const history = await getExerciseHistory(user.id, exercise.id);
  const records = computeRecords(history);
  const summaries = history.map((h) => ({ ...h, sum: summarizeSets(h.sets) }));
  const bodyweight = summaries.every((s) => s.sum.topWeightKg === 0);

  const chart = summaries.map((s) => ({
    date: s.date.toISOString(),
    label: formatLocalDate(s.date, tz, { month: "short", day: "numeric" }),
    topWeight: toDisplayMass(s.sum.topWeightKg, units),
    e1rm: s.sum.bestE1rmKg != null ? toDisplayMass(s.sum.bestE1rmKg, units) : null,
    volume: Math.round(toDisplayMass(s.sum.volumeKg, units)),
    reps: s.sum.totalReps,
  }));

  const recordValue = (k: RecordKind, v: number) =>
    k === "mostReps" ? `${v} reps` : k === "bestVolume" ? formatVolume(v, units) : formatMass(v, units);

  return (
    <Page width="wide">
      <PageHeader title={exercise.name} subtitle={`${history.length} session${history.length === 1 ? "" : "s"} logged`} back="/progress" />
      {history.length === 0 ? (
        <EmptyState title="No completed sessions" body="Log this exercise in a workout to see its progress." />
      ) : (
        <>
          <Card className="p-4 lg:p-6">
            {history.length < 2 ? (
              <p className="py-8 text-center text-sm text-muted">Log at least two sessions to see a trend.</p>
            ) : (
              <ExerciseChart data={chart} unit={massUnit(units)} bodyweight={bodyweight} />
            )}
          </Card>

          <div className="grid gap-x-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-start">
          <section className="min-w-0">
          <SectionTitle>Personal records</SectionTitle>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-2">
            {(Object.keys(RECORD_LABELS) as RecordKind[]).map((k) => {
              const r = records.current[k];
              if (!r) return null;
              return (
                <Card key={k} className="p-3">
                  <p className="text-xs text-muted">{RECORD_LABELS[k]}</p>
                  <p className="num mt-0.5 text-lg font-bold">{recordValue(k, r.value)}</p>
                  <Link href={`/workouts/history/${r.sessionId}`} className="text-xs text-muted hover:underline">{formatLocalDate(r.date, tz)}</Link>
                </Card>
              );
            })}
          </div>
          </section>

          <section className="min-w-0">
          <SectionTitle>Sessions</SectionTitle>
          <Card className="divide-y divide-line">
            {[...summaries].reverse().map((s, i, arr) => {
              const prev = arr[i + 1];
              const cmp = compareToPrevious(prev ? prev.sum : null, s.sum);
              const prs = records.prsBySession.get(s.sessionId) ?? [];
              const working = s.sets.filter((x) => !x.isWarmup);
              return (
                <Link key={s.sessionId} href={`/workouts/history/${s.sessionId}`} className="block px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{formatLocalDate(s.date, tz, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</p>
                    <div className="flex items-center gap-1.5">{prs.length > 0 && <PrBadge />}<OverloadBadge status={cmp.status} /></div>
                  </div>
                  <p className="num mt-1 text-sm text-muted">
                    {working.map((x) => (x.weightKg > 0 ? `${round(toDisplayMass(x.weightKg, units), 1)}×${x.reps}` : `${x.reps}`)).join(", ")}
                  </p>
                  <p className="num mt-0.5 text-xs text-muted">
                    {s.sum.workingSets} sets · {bodyweight ? `${s.sum.totalReps} reps` : formatVolume(s.sum.volumeKg, units)}
                    {s.sum.bestE1rmKg != null && <> · e1RM {formatMass(s.sum.bestE1rmKg, units)}</>}
                  </p>
                </Link>
              );
            })}
          </Card>
          </section>
          </div>
        </>
      )}
    </Page>
  );
}
