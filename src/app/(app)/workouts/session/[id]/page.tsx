import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/server/profile";
import { getPreviousPerformances, getSessionDetail } from "@/lib/server/workouts";
import { WorkoutLogger, type LoggerExercise } from "@/components/workouts/workout-logger";

export const metadata = { title: "Log workout" };

const pickSet = (s: { id: string; setNumber: number; reps: number; weightKg: number; isWarmup: boolean }) => ({
  id: s.id, setNumber: s.setNumber, reps: s.reps, weightKg: s.weightKg, isWarmup: s.isWarmup,
});

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, profile } = await requireProfile();
  const session = await getSessionDetail(user.id, id);
  if (!session) notFound();
  if (session.status === "COMPLETED") redirect(`/workouts/history/${id}`);

  const prev = await getPreviousPerformances(user.id, session.exercises.map((e) => e.exerciseId), { excludeSessionId: id });
  const targets = new Map(session.template?.exercises.map((t) => [t.exerciseId, t]) ?? []);

  const initial: LoggerExercise[] = session.exercises.map((e) => {
    const p = prev.get(e.exerciseId);
    const t = targets.get(e.exerciseId);
    return {
      id: e.id,
      exercise: { id: e.exercise.id, name: e.exercise.name, equipment: e.exercise.equipment },
      notes: e.notes,
      restSeconds: e.restSeconds,
      sets: e.sets.map(pickSet),
      prev: p ? { date: p.date.toISOString(), sets: p.sets.map(pickSet) } : null,
      target: t ? { sets: t.targetSets, repsMin: t.targetRepsMin, repsMax: t.targetRepsMax, weightKg: t.targetWeightKg } : null,
    };
  });

  return <WorkoutLogger sessionId={id} name={session.name} startedAt={session.startedAt.toISOString()} units={profile.unitSystem} initial={initial} />;
}
