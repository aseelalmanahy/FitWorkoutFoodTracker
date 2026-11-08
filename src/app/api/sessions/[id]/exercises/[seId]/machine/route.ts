import { route, parseBody } from "@/lib/server/api";
import { sessionMachineSchema } from "@/lib/gym-schemas";
import { setSessionMachine } from "@/lib/server/gyms";

export const PUT = route<{ id: string; seId: string }>(async (req, { user, params }) => ({ sessionExercise: await setSessionMachine(user.id, params.id, params.seId, (await parseBody(req, sessionMachineSchema)).gymEquipmentId) }));
