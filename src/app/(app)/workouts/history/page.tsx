import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { requireProfile } from "@/lib/server/profile";
import { summarizeSessions } from "@/lib/server/stats";
import { formatLocalDate } from "@/lib/time";
import { formatDuration, formatVolume } from "@/lib/units";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { ChevronRight } from "@/components/icons";
import { Page } from "@/components/page";

export const metadata = { title: "Workout history" };
const PAGE = 25;

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ page?: string; gym?: string }> }) {
  const { user, profile } = await requireProfile();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  // Multi-gym: filter by one of this person's gyms. Workouts with no gym, including all from before gyms, aren't at any.
  const gyms = await prisma.gymLocation.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const gym = params.gym ? gyms.find((g) => g.id === params.gym) ?? null : null;
  const where = { userId: user.id, status: "COMPLETED" as const, ...(gym ? { gymLocationId: gym.id } : {}) };
  const qs = (n: number) => `?${new URLSearchParams({ ...(gym ? { gym: gym.id } : {}), page: String(n) })}`;
  const [sessions, total] = await Promise.all([
    prisma.workoutSession.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { gym: { select: { name: true } }, exercises: { orderBy: { position: "asc" }, include: { sets: true, exercise: { select: { name: true } } } } },
    }),
    prisma.workoutSession.count({ where }),
  ]);
  const tz = profile.timezone;

  // Group by local month for scannability.
  const groups = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const k = formatLocalDate(s.startedAt, tz, { month: "long", year: "numeric" });
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }

  return (
    <Page width="medium">
      <PageHeader title="History" subtitle={`${total} completed workout${total === 1 ? "" : "s"}${gym ? ` at ${gym.name}` : ""}`} back="/workouts" />
      {gyms.length > 0 && (
        <nav aria-label="Filter by gym" className="mb-4 flex flex-wrap gap-1.5" data-testid="history-gym-filter">
          <Link href="/workouts/history" aria-current={!gym ? "page" : undefined} className={`rounded-full border px-3 py-1 text-xs ${!gym ? "border-accent bg-accent-soft font-semibold" : "border-line"}`}>All</Link>
          {gyms.map((g) => (
            <Link key={g.id} href={`/workouts/history?gym=${g.id}`} aria-current={gym?.id === g.id ? "page" : undefined} className={`rounded-full border px-3 py-1 text-xs ${gym?.id === g.id ? "border-accent bg-accent-soft font-semibold" : "border-line"}`}>{g.name}</Link>
          ))}
        </nav>
      )}
      {total === 0 ? (
        gym ? <EmptyState title={`No workouts at ${gym.name} yet`} body="Choose this gym in a workout and it will show up here." />
        : <EmptyState title="No workouts yet" body="Finish a workout and it will show up here." action={<ButtonLink href="/workouts">Go to workouts</ButtonLink>} />
      ) : (
        [...groups.entries()].map(([month, list]) => (
          <section key={month} className="mb-5">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{month}</h2>
            <Card className="divide-y divide-line">
              {list.map((s) => {
                const sum = summarizeSessions([s]);
                return (
                  <Link key={s.id} href={`/workouts/history/${s.id}`} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-11 shrink-0 text-center">
                      <p className="text-[11px] font-semibold uppercase text-muted">{formatLocalDate(s.startedAt, tz, { weekday: "short" })}</p>
                      <p className="num text-lg font-bold leading-none">{formatLocalDate(s.startedAt, tz, { day: "numeric" })}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{s.name}</p>
                      <p className="truncate text-xs text-muted">{s.exercises.map((e) => e.exercise.name).join(" · ")}</p>
                      <p className="num mt-0.5 text-xs text-muted">{sum.sets} sets · {formatVolume(sum.volumeKg, profile.unitSystem)} · {formatDuration(sum.seconds)}{s.gym && <> · {s.gym.name}</>}</p>
                    </div>
                    <ChevronRight width={18} height={18} className="shrink-0 text-muted" />
                  </Link>
                );
              })}
            </Card>
          </section>
        ))
      )}
      {total > PAGE && (
        <div className="flex justify-between">
          {page > 1 ? <ButtonLink href={qs(page - 1)} variant="secondary" size="sm">Newer</ButtonLink> : <span />}
          {page * PAGE < total && <ButtonLink href={qs(page + 1)} variant="secondary" size="sm">Older</ButtonLink>}
        </div>
      )}
    </Page>
  );
}
