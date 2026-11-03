import { route, notFound } from "@/lib/server/api";
import { prisma } from "@/lib/server/db";
import { foodToDto, getVisibleFood } from "@/lib/server/foods/service";

export const GET = route<{ id: string }>(async (_req, { user, params }) => {
  const food = await getVisibleFood(user.id, params.id);
  if (!food) throw notFound("Food");
  return { food: foodToDto(food) };
});

/** Delete a custom food. Logged entries keep their nutrition snapshot (foodId → NULL). */
export const DELETE = route<{ id: string }>(async (_req, { user, params }) => {
  const food = await prisma.food.findFirst({ where: { id: params.id, userId: user.id, source: "CUSTOM" } });
  if (!food) throw notFound("Food");
  await prisma.food.delete({ where: { id: food.id } });
  return { ok: true };
});
