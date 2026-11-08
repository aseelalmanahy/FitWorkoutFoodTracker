import { PlanImport } from "@/components/workouts/plan-import";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Import a plan" };

export default function ImportPlanPage() {
  return (
    <Page width="medium">
      <PageHeader title="Import a plan" subtitle="From a file: you check every exercise before anything is saved." back="/workouts" />
      <PlanImport />
    </Page>
  );
}
