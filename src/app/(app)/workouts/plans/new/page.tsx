import { requireProfile } from "@/lib/server/profile";
import { PageHeader } from "@/components/ui";
import { PlanEditor } from "@/components/workouts/plan-editor";
import { Page } from "@/components/page";

export const metadata = { title: "New plan" };

export default async function NewPlanPage() {
  const { profile } = await requireProfile();
  return (
    <Page width="medium">
      <PageHeader title="New plan" back="/workouts" />
      <PlanEditor units={profile.unitSystem} />
    </Page>
  );
}
