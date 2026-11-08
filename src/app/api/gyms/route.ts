import { route, parseBody } from "@/lib/server/api";
import { gymSchema } from "@/lib/gym-schemas";
import { createGym, listGyms } from "@/lib/server/gyms";

export const GET = route(async (_req, { user }) => ({ gyms: await listGyms(user.id) }));
export const POST = route(async (req, { user }) => ({ gym: await createGym(user.id, (await parseBody(req, gymSchema)).name) }));
