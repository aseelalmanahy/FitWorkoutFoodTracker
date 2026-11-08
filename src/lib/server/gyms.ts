import "server-only";
import type { Equipment, Prisma } from "@prisma/client";
import { HttpError, notFound } from "./api";
import { prisma } from "./db";
import { limitLockWait } from "./auth";
import { visibleExercises } from "./workouts";
import { findAlternatives } from "@/lib/movement-patterns";
import { MAX_GYMS, MAX_MACHINES_PER_GYM } from "@/lib/gyms";

/**
 * Multi-gym, server side. Every read and write is scoped to the person: a gym, machine or workout of someone else's
 * answers 404, as if it didn't exist. Nothing here changes a logged set.
 */
const gymInclude = { equipment: { orderBy: [{ name: { sort: "asc", nulls: "first" } }, { kind: "asc" }] as Prisma.GymEquipmentOrderByWithRelationInput[], include: { exercise: { select: { id: true, name: true } } } } } as const;

export const listGyms = (userId: string) => prisma.gymLocation.findMany({ where: { userId }, orderBy: { name: "asc" }, include: gymInclude });

export async function getOwnedGym(userId: string, gymId: string) {
  const gym = await prisma.gymLocation.findFirst({ where: { id: gymId, userId }, include: gymInclude });
  if (!gym) throw notFound("Gym");
  return gym;
}

const duplicateName = () => new HttpError(409, "You already have a gym with that name.");

export async function createGym(userId: string, name: string) {
  if ((await prisma.gymLocation.count({ where: { userId } })) >= MAX_GYMS) throw new HttpError(409, `You can have up to ${MAX_GYMS} gyms.`);
  if (await prisma.gymLocation.findFirst({ where: { userId, name: { equals: name, mode: "insensitive" } } })) throw duplicateName();
  return prisma.gymLocation.create({ data: { userId, name }, include: gymInclude });
}

export async function renameGym(userId: string, gymId: string, name: string) {
  await getOwnedGym(userId, gymId);
  if (await prisma.gymLocation.findFirst({ where: { userId, id: { not: gymId }, name: { equals: name, mode: "insensitive" } } })) throw duplicateName();
  return prisma.gymLocation.update({ where: { id: gymId }, data: { name }, include: gymInclude });
}

/** The kinds of equipment a gym has: unnamed rows. Named machines aren't touched. */
export async function setGymKinds(userId: string, gymId: string, kinds: Equipment[]) {
  await getOwnedGym(userId, gymId);
  const wanted = [...new Set(kinds)];
  await prisma.$transaction(async (tx) => {
    // The gym row is locked, so two saves of the list can't both add the same kind.
    await tx.$queryRaw`SELECT id FROM "GymLocation" WHERE id = ${gymId} FOR UPDATE`;
    await tx.gymEquipment.deleteMany({ where: { gymId, userId, name: null, kind: { notIn: wanted } } });
    const have = new Set((await tx.gymEquipment.findMany({ where: { gymId, name: null }, select: { kind: true } })).map((r) => r.kind));
    for (const kind of wanted) if (!have.has(kind)) await tx.gymEquipment.create({ data: { userId, gymId, kind } });
  });
  return getOwnedGym(userId, gymId);
}

/** A specific machine at a gym, optionally for one exercise the person can see. */
export async function addMachine(userId: string, gymId: string, input: { kind: Equipment; name: string; exerciseId?: string | null }) {
  const gym = await getOwnedGym(userId, gymId);
  if (gym.equipment.filter((e) => e.name !== null).length >= MAX_MACHINES_PER_GYM) throw new HttpError(409, `A gym can have up to ${MAX_MACHINES_PER_GYM} machines.`);
  if (input.exerciseId && !(await prisma.exercise.findFirst({ where: { id: input.exerciseId, ...visibleExercises(userId) }, select: { id: true } }))) throw new HttpError(400, "One or more exercises are unknown");
  if (gym.equipment.some((e) => e.name !== null && e.name.toLowerCase() === input.name.toLowerCase() && e.kind === input.kind)) throw new HttpError(409, "That machine is already listed at this gym.");
  return prisma.gymEquipment.create({ data: { userId, gymId, kind: input.kind, name: input.name, exerciseId: input.exerciseId ?? null } });
}

