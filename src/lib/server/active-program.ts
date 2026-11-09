import "server-only";
import { prisma } from "@/lib/server/db";
import { HttpError } from "@/lib/server/api";
import { buildWeek, proposeWeekdays, scheduleChanges, scheduleVersion } from "@/lib/active-program";

/**
 * UI-06: one active training program per person (Profile.activeProgramId). Making a program active is always
 * previewed and confirmed, and sets the program and the weekly schedule together, in one transaction. Nothing here
 * picks a program by itself, and no completed workout or progress is touched.
 */

async function programDays(userId: string, programId: string) {
  const program = await prisma.workoutProgram.findFirst({
    where: { id: programId, userId },
    select: { id: true, name: true, templates: { orderBy: [{ programPosition: "asc" }, { name: "asc" }], select: { id: true, name: true, _count: { select: { exercises: true } } } } },
  });
  if (!program) throw new HttpError(404, "Program not found");
  return program;
}

const currentSlots = (userId: string) =>
  prisma.scheduleSlot.findMany({ where: { userId }, orderBy: [{ weekday: "asc" }, { position: "asc" }], select: { weekday: true, position: true, templateId: true, template: { select: { name: true, program: { select: { name: true } } } } } });

/** The preview: the program's days with suggested weekdays, today's schedule, and the version the confirmation must match. */
export async function activationPreview(userId: string, programId: string) {
  const [program, slots, profile] = await Promise.all([programDays(userId, programId), currentSlots(userId), prisma.profile.findUnique({ where: { userId }, select: { activeProgramId: true } })]);
  const dayIds = program.templates.map((t) => t.id);
  return {
    program: { id: program.id, name: program.name },
    alreadyActive: profile?.activeProgramId === program.id,
    days: program.templates.map((t) => ({ id: t.id, name: t.name, exercises: t._count.exercises })),
    proposed: proposeWeekdays(dayIds, slots),
    current: slots.map((s) => ({ weekday: s.weekday, position: s.position, templateId: s.templateId, name: s.template.name, program: s.template.program?.name ?? null })),
    version: scheduleVersion(slots),
  };
}

/** Confirm: refuses a stale preview (409), a day too full, or another person's program; otherwise sets both at once. */
export async function activateProgram(userId: string, programId: string, input: { weekdays: Record<string, number[]>; version: string }) {
  return prisma.$transaction(async (tx) => {
    // One confirmation at a time per person: the profile row is the lock.
    await tx.$queryRaw`SELECT "userId" FROM "Profile" WHERE "userId" = ${userId} FOR UPDATE`;
    const program = await tx.workoutProgram.findFirst({ where: { id: programId, userId }, select: { id: true, templates: { orderBy: [{ programPosition: "asc" }, { name: "asc" }], select: { id: true } } } });
    if (!program) throw new HttpError(404, "Program not found");
    const slots = await tx.scheduleSlot.findMany({ where: { userId }, select: { weekday: true, position: true, templateId: true } });
    if (scheduleVersion(slots) !== input.version) throw new HttpError(409, "Your schedule changed since this preview was shown. Review the updated preview, then confirm again.");
    const dayIds = program.templates.map((t) => t.id);
    const unknown = Object.keys(input.weekdays).filter((id) => !dayIds.includes(id));
    if (unknown.length) throw new HttpError(400, "A workout in the preview isn't in this program any more. Reload the preview.");
    let week: string[][];
    try { week = buildWeek(dayIds, input.weekdays); } catch (e) { throw new HttpError(400, (e as Error).message); }
    const changes = scheduleChanges(slots, week);
    await tx.scheduleSlot.deleteMany({ where: { userId } });
    await tx.scheduleSlot.createMany({ data: week.flatMap((ids, weekday) => ids.map((templateId, position) => ({ userId, weekday, templateId, position }))) });
    await tx.profile.update({ where: { userId }, data: { activeProgramId: program.id } });
    return { ok: true, ...changes };
  });
}

/** The active program, if any, with its days in order; null when none is chosen. */
export async function getActiveProgramId(userId: string) {
  return (await prisma.profile.findUnique({ where: { userId }, select: { activeProgramId: true } }))?.activeProgramId ?? null;
}
