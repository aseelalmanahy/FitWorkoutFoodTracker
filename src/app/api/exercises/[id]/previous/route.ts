import { notFound, route } from "@/lib/server/api";
import { prisma } from "@/lib/server/db";
import { getPreviousPerformances, visibleExercises } from "@/lib/server/workouts";

/** Most recent completed performance of an exercise, optionally excluding a session. */
export const GET = route<{ id: string }>(async (req, { user, params }) => {
  // The same answer as /history for an exercise this person can't see, rather than a null that reads as "not done yet".
  const exercise = await prisma.exercise.findFirst({ where: { id: params.id, ...visibleExercises(user.id) }, select: { id: true } });
  if (!exercise) throw notFound("Exercise");
  const exclude = req.nextUrl.searchParams.get("exclude") ?? undefined;
  const map = await getPreviousPerformances(user.id, [params.id], { excludeSessionId: exclude });
  return { previous: map.get(params.id) ?? null };
});
