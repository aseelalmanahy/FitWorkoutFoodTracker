import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/server/profile";
import { getPreviousPerformances, getSessionDetail } from "@/lib/server/workouts";
import { listGyms } from "@/lib/server/gyms";
import { contextKey } from "@/lib/movement-patterns";
import { WorkoutLogger, type LoggerExercise, type LoggerGym } from "@/components/workouts/workout-logger";
import { Page } from "@/components/page";

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

  // Previous performance per context: a machine's sets are compared only with that machine's.
  const [prev, gymRows] = await Promise.all([
    getPreviousPerformances(user.id, session.exercises.map((e) => ({ exerciseId: e.exerciseId, gymEquipmentId: e.gymEquipmentId })), { excludeSessionId: id }),
    listGyms(user.id),
  ]);
  const targets = new Map(session.template?.exercises.map((t) => [t.exerciseId, t]) ?? []);
  const gyms: LoggerGym[] = gymRows.map((g) => ({
    id: g.id, name: g.name,
    machines: g.equipment.flatMap((m) => (m.name ? [{ id: m.id, name: m.name, exerciseId: m.exerciseId }] : [])),
  }));

  const initial: LoggerExercise[] = session.exercises.map((e) => {
    const p = prev.get(contextKey(e.exerciseId, e.gymEquipmentId));
    // A swapped-in exercise keeps the plan's target for what it replaced.
    const t = targets.get(e.plannedExerciseId ?? e.exerciseId);
    return {
      id: e.id,
      exercise: { id: e.exercise.id, name: e.exercise.name, equipment: e.exercise.equipment },
      notes: e.notes,
      restSeconds: e.restSeconds,
      sets: e.sets.map(pickSet),
      prev: p ? { date: p.date.toISOString(), sets: p.sets.map(pickSet) } : null,
      target: t ? { sets: t.targetSets, repsMin: t.targetRepsMin, repsMax: t.targetRepsMax, weightKg: t.targetWeightKg } : null,
      machine: e.machine?.name ? { id: e.machine.id, name: e.machine.name } : null,
      planned: e.plannedExercise ? { name: e.plannedExercise.name } : null,
      swappedOut: e.substitutedBy.length > 0,
    };
  });

  // The logger stays one focused column on every screen: it's a task, and wider wouldn't help.
  return (
    <Page width="focused">
      <WorkoutLogger sessionId={id} name={session.name} startedAt={session.startedAt.toISOString()} units={profile.unitSystem} initial={initial} initialNotes={session.notes}
        gyms={gyms} gymId={session.gymLocationId} fromPlan={Boolean(session.templateId)} />
    </Page>
  );
}
