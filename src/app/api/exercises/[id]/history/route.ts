import { route, notFound } from "@/lib/server/api";
import { prisma } from "@/lib/server/db";
import { getExerciseHistory, visibleExercises } from "@/lib/server/workouts";
import { computeRecords, summarizeSets } from "@/lib/overload";

export const GET = route<{ id: string }>(async (_req, { user, params }) => {
  const exercise = await prisma.exercise.findFirst({ where: { id: params.id, ...visibleExercises(user.id) } });
  if (!exercise) throw notFound("Exercise");
  const history = await getExerciseHistory(user.id, exercise.id);
  const records = computeRecords(history);
  return {
    exercise,
    sessions: history.map((h) => ({
      sessionId: h.sessionId,
      date: h.date,
      summary: summarizeSets(h.sets),
      prs: records.prsBySession.get(h.sessionId) ?? [],
    })),
    records: records.current,
  };
});
