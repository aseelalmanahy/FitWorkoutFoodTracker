import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { requireProfile } from "@/lib/server/profile";
import { getSchedule, getWeekStats } from "@/lib/server/stats";
import { localParts, formatLocalDate, WEEKDAYS_SHORT } from "@/lib/time";
import { formatDuration, formatVolume } from "@/lib/units";
import { summarizeSessions } from "@/lib/server/stats";
import { ButtonLink, Card, EmptyState, PageHeader, SectionTitle, cx } from "@/components/ui";
import { ChevronRight, PlusIcon } from "@/components/icons";
import { StartWorkoutButton } from "@/components/workouts/start-workout-button";
import { Page } from "@/components/page";

export const metadata = { title: "Workouts" };

export default async function WorkoutsPage() {
  const { user, profile } = await requireProfile();
  const tz = profile.timezone;
  const today = localParts(new Date(), tz).weekday;
  const [active, plans, schedule, week, recent] = await Promise.all([
    prisma.workoutSession.findFirst({ where: { userId: user.id, status: "IN_PROGRESS" } }),
    prisma.workoutTemplate.findMany({
      where: { userId: user.id },
      orderBy: { name: "asc" },
      include: { exercises: { orderBy: { position: "asc" }, include: { exercise: { select: { name: true } } } } },
    }),
    getSchedule(user.id),
    getWeekStats(user.id, tz),
    prisma.workoutSession.findMany({
      where: { userId: user.id, status: "COMPLETED" },
      orderBy: { startedAt: "desc" },
      take: 5,
      include: { exercises: { include: { sets: true } } },
    }),
  ]);

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

      <div className="grid gap-x-8 lg:grid-cols-2 lg:items-start">
      <div className="min-w-0">
      <SectionTitle action={<Link href="/workouts/schedule" className="text-sm font-medium text-accent-ink">Edit</Link>}>This week</SectionTitle>
      <Card className="divide-y divide-line">
        {schedule.map((slots, d) => {
          const done = week.completedDays.has(d);
          return (
            <div key={d} className={cx("flex items-center gap-3 px-4 py-3", d === today && "bg-surface-2/60")}>
              <span className={cx("w-10 text-sm font-semibold", d === today ? "text-fg" : "text-muted")}>{WEEKDAYS_SHORT[d]}</span>
              <div className="min-w-0 flex-1">
                {slots.length === 0 ? (
                  <span className="text-sm text-muted">Rest</span>
                ) : (
                  slots.map((s) => <p key={s.id} className="truncate text-sm font-medium">{s.template.name}</p>)
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

      </div>
      <div className="min-w-0">
      <SectionTitle action={<Link href="/workouts/plans/new" className="flex items-center gap-1 text-sm font-medium text-accent-ink"><PlusIcon width={16} height={16} />New</Link>}>My plans</SectionTitle>
      {plans.length === 0 ? (
        <EmptyState title="No workout plans yet" body="Create a plan like “Upper Body” with exercises, target sets, reps and weights." action={<ButtonLink href="/workouts/plans/new">Create a plan</ButtonLink>} />
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-1">
          {plans.map((p) => (
            <Card key={p.id} className="flex min-w-0 items-center gap-3 p-4">
              <Link href={`/workouts/plans/${p.id}`} className="min-w-0 flex-1">
                <p className="font-semibold break-words">{p.name}</p>
                <p className="truncate text-sm text-muted">{p.exercises.length ? p.exercises.map((e) => e.exercise.name).join(" · ") : "No exercises"}</p>
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

      <SectionTitle action={<Link href="/workouts/history" className="text-sm font-medium text-accent-ink">All</Link>}>Recent</SectionTitle>
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
                <ChevronRight width={18} height={18} className="text-muted" />
              </Link>
            );
          })}
        </Card>
      )}
      </div>
      </div>
    </Page>
  );
}
