import { route, parseBody } from "@/lib/server/api";
import { activateProgramSchema } from "@/lib/validation";
import { activateProgram, activationPreview } from "@/lib/server/active-program";

/** UI-06: the preview of making this program the active one. Changes nothing. */
export const GET = route<{ id: string }>(async (_req, { user, params }) => activationPreview(user.id, params.id));

/** UI-06: confirm it, with the weekdays chosen in the preview and the preview's version. */
export const POST = route<{ id: string }>(async (req, { user, params }) => {
  const input = await parseBody(req, activateProgramSchema);
  return activateProgram(user.id, params.id, input);
});
