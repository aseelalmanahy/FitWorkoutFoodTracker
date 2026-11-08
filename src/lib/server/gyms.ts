import "server-only";
import type { Equipment, Prisma } from "@prisma/client";
import { HttpError, notFound } from "./api";
import { prisma } from "./db";
import { limitLockWait } from "./auth";
import { visibleExercises } from "./workouts";
import { findAlternatives } from "@/lib/movement-patterns";
import { MAX_GYMS, MAX_MACHINES_PER_GYM, nameKey } from "@/lib/gyms";

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

/**
 * The person's row, held so their gyms are counted and names compared one save at a time.
 *
 * Lock order, everywhere here: the person's row, then a gym's row, then its equipment; for a workout, its row, then a
 * machine, then a plan entry, then the workout's exercise rows. Taking them in one order means no two requests can
 * each wait for the other (a deadlock, which PostgreSQL ends by rolling one back: answered 503, nothing changed).
 */
async function lockPerson(tx: Prisma.TransactionClient, userId: string) {
  await limitLockWait(tx);
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
}
const SHORT = { maxWait: 5_000, timeout: 15_000 };

/**
 * Another of the person's gyms with the same name, compared by nameKey (Unicode-normalised and case-folded), so
 * "Café", "CAFÉ" and "Cafe\u0301" are one name. Read with the person's row held, so two saves can't both pass.
 * At most MAX_GYMS rows, compared here rather than by the database's collation.
 */
