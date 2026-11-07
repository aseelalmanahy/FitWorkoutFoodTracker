import "server-only";
import { prisma } from "./db";
import { HttpError, notFound } from "./api";
import { limitLockWait } from "./auth";
import { idempotencyConflict, idempotentId, isUniqueViolation } from "./idempotency";
import type { Prisma, SetEntry } from "@prisma/client";
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

interface NewSet { reps: number; weightKg: number; isWarmup?: boolean; rpe?: number | null }

/**
 * Logging a set and finishing a workout each hold the workout's row from their status check to their commit, so one
 * finishes before the other starts, and the second sees what the first did. The holder only does a few quick queries.
 * A stuck lock fails the request with a 503 and nothing saved, which is safe to retry. limitLockWait is what bounds that
 * wait, as Prisma's own timeout doesn't end a query that's already waiting.
 */
const HOLDING_THE_WORKOUT = { maxWait: 5_000, timeout: 10_000 };

async function lockSession(tx: Prisma.TransactionClient, userId: string, sessionId: string) {
  await limitLockWait(tx);
  const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM "WorkoutSession" WHERE id = ${sessionId} AND "userId" = ${userId} FOR UPDATE`;
  if (!rows.length) throw notFound("Workout");
  return rows[0].status;
}

async function earlierSet(db: Pick<Prisma.TransactionClient, "setEntry">, id: string, sessionExerciseId: string, input: NewSet) {
  const set = await db.setEntry.findUnique({ where: { id } });
  if (!set) return null;
  const same = set.sessionExerciseId === sessionExerciseId && set.reps === input.reps && set.weightKg === input.weightKg
    && set.isWarmup === (input.isWarmup ?? false) && set.rpe === (input.rpe ?? null);
  if (!same) throw idempotencyConflict();
  return set;
}

/** With a key, a retry after a lost response returns the set that was saved, and doesn't log it twice. */
export async function logSet(userId: string, sessionId: string, sessionExerciseId: string, input: NewSet, idempotencyKey: string | null = null) {
  const id = idempotencyKey ? idempotentId("set", userId, idempotencyKey) : undefined;
  try {
    return await prisma.$transaction(async (tx) => {
      const status = await lockSession(tx, userId, sessionId);
      if (id) {
        const earlier = await earlierSet(tx, id, sessionExerciseId, input);
        if (earlier) return earlier;
      }
      // After the check above, so an honest retry still gets the set it saved. A new one would change a finished workout's records.
      if (status !== "IN_PROGRESS") throw new HttpError(409, "This workout has been finished, so nothing was logged.");
      const agg = await tx.setEntry.aggregate({ where: { sessionExerciseId }, _max: { setNumber: true } });
      return tx.setEntry.create({
        data: {
          ...(id ? { id } : {}),
          sessionExerciseId,
          setNumber: (agg._max.setNumber ?? 0) + 1,
          reps: input.reps,
          weightKg: input.weightKg,
          isWarmup: input.isWarmup ?? false,
          rpe: input.rpe ?? null,
        },
      });
    }, HOLDING_THE_WORKOUT);
  } catch (err) {
    // The same key used on another of this person's workouts, whose row wasn't held. That transaction has ended, so this reads outside it.
    if (id && isUniqueViolation(err)) {
      const earlier = await earlierSet(prisma, id, sessionExerciseId, input);
      if (earlier) return earlier;
    }
    throw err;
  }
}

/** Status first and under the lock, so finishing twice is refused, and a set still being saved counts. */
export async function finishSession(userId: string, sessionId: string, changes: { name?: string; notes?: string | null }) {
  return prisma.$transaction(async (tx) => {
    if ((await lockSession(tx, userId, sessionId)) === "COMPLETED") throw new HttpError(409, "Workout already finished");
    const sets = await tx.setEntry.count({ where: { sessionExercise: { sessionId } } });
    if (sets === 0) throw new HttpError(400, "Log at least one set before finishing");
    // Drop exercises that were planned but never performed.
    await tx.sessionExercise.deleteMany({ where: { sessionId, sets: { none: {} } } });
    return tx.workoutSession.update({ where: { id: sessionId }, data: { ...changes, status: "COMPLETED", endedAt: new Date() } });
  }, HOLDING_THE_WORKOUT);
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
