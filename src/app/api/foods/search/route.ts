import { route } from "@/lib/server/api";
import { foodSearchQuerySchema } from "@/lib/validation";
import { searchFoods, type SearchSource } from "@/lib/server/foods/service";

/**
 * Search the user's custom foods, USDA FoodData Central (generic foods) and
 * Open Food Facts (packaged foods). Per-source failures are reported in
 * `errors` and don't fail the whole search. An 8–14 digit query is treated as a barcode.
 */
export const GET = route(async (req, { user }) => {
  const { q, sources } = foodSearchQuerySchema.parse({
    q: req.nextUrl.searchParams.get("q") ?? "",
    sources: req.nextUrl.searchParams.get("sources") ?? undefined,
  });
  return searchFoods(user.id, q, sources as SearchSource[]);
});
