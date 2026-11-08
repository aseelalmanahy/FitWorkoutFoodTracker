import "server-only";
import { prisma } from "./db";
import { HttpError, notFound } from "./api";
import { limitLockWait } from "./auth";
import { idempotencyConflict, idempotentId, isUniqueViolation } from "./idempotency";
import type { Prisma, SetEntry } from "@prisma/client";
import type { SessionPerformance } from "@/lib/overload";
import { contextKey } from "@/lib/movement-patterns";

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
 * wait, as Prisma's own timeout doesn't end a query that's already waiting. A request can wait on the workout's row for
 * about 8 seconds, then 4 on its exercise, and this leaves room for that, so the lock limit is what answers.
 */
const HOLDING_THE_WORKOUT = { maxWait: 5_000, timeout: 15_000 };

/**
 * Each request waiting on a workout's row holds a database connection, and those are shared with everyone. So one person
 * can only have this many at once, which an app sending one set at a time won't reach. Per server process, like the throttles.
 */
const MOST_WAITING_PER_PERSON = 8;
const waitingFor = new Map<string, number>();

async function holdingTheWorkout<T>(userId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const waiting = waitingFor.get(userId) ?? 0;
  if (waiting >= MOST_WAITING_PER_PERSON) throw new HttpError(503, "Too many saves are in progress, and this one wasn't saved. Try again shortly.", undefined, { "Retry-After": "5" });
  waitingFor.set(userId, waiting + 1);
  try {
    return await prisma.$transaction(work, HOLDING_THE_WORKOUT);
  } finally {
    const left = (waitingFor.get(userId) ?? 1) - 1;
    if (left) waitingFor.set(userId, left);
    else waitingFor.delete(userId);
  }
}

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
    return await holdingTheWorkout(userId, async (tx) => {
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
    });
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
  return holdingTheWorkout(userId, async (tx) => {
    if ((await lockSession(tx, userId, sessionId)) === "COMPLETED") throw new HttpError(409, "Workout already finished");
    const sets = await tx.setEntry.count({ where: { sessionExercise: { sessionId } } });
    if (sets === 0) throw new HttpError(400, "Log at least one set before finishing");
    // Drop exercises that were planned but never performed.
    await tx.sessionExercise.deleteMany({ where: { sessionId, sets: { none: {} } } });
    return tx.workoutSession.update({ where: { id: sessionId }, data: { ...changes, status: "COMPLETED", endedAt: new Date() } });
  });
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
      machine: { select: { id: true, name: true, kind: true, gymId: true } },
      plannedExercise: { select: { id: true, name: true } },
      substitutedBy: { select: { id: true } },
    },
  },
  template: { include: { exercises: true } },
  gym: { select: { id: true, name: true } },
};

export async function getSessionDetail(userId: string, sessionId: string) {
  return prisma.workoutSession.findFirst({ where: { id: sessionId, userId }, include: sessionDetailInclude });
}

/**
 * Multi-gym: a set's history belongs to its exercise and, if one was chosen, the specific machine. Sets with no machine
 * (free weights, and every workout from before gyms existed) share one history per exercise, as before; a machine's
 * sets are compared only with that machine's, as different machines aren't mechanically equivalent.
 */
export type HistoryContext = { exerciseId: string; gymEquipmentId: string | null };

/**
 * Most recent completed performance in each context, excluding a session. Returns contextKey → performance.
 * Given plain exercise IDs, the context is "no machine", which is every set logged before machines existed.
 */
export async function getPreviousPerformances(
  userId: string,
  exercises: (string | HistoryContext)[],
  opts: { excludeSessionId?: string; before?: Date } = {},
): Promise<Map<string, PreviousPerformance>> {
  const result = new Map<string, PreviousPerformance>();
  const contexts = exercises.map((e) => (typeof e === "string" ? { exerciseId: e, gymEquipmentId: null } : e));
  if (!contexts.length) return result;
  const rows = await prisma.sessionExercise.findMany({
    where: {
      OR: contexts.map((c) => ({ exerciseId: c.exerciseId, gymEquipmentId: c.gymEquipmentId })),
      sets: { some: { isWarmup: false } },
      session: {
        userId,
        status: "COMPLETED",
        ...(opts.excludeSessionId ? { id: { not: opts.excludeSessionId } } : {}),
        ...(opts.before ? { startedAt: { lt: opts.before } } : {}),
      },
    },
    orderBy: [{ session: { startedAt: "desc" } }, { position: "asc" }],
    distinct: ["exerciseId", "gymEquipmentId"],
    include: { session: { select: { id: true, startedAt: true } }, sets: { orderBy: { setNumber: "asc" } } },
  });
  for (const r of rows) {
    const value = { sessionId: r.session.id, date: r.session.startedAt, sets: r.sets };
    result.set(contextKey(r.exerciseId, r.gymEquipmentId), value);
    // Callers that ask by exercise ID alone read the "no machine" context under the plain ID too.
    if (r.gymEquipmentId === null) result.set(r.exerciseId, value);
  }
  return result;
}

/**
 * All completed sessions containing each exercise, oldest first (sets merged per session), in one context: no machine
 * by default (the shared history), or one machine.
 */
export async function getExerciseHistories(userId: string, exerciseIds: string[], { gymEquipmentId = null }: { gymEquipmentId?: string | null } = {}): Promise<Map<string, SessionPerformance[]>> {
  const rows = await prisma.sessionExercise.findMany({
    where: { exerciseId: { in: exerciseIds }, gymEquipmentId, session: { userId, status: "COMPLETED" } },
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

export async function getExerciseHistory(userId: string, exerciseId: string, gymEquipmentId: string | null = null): Promise<SessionPerformance[]> {
  return (await getExerciseHistories(userId, [exerciseId], { gymEquipmentId })).get(exerciseId) ?? [];
}

/** The machines this person has logged an exercise on, each with its gym, for separate histories and records. */
export async function getMachinesUsedFor(userId: string, exerciseId: string) {
  const rows = await prisma.sessionExercise.findMany({
    where: { exerciseId, gymEquipmentId: { not: null }, session: { userId, status: "COMPLETED" } },
    distinct: ["gymEquipmentId"],
    select: { machine: { select: { id: true, name: true, kind: true, gym: { select: { name: true } } } } },
  });
  return rows.flatMap((r) => (r.machine ? [{ id: r.machine.id, name: r.machine.name ?? "", gym: r.machine.gym.name }] : []));
}

/** Next free position for a session exercise. */
export async function nextPosition(sessionId: string): Promise<number> {
  const agg = await prisma.sessionExercise.aggregate({ where: { sessionId }, _max: { position: true } });
  return (agg._max.position ?? -1) + 1;
}
