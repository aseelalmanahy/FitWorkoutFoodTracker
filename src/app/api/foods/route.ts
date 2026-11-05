import { route, parseBody } from "@/lib/server/api";
import { customFoodSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";
import { createCustomFood } from "@/lib/server/foods/custom";
import { foodToDto } from "@/lib/server/foods/service";
import { readIdempotencyKey } from "@/lib/server/idempotency";

/** The user's custom foods. */
export const GET = route(async (_req, { user }) => {
  const foods = await prisma.food.findMany({ where: { userId: user.id, source: "CUSTOM" }, include: { servings: true }, orderBy: { name: "asc" } });
  return { foods: foods.map(foodToDto) };
});

/** Create a custom food. With an Idempotency-Key, retrying can't create a second one. */
export const POST = route(async (req, { user }) => {
  const key = readIdempotencyKey(req);
  const input = await parseBody(req, customFoodSchema);
  return { food: await createCustomFood(user.id, input, key) };
});
