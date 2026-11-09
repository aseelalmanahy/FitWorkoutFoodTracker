import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { requireProfile } from "@/lib/server/profile";
import { getSchedule, getWeekStats } from "@/lib/server/stats";
import { getExerciseHistories } from "@/lib/server/workouts";
import { computeRecords, RECORD_LABELS } from "@/lib/overload";
import { formatLocalDate, localParts, WEEKDAYS_SHORT } from "@/lib/time";
import { formatDuration, formatVolume } from "@/lib/units";
import { ButtonLink, Card, SectionTitle, Stat, cx } from "@/components/ui";
import { ChevronRight } from "@/components/icons";
import { PrBadge } from "@/components/overload-badge";
import { StartWorkoutButton } from "@/components/workouts/start-workout-button";
import { GoalCard } from "@/components/progress/goal-card";
import { Page } from "@/components/page";
import { goalProgress } from "@/lib/goal-progress";
import { getWeightEntries } from "@/lib/server/weight";
import { weightTrend } from "@/lib/weight-trend";

export const metadata = { title: "Today" };

function Ring({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const r = 34, c = 2 * Math.PI * r;
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden>
      <circle cx="42" cy="42" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="9" />
      <circle cx="42" cy="42" r={r} fill="none" stroke="var(--chart-1)" strokeWidth="9" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 42 42)" />
    </svg>
  );
}

