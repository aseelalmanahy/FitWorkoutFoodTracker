import { requireUser } from "@/lib/server/auth";
import { listOwnFeedback } from "@/lib/server/feedback";
import { FeedbackForm } from "@/components/feedback/feedback-form";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Feedback" };
export const dynamic = "force-dynamic";

/** Only an app path of letters, digits, dashes and slashes is kept, so no query or token rides along. */
const pathOf = (from: string | string[] | undefined) => (typeof from === "string" && /^\/[A-Za-z0-9/_-]{0,119}$/.test(from) ? from : null);

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const own = await listOwnFeedback(user.id);
  const from = pathOf((await searchParams).from);
  return (
    <Page width="focused">
      {/* UI-11: opened from the main navigation, it offers the way back to the page it came from. */}
      <PageHeader title="Feedback" subtitle="A bug, an idea, or something that's hard to use: it all helps during the beta." back={from ?? undefined} />
      <FeedbackForm from={from} initial={own.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() }))} />
    </Page>
  );
}
