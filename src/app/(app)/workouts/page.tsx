import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { requireProfile } from "@/lib/server/profile";
import { getSchedule, getWeekStats } from "@/lib/server/stats";
import { getPrograms } from "@/lib/server/programs";
import { scheduleExceptions } from "@/lib/active-program";
import { ScheduleExceptionsNotice } from "@/components/workouts/schedule-exceptions";
import { localParts, formatLocalDate, WEEKDAYS_SHORT } from "@/lib/time";
import { formatDuration, formatVolume } from "@/lib/units";
import { summarizeSessions } from "@/lib/server/stats";
import { ButtonLink, Card, EmptyState, PageHeader, SectionTitle, cx } from "@/components/ui";
import { ChevronRight, PlusIcon } from "@/components/icons";
import { StartWorkoutButton } from "@/components/workouts/start-workout-button";
import { DeletePlanButton, DeleteProgramButton } from "@/components/workouts/manage-actions";
import { Page } from "@/components/page";
import { GymPicker } from "@/components/workouts/gym-picker";

export const metadata = { title: "Workouts" };

const days = (weekdays: number[]) => (weekdays.length ? weekdays.map((d) => WEEKDAYS_SHORT[d]).join(", ") : "Not scheduled");

type Program = Awaited<ReturnType<typeof getPrograms>>[number];
type Plan = Program["templates"][number];

/**
 * The week, then (UI-06) the active program, the other saved programs and individual plans, then recent workouts.
 * Only the person chooses the active program; until they do, a one-time choice is offered. UI-05: every program and
 * plan has visible management actions, and every deletion is confirmed with what it changes and what it keeps.
 */
