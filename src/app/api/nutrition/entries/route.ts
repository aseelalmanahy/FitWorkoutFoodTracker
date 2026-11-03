import { route, parseBody } from "@/lib/server/api";
import { createFoodEntrySchema } from "@/lib/validation";
import { createEntry } from "@/lib/server/nutrition/entries";
import { requireApiProfile } from "@/lib/server/nutrition/profile";

export const POST = route(async (req, { user }) => {
  const profile = await requireApiProfile(user.id);
  const input = await parseBody(req, createFoodEntrySchema);
  return { entry: await createEntry(user.id, profile, input) };
});
