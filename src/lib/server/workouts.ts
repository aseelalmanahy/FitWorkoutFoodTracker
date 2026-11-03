import "server-only";
import { prisma } from "./db";
import { HttpError, notFound } from "./api";
import type { SetEntry } from "@prisma/client";
import type { SessionPerformance } from "@/lib/overload";

export interface PreviousPerformance {
  sessionId: string;
  date: Date;
  sets: SetEntry[];
}

export const visibleExercises = (userId: string) => ({ OR: [{ userId: null }, { userId }] });

export async function assertExercisesVisible(userId: string, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const count = await prisma.exercise.count({ where: { id: { in: unique }, ...visibleExercises(userId) } });
  if (count !== unique.length) throw new HttpError(400, "One or more exercises are unknown");
}

export async function getOwnedSession(userId: string, sessionId: string) {
  const s = await prisma.workoutSession.findFirst({ where: { id: sessionId, userId } });
  if (!s) throw notFound("Workout");
  return s;
}

export async function getOwnedSessionExercise(userId: string, sessionId: string, seId: string) {
  const se = await prisma.sessionExercise.findFirst({
    where: { id: seId, sessionId, session: { userId } },
    include: { session: true },
  });
  if (!se) throw notFound("Exercise entry");
  return se;
}

export const templateInclude = {
  exercises: { orderBy: { position: "asc" as const }, include: { exercise: true } },
};

export const sessionDetailInclude = {
  exercises: {
    orderBy: { position: "asc" as const },
    include: {
      exercise: true,
      sets: { orderBy: { setNumber: "asc" as const } },
    },
  },
  template: { include: { exercises: true } },
};

export async function getSessionDetail(userId: string, sessionId: string) {
  return prisma.workoutSession.findFirst({ where: { id: sessionId, userId }, include: sessionDetailInclude });
}

/**
 * Most recent completed performance of each exercise, excluding a session.
 * Returns exerciseId → performance.
 */
export async function getPreviousPerformances(
  userId: string,
  exerciseIds: string[],
  opts: { excludeSessionId?: string; before?: Date } = {},
): Promise<Map<string, PreviousPerformance>> {
  const result = new Map<string, PreviousPerformance>();
  if (!exerciseIds.length) return result;
  const rows = await prisma.sessionExercise.findMany({
    where: {
      exerciseId: { in: exerciseIds },
      sets: { some: { isWarmup: false } },
      session: {
        userId,
        status: "COMPLETED",
        ...(opts.excludeSessionId ? { id: { not: opts.excludeSessionId } } : {}),
        ...(opts.before ? { startedAt: { lt: opts.before } } : {}),
      },
    },
    orderBy: [{ session: { startedAt: "desc" } }, { position: "asc" }],
    distinct: ["exerciseId"],
    include: { session: { select: { id: true, startedAt: true } }, sets: { orderBy: { setNumber: "asc" } } },
  });
  for (const r of rows) {
    result.set(r.exerciseId, { sessionId: r.session.id, date: r.session.startedAt, sets: r.sets });
  }
  return result;
}

/** All completed sessions containing each exercise, oldest first (sets merged per session). */
export async function getExerciseHistories(userId: string, exerciseIds: string[]): Promise<Map<string, SessionPerformance[]>> {
  const rows = await prisma.sessionExercise.findMany({
    where: { exerciseId: { in: exerciseIds }, session: { userId, status: "COMPLETED" } },
    include: { session: { select: { id: true, startedAt: true } }, sets: { orderBy: { setNumber: "asc" } } },
    orderBy: [{ session: { startedAt: "asc" } }, { position: "asc" }],
  });
  const out = new Map<string, Map<string, SessionPerformance>>();
  for (const r of rows) {
    const bySession = out.get(r.exerciseId) ?? new Map<string, SessionPerformance>();
    out.set(r.exerciseId, bySession);
    const existing = bySession.get(r.session.id);
    if (existing) existing.sets.push(...r.sets);
    else bySession.set(r.session.id, { sessionId: r.session.id, date: r.session.startedAt, sets: [...r.sets] });
  }
  return new Map(exerciseIds.map((id) => [id, [...(out.get(id)?.values() ?? [])]]));
}

export async function getExerciseHistory(userId: string, exerciseId: string): Promise<SessionPerformance[]> {
  return (await getExerciseHistories(userId, [exerciseId])).get(exerciseId) ?? [];
}

/** Next free position for a session exercise. */
export async function nextPosition(sessionId: string): Promise<number> {
  const agg = await prisma.sessionExercise.aggregate({ where: { sessionId }, _max: { position: true } });
  return (agg._max.position ?? -1) + 1;
}
