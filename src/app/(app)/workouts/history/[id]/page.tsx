import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/server/profile";
import { getExerciseHistories, getPreviousPerformances, getSessionDetail } from "@/lib/server/workouts";
import { summarizeSessions } from "@/lib/server/stats";
import { compareToPrevious, computeRecords, RECORD_LABELS, summarizeSets } from "@/lib/overload";
import { formatLocalDate } from "@/lib/time";
import { formatDuration, formatMass, formatVolume, massUnit, toDisplayMass } from "@/lib/units";
import { Card, PageHeader, Stat } from "@/components/ui";
import { OverloadBadge, PrBadge } from "@/components/overload-badge";
import { StartWorkoutButton } from "@/components/workouts/start-workout-button";
import { DeleteSessionButton } from "./delete-button";
import { Page } from "@/components/page";

export const metadata = { title: "Workout" };

export default async function SessionDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const { id } = await params;
  const { done } = await searchParams;
  const { user, profile } = await requireProfile();
  const session = await getSessionDetail(user.id, id);
  if (!session) notFound();
  if (session.status === "IN_PROGRESS") redirect(`/workouts/session/${id}`);

  const units = profile.unitSystem;
  const exerciseIds = [...new Set(session.exercises.map((e) => e.exerciseId))];
  const [prev, histories] = await Promise.all([
    getPreviousPerformances(user.id, exerciseIds, { excludeSessionId: id, before: session.startedAt }),
    getExerciseHistories(user.id, exerciseIds),
  ]);
  const sum = summarizeSessions([session]);
  const prsByExercise = new Map(exerciseIds.map((eid) => [eid, computeRecords(histories.get(eid) ?? []).prsBySession.get(id) ?? []]));
  const prCount = [...prsByExercise.values()].reduce((n, l) => n + l.length, 0);

  return (
    <Page width="wide">
      <PageHeader
        title={session.name}
        subtitle={formatLocalDate(session.startedAt, profile.timezone, { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
        back="/workouts/history"
      />
      {done && (
        <Card className="mb-4 border-accent/40 bg-accent/10 p-4">
          <p className="font-bold">Workout complete</p>
          <p className="text-sm text-muted">{prCount > 0 ? `You set ${prCount} personal record${prCount > 1 ? "s" : ""}.` : "Logged and saved."}</p>
        </Card>
      )}
      <Card className="grid grid-cols-4 gap-2 p-4 lg:max-w-3xl">
        <Stat label="Time" value={formatDuration(sum.seconds)} />
        <Stat label="Sets" value={sum.sets} />
        <Stat label={`Vol (${massUnit(units)})`} value={Math.round(toDisplayMass(sum.volumeKg, units)).toLocaleString()} />
        <Stat label="PRs" value={prCount} />
      </Card>

      <div className="mt-4 grid gap-3 md:grid-cols-2 md:items-start">
        {session.exercises.map((e) => {
          const p = prev.get(e.exerciseId);
          const cmp = compareToPrevious(p ? summarizeSets(p.sets) : null, summarizeSets(e.sets));
          const prs = prsByExercise.get(e.exerciseId) ?? [];
          let n = 0;
          return (
            <Card key={e.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/progress/${e.exerciseId}`} className="font-bold hover:underline">{e.exercise.name}</Link>
                <OverloadBadge status={cmp.status} />
              </div>
              <p className="mt-0.5 text-xs text-muted">{cmp.headline}{p && <> · vs {formatLocalDate(p.date, profile.timezone)}</>}</p>
              {prs.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">{prs.map((k) => <PrBadge key={k} label={`PR · ${RECORD_LABELS[k]}`} />)}</div>
              )}
              <ul className="mt-3 space-y-1">
                {e.sets.map((s) => (
                  <li key={s.id} className="num flex items-center justify-between text-sm">
                    <span className={s.isWarmup ? "text-info" : "text-muted"}>{s.isWarmup ? "Warm-up" : `Set ${++n}`}</span>
                    <span className="font-semibold">{s.weightKg > 0 ? `${formatMass(s.weightKg, units)} × ${s.reps}` : `${s.reps} reps`}</span>
                  </li>
                ))}
              </ul>
              {e.notes && (
                <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2" data-testid="history-exercise-note">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Exercise note</p>
                  <p className="mt-0.5 whitespace-pre-line text-sm">{e.notes}</p>
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {session.notes && (
        <Card className="mt-3 p-4 lg:max-w-3xl" data-testid="history-workout-notes">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Workout notes</h2>
          <p className="mt-1 whitespace-pre-line text-sm">{session.notes}</p>
        </Card>
      )}

      <div className="mx-auto mt-5 max-w-xl space-y-2">
        <StartWorkoutButton source={{ fromSessionId: session.id }} size="lg" className="w-full">Repeat this workout</StartWorkoutButton>
        <p className="text-center text-xs text-muted">Starts a new workout with the same exercises. Your sets from this session show as “previous”.</p>
        <DeleteSessionButton sessionId={session.id} />
      </div>
      <p className="mt-2 text-center text-xs text-muted">Total volume = Σ weight × reps for working sets. {formatVolume(sum.volumeKg, units)}.</p>
    </Page>
  );
}
