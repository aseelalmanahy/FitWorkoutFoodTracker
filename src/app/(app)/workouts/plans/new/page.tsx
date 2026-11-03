import { requireProfile } from "@/lib/server/profile";
import { PageHeader } from "@/components/ui";
import { PlanEditor } from "@/components/workouts/plan-editor";

export const metadata = { title: "New plan" };

export default async function NewPlanPage() {
  const { profile } = await requireProfile();
  return (
    <>
      <PageHeader title="New plan" back="/workouts" />
      <PlanEditor units={profile.unitSystem} />
    </>
  );
}
