import { route, parseBody } from "@/lib/server/api";
import { substituteSchema } from "@/lib/gym-schemas";
import { revertSwap, substitute } from "@/lib/server/gyms";

export const POST = route<{ id: string; seId: string }>(async (req, { user, params }) => substitute(user.id, params.id, params.seId, await parseBody(req, substituteSchema)));

/** GYM-01: switch back to the original exercise, while nothing is logged on this replacement. */
export const DELETE = route<{ id: string; seId: string }>(async (_req, { user, params }) => revertSwap(user.id, params.id, params.seId));
