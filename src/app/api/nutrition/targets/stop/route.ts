import { route } from "@/lib/server/api";
import { requireApiProfile } from "@/lib/server/nutrition/profile";
import { stopTarget } from "@/lib/server/nutrition/targets";

/** The only way to stop a target. Repeating it is harmless. */
export const POST = route(async (_req, { user }) => {
  return stopTarget(user.id, await requireApiProfile(user.id));
});
