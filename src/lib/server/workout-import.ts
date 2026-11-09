import "server-only";
import { HttpError } from "./api";
import { prisma } from "./db";
import { idempotentId, isUniqueViolation } from "./idempotency";
import { assertExercisesVisible } from "./workouts";
import type { ImportSave } from "@/lib/workout-import/save-schema";

const MAX_SLOTS_PER_WEEKDAY = 3;

/**
 * Saves a confirmed import, all or nothing, as one program (UI-01): the program, and one plan per day, in the
 * order the file gave them, each named after its day (the program carries the program's name). Any new exercises the
 * person named are made too. Nothing existing is changed: the plans and the program are always new rows, and an
 * exercise the person named that they already have (or that's built in) is reused, never duplicated or renamed.
 *
 * The weekly schedule is changed only when the person asked for it (`schedule`), and then only by adding: a weekday
 * that already has three plans keeps them, and that day is left unscheduled and said so.
 * With an idempotency key, a retried save returns what the first one made instead of making it again.
 */
export async function saveImport(userId: string, input: ImportSave, key: string | null) {
  await assertExercisesVisible(userId, input.days.flatMap((d) => d.exercises.flatMap((e) => (e.exerciseId ? [e.exerciseId] : []))));
  const programId = key ? idempotentId("program", userId, key) : undefined;
  const ids = input.days.map((_, i) => (key ? idempotentId("template", userId, `${key}:${i}`) : undefined));
  try {
    return await prisma.$transaction(async (tx) => {
      // New exercises: the person's own with the same name (any case) or a built-in one is reused.
      const resolved = new Map<string, string>();
      for (const e of input.days.flatMap((d) => d.exercises)) {
        if (!e.newExercise) continue;
        const name = e.newExercise.name;
        const k = name.toLowerCase();
        if (resolved.has(k)) continue;
        const existing = await tx.exercise.findFirst({ where: { name: { equals: name, mode: "insensitive" }, OR: [{ userId }, { userId: null }] }, orderBy: { userId: { sort: "desc", nulls: "last" } }, select: { id: true } });
        resolved.set(k, existing?.id ?? (await tx.exercise.create({ data: { userId, name, primaryMuscle: e.newExercise.primaryMuscle, equipment: e.newExercise.equipment }, select: { id: true } })).id);
      }
      const program = await tx.workoutProgram.create({ data: { ...(programId ? { id: programId } : {}), userId, name: input.programName, origin: "import" }, select: { id: true, name: true } });
      const templates: { id: string; name: string; weekday: number | null }[] = [];
      for (const [i, day] of input.days.entries()) {
        const t = await tx.workoutTemplate.create({
          data: {
            ...(ids[i] ? { id: ids[i] } : {}),
            userId,
            name: day.name.slice(0, 80),
            notes: day.notes ?? null,
            programId: program.id,
            programPosition: i,
            exercises: {
              create: day.exercises.map((e, position) => ({
                exerciseId: e.exerciseId ?? resolved.get(e.newExercise!.name.toLowerCase())!,
                position,
                targetSets: e.targetSets,
                targetRepsMin: e.targetRepsMin,
                targetRepsMax: e.targetRepsMax,
                targetWeightKg: e.targetWeightKg ?? null,
                restSeconds: e.restSeconds ?? null,
                notes: e.notes ?? null,
              })),
            },
          },
          select: { id: true, name: true },
        });
        templates.push({ ...t, weekday: day.weekday });
      }
      const scheduled: { name: string; weekday: number }[] = [];
      const unscheduled: string[] = [];
      if (input.schedule) {
        for (const t of templates) {
          if (t.weekday === null) continue;
          const taken = await tx.scheduleSlot.count({ where: { userId, weekday: t.weekday } });
          if (taken >= MAX_SLOTS_PER_WEEKDAY) { unscheduled.push(t.name); continue; }
          await tx.scheduleSlot.create({ data: { userId, weekday: t.weekday, templateId: t.id, position: taken } });
          scheduled.push({ name: t.name, weekday: t.weekday });
        }
      }
      return { program, templates: templates.map(({ id, name, weekday }) => ({ id, name, weekday })), scheduled, unscheduled, repeated: false };
    }, { maxWait: 10_000, timeout: 30_000 });
  } catch (err) {
    if (!key || !isUniqueViolation(err)) throw err;
    // The same save, retried: the first one's program and plans, unchanged, and nothing scheduled again.
    const program = await prisma.workoutProgram.findFirst({ where: { id: programId, userId }, select: { id: true, name: true } });
    const existing = await prisma.workoutTemplate.findMany({ where: { id: { in: ids as string[] }, userId }, select: { id: true, name: true }, orderBy: { programPosition: "asc" } });
    if (!program || existing.length !== ids.length) throw new HttpError(409, "An earlier attempt saved part of this differently. Check your plans before importing again.");
    return { program, templates: existing.map((t) => ({ ...t, weekday: null })), scheduled: [], unscheduled: [], repeated: true };
  }
}
