import "server-only";
import { HttpError, notFound } from "./api";
import { prisma } from "./db";

/**
 * UI-01: workout programs. A program groups the person's own plans as its ordered days; a plan is in at most one.
 * Grouping, renaming, reordering and ungrouping change only the grouping: the plans themselves, their exercises,
 * the schedule and every logged workout stay exactly as they were. Ungrouping deletes the program, and its plans
 * become individual plans again.
 */

async function ownedTemplates(userId: string, templateIds: string[]) {
  const found = await prisma.workoutTemplate.findMany({ where: { id: { in: templateIds }, userId }, select: { id: true } });
  if (found.length !== templateIds.length) throw notFound("Workout plan");
}

/** The person's plans become one program's days, in the given order. A plan already in another program moves. */
export async function createProgram(userId: string, name: string, templateIds: string[]) {
  await ownedTemplates(userId, templateIds);
  return prisma.$transaction(async (tx) => {
    const program = await tx.workoutProgram.create({ data: { userId, name, origin: "manual" }, select: { id: true, name: true } });
    for (const [i, id] of templateIds.entries()) await tx.workoutTemplate.update({ where: { id }, data: { programId: program.id, programPosition: i } });
    return program;
  });
}

/**
 * Rename, and set the days and their order. A listed plan that was an individual plan joins the program (UI-05B: Add
 * existing workout); its schedule entries stay as they are. Days left out become individual plans. UI-05C: with
 * unscheduleRemoved, the days left out also leave the weekly schedule, in the same transaction; otherwise their
 * schedule entries stay. Plans, exercises and logged workouts are never changed.
 */
export async function updateProgram(userId: string, programId: string, patch: { name?: string; templateIds?: string[]; unscheduleRemoved?: boolean }) {
  const program = await prisma.workoutProgram.findFirst({ where: { id: programId, userId }, select: { id: true } });
  if (!program) throw notFound("Program");
  if (patch.templateIds) {
    await ownedTemplates(userId, patch.templateIds);
    // UI-05B: only an individual plan can join; a day of another program is never moved silently.
    const elsewhere = await prisma.workoutTemplate.count({ where: { id: { in: patch.templateIds }, userId, programId: { not: null, notIn: [programId] } } });
    if (elsewhere) throw new HttpError(409, "That workout is in another program. Remove it from that program first.");
  }
  return prisma.$transaction(async (tx) => {
    if (patch.name !== undefined) await tx.workoutProgram.update({ where: { id: programId }, data: { name: patch.name } });
    if (patch.templateIds && patch.unscheduleRemoved) {
      await tx.scheduleSlot.deleteMany({ where: { userId, template: { programId, userId }, templateId: { notIn: patch.templateIds } } });
    }
    if (patch.templateIds) {
      // Days left out become individual plans; the listed ones take their new order.
      await tx.workoutTemplate.updateMany({ where: { programId, userId, id: { notIn: patch.templateIds } }, data: { programId: null, programPosition: null } });
      for (const [i, id] of patch.templateIds.entries()) await tx.workoutTemplate.update({ where: { id }, data: { programId, programPosition: i } });
    }
    return tx.workoutProgram.findUniqueOrThrow({ where: { id: programId }, select: { id: true, name: true, templates: { select: { id: true, name: true }, orderBy: { programPosition: "asc" } } } });
  });
}

/** UI-05B: the person's individual plans (in no program), with their weekdays, to add to a program. */
export async function getIndividualPlans(userId: string) {
  return prisma.workoutTemplate.findMany({
    where: { userId, programId: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, _count: { select: { exercises: true } }, slots: { select: { weekday: true }, orderBy: { weekday: "asc" } } },
  });
}

/** Removes the grouping only. */
export async function ungroupProgram(userId: string, programId: string) {
  const { count } = await prisma.workoutProgram.deleteMany({ where: { id: programId, userId } });
  if (count === 0) throw notFound("Program");
  return { ok: true };
}

/** A program with its days in order, and each day's exercises and weekdays, for the Workouts page and its own page. */
export async function getPrograms(userId: string, programId?: string) {
  const programs = await prisma.workoutProgram.findMany({
    where: { userId, ...(programId ? { id: programId } : {}) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, origin: true, createdAt: true,
      templates: {
        orderBy: { programPosition: "asc" },
        select: {
          id: true, name: true,
          exercises: { orderBy: { position: "asc" }, select: { targetSets: true, targetRepsMin: true, targetRepsMax: true, exercise: { select: { name: true } } } },
          slots: { select: { weekday: true }, orderBy: { weekday: "asc" } },
          // UI-05: so deleting a plan can say how many logged workouts stay.
          _count: { select: { sessions: { where: { status: "COMPLETED" } } } },
        },
      },
    },
  });
  if (programId && programs.length === 0) throw notFound("Program");
  return programs;
}
