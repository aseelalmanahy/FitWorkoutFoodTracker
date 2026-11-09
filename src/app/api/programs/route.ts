import { route, parseBody } from "@/lib/server/api";
import { createProgramSchema } from "@/lib/validation";
import { createProgram, getPrograms } from "@/lib/server/programs";

/** UI-01: the person's programs, each with its days in order. */
export const GET = route(async (_req, { user }) => ({ programs: await getPrograms(user.id) }));

/** UI-01: group some of the person's own plans into a program (the manual way to organize plans saved earlier). */
export const POST = route(async (req, { user }) => {
  const input = await parseBody(req, createProgramSchema);
  return { program: await createProgram(user.id, input.name, input.templateIds) };
});
