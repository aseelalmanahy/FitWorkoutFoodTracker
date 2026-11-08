/** Multi-gym: what may be sent about gyms, their equipment, and swaps. Server side: route handlers parse with these. */
import { z } from "zod";
import { EQUIPMENT_KINDS } from "./gyms";

const name = (max: number) => z.string().trim().min(1).max(max);
const id = z.string().min(1).max(40);

export const gymSchema = z.strictObject({ name: name(60) });
export const gymEquipmentSchema = z.strictObject({
  /** Which kinds of equipment the gym has. Replaces the gym's list of kinds; named machines are separate. */
  kinds: z.array(z.enum(EQUIPMENT_KINDS)).max(EQUIPMENT_KINDS.length),
});
export const machineSchema = z.strictObject({
  kind: z.enum(EQUIPMENT_KINDS),
  name: name(60),
  exerciseId: id.nullable().optional(),
});
export const sessionGymSchema = z.strictObject({ gymLocationId: id.nullable() });
export const sessionMachineSchema = z.strictObject({ gymEquipmentId: id.nullable() });
export const substituteSchema = z.strictObject({
  exerciseId: id,
  gymEquipmentId: id.nullable().optional(),
  /** Also change the plan this workout came from, from now on. Off unless the person asks. */
  updatePlan: z.boolean().optional(),
});
