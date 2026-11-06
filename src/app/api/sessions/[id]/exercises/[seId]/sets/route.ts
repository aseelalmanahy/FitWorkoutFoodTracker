import { route, parseBody } from "@/lib/server/api";
import { readIdempotencyKey } from "@/lib/server/idempotency";
import { setSchema } from "@/lib/validation";
import { getOwnedSessionExercise, logSet } from "@/lib/server/workouts";

export const POST = route<{ id: string; seId: string }>(async (req, { user, params }) => {
  const se = await getOwnedSessionExercise(user.id, params.id, params.seId);
  const key = readIdempotencyKey(req);
  const input = await parseBody(req, setSchema);
  return { set: await logSet(user.id, se.id, input, key) };
});
