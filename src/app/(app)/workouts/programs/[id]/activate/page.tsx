import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/server/profile";
import { activationPreview } from "@/lib/server/active-program";
import { HttpError } from "@/lib/server/api";
import { PageHeader } from "@/components/ui";
import { ActivateProgram } from "@/components/workouts/activate-program";
import { Page } from "@/components/page";

export const metadata = { title: "Set as active program" };

/** UI-06: preview, then confirm, a program as the active one. Rendered fresh each time, so the preview is current. */
export default async function ActivateProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireProfile();
  const preview = await activationPreview(user.id, id).catch((e) => { if (e instanceof HttpError && e.status === 404) notFound(); throw e; });
  return (
    <Page width="medium">
      <PageHeader title="Set as active program" subtitle={preview.program.name} back={`/workouts/programs/${id}`} />
      {preview.days.length === 0 ? <p className="text-sm text-muted">This program has no workouts.</p> : (
        <ActivateProgram key={preview.version} programId={preview.program.id} programName={preview.program.name} days={preview.days} proposed={preview.proposed} current={preview.current} version={preview.version} alreadyActive={preview.alreadyActive} />
      )}
    </Page>
  );
}
