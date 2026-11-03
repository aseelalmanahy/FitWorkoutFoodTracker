import { notFound } from "next/navigation";
import { prisma } from "@/lib/server/db";
import { requireProfile } from "@/lib/server/profile";
import { PageHeader } from "@/components/ui";
import { PlanEditor } from "@/components/workouts/plan-editor";

export const metadata = { title: "Edit plan" };

export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, profile } = await requireProfile();
  const plan = await prisma.workoutTemplate.findFirst({
    where: { id, userId: user.id },
    include: { exercises: { orderBy: { position: "asc" }, include: { exercise: { select: { name: true } } } } },
  });
  if (!plan) notFound();
  return (
    <>
      <PageHeader title="Edit plan" back="/workouts" />
      <PlanEditor
        planId={plan.id}
        units={profile.unitSystem}
        initial={{
          name: plan.name,
          notes: plan.notes,
          exercises: plan.exercises.map((e) => ({
            exerciseId: e.exerciseId,
            name: e.exercise.name,
            targetSets: e.targetSets,
            targetRepsMin: e.targetRepsMin,
            targetRepsMax: e.targetRepsMax,
            targetWeightKg: e.targetWeightKg,
            restSeconds: e.restSeconds,
            notes: e.notes,
          })),
        }}
      />
    </>
  );
}
