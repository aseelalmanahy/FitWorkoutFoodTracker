import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { requireProfile } from "@/lib/server/profile";
import { summarizeSessions } from "@/lib/server/stats";
import { formatLocalDate } from "@/lib/time";
import { formatDuration, formatVolume } from "@/lib/units";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { ChevronRight } from "@/components/icons";

export const metadata = { title: "Workout history" };
const PAGE = 25;

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { user, profile } = await requireProfile();
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const [sessions, total] = await Promise.all([
    prisma.workoutSession.findMany({
      where: { userId: user.id, status: "COMPLETED" },
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { exercises: { orderBy: { position: "asc" }, include: { sets: true, exercise: { select: { name: true } } } } },
    }),
    prisma.workoutSession.count({ where: { userId: user.id, status: "COMPLETED" } }),
  ]);
  const tz = profile.timezone;

  // Group by local month for scannability.
  const groups = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const k = formatLocalDate(s.startedAt, tz, { month: "long", year: "numeric" });
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }

  return (
    <>
      <PageHeader title="History" subtitle={`${total} completed workout${total === 1 ? "" : "s"}`} back="/workouts" />
      {total === 0 ? (
        <EmptyState title="No workouts yet" body="Finish a workout and it will show up here." action={<ButtonLink href="/workouts">Go to workouts</ButtonLink>} />
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
                      <p className="num mt-0.5 text-xs text-muted">{sum.sets} sets · {formatVolume(sum.volumeKg, profile.unitSystem)} · {formatDuration(sum.seconds)}</p>
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
          {page > 1 ? <ButtonLink href={`?page=${page - 1}`} variant="secondary" size="sm">Newer</ButtonLink> : <span />}
          {page * PAGE < total && <ButtonLink href={`?page=${page + 1}`} variant="secondary" size="sm">Older</ButtonLink>}
        </div>
      )}
    </>
  );
}
