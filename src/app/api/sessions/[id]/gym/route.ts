import { route, parseBody } from "@/lib/server/api";
import { sessionGymSchema } from "@/lib/gyms";
import { setSessionGym } from "@/lib/server/gyms";

export const PUT = route<{ id: string }>(async (req, { user, params }) => ({ session: await setSessionGym(user.id, params.id, (await parseBody(req, sessionGymSchema)).gymLocationId) }));