/** A machine with history can't be removed: its sets would lose the machine they were done on. */
export async function removeMachine(userId: string, gymId: string, machineId: string) {
  const m = await prisma.gymEquipment.findFirst({ where: { id: machineId, gymId, userId }, include: { _count: { select: { sessionExercises: true } } } });
  if (!m) throw notFound("Machine");
  if (m._count.sessionExercises > 0) throw new HttpError(409, "This machine has workouts logged on it, so it's kept with them.");
  await prisma.gymEquipment.delete({ where: { id: m.id } });
}

/**
 * Holds the workout's row, as logging a set and finishing do, and checks it's still in progress. So a set can't be
 * logged between the "no sets yet" check and choosing a machine, and nothing changes in a workout that just finished.
 */
async function lockInProgress(tx: Prisma.TransactionClient, userId: string, sessionId: string) {
  await limitLockWait(tx);
  const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM "WorkoutSession" WHERE id = ${sessionId} AND "userId" = ${userId} FOR UPDATE`;
  if (!rows.length) throw notFound("Workout");
  if (rows[0].status !== "IN_PROGRESS") throw new HttpError(409, "This workout is finished.");
}

async function ownedInProgress(userId: string, sessionId: string) {
  const s = await prisma.workoutSession.findFirst({ where: { id: sessionId, userId } });
  if (!s) throw notFound("Workout");
  if (s.status !== "IN_PROGRESS") throw new HttpError(409, "This workout is finished.");
  return s;
}

export async function setSessionGym(userId: string, sessionId: string, gymLocationId: string | null) {
  await ownedInProgress(userId, sessionId);
  if (gymLocationId) await getOwnedGym(userId, gymLocationId);
  return prisma.workoutSession.update({ where: { id: sessionId }, data: { gymLocationId }, select: { id: true, gymLocationId: true } });
}

/** The machine for one exercise in a workout: one of this person's, at the workout's gym; only before any set is logged. */
export async function setSessionMachine(userId: string, sessionId: string, seId: string, gymEquipmentId: string | null) {
  const s = await ownedInProgress(userId, sessionId);
  if (!(await prisma.sessionExercise.findFirst({ where: { id: seId, sessionId }, select: { id: true } }))) throw notFound("Exercise");
  if (gymEquipmentId) {
    const m = await prisma.gymEquipment.findFirst({ where: { id: gymEquipmentId, userId, name: { not: null } } });
    if (!m) throw notFound("Machine");
    if (m.gymId !== s.gymLocationId) throw new HttpError(409, "That machine is at another gym. Choose this workout's gym first.");
  }
  return prisma.$transaction(async (tx) => {
    await lockInProgress(tx, userId, sessionId);
    if (await tx.setEntry.count({ where: { sessionExerciseId: seId } })) throw new HttpError(409, "Sets are already logged for this exercise. Swap it instead, so they keep the machine they were done on.");
    return tx.sessionExercise.update({ where: { id: seId }, data: { gymEquipmentId }, select: { id: true, gymEquipmentId: true } });
  }, { maxWait: 5_000, timeout: 15_000 });
}

/** Reviewed alternatives for an exercise in a workout, marked by what the workout's gym has. */
export async function alternativesFor(userId: string, sessionId: string, seId: string) {
  const s = await prisma.workoutSession.findFirst({ where: { id: sessionId, userId }, include: { gym: { include: { equipment: true } } } });
  if (!s) throw notFound("Workout");
  const se = await prisma.sessionExercise.findFirst({ where: { id: seId, sessionId }, include: { exercise: true } });
  if (!se) throw notFound("Exercise");
  const library = await prisma.exercise.findMany({ where: visibleExercises(userId), select: { id: true, name: true, userId: true, equipment: true } });
  const swaps = await prisma.sessionExercise.findMany({ where: { plannedExerciseId: se.exerciseId, session: { userId } }, select: { exerciseId: true }, distinct: ["exerciseId"] });
  const kinds = s.gym ? [...new Set(s.gym.equipment.map((e) => e.kind))] : null;
  return {
    planned: { id: se.exercise.id, name: se.exercise.name },
    gym: s.gym ? { id: s.gym.id, name: s.gym.name, equipmentKnown: kinds !== null && kinds.length > 0 } : null,
    alternatives: findAlternatives(se.exercise, library, { equipment: kinds && kinds.length ? kinds : null, usedBefore: swaps.map((x) => x.exerciseId) }),
    machines: s.gym ? s.gym.equipment.filter((e) => e.name !== null).map((e) => ({ id: e.id, name: e.name, kind: e.kind, exerciseId: e.exerciseId })) : [],
  };
}

/**
 * Swaps an exercise in a workout: the planned row stays, with every set already logged on it, and a new row for the
 * actual exercise follows it, linked to it. The plan is changed only when the person asks, and only that one entry.
 */
export async function substitute(userId: string, sessionId: string, seId: string, input: { exerciseId: string; gymEquipmentId?: string | null; updatePlan?: boolean }) {
  const s = await ownedInProgress(userId, sessionId);
  const se = await prisma.sessionExercise.findFirst({ where: { id: seId, sessionId } });
  if (!se) throw notFound("Exercise");
  if (input.exerciseId === se.exerciseId) throw new HttpError(400, "Choose a different exercise.");
  if (!(await prisma.exercise.findFirst({ where: { id: input.exerciseId, ...visibleExercises(userId) }, select: { id: true } }))) throw new HttpError(400, "One or more exercises are unknown");
  if (input.gymEquipmentId) {
    const m = await prisma.gymEquipment.findFirst({ where: { id: input.gymEquipmentId, userId, name: { not: null } } });
    if (!m || m.gymId !== s.gymLocationId) throw new HttpError(409, "That machine isn't at this workout's gym.");
  }
  const gymEquipmentId = input.gymEquipmentId ?? null;
  return prisma.$transaction(async (tx) => {
    // The workout is held, so two swaps of one exercise can't both pass this check, and a finished workout isn't changed.
    await lockInProgress(tx, userId, sessionId);
    const earlier = await tx.sessionExercise.findFirst({ where: { substitutesId: se.id }, include: { exercise: true, sets: true } });
    if (earlier) {
      // The same swap sent again (a retry after a lost answer) gets the replacement it made; a different one is refused.
      if (earlier.exerciseId === input.exerciseId && earlier.gymEquipmentId === gymEquipmentId) return { sessionExercise: earlier, planUpdated: false };
      throw new HttpError(409, "This exercise was already swapped. Swap the replacement instead.");
    }
    await tx.sessionExercise.updateMany({ where: { sessionId, position: { gt: se.position } }, data: { position: { increment: 1 } } });
    const replacement = await tx.sessionExercise.create({
      data: { sessionId, exerciseId: input.exerciseId, position: se.position + 1, restSeconds: se.restSeconds, notes: se.notes, gymEquipmentId, substitutesId: se.id, plannedExerciseId: se.plannedExerciseId ?? se.exerciseId },
      include: { exercise: true, sets: true },
    });
    let planUpdated = false;
    if (input.updatePlan && s.templateId) {
      const entry = await tx.templateExercise.findFirst({ where: { templateId: s.templateId, exerciseId: se.exerciseId, template: { userId } }, orderBy: { position: "asc" } });
      if (entry) { await tx.templateExercise.update({ where: { id: entry.id }, data: { exerciseId: input.exerciseId } }); planUpdated = true; }
    }
    return { sessionExercise: replacement, planUpdated };
  }, { maxWait: 5_000, timeout: 15_000 });
}
