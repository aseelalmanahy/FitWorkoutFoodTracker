import { route, parseBody } from "@/lib/server/api";
import { createFoodEntrySchema } from "@/lib/validation";
import { createEntry } from "@/lib/server/nutrition/entries";
import { requireApiProfile } from "@/lib/server/nutrition/profile";
import { readIdempotencyKey } from "@/lib/server/idempotency";

export const POST = route(async (req, { user }) => {
  const profile = await requireApiProfile(user.id);
  const key = readIdempotencyKey(req);
  const input = await parseBody(req, createFoodEntrySchema);
  return { entry: await createEntry(user.id, profile, input, key) };
});