export default async function DashboardPage() {
  const { user, profile } = await requireProfile();
  const tz = profile.timezone;
  const now = new Date();
  const today = localParts(now, tz).weekday;
  const [active, schedule, week, recentSessions, weightEntries] = await Promise.all([
    prisma.workoutSession.findFirst({ where: { userId: user.id, status: "IN_PROGRESS" } }),
    getSchedule(user.id),
    getWeekStats(user.id, tz, now),
    prisma.workoutSession.findMany({
      where: { userId: user.id, status: "COMPLETED", startedAt: { gte: new Date(now.getTime() - 30 * 86400000) } },
      select: { id: true, name: true, startedAt: true, exercises: { select: { exerciseId: true, exercise: { select: { name: true } } } } },
      orderBy: { startedAt: "desc" },
    }),
    getWeightEntries(user.id),
  ]);

  // Personal records set in the last 30 days.
  const exIds = [...new Set(recentSessions.flatMap((s) => s.exercises.map((e) => e.exerciseId)))];
  const histories = await getExerciseHistories(user.id, exIds);
  const recentIds = new Set(recentSessions.map((s) => s.id));
  const names = new Map(recentSessions.flatMap((s) => s.exercises.map((e) => [e.exerciseId, e.exercise.name] as const)));
  const recentPrs: { exercise: string; exerciseId: string; kinds: string[]; date: Date }[] = [];
  for (const id of exIds) {
    const h = histories.get(id) ?? [];
    const { prsBySession } = computeRecords(h);
    for (const [sid, kinds] of prsBySession) {
      if (recentIds.has(sid)) recentPrs.push({ exercise: names.get(id)!, exerciseId: id, kinds: kinds.map((k) => RECORD_LABELS[k]), date: h.find((x) => x.sessionId === sid)!.date });
    }
  }
  recentPrs.sort((a, b) => b.date.getTime() - a.date.getTime());
  // WT-08: the card lists each exercise once, at its latest record; the goal card still counts every record.
  const shownPrs = recentPrs.filter((p, i) => recentPrs.findIndex((q) => q.exerciseId === p.exerciseId) === i);

  const todaySlots = schedule[today];
  const doneToday = week.completedDays.has(today);
  const plannedThroughToday = schedule.slice(0, today + 1).flat().length;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <Page width="wide">
      <header className="pt-6 pb-4 lg:pt-10 lg:pb-6">
        <p className="text-sm text-muted">{formatLocalDate(now, tz, { weekday: "long", month: "long", day: "numeric" })}</p>
        <h1 className="text-[28px] font-bold tracking-tight lg:text-[34px]">{greeting}, {profile.name.split(" ")[0]}</h1>
      </header>

      <div className="grid gap-x-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
      <div className="min-w-0">

      {/* Today */}
      <h2 className="mb-2 hidden text-xs font-semibold uppercase tracking-wider text-muted lg:mt-6 lg:block">Today</h2>
      {active ? (
        <Link href={`/workouts/session/${active.id}`} className="flex items-center justify-between rounded-3xl bg-accent p-5 text-accent-fg">
          <span>
            <span className="block text-xs font-semibold uppercase tracking-wide opacity-70">In progress</span>
            <span className="text-xl font-bold">{active.name}</span>
          </span>
          <span className="flex items-center gap-1 font-semibold">Resume <ChevronRight width={18} height={18} /></span>
        </Link>
      ) : todaySlots.length > 0 ? (
        <Card className="rounded-3xl p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Today’s workout</p>
          <p className="mt-1 text-xl font-bold">{[...new Set(todaySlots.map((s) => s.template.name))].join(" + ")}</p>
          <p className="text-sm text-muted">{todaySlots[0].template._count.exercises} exercises</p>
          {doneToday ? (
            <p className="mt-4 rounded-xl bg-up/12 px-3 py-2 text-sm font-semibold text-up">Completed today</p>
          ) : (
            <StartWorkoutButton source={{ templateId: todaySlots[0].template.id }} size="lg" className="mt-4 w-full">Start workout</StartWorkoutButton>
          )}
        </Card>
      ) : (
        <Card className="rounded-3xl p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Today</p>
          <p className="mt-1 text-xl font-bold">{doneToday ? "Workout logged" : "Rest day"}</p>
          <p className="text-sm text-muted">{schedule.every((d) => d.length === 0) ? "Set up a weekly schedule to see planned workouts here." : "Recovery is part of the plan."}</p>
          <div className="mt-4 flex gap-2">
            {schedule.every((d) => d.length === 0) && <ButtonLink href="/workouts/schedule" variant="secondary">Plan my week</ButtonLink>}
            <StartWorkoutButton source={{ name: "Workout" }} variant="ghost">Log a workout anyway</StartWorkoutButton>
          </div>
        </Card>
      )}

      {/* Week */}
      <SectionTitle>This week</SectionTitle>
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Ring value={week.workouts} max={week.planned} />
            <span className="num absolute inset-0 grid place-items-center text-lg font-bold">
              {week.planned > 0 ? `${Math.round(Math.min(1, week.workouts / week.planned) * 100)}%` : week.workouts}
            </span>
          </div>
          <div>
            <p className="num text-2xl font-bold">{week.workouts}<span className="text-base font-medium text-muted"> / {week.planned} workouts</span></p>
            <p className="text-sm text-muted">{week.planned ? `${plannedThroughToday} planned through today` : "No schedule set"}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-7 gap-1">
          {WEEKDAYS_SHORT.map((d, i) => {
            const planned = schedule[i].length > 0, done = week.completedDays.has(i);
            return (
              <div key={d} className="text-center">
                <div className={cx("mx-auto grid h-8 w-8 place-items-center rounded-full text-xs font-bold",
                  done ? "bg-accent text-accent-fg" : planned ? (i < today ? "border-2 border-down/50 text-muted" : "border-2 border-line text-muted") : "text-muted/50",
                  i === today && !done && "ring-2 ring-fg/30")}>{d[0]}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4">
          <Stat label="Sets" value={week.sets} />
          <Stat label="Volume" value={formatVolume(week.volumeKg, profile.unitSystem)} />
          <Stat label="Time" value={formatDuration(week.seconds)} />
        </div>
      </Card>

      </div>

      <div className="min-w-0 md:grid md:grid-cols-2 md:gap-x-6 lg:block">
      <div className="min-w-0">
      {/* Goal */}
      <SectionTitle>Goal</SectionTitle>
      <GoalCard progress={goalProgress({ goal: profile.goal, goalWeightKg: profile.goalWeightKg, trend: weightTrend(weightEntries), recentRecords: recentPrs.length })} units={profile.unitSystem} />

      </div>
      <div className="min-w-0">
      {/* PRs */}
      <SectionTitle action={<Link href="/progress" className="text-sm font-medium text-accent-ink">Progress</Link>}>Recent PRs</SectionTitle>
      {recentPrs.length === 0 ? (
        <p className="text-sm text-muted">No new records in the last 30 days. Records are flagged when you beat a previous best.</p>
      ) : (
        <Card className="divide-y divide-line">
          {shownPrs.slice(0, 6).map((p, i) => (
            <Link key={i} href={`/progress/${p.exerciseId}`} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">{p.exercise}</span>
                <span className="text-xs text-muted">{p.kinds.join(" · ")} · {formatLocalDate(p.date, tz)}</span>
              </span>
              <PrBadge />
            </Link>
          ))}
        </Card>
      )}
      </div>
      </div>
      </div>
    </Page>
  );
}
