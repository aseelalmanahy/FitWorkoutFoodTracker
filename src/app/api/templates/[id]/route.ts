import { route, parseBody, notFound } from "@/lib/server/api";
import { templateSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";
import { limitLockWait } from "@/lib/server/auth";
import { assertExercisesVisible, templateInclude } from "@/lib/server/workouts";

async function owned(userId: string, id: string) {
  const t = await prisma.workoutTemplate.findFirst({ where: { id, userId } });
  if (!t) throw notFound("Workout plan");
  return t;
}

export const GET = route<{ id: string }>(async (_req, { user, params }) => {
  await owned(user.id, params.id);
  return { template: await prisma.workoutTemplate.findUnique({ where: { id: params.id }, include: templateInclude }) };
});

/** Full replace of name/notes and the ordered exercise list. */
export const PUT = route<{ id: string }>(async (req, { user, params }) => {
  await owned(user.id, params.id);
  const input = await parseBody(req, templateSchema);
  await assertExercisesVisible(user.id, input.exercises.map((e) => e.exerciseId));
  const template = await prisma.$transaction(async (tx) => {
    // A swap in a workout from this plan may hold one of its entries; waiting is bounded, so a stuck one answers 503.
    await limitLockWait(tx);
    await tx.templateExercise.deleteMany({ where: { templateId: params.id } });
    return tx.workoutTemplate.update({
      where: { id: params.id },
      data: {
        name: input.name,
        notes: input.notes ?? null,
        exercises: { create: input.exercises.map((e, position) => ({ ...e, position })) },
      },
      include: templateInclude,
    });
  });
  return { template };
});

export const DELETE = route<{ id: string }>(async (_req, { user, params }) => {
  await owned(user.id, params.id);
  // Logged sessions keep their data; templateId is set to NULL by the FK rule.
  await prisma.$transaction(async (tx) => {
    // Workouts before plan entries, as a swap takes them (see lockPerson in gyms.ts): the in-progress workouts started
    // from this plan are held first, so deleting the plan and a swap in one of them can't each wait for the other.
    await limitLockWait(tx);
    await tx.$queryRaw`SELECT id FROM "WorkoutSession" WHERE "templateId" = ${params.id} AND "userId" = ${user.id} AND status = 'IN_PROGRESS' FOR UPDATE`;
    await tx.workoutTemplate.delete({ where: { id: params.id } });
  });
  return { ok: true };
});
