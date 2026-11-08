import { route, parseBody } from "@/lib/server/api";
import { gymEquipmentSchema, machineSchema } from "@/lib/gyms";
import { addMachine, setGymKinds } from "@/lib/server/gyms";

/** PUT: the kinds of equipment this gym has. POST: one named machine. */
export const PUT = route<{ id: string }>(async (req, { user, params }) => ({ gym: await setGymKinds(user.id, params.id, (await parseBody(req, gymEquipmentSchema)).kinds) }));
export const POST = route<{ id: string }>(async (req, { user, params }) => ({ machine: await addMachine(user.id, params.id, await parseBody(req, machineSchema)) }));
