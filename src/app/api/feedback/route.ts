import { accountRoute, parseBody } from "@/lib/server/api";
import { feedbackSubmitSchema } from "@/lib/feedback";
import { listOwnFeedback, submitFeedback } from "@/lib/server/feedback";

// accountRoute, so someone whose account is restricted can still report a problem with it. 16 KB is ample for 2,000
// characters of text and a page path.
export const POST = accountRoute(async (req, { user }) => {
  const input = await parseBody(req, feedbackSubmitSchema, { maxBytes: 16 * 1024 });
  return submitFeedback(user.id, input);
});

export const GET = accountRoute(async (_req, { user }) => ({ feedback: await listOwnFeedback(user.id) }));
