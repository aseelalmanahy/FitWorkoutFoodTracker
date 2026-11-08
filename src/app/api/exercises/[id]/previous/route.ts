import { notFound, route } from "@/lib/server/api";
import { prisma } from "@/lib/server/db";
import { getPreviousPerformances, visibleExercises } from "@/lib/server/workouts";
import { contextKey } from "@/lib/movement-patterns";

/** Most recent completed performance of an exercise, optionally excluding a session. */
export const GET = route<{ id: string }>(async (req, { user, params }) => {
  // The same answer as /history for an exercise this person can't see, rather than a null that reads as "not done yet".
  const exercise = await prisma.exercise.findFirst({ where: { id: params.id, ...visibleExercises(user.id) }, select: { id: true } });
  if (!exercise) throw notFound("Exercise");
  const exclude = req.nextUrl.searchParams.get("exclude") ?? undefined;
  // Multi-gym: ?machine=<id> asks for that machine's own history; without it, the shared one.
  const machine = req.nextUrl.searchParams.get("machine") || null;
  if (machine && !(await prisma.gymEquipment.findFirst({ where: { id: machine, userId: user.id }, select: { id: true } }))) throw notFound("Machine");
  const map = await getPreviousPerformances(user.id, [{ exerciseId: params.id, gymEquipmentId: machine }], { excludeSessionId: exclude });
  return { previous: map.get(contextKey(params.id, machine)) ?? null };
});
