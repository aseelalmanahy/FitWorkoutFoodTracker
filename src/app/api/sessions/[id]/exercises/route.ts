import { route, parseBody } from "@/lib/server/api";
import { addSessionExerciseSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";
import { assertExercisesVisible, getOwnedSession, nextPosition } from "@/lib/server/workouts";

export const POST = route<{ id: string }>(async (req, { user, params }) => {
  await getOwnedSession(user.id, params.id);
  const input = await parseBody(req, addSessionExerciseSchema);
  await assertExercisesVisible(user.id, [input.exerciseId]);
  const sessionExercise = await prisma.sessionExercise.create({
    data: {
      sessionId: params.id,
      exerciseId: input.exerciseId,
      position: await nextPosition(params.id),
      restSeconds: input.restSeconds ?? null,
    },
    include: { exercise: true, sets: true },
  });
  return { sessionExercise };
});
