import "server-only";
import { notFound } from "./api";
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

export async function updateProgram(userId: string, programId: string, patch: { name?: string; templateIds?: string[] }) {
  const program = await prisma.workoutProgram.findFirst({ where: { id: programId, userId }, select: { id: true } });
  if (!program) throw notFound("Program");
  if (patch.templateIds) await ownedTemplates(userId, patch.templateIds);
  return prisma.$transaction(async (tx) => {
    if (patch.name !== undefined) await tx.workoutProgram.update({ where: { id: programId }, data: { name: patch.name } });
    if (patch.templateIds) {
      // Days left out become individual plans; the listed ones take their new order.
      await tx.workoutTemplate.updateMany({ where: { programId, userId, id: { notIn: patch.templateIds } }, data: { programId: null, programPosition: null } });
      for (const [i, id] of patch.templateIds.entries()) await tx.workoutTemplate.update({ where: { id }, data: { programId, programPosition: i } });
    }
    return tx.workoutProgram.findUniqueOrThrow({ where: { id: programId }, select: { id: true, name: true, templates: { select: { id: true, name: true }, orderBy: { programPosition: "asc" } } } });
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