export default async function WorkoutsPage() {
  const { user, profile } = await requireProfile();
  const tz = profile.timezone;
  const today = localParts(new Date(), tz).weekday;
  const [active, singles, programs, schedule, week, recent, gyms] = await Promise.all([
    prisma.workoutSession.findFirst({ where: { userId: user.id, status: "IN_PROGRESS" } }),
    prisma.workoutTemplate.findMany({
      where: { userId: user.id, programId: null },
      orderBy: { name: "asc" },
      include: { exercises: { orderBy: { position: "asc" }, include: { exercise: { select: { name: true } } } }, slots: { select: { weekday: true }, orderBy: { weekday: "asc" } }, _count: { select: { sessions: { where: { status: "COMPLETED" } } } } },
    }),
    getPrograms(user.id),
    getSchedule(user.id),
    getWeekStats(user.id, tz),
    prisma.workoutSession.findMany({
      where: { userId: user.id, status: "COMPLETED" },
      orderBy: { startedAt: "desc" },
      take: 5,
      include: { exercises: { include: { sets: true } } },
    }),
    prisma.gymLocation.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const activeProgram = programs.find((p) => p.id === profile.activeProgramId) ?? null;
  const others = programs.filter((p) => p.id !== activeProgram?.id);
  const nothing = singles.length === 0 && programs.length === 0;
  // UI-06B: scheduled workouts outside the active program, shown the same way on Workouts, Today, the schedule and the program.
  const exceptions = scheduleExceptions(schedule, activeProgram?.id ?? null);
  const outside = exceptions.reduce((n, x) => n + x.weekdays.length, 0);

  const planActions = (t: { id: string; name: string; slots: { weekday: number }[]; _count: { sessions: number } }, startable: boolean) => (
    <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-1 gap-y-1">
      {!active && startable && <StartWorkoutButton source={{ templateId: t.id }} variant="secondary" size="sm">Start</StartWorkoutButton>}
      <ButtonLink href={`/workouts/plans/${t.id}`} variant="ghost" size="sm" aria-label={`Edit ${t.name}`} data-testid="plan-edit">Edit</ButtonLink>
      <DeletePlanButton id={t.id} name={t.name} scheduledDays={t.slots.map((s) => WEEKDAYS_SHORT[s.weekday])} workouts={t._count.sessions} inProgress={active?.templateId === t.id} />
    </span>
  );

  const dayList = (p: Program) => (
    <ol className="divide-y divide-line border-t border-line">
      {p.templates.map((t: Plan, i) => (
        <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3" data-testid="program-day">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold" aria-hidden>{i + 1}</span>
          <span className="min-w-0 flex-1 basis-40">
            <span className="line-clamp-2 text-sm font-medium break-words" data-testid="program-day-name">{t.name}</span>
            <span className="block truncate text-xs text-muted">{t.exercises.length} exercise{t.exercises.length === 1 ? "" : "s"} · {days(t.slots.map((s) => s.weekday))}</span>
          </span>
          {planActions(t, t.exercises.length > 0)}
        </li>
      ))}
    </ol>
  );

  return (
    <Page width="wide">
      <PageHeader title="Workouts" action={<ButtonLink href="/workouts/history" variant="secondary" size="sm">History</ButtonLink>} />

      {active && (
        <Link href={`/workouts/session/${active.id}`} className="mb-4 flex items-center justify-between rounded-2xl bg-accent px-4 py-3.5 text-accent-fg">
          <span>
            <span className="block text-xs font-semibold uppercase tracking-wide opacity-70">In progress</span>
            <span className="font-bold">{active.name}</span>
          </span>
          <span className="flex items-center gap-1 text-sm font-semibold">Resume <ChevronRight width={18} height={18} /></span>
        </Link>
      )}

      {!active && <GymPicker gyms={gyms} />}

      {/* The first row is only as tall as the week, so recent workouts sit right under it beside the taller plan column. */}
      <div className="grid gap-x-8 lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:items-start">
        {/* This week: the schedule, which the active program sets */}
        <section className="min-w-0 lg:col-start-1 lg:row-start-1" aria-labelledby="week-title">
          <SectionTitle action={<Link href="/workouts/schedule" className="text-sm font-medium text-accent-ink">Edit schedule</Link>}><span id="week-title">This week</span></SectionTitle>
          <p className="-mt-1 mb-2 text-xs text-muted" data-testid="week-program">{activeProgram ? <>From your active program, <strong className="text-fg">{activeProgram.name}</strong>{outside ? `, with ${outside} exception${outside === 1 ? "" : "s"} outside it` : ""}</> : "No active program chosen"}</p>
          <Card className="divide-y divide-line" data-testid="week">
            {schedule.map((slots, d) => {
              const done = week.completedDays.has(d);
              return (
                <div key={d} className={cx("flex items-center gap-3 px-4 py-3", d === today && "bg-surface-2/60")}>
                  <span className={cx("w-10 shrink-0 text-sm font-semibold", d === today ? "text-fg" : "text-muted")}>{WEEKDAYS_SHORT[d]}</span>
                  <div className="min-w-0 flex-1">
                    {slots.length === 0 ? (
                      <span className="text-sm text-muted">Rest</span>
                    ) : (
                      slots.map((s) => (
                        <p key={s.id} className="min-w-0 text-sm">
                          <span className="line-clamp-1 font-medium">{s.template.name}</span>
                          {activeProgram && s.template.programId !== activeProgram.id
                            ? <span className="line-clamp-1 text-xs font-medium text-muted" data-testid="week-outside"><span className="rounded bg-surface-2 px-1 py-px text-fg">Exception</span> not in your active program{s.template.program ? ` (${s.template.program.name})` : ""}</span>
                            : s.template.program && !activeProgram && <span className="line-clamp-1 text-xs text-muted">{s.template.program.name}</span>}
                        </p>
                      ))
                    )}
                  </div>
                  {done && <span className="rounded-full bg-up/12 px-2 py-0.5 text-xs font-semibold text-up">Done</span>}
                  {d === today && slots[0] && !active && !done && (
                    <StartWorkoutButton source={{ templateId: slots[0].template.id }} size="sm">Start</StartWorkoutButton>
                  )}
                </div>
              );
            })}
          </Card>
          {activeProgram && <ScheduleExceptionsNotice exceptions={exceptions} program={{ id: activeProgram.id, name: activeProgram.name }} />}
        </section>

        <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {/* UI-06: the active program */}
          <section aria-labelledby="active-title">
            <SectionTitle action={<span className="flex items-center gap-3"><Link href="/workouts/import" className="text-sm font-medium text-accent-ink" data-testid="import-link">Import</Link><Link href="/workouts/plans/new" className="flex items-center gap-1 text-sm font-medium text-accent-ink"><PlusIcon width={16} height={16} />New plan</Link></span>}>
              <span id="active-title">Active program</span>
            </SectionTitle>
            {activeProgram ? (
              <Card className="overflow-hidden border-accent/40" data-testid="active-program">
                <div className="flex flex-wrap items-start gap-3 p-4">
                  <span className="min-w-0 flex-1 basis-48">
                    <span className="mb-1 inline-block rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-ink">Active</span>
                    <span className="line-clamp-2 block font-semibold break-words" data-testid="program-name">{activeProgram.name}</span>
                    <span className="mt-0.5 block text-xs text-muted">{activeProgram.templates.length} workout day{activeProgram.templates.length === 1 ? "" : "s"} · it sets your weekly schedule</span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    <ButtonLink href={`/workouts/programs/${activeProgram.id}`} variant="secondary" size="sm" data-testid="program-view">Manage</ButtonLink>
                    <DeleteProgramButton id={activeProgram.id} name={activeProgram.name} plans={activeProgram.templates.length} active />
                  </span>
                </div>
                {dayList(activeProgram)}
              </Card>
            ) : programs.length > 0 ? (
              <Card className="p-4" data-testid="choose-active">
                <p className="font-semibold">Choose your active program</p>
                <p className="mt-1 text-sm text-muted">One program sets your weekly schedule. Use <strong className="text-fg">Set as active</strong> on one of your programs below: you&apos;ll see the schedule it would make, and confirm it, before anything changes. Until then your schedule stays as it is.</p>
              </Card>
            ) : (
              <p className="text-sm text-muted" data-testid="programs-empty">An imported plan with several days is kept as a program, which you can make active. {singles.length >= 2 && <Link href="/workouts/programs/new" className="font-medium text-accent-ink">Group plans into a program</Link>}</p>
            )}
          </section>

          {/* Other saved programs */}
          {activeProgram && others.length > 0 || (!activeProgram && programs.length > 0) ? (
            <section aria-labelledby="programs-title">
              <SectionTitle><span id="programs-title">{activeProgram ? "Other programs" : "My programs"}</span></SectionTitle>
              <div className="space-y-2" data-testid="programs">
                {(activeProgram ? others : programs).map((p) => {
                  const onSchedule = p.templates.filter((t) => t.slots.length > 0).length;
                  return (
                    <Card key={p.id} className="overflow-hidden" data-testid="program">
                      <details className="group">
                        <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 font-semibold break-words" data-testid="program-name">{p.name}</span>
                            <span className="mt-0.5 block text-xs text-muted" data-testid="program-meta">
                              {p.templates.length} workout day{p.templates.length === 1 ? "" : "s"}
                              {p.origin === "import" ? " · Imported" : ""}
                              {" · "}{onSchedule === 0 ? "Not on your schedule" : `${onSchedule} of ${p.templates.length} on your schedule`}
                            </span>
                          </span>
                          <ChevronRight width={18} height={18} className="shrink-0 text-muted transition group-open:rotate-90" aria-hidden />
                        </summary>
                        {dayList(p)}
                      </details>
                      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 text-sm">
                        <ButtonLink href={`/workouts/programs/${p.id}/activate`} size="sm" data-testid="set-active">Set as active</ButtonLink>
                        <ButtonLink href={`/workouts/programs/${p.id}`} variant="secondary" size="sm" data-testid="program-view">Manage</ButtonLink>
                        <DeleteProgramButton id={p.id} name={p.name} plans={p.templates.length} active={false} />
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section aria-labelledby="plans-title">
            <SectionTitle action={singles.length >= 2 ? <Link href="/workouts/programs/new" className="text-sm font-medium text-accent-ink">Group into a program</Link> : undefined}>
              <span id="plans-title">Individual plans</span>
            </SectionTitle>
            {nothing ? (
              <EmptyState title="No workout plans yet" body="Create a plan like “Upper Body” with exercises, target sets, reps and weights, or import one." action={<ButtonLink href="/workouts/plans/new">Create a plan</ButtonLink>} />
            ) : singles.length === 0 ? (
              <p className="text-sm text-muted">Plans you make one at a time appear here.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-1" data-testid="plans">
                {singles.map((p) => (
                  <Card key={p.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 p-4" data-testid="plan">
                    <Link href={`/workouts/plans/${p.id}`} className="min-w-0 flex-1 basis-48">
                      <p className="line-clamp-2 font-semibold break-words">{p.name}</p>
                      <p className="truncate text-sm text-muted">{p.exercises.length ? p.exercises.map((e) => e.exercise.name).join(" · ") : "No exercises"}</p>
                      {p.slots.length > 0 && <p className="text-xs text-muted">{days(p.slots.map((s) => s.weekday))}</p>}
                    </Link>
                    {planActions(p, p.exercises.length > 0)}
                  </Card>
                ))}
              </div>
            )}
            {!active && (
              <div className="mt-3">
                <StartWorkoutButton source={{ name: "Workout" }} variant="ghost" className="w-full">Start an empty workout</StartWorkoutButton>
              </div>
            )}
          </section>
        </div>

        {/* Recent workouts: history, apart from planning */}
        <section className="min-w-0 lg:col-start-1 lg:row-start-2" aria-labelledby="recent-title">
          <SectionTitle action={<Link href="/workouts/history" className="text-sm font-medium text-accent-ink">All</Link>}><span id="recent-title">Recent workouts</span></SectionTitle>
          {recent.length === 0 ? (
            <p className="text-sm text-muted">Completed workouts will appear here.</p>
          ) : (
            <Card className="divide-y divide-line">
              {recent.map((s) => {
                const sum = summarizeSessions([s]);
                return (
                  <Link key={s.id} href={`/workouts/history/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{s.name}</span>
                      <span className="text-xs text-muted">{formatLocalDate(s.startedAt, tz)} · {sum.sets} sets · {formatVolume(sum.volumeKg, profile.unitSystem)} · {formatDuration(sum.seconds)}</span>
                    </span>
                    <ChevronRight width={18} height={18} className="shrink-0 text-muted" />
                  </Link>
                );
              })}
            </Card>
          )}
        </section>
      </div>
    </Page>
  );
}
