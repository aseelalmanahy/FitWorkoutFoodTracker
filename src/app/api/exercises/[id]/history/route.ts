import { route, notFound } from "@/lib/server/api";
import { prisma } from "@/lib/server/db";
import { getExerciseHistory, visibleExercises } from "@/lib/server/workouts";
import { computeRecords, summarizeSets } from "@/lib/overload";

/** ?machine= gives one machine's own history and records; without it, the shared history with no specific machine. */
export const GET = route<{ id: string }>(async (req, { user, params }) => {
  const exercise = await prisma.exercise.findFirst({ where: { id: params.id, ...visibleExercises(user.id) } });
  if (!exercise) throw notFound("Exercise");
  const machine = req.nextUrl.searchParams.get("machine");
  if (machine && !(await prisma.gymEquipment.findFirst({ where: { id: machine, userId: user.id }, select: { id: true } }))) throw notFound("Machine");
  const history = await getExerciseHistory(user.id, exercise.id, machine);
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
