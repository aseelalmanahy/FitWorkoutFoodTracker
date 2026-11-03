import { route, parseBody } from "@/lib/server/api";
import { resolveFoodSchema } from "@/lib/validation";
import { foodToDto, resolveExternalFood } from "@/lib/server/foods/service";

/** Fetch (or reuse cached) full details for an external food so it can be logged. */
export const POST = route(async (req, { user }) => {
  const { source, sourceId } = await parseBody(req, resolveFoodSchema);
  return { food: foodToDto(await resolveExternalFood(source, sourceId, user.id)) };
});
