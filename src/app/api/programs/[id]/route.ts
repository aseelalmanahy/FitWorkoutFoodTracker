import { route, parseBody } from "@/lib/server/api";
import { updateProgramSchema } from "@/lib/validation";
import { getPrograms, ungroupProgram, updateProgram } from "@/lib/server/programs";

export const GET = route<{ id: string }>(async (_req, { user, params }) => ({ program: (await getPrograms(user.id, params.id))[0] }));

/** Rename, and set the days and their order. Days left out become individual plans. */
export const PATCH = route<{ id: string }>(async (req, { user, params }) => {
  const input = await parseBody(req, updateProgramSchema);
  return { program: await updateProgram(user.id, params.id, input) };
});

/** Ungroup: the program goes; its plans stay, as individual plans, with their schedule and history. */
export const DELETE = route<{ id: string }>(async (_req, { user, params }) => ungroupProgram(user.id, params.id));
