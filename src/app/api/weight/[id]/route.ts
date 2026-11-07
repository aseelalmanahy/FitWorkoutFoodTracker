import { route } from "@/lib/server/api";
import { deleteWeightEntry } from "@/lib/server/weight";

export const DELETE = route<{ id: string }>(async (_req, { user, params }) => {
  await deleteWeightEntry(user.id, params.id);
  return { ok: true };
});
