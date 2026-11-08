import { route, parseBody } from "@/lib/server/api";
import { gymSchema } from "@/lib/gyms";
import { getOwnedGym, renameGym } from "@/lib/server/gyms";

export const GET = route<{ id: string }>(async (_req, { user, params }) => ({ gym: await getOwnedGym(user.id, params.id) }));
export const PATCH = route<{ id: string }>(async (req, { user, params }) => ({ gym: await renameGym(user.id, params.id, (await parseBody(req, gymSchema)).name) }));
