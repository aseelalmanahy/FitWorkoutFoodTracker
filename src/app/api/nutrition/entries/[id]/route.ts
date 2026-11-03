import { route, parseBody } from "@/lib/server/api";
import { updateFoodEntrySchema } from "@/lib/validation";
import { deleteEntry, updateEntry } from "@/lib/server/nutrition/entries";
import { requireApiProfile } from "@/lib/server/nutrition/profile";

export const PATCH = route<{ id: string }>(async (req, { user, params }) => {
  const profile = await requireApiProfile(user.id);
  const input = await parseBody(req, updateFoodEntrySchema);
  return { entry: await updateEntry(user.id, profile, params.id, input) };
});

export const DELETE = route<{ id: string }>(async (_req, { user, params }) => {
  await deleteEntry(user.id, params.id);
  return { ok: true };
});
