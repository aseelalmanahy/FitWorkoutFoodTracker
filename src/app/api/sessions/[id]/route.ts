import { route, parseBody } from "@/lib/server/api";
import { updateSessionSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";
import { finishSession, getOwnedSession, getSessionDetail } from "@/lib/server/workouts";

export const GET = route<{ id: string }>(async (_req, { user, params }) => {
  await getOwnedSession(user.id, params.id);
  return { session: await getSessionDetail(user.id, params.id) };
});

export const PATCH = route<{ id: string }>(async (req, { user, params }) => {
  const existing = await getOwnedSession(user.id, params.id);
  const input = await parseBody(req, updateSessionSchema);
  const changes = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  };
  if (input.finish) return { session: await finishSession(user.id, existing.id, changes) };
  return { session: await prisma.workoutSession.update({ where: { id: existing.id }, data: changes }) };
});

export const DELETE = route<{ id: string }>(async (_req, { user, params }) => {
  await getOwnedSession(user.id, params.id);
  await prisma.workoutSession.delete({ where: { id: params.id } });
  return { ok: true };
});
