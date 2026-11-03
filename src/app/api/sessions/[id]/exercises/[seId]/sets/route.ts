import { route, parseBody } from "@/lib/server/api";
import { setSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";
import { getOwnedSessionExercise } from "@/lib/server/workouts";

export const POST = route<{ id: string; seId: string }>(async (req, { user, params }) => {
  const se = await getOwnedSessionExercise(user.id, params.id, params.seId);
  const input = await parseBody(req, setSchema);
  const agg = await prisma.setEntry.aggregate({ where: { sessionExerciseId: se.id }, _max: { setNumber: true } });
  const set = await prisma.setEntry.create({
    data: {
      sessionExerciseId: se.id,
      setNumber: (agg._max.setNumber ?? 0) + 1,
      reps: input.reps,
      weightKg: input.weightKg,
      isWarmup: input.isWarmup ?? false,
      rpe: input.rpe ?? null,
    },
  });
  return { set };
});