async function sameName(tx: Prisma.TransactionClient, userId: string, name: string, exceptId?: string) {
  const key = nameKey(name);
  const rows = await tx.gymLocation.findMany({ where: { userId, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { name: true } });
  return rows.some((r) => nameKey(r.name) === key);
}

export async function createGym(userId: string, name: string) {
  return prisma.$transaction(async (tx) => {
    await lockPerson(tx, userId);
    if ((await tx.gymLocation.count({ where: { userId } })) >= MAX_GYMS) throw new HttpError(409, `You can have up to ${MAX_GYMS} gyms.`);
    if (await sameName(tx, userId, name)) throw duplicateName();
    return tx.gymLocation.create({ data: { userId, name }, include: gymInclude });
  }, SHORT);
}

export async function renameGym(userId: string, gymId: string, name: string) {
  await getOwnedGym(userId, gymId);
  return prisma.$transaction(async (tx) => {
    await lockPerson(tx, userId);
    if (await sameName(tx, userId, name, gymId)) throw duplicateName();
    return tx.gymLocation.update({ where: { id: gymId }, data: { name }, include: gymInclude });
  }, SHORT);
}

/** The kinds of equipment a gym has: unnamed rows. Named machines aren't touched. */
export async function setGymKinds(userId: string, gymId: string, kinds: Equipment[]) {
  await getOwnedGym(userId, gymId);
  const wanted = [...new Set(kinds)];
  await prisma.$transaction(async (tx) => {
    // The person, then the gym (see lockPerson); with the gym held, two saves of the list can't both add the same kind.
    await lockPerson(tx, userId);
    await tx.$queryRaw`SELECT id FROM "GymLocation" WHERE id = ${gymId} FOR UPDATE`;
    await tx.gymEquipment.deleteMany({ where: { gymId, userId, name: null, kind: { notIn: wanted } } });
    const have = new Set((await tx.gymEquipment.findMany({ where: { gymId, name: null }, select: { kind: true } })).map((r) => r.kind));
    for (const kind of wanted) if (!have.has(kind)) await tx.gymEquipment.create({ data: { userId, gymId, kind } });
  });
  return getOwnedGym(userId, gymId);
}

/** A specific machine at a gym, optionally for one exercise the person can see. */
export async function addMachine(userId: string, gymId: string, input: { kind: Equipment; name: string; exerciseId?: string | null }) {
  await getOwnedGym(userId, gymId);
  if (input.exerciseId && !(await prisma.exercise.findFirst({ where: { id: input.exerciseId, ...visibleExercises(userId) }, select: { id: true } }))) throw new HttpError(400, "One or more exercises are unknown");
  return prisma.$transaction(async (tx) => {
    // The person, then the gym (see lockPerson); with the gym held, the limit and the duplicate check count every
    // machine saved at the same time.
    await lockPerson(tx, userId);
    await tx.$queryRaw`SELECT id FROM "GymLocation" WHERE id = ${gymId} FOR UPDATE`;
    const named = await tx.gymEquipment.findMany({ where: { gymId, name: { not: null } }, select: { name: true, kind: true } });
    if (named.length >= MAX_MACHINES_PER_GYM) throw new HttpError(409, `A gym can have up to ${MAX_MACHINES_PER_GYM} machines.`);
    if (named.some((e) => nameKey(e.name!) === nameKey(input.name) && e.kind === input.kind)) throw new HttpError(409, "That machine is already listed at this gym.");
    return tx.gymEquipment.create({ data: { userId, gymId, kind: input.kind, name: input.name, exerciseId: input.exerciseId ?? null } });
  }, SHORT);
}

const machineInUse = () => new HttpError(409, "This machine is used in a workout, so it's kept with it.");

/**
 * A machine used in any workout can't be removed: its sets would lose the machine they were done on. The machine's row
 * is held for update while it's counted and deleted, and choosing a machine holds it for share (usableMachine), so the
 * two take turns: a choice that commits first is counted here, and one that waits finds the machine gone (404).
 */
export async function removeMachine(userId: string, gymId: string, machineId: string) {
  await prisma.$transaction(async (tx) => {
    await limitLockWait(tx);
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "GymEquipment" WHERE id = ${machineId} AND "gymId" = ${gymId} AND "userId" = ${userId} FOR UPDATE`;
    if (!rows.length) throw notFound("Machine");
    if (await tx.sessionExercise.count({ where: { gymEquipmentId: machineId } })) throw machineInUse();
    await tx.gymEquipment.delete({ where: { id: machineId } });
  }, SHORT);
}

/**
 * Holds the workout's row, as logging a set and finishing do, and checks it's still in progress. So a set can't be
 * logged between the "no sets yet" check and choosing a machine, and nothing changes in a workout that just finished.
 */
async function lockInProgress(tx: Prisma.TransactionClient, userId: string, sessionId: string): Promise<{ gymLocationId: string | null }> {
  await limitLockWait(tx);
  const rows = await tx.$queryRaw<{ status: string; gymLocationId: string | null }[]>`SELECT status::text AS status, "gymLocationId" FROM "WorkoutSession" WHERE id = ${sessionId} AND "userId" = ${userId} FOR UPDATE`;
  if (!rows.length) throw notFound("Workout");
  if (rows[0].status !== "IN_PROGRESS") throw new HttpError(409, "This workout is finished.");
  return { gymLocationId: rows[0].gymLocationId };
}

/** A machine for an exercise: this person's, named, at the workout's gym as it is now, and not set up for another exercise. */
async function usableMachine(tx: Prisma.TransactionClient, userId: string, machineId: string, gymLocationId: string | null, exerciseId: string) {
  // Held for share until this choice commits, so the machine can't be removed in between (removeMachine).
  await tx.$queryRaw`SELECT id FROM "GymEquipment" WHERE id = ${machineId} AND "userId" = ${userId} FOR SHARE`;
  const m = await tx.gymEquipment.findFirst({ where: { id: machineId, userId, name: { not: null } } });
  if (!m) throw notFound("Machine");
  if (m.gymId !== gymLocationId) throw new HttpError(409, "That machine is at another gym. Choose this workout's gym first.");
  if (m.exerciseId && m.exerciseId !== exerciseId) throw new HttpError(409, "That machine is set up for a different exercise.");
}

async function ownedInProgress(userId: string, sessionId: string) {
  const s = await prisma.workoutSession.findFirst({ where: { id: sessionId, userId } });
  if (!s) throw notFound("Workout");
  if (s.status !== "IN_PROGRESS") throw new HttpError(409, "This workout is finished.");
  return s;
}

/**
 * The workout's gym, while it's in progress. Not while an exercise in it is on a machine at its current gym: those sets
 * were done there, and history filtered by gym would otherwise put them at the wrong one.
 */
export async function setSessionGym(userId: string, sessionId: string, gymLocationId: string | null) {
  await ownedInProgress(userId, sessionId);
  if (gymLocationId) await getOwnedGym(userId, gymLocationId);
  return prisma.$transaction(async (tx) => {
    const now = await lockInProgress(tx, userId, sessionId);
    if (now.gymLocationId !== gymLocationId && (await tx.sessionExercise.count({ where: { sessionId, gymEquipmentId: { not: null } } }))) {
      throw new HttpError(409, "Some exercises in this workout are on machines at this gym. Clear their machine first, or swap them.");
    }
    return tx.workoutSession.update({ where: { id: sessionId }, data: { gymLocationId }, select: { id: true, gymLocationId: true } });
  }, SHORT);
}

/** The machine for one exercise in a workout: one of this person's, at the workout's gym; only before any set is logged. */
export async function setSessionMachine(userId: string, sessionId: string, seId: string, gymEquipmentId: string | null) {
  await ownedInProgress(userId, sessionId);
  const se = await prisma.sessionExercise.findFirst({ where: { id: seId, sessionId }, select: { id: true, exerciseId: true } });
  if (!se) throw notFound("Exercise");
  return prisma.$transaction(async (tx) => {
    // Checked under the workout's lock, so a gym changed at the same moment can't leave a machine from the other one.
    const now = await lockInProgress(tx, userId, sessionId);
    if (gymEquipmentId) await usableMachine(tx, userId, gymEquipmentId, now.gymLocationId, se.exerciseId);
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

const planUnchangeable = (why: string, alreadySwapped = false) => new HttpError(409, alreadySwapped
  ? `${why} The swap you made earlier stays; the plan wasn't changed. Edit the plan itself to change it.`
  : `${why} Nothing was swapped. Swap without changing the plan, or edit the plan itself.`);

/**
 * The plan entry this workout row was started from, held for update, if it still names the exercise being replaced
 * (or, for a retry, already names the replacement). Refuses rather than guess: a plan with the same exercise twice has
 * two entries, and only the row's own templateExerciseId says which one this is.
 */
async function intendedEntry(tx: Prisma.TransactionClient, userId: string, templateId: string | null, se: { templateExerciseId: string | null; exerciseId: string }, replacementExerciseId: string, alreadySwapped: boolean) {
  const refuse = (why: string) => planUnchangeable(why, alreadySwapped);
  if (!templateId) throw refuse("This workout didn't come from a plan, so there's no plan to change.");
  if (!se.templateExerciseId) throw refuse("This exercise isn't in the plan as it is now (the plan was edited, or the exercise was added during the workout).");
  const rows = await tx.$queryRaw<{ id: string; exerciseId: string }[]>`SELECT te.id, te."exerciseId" FROM "TemplateExercise" te JOIN "WorkoutTemplate" t ON t.id = te."templateId" WHERE te.id = ${se.templateExerciseId} AND te."templateId" = ${templateId} AND t."userId" = ${userId} FOR UPDATE OF te`;
  const entry = rows[0];
  if (!entry) throw refuse("This exercise's entry is no longer in the plan.");
  if (entry.exerciseId !== se.exerciseId && entry.exerciseId !== replacementExerciseId) throw refuse("The plan's entry for this exercise was changed since the workout started.");
  return entry;
}

/**
 * Swaps an exercise in a workout: the planned row stays, with every set already logged on it, and a new row for the
 * actual exercise follows it, linked to it. The plan is changed only when the person asks, and then only the entry this
 * row came from; if that can't be done, nothing is swapped and the reason is given. All of it happens or none of it.
 *
 * Sent again with the same exercise and machine (a retry after a lost answer), it returns the replacement it made, and
 * a plan update asked for in the retry is made then, not dropped. A retry without updatePlan never undoes one. A
 * different second swap of the same row is refused.
 */
export async function substitute(userId: string, sessionId: string, seId: string, input: { exerciseId: string; gymEquipmentId?: string | null; updatePlan?: boolean }) {
  const s = await ownedInProgress(userId, sessionId);
  const first = await prisma.sessionExercise.findFirst({ where: { id: seId, sessionId } });
  if (!first) throw notFound("Exercise");
  if (input.exerciseId === first.exerciseId) throw new HttpError(400, "Choose a different exercise.");
  if (!(await prisma.exercise.findFirst({ where: { id: input.exerciseId, ...visibleExercises(userId) }, select: { id: true } }))) throw new HttpError(400, "One or more exercises are unknown");
  const gymEquipmentId = input.gymEquipmentId ?? null;
  return prisma.$transaction(async (tx) => {
    // The workout is held, so two swaps of one exercise can't both pass this check, and a finished workout isn't changed.
    const now = await lockInProgress(tx, userId, sessionId);
    if (gymEquipmentId) await usableMachine(tx, userId, gymEquipmentId, now.gymLocationId, input.exerciseId);
    // Read again under the workout's lock: what was read before it may be out of date (a plan saved since clears the
    // row's link to its entry).
    const fresh = await tx.sessionExercise.findFirst({ where: { id: seId, sessionId } });
    if (!fresh) throw notFound("Exercise");
    const earlier = await tx.sessionExercise.findFirst({ where: { substitutesId: fresh.id }, include: { exercise: true, sets: true } });
    if (earlier && (earlier.exerciseId !== input.exerciseId || earlier.gymEquipmentId !== gymEquipmentId)) throw new HttpError(409, "This exercise was already swapped. Swap the replacement instead.");
    // The plan entry before any exercise row (see lockPerson): for update when changing it, otherwise for key share,
    // which is what linking the replacement to it needs. A plan saved meanwhile has removed it: the link is then none.
    let se = fresh;
    if (!input.updatePlan && fresh.templateExerciseId) {
      const still = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "TemplateExercise" WHERE id = ${fresh.templateExerciseId} FOR KEY SHARE`;
      if (!still.length) se = { ...fresh, templateExerciseId: null };
    }
    // Before anything is written: if the plan can't be changed as asked, nothing is.
    const entry = input.updatePlan ? await intendedEntry(tx, userId, s.templateId, se, input.exerciseId, earlier !== null) : null;
    const replacement = earlier ?? await (async () => {
      await tx.sessionExercise.updateMany({ where: { sessionId, position: { gt: se.position } }, data: { position: { increment: 1 } } });
      return tx.sessionExercise.create({
        data: { sessionId, exerciseId: input.exerciseId, position: se.position + 1, restSeconds: se.restSeconds, notes: se.notes, gymEquipmentId, substitutesId: se.id, plannedExerciseId: se.plannedExerciseId ?? se.exerciseId, templateExerciseId: se.templateExerciseId },
        include: { exercise: true, sets: true },
      });
    })();
    if (entry && entry.exerciseId !== input.exerciseId) await tx.templateExercise.update({ where: { id: entry.id }, data: { exerciseId: input.exerciseId } });
    // True when the plan's entry now names the replacement, whether this request or the one it repeats changed it.
    const planUpdated = entry !== null || (earlier !== null && se.templateExerciseId !== null && (await tx.templateExercise.count({ where: { id: se.templateExerciseId, exerciseId: input.exerciseId } })) > 0);
    return { sessionExercise: replacement, planUpdated };
  }, { maxWait: 5_000, timeout: 15_000 });
}
