import { route } from "@/lib/server/api";
import { getPreviousPerformances } from "@/lib/server/workouts";

/** Most recent completed performance of an exercise, optionally excluding a session. */
export const GET = route<{ id: string }>(async (req, { user, params }) => {
  const exclude = req.nextUrl.searchParams.get("exclude") ?? undefined;
  const map = await getPreviousPerformances(user.id, [params.id], { excludeSessionId: exclude });
  return { previous: map.get(params.id) ?? null };
});
