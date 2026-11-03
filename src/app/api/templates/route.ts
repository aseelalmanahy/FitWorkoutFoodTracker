import { route, parseBody } from "@/lib/server/api";
import { templateSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";
import { assertExercisesVisible, templateInclude } from "@/lib/server/workouts";

export const GET = route(async (_req, { user }) => {
  const templates = await prisma.workoutTemplate.findMany({
    where: { userId: user.id },
    include: templateInclude,
    orderBy: { name: "asc" },
  });
  return { templates };
});

export const POST = route(async (req, { user }) => {
  const input = await parseBody(req, templateSchema);
  await assertExercisesVisible(user.id, input.exercises.map((e) => e.exerciseId));
  const template = await prisma.workoutTemplate.create({
    data: {
      userId: user.id,
      name: input.name,
      notes: input.notes ?? null,
      exercises: { create: input.exercises.map((e, position) => ({ ...e, position })) },
    },
    include: templateInclude,
  });
  return { template };
});
