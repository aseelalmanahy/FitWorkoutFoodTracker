import { route, HttpError } from "@/lib/server/api";
import { isIsoDate } from "@/lib/nutrition";
import { history } from "@/lib/server/nutrition/entries";
import { localToday } from "@/lib/server/nutrition/targets";
import { requireApiProfile } from "@/lib/server/nutrition/profile";

/** Daily totals and period averages for `days` (1–90) ending on `end` (default today). */
export const GET = route(async (req, { user }) => {
  const profile = await requireApiProfile(user.id);
  const end = req.nextUrl.searchParams.get("end") ?? localToday(profile.timezone);
  const days = Number(req.nextUrl.searchParams.get("days") ?? 7);
  if (!isIsoDate(end)) throw new HttpError(400, "end must be YYYY-MM-DD");
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new HttpError(400, "days must be 1–90");
  return history(user.id, profile, end, days);
});
