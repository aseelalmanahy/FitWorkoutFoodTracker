import { route } from "@/lib/server/api";
import { recentFoods } from "@/lib/server/foods/service";

export const GET = route(async (_req, { user }) => ({ foods: await recentFoods(user.id) }));
