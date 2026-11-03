import { route, HttpError } from "@/lib/server/api";
import { isIsoDate } from "@/lib/nutrition";
import { daySummary } from "@/lib/server/nutrition/entries";
import { localToday } from "@/lib/server/nutrition/targets";
import { requireApiProfile } from "@/lib/server/nutrition/profile";

/** Entries grouped by meal, daily totals, the target in force that day, remaining and progress. */
export const GET = route(async (req, { user }) => {
  const profile = await requireApiProfile(user.id);
  const date = req.nextUrl.searchParams.get("date") ?? localToday(profile.timezone);
  if (!isIsoDate(date)) throw new HttpError(400, "date must be YYYY-MM-DD");
  return daySummary(user.id, profile, date);
});
