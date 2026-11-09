import "server-only";
import { prisma } from "./db";
import { localParts, localWeekRange } from "@/lib/time";
import { summarizeSets } from "@/lib/overload";

export async function getSchedule(userId: string) {
  const slots = await prisma.scheduleSlot.findMany({
    where: { userId },
    orderBy: [{ weekday: "asc" }, { position: "asc" }],
    include: { template: { select: { id: true, name: true, programId: true, program: { select: { name: true } }, _count: { select: { exercises: true } } } } },
  });
  const days: (typeof slots)[] = Array.from({ length: 7 }, () => []);
  for (const s of slots) days[s.weekday].push(s);
  return days;
}

/** Summary metrics for a list of completed sessions. */
export function summarizeSessions(
  sessions: { startedAt: Date; endedAt: Date | null; exercises: { sets: { reps: number; weightKg: number; isWarmup: boolean }[] }[] }[],
) {
  let sets = 0, volumeKg = 0, seconds = 0;
  for (const s of sessions) {
    if (s.endedAt) seconds += (s.endedAt.getTime() - s.startedAt.getTime()) / 1000;
    for (const e of s.exercises) {
      const sum = summarizeSets(e.sets);
      sets += sum.workingSets;
      volumeKg += sum.volumeKg;
    }
  }
  return { workouts: sessions.length, sets, volumeKg, seconds };
}

export async function getWeekStats(userId: string, timeZone: string, now = new Date()) {
  const { start, end } = localWeekRange(now, timeZone);
  const [sessions, plannedCount] = await Promise.all([
    prisma.workoutSession.findMany({
      where: { userId, status: "COMPLETED", startedAt: { gte: start, lt: end } },
      include: { exercises: { include: { sets: true } } },
      orderBy: { startedAt: "asc" },
    }),
    prisma.scheduleSlot.count({ where: { userId } }),
  ]);
  const completedDays = new Set(sessions.map((s) => localParts(s.startedAt, timeZone).weekday));
  return { start, end, planned: plannedCount, completedDays, ...summarizeSessions(sessions) };
}
