import "server-only";
import { HttpError } from "./api";
import { prisma } from "./db";
import { idempotentId, isUniqueViolation } from "./idempotency";
import { assertExercisesVisible } from "./workouts";
import { planName, type ImportSave } from "@/lib/workout-import/save-schema";

const MAX_SLOTS_PER_WEEKDAY = 3;

/**
 * Saves a confirmed import, all or nothing: one new plan per day, any new exercises the person named, and a schedule
 * slot for each day the plan put on a weekday. Nothing existing is changed: plans are always new rows; the schedule
 * only gains slots, and a weekday that already has three keeps them, with that day left unscheduled and said so; an
 * exercise the person named that they already have (or that's built in) is reused, never duplicated or renamed.
 * With an idempotency key, a retried save returns the plans the first one made instead of making them again.
 */
export async function saveImport(userId: string, input: ImportSave, key: string | null) {
  await assertExercisesVisible(userId, input.days.flatMap((d) => d.exercises.flatMap((e) => (e.exerciseId ? [e.exerciseId] : []))));
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
      const templates: { id: string; name: string; weekday: number | null }[] = [];
      for (const [i, day] of input.days.entries()) {
        const t = await tx.workoutTemplate.create({
          data: {
            ...(ids[i] ? { id: ids[i] } : {}),
            userId,
            name: planName(input.programName, day.name),
            notes: day.notes ?? null,
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
      const unscheduled: string[] = [];
      for (const t of templates) {
        if (t.weekday === null) continue;
        const taken = await tx.scheduleSlot.count({ where: { userId, weekday: t.weekday } });
        if (taken >= MAX_SLOTS_PER_WEEKDAY) { unscheduled.push(t.name); continue; }
        await tx.scheduleSlot.create({ data: { userId, weekday: t.weekday, templateId: t.id, position: taken } });
      }
      return { templates: templates.map(({ id, name, weekday }) => ({ id, name, weekday })), unscheduled, repeated: false };
    }, { maxWait: 10_000, timeout: 30_000 });
  } catch (err) {
    if (!key || !isUniqueViolation(err)) throw err;
    // The same save, retried: the first one's plans, unchanged.
    const existing = await prisma.workoutTemplate.findMany({ where: { id: { in: ids as string[] }, userId }, select: { id: true, name: true } });
    if (existing.length !== ids.length) throw new HttpError(409, "An earlier attempt saved part of this differently. Check your plans before importing again.");
    return { templates: existing.map((t) => ({ ...t, weekday: null })), unscheduled: [], repeated: true };
  }
}
