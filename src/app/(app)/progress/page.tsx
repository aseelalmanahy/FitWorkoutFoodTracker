import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { requireProfile } from "@/lib/server/profile";
import { getAllExerciseSessions } from "@/lib/server/workouts";
import { overviewByExercise } from "@/lib/progress-overview";
import { groupProgressByProgram } from "@/lib/progress-programs";
import { compareToPrevious, summarizeSets } from "@/lib/overload";
import { formatLocalDate } from "@/lib/time";
import { formatMass, type UnitSystem } from "@/lib/units";
import { MUSCLE_LABELS } from "@/lib/labels";
import { ButtonLink, Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { OverloadBadge } from "@/components/overload-badge";
import { ChevronRight } from "@/components/icons";
import { Page } from "@/components/page";

export const metadata = { title: "Progress" };

type View = "programs" | "exercises";

/**
 * UI-02: three views. Training programs (the default) is added; Exercise progress is the page as it was, with its cards
 * and badges unchanged (owner decision, 2026-11-09); Body weight opens the existing weight log.
 */
export default async function ProgressPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { user, profile } = await requireProfile();
  const view: View = (await searchParams).view === "exercises" ? "exercises" : "programs";
  return (
    <Page width="wide">
      <PageHeader title="Progress" subtitle={view === "programs" ? "Your workouts by program, month and date" : "Per-exercise performance over time"} />
      <ProgressTabs active={view} />
      {view === "programs" ? <ProgramsView userId={user.id} timeZone={profile.timezone} unitSystem={profile.unitSystem} /> : <ExercisesView userId={user.id} timeZone={profile.timezone} unitSystem={profile.unitSystem} />}
    </Page>
  );
}

function ProgressTabs({ active }: { active: View }) {
  const tab = (href: string, label: string, current: boolean) => (
    <Link href={href} aria-current={current ? "page" : undefined} data-testid="progress-tab"
      className={cx("shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium", current ? "border-accent bg-accent-soft font-semibold text-accent-ink" : "border-line text-muted hover:text-fg")}>
      {label}
    </Link>
  );
  return (
    <nav aria-label="Progress views" className="mb-4 flex flex-wrap gap-2">
      {tab("/progress", "Training programs", active === "programs")}
      {tab("/progress?view=exercises", "Exercise progress", active === "exercises")}
      {tab("/progress/weight", "Body weight", false)}
    </nav>
  );
}

const noProgressYet = <EmptyState title="No progress data yet" body="Complete a workout to start tracking progressive overload and personal records." action={<ButtonLink href="/workouts">Go to workouts</ButtonLink>} />;

