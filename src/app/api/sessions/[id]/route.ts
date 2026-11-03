import { route, parseBody, HttpError } from "@/lib/server/api";
import { updateSessionSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";
import { getOwnedSession, getSessionDetail } from "@/lib/server/workouts";

export const GET = route<{ id: string }>(async (_req, { user, params }) => {
  await getOwnedSession(user.id, params.id);
  return { session: await getSessionDetail(user.id, params.id) };
});

export const PATCH = route<{ id: string }>(async (req, { user, params }) => {
  const existing = await getOwnedSession(user.id, params.id);
  const input = await parseBody(req, updateSessionSchema);
  if (input.finish) {
    if (existing.status === "COMPLETED") throw new HttpError(409, "Workout already finished");
    const sets = await prisma.setEntry.count({ where: { sessionExercise: { sessionId: existing.id } } });
    if (sets === 0) throw new HttpError(400, "Log at least one set before finishing");
    // Drop exercises that were planned but never performed.
    await prisma.sessionExercise.deleteMany({ where: { sessionId: existing.id, sets: { none: {} } } });
  }
  const session = await prisma.workoutSession.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.finish ? { status: "COMPLETED", endedAt: new Date() } : {}),
    },
  });
  return { session };
});

export const DELETE = route<{ id: string }>(async (_req, { user, params }) => {
  await getOwnedSession(user.id, params.id);
  await prisma.workoutSession.delete({ where: { id: params.id } });
  return { ok: true };
});
