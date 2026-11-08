import { notFound } from "next/navigation";
import { requireUser } from "@/lib/server/auth";
import { isAdmin } from "@/lib/server/admins";
import { listAllFeedback } from "@/lib/server/feedback";
import { AdminFeedback } from "@/components/feedback/admin-feedback";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Feedback review" };
export const dynamic = "force-dynamic";

/** Administrators only, decided on the server: anyone else gets the ordinary "not found" page. */
export default async function AdminFeedbackPage() {
  const user = await requireUser();
  if (!isAdmin(user.id)) notFound();
  const { feedback, counts } = await listAllFeedback({});
  return (
    <Page width="medium">
      <PageHeader title="Feedback review" subtitle="Private. Reporters are shown by a short reference only." />
      <AdminFeedback initial={feedback.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() }))} counts={counts} />
    </Page>
  );
}
