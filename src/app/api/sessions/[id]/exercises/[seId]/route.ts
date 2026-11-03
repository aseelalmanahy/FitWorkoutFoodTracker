import { route, parseBody } from "@/lib/server/api";
import { updateSessionExerciseSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";
import { getOwnedSessionExercise } from "@/lib/server/workouts";

type P = { id: string; seId: string };

export const PATCH = route<P>(async (req, { user, params }) => {
  const se = await getOwnedSessionExercise(user.id, params.id, params.seId);
  const input = await parseBody(req, updateSessionExerciseSchema);
  if (input.move) {
    const neighbour = await prisma.sessionExercise.findFirst({
      where: {
        sessionId: se.sessionId,
        position: input.move === "up" ? { lt: se.position } : { gt: se.position },
      },
      orderBy: { position: input.move === "up" ? "desc" : "asc" },
    });
    if (neighbour) {
      await prisma.$transaction([
        prisma.sessionExercise.update({ where: { id: se.id }, data: { position: neighbour.position } }),
        prisma.sessionExercise.update({ where: { id: neighbour.id }, data: { position: se.position } }),
      ]);
    }
  }
  const updated = await prisma.sessionExercise.update({
    where: { id: se.id },
    data: {
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.restSeconds !== undefined ? { restSeconds: input.restSeconds } : {}),
    },
  });
  return { sessionExercise: updated };
});

export const DELETE = route<P>(async (_req, { user, params }) => {
  const se = await getOwnedSessionExercise(user.id, params.id, params.seId);
  await prisma.sessionExercise.delete({ where: { id: se.id } });
  return { ok: true };
});
