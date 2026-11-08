import { adminRoute, parseBody } from "@/lib/server/api";
import { feedbackUpdateSchema } from "@/lib/feedback";
import { updateFeedback } from "@/lib/server/feedback";

export const PATCH = adminRoute<{ id: string }>(async (req, { params }) => {
  const patch = await parseBody(req, feedbackUpdateSchema, { maxBytes: 16 * 1024 });
  return { feedback: await updateFeedback(params.id, patch) };
});
