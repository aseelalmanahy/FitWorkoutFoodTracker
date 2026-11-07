import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { requireProfile } from "@/lib/server/profile";
import { getExerciseHistories } from "@/lib/server/workouts";
import { compareToPrevious, summarizeSets } from "@/lib/overload";
import { formatLocalDate } from "@/lib/time";
import { formatMass } from "@/lib/units";
import { MUSCLE_LABELS } from "@/lib/labels";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { OverloadBadge } from "@/components/overload-badge";
import { ChevronRight } from "@/components/icons";
import { Page } from "@/components/page";

export const metadata = { title: "Progress" };

export default async function ProgressPage() {
  const { user, profile } = await requireProfile();
  const performed = await prisma.sessionExercise.findMany({
    where: { session: { userId: user.id, status: "COMPLETED" } },
    distinct: ["exerciseId"],
    select: { exercise: true },
  });
  const ids = performed.map((p) => p.exercise.id);
  const histories = await getExerciseHistories(user.id, ids);

  const rows = performed
    .map(({ exercise }) => {
      const h = histories.get(exercise.id) ?? [];
      const last = h.at(-1);
      const prevS = h.at(-2);
      const lastSum = last ? summarizeSets(last.sets) : null;
      return {
        exercise,
        sessions: h.length,
        lastDate: last?.date,
        lastSum,
        status: lastSum ? compareToPrevious(prevS ? summarizeSets(prevS.sets) : null, lastSum).status : null,
      };
    })
    .sort((a, b) => (b.lastDate?.getTime() ?? 0) - (a.lastDate?.getTime() ?? 0));

  return (
    <Page width="wide">
      <PageHeader title="Progress" subtitle="Per-exercise performance over time" />
      <Link href="/progress/weight" className="mb-4 flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 font-semibold md:max-w-sm">
        Weight log <ChevronRight width={18} height={18} className="shrink-0 text-muted" />
      </Link>
      {rows.length === 0 ? (
        <EmptyState title="No progress data yet" body="Complete a workout to start tracking progressive overload and personal records." action={<ButtonLink href="/workouts">Go to workouts</ButtonLink>} />
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <Link key={r.exercise.id} href={`/progress/${r.exercise.id}`} className="flex min-w-0 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 transition hover:border-accent/40">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.exercise.name}</p>
                <p className="num truncate text-xs text-muted">
                  {MUSCLE_LABELS[r.exercise.primaryMuscle]} · {r.sessions} session{r.sessions === 1 ? "" : "s"}
                  {r.lastSum && r.lastSum.topWeightKg > 0 && <> · top {formatMass(r.lastSum.topWeightKg, profile.unitSystem)} × {r.lastSum.repsAtTopWeight}</>}
                  {r.lastDate && <> · {formatLocalDate(r.lastDate, profile.timezone)}</>}
                </p>
              </div>
              {r.status && <OverloadBadge status={r.status} />}
              <ChevronRight width={18} height={18} className="shrink-0 text-muted" />
            </Link>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-muted">Status compares each exercise’s latest session with the one before it: load first, then reps at that load, then total volume.</p>
    </Page>
  );
}
