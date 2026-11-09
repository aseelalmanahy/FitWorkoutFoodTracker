import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { requireProfile } from "@/lib/server/profile";
import { getSchedule, getWeekStats } from "@/lib/server/stats";
import { getPrograms } from "@/lib/server/programs";
import { localParts, formatLocalDate, WEEKDAYS_SHORT } from "@/lib/time";
import { formatDuration, formatVolume } from "@/lib/units";
import { summarizeSessions } from "@/lib/server/stats";
import { ButtonLink, Card, EmptyState, PageHeader, SectionTitle, cx } from "@/components/ui";
import { ChevronRight, PlusIcon } from "@/components/icons";
import { StartWorkoutButton } from "@/components/workouts/start-workout-button";
import { Page } from "@/components/page";
import { GymPicker } from "@/components/workouts/gym-picker";

export const metadata = { title: "Workouts" };

const days = (weekdays: number[]) => (weekdays.length ? weekdays.map((d) => WEEKDAYS_SHORT[d]).join(", ") : "Not scheduled");

/**
 * UI-01: the week, then the person's programs (each a group of workout days, shown once under its own name), then
 * individual plans, then recent workouts. Programs are what the person imported or grouped: nothing is grouped by
 * guessing from names. On a wide screen the week and recent workouts sit beside the plans.
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
      include: { exercises: { orderBy: { position: "asc" }, include: { exercise: { select: { name: true } } } }, slots: { select: { weekday: true }, orderBy: { weekday: "asc" } } },
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
  const nothing = singles.length === 0 && programs.length === 0;

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
        {/* This week */}
        <section className="min-w-0 lg:col-start-1 lg:row-start-1" aria-labelledby="week-title">
          <SectionTitle action={<Link href="/workouts/schedule" className="text-sm font-medium text-accent-ink">Edit</Link>}><span id="week-title">This week</span></SectionTitle>
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
                          {s.template.program && <span className="line-clamp-1 text-xs text-muted">{s.template.program.name}</span>}
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
        </section>

        {/* Programs and individual plans */}
        <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <section aria-labelledby="programs-title">
            <SectionTitle action={<span className="flex items-center gap-3"><Link href="/workouts/import" className="text-sm font-medium text-accent-ink" data-testid="import-link">Import</Link><Link href="/workouts/plans/new" className="flex items-center gap-1 text-sm font-medium text-accent-ink"><PlusIcon width={16} height={16} />New</Link></span>}>
              <span id="programs-title">My programs</span>
            </SectionTitle>
            {programs.length === 0 ? (
              <p className="text-sm text-muted" data-testid="programs-empty">An imported plan with several days is kept here as one program. {singles.length >= 2 && <Link href="/workouts/programs/new" className="font-medium text-accent-ink">Group plans into a program</Link>}</p>
            ) : (
              <div className="space-y-2" data-testid="programs">
                {programs.map((p) => {
                  const onSchedule = p.templates.filter((t) => t.slots.length > 0).length;
                  return (
                    <Card key={p.id} className="overflow-hidden" data-testid="program">
                      <details open={programs.length === 1} className="group">
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
                        <ol className="divide-y divide-line border-t border-line">
                          {p.templates.map((t, i) => (
                            <li key={t.id} className="flex items-center gap-3 px-4 py-3" data-testid="program-day">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold" aria-hidden>{i + 1}</span>
                              <span className="min-w-0 flex-1">
                                <span className="line-clamp-2 text-sm font-medium break-words" data-testid="program-day-name">{t.name}</span>
                                <span className="block truncate text-xs text-muted">{t.exercises.length} exercise{t.exercises.length === 1 ? "" : "s"} · {days(t.slots.map((s) => s.weekday))}</span>
                              </span>
                              <Link href={`/workouts/plans/${t.id}`} className="shrink-0 text-sm font-medium text-accent-ink" aria-label={`Edit ${t.name}`}>Edit</Link>
                              {!active && t.exercises.length > 0 && <StartWorkoutButton source={{ templateId: t.id }} variant="secondary" size="sm">Start</StartWorkoutButton>}
                            </li>
                          ))}
                        </ol>
                        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line px-4 py-3 text-sm font-medium">
                          <Link href={`/workouts/programs/${p.id}`} className="text-accent-ink" data-testid="program-view">View and rename</Link>
                          <Link href="/workouts/schedule" className="text-accent-ink">Schedule</Link>
                        </div>
                      </details>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          <section aria-labelledby="plans-title">
            <SectionTitle action={singles.length >= 2 && programs.length > 0 ? <Link href="/workouts/programs/new" className="text-sm font-medium text-accent-ink">Group into a program</Link> : undefined}>
              <span id="plans-title">Individual plans</span>
            </SectionTitle>
            {nothing ? (
              <EmptyState title="No workout plans yet" body="Create a plan like “Upper Body” with exercises, target sets, reps and weights, or import one." action={<ButtonLink href="/workouts/plans/new">Create a plan</ButtonLink>} />
            ) : singles.length === 0 ? (
              <p className="text-sm text-muted">Plans you make one at a time appear here.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-1" data-testid="plans">
                {singles.map((p) => (
                  <Card key={p.id} className="flex min-w-0 items-center gap-3 p-4" data-testid="plan">
                    <Link href={`/workouts/plans/${p.id}`} className="min-w-0 flex-1">
                      <p className="line-clamp-2 font-semibold break-words">{p.name}</p>
                      <p className="truncate text-sm text-muted">{p.exercises.length ? p.exercises.map((e) => e.exercise.name).join(" · ") : "No exercises"}</p>
                      {p.slots.length > 0 && <p className="text-xs text-muted">{days(p.slots.map((s) => s.weekday))}</p>}
                    </Link>
                    {!active && p.exercises.length > 0 && (
                      <StartWorkoutButton source={{ templateId: p.id }} variant="secondary" size="sm">Start</StartWorkoutButton>
                    )}
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
