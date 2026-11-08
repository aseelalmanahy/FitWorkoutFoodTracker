import { route } from "@/lib/server/api";
import { removeMachine } from "@/lib/server/gyms";

export const DELETE = route<{ id: string; machineId: string }>(async (_req, { user, params }) => { await removeMachine(user.id, params.id, params.machineId); return { ok: true }; });