/** Training programs: program → month → workout → exercises, each exercise with the Exercise progress status. */
async function ProgramsView({ userId, timeZone, unitSystem }: { userId: string; timeZone: string; unitSystem: UnitSystem }) {
  const sessions = await prisma.workoutSession.findMany({
    where: { userId, status: "COMPLETED" },
    orderBy: { startedAt: "asc" },
    select: {
      id: true, name: true, startedAt: true,
      template: { select: { program: { select: { id: true, name: true } } } },
      exercises: {
        orderBy: { position: "asc" },
        select: { exerciseId: true, gymEquipmentId: true, exercise: { select: { name: true } }, machine: { select: { name: true } }, sets: { orderBy: { setNumber: "asc" }, select: { reps: true, weightKg: true, isWarmup: true } } },
      },
    },
  });
  if (sessions.length === 0) return noProgressYet;
  const programs = groupProgressByProgram(sessions.map((s) => ({
    id: s.id, name: s.name, startedAt: s.startedAt, program: s.template?.program ?? null,
    exercises: s.exercises.map((e) => ({ exerciseId: e.exerciseId, name: e.exercise.name, gymEquipmentId: e.gymEquipmentId, machineName: e.machine?.name ?? null, sets: e.sets })),
  })), timeZone);
  const anyProgram = programs.some((p) => p.id !== null);

  return (
    <>
      {!anyProgram && (
        <p className="mb-3 text-sm text-muted" data-testid="progress-no-programs">
          None of your workouts come from a program yet. <Link href="/workouts" className="font-medium text-accent-ink">Group your plans into a program on Workouts</Link>, and their workouts appear under it here.
        </p>
      )}
      <div className="space-y-3">
        {programs.map((p, pi) => (
          <Card key={p.id ?? "none"} className="overflow-hidden" data-testid="progress-program">
            <details open={pi === 0} className="group/program">
              <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 font-semibold break-words" data-testid="progress-program-name">{p.name}</span>
                  <span className="num mt-0.5 block text-xs text-muted">{p.workoutCount} workout{p.workoutCount === 1 ? "" : "s"} · last {formatLocalDate(p.lastDate, timeZone)}</span>
                </span>
                <ChevronRight width={18} height={18} className="shrink-0 text-muted transition group-open/program:rotate-90" aria-hidden />
              </summary>
              <div className="border-t border-line">
                {p.months.map((m, mi) => (
                  <details key={m.key} open={mi === 0} className="group/month border-b border-line last:border-b-0" data-testid="progress-month">
                    <summary className="flex cursor-pointer list-none items-center gap-2 bg-surface-2/50 px-4 py-2.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                      <ChevronRight width={16} height={16} className="shrink-0 text-muted transition group-open/month:rotate-90" aria-hidden />
                      <span className="flex-1">{m.label}</span>
                      <span className="num text-xs font-normal text-muted">{m.workouts.length} workout{m.workouts.length === 1 ? "" : "s"}</span>
                    </summary>
                    <ol className="divide-y divide-line">
                      {m.workouts.map((w) => (
                        <li key={w.sessionId} className="px-4 py-3" data-testid="progress-workout">
                          <Link href={`/workouts/history/${w.sessionId}`} className="flex items-baseline justify-between gap-3">
                            <span className="min-w-0 truncate font-medium">{w.name}</span>
                            <span className="num shrink-0 text-xs text-muted">{formatLocalDate(w.date, timeZone)}</span>
                          </Link>
                          {w.exercises.length === 0 ? (
                            <p className="mt-1 text-xs text-muted">No exercises logged</p>
                          ) : (
                            <ul className="mt-2 space-y-1.5">
                              {w.exercises.map((e) => (
                                <li key={`${e.exerciseId}:${e.gymEquipmentId ?? ""}`} data-testid="progress-exercise">
                                  <Link href={e.gymEquipmentId ? `/progress/${e.exerciseId}?machine=${e.gymEquipmentId}` : `/progress/${e.exerciseId}`} className="flex min-w-0 items-center gap-2 text-sm">
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate">{e.name}{e.machineName ? <span className="text-muted"> · {e.machineName}</span> : null}</span>
                                      <span className="num block truncate text-xs text-muted">
                                        {e.summary.workingSets === 0 ? "No working sets" : <>{e.summary.workingSets} set{e.summary.workingSets === 1 ? "" : "s"}{e.summary.topWeightKg > 0 && <> · top {formatMass(e.summary.topWeightKg, unitSystem)} × {e.summary.repsAtTopWeight}</>}</>}
                                      </span>
                                    </span>
                                    {e.status && <OverloadBadge status={e.status} />}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ol>
                  </details>
                ))}
              </div>
            </details>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">Workouts are grouped by each plan’s current program. Each exercise’s status compares that workout with your previous workout of the same exercise, on the same machine or none, as in Exercise progress.</p>
    </>
  );
}

/** Exercise progress: the original Progress page, unchanged (owner decision, UI-02). */
async function ExercisesView({ userId, timeZone, unitSystem }: { userId: string; timeZone: string; unitSystem: UnitSystem }) {
  const performed = await prisma.sessionExercise.findMany({
    where: { session: { userId, status: "COMPLETED" } },
    distinct: ["exerciseId"],
    select: { exercise: true },
  });
  // WT-03: sessions are counted in every context (a named machine or none); the latest result and its status come
  // from the most recent session's context only, so different machines' loads are never compared or combined.
  const overview = overviewByExercise(await getAllExerciseSessions(userId));

  const rows = performed
    .map(({ exercise }) => {
      const o = overview.get(exercise.id);
      const h = o?.history ?? [];
      const last = h.at(-1);
      const prevS = h.at(-2);
      const lastSum = last ? summarizeSets(last.sets) : null;
      return {
        exercise,
        context: o?.latestContext ?? null,
        sessions: o?.sessions ?? 0,
        lastDate: last?.date,
        lastSum,
        status: lastSum ? compareToPrevious(prevS ? summarizeSets(prevS.sets) : null, lastSum).status : null,
      };
    })
    .sort((a, b) => (b.lastDate?.getTime() ?? 0) - (a.lastDate?.getTime() ?? 0));

  return (
    <>
      {rows.length === 0 ? (
        noProgressYet
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <Link key={r.exercise.id} href={r.context ? `/progress/${r.exercise.id}?machine=${r.context}` : `/progress/${r.exercise.id}`} className="flex min-w-0 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 transition hover:border-accent/40">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.exercise.name}</p>
                <p className="num truncate text-xs text-muted">
                  {MUSCLE_LABELS[r.exercise.primaryMuscle]} · {r.sessions} session{r.sessions === 1 ? "" : "s"}
                  {r.lastSum && r.lastSum.topWeightKg > 0 && <> · top {formatMass(r.lastSum.topWeightKg, unitSystem)} × {r.lastSum.repsAtTopWeight}</>}
                  {r.lastDate && <> · {formatLocalDate(r.lastDate, timeZone)}</>}
                </p>
              </div>
              {r.status && <OverloadBadge status={r.status} />}
              <ChevronRight width={18} height={18} className="shrink-0 text-muted" />
            </Link>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-muted">Status compares each exercise’s latest session with the one before it: load first, then reps at that load, then total volume.</p>
    </>
  );
}
