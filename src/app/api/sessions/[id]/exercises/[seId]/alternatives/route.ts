import { route } from "@/lib/server/api";
import { alternativesFor } from "@/lib/server/gyms";

export const GET = route<{ id: string; seId: string }>(async (_req, { user, params }) => alternativesFor(user.id, params.id, params.seId));
