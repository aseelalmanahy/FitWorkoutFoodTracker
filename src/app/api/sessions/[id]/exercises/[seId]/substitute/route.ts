import { route, parseBody } from "@/lib/server/api";
import { substituteSchema } from "@/lib/gym-schemas";
import { substitute } from "@/lib/server/gyms";

export const POST = route<{ id: string; seId: string }>(async (req, { user, params }) => substitute(user.id, params.id, params.seId, await parseBody(req, substituteSchema)));
