import { adminRoute } from "@/lib/server/api";
import { feedbackFilterSchema } from "@/lib/feedback";
import { redactedFeedbackExport } from "@/lib/server/feedback";

// A download for the owner's review (phase 6), never cached (API_HEADERS), redacted and pseudonymous.
export const GET = adminRoute(async (req) => {
  const filter = feedbackFilterSchema.parse(Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== "")));
  const now = new Date();
  return new Response(JSON.stringify(await redactedFeedbackExport(filter, now), null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="feedback-review-${now.toISOString().slice(0, 10)}.json"` },
  });
});
