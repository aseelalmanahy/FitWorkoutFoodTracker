import { route, HttpError } from "@/lib/server/api";
import { prisma } from "@/lib/server/db";
import { foodToDto, resolveExternalFood } from "@/lib/server/foods/service";

/** Barcode lookup: user's custom food with this barcode first, then Open Food Facts. */
export const GET = route<{ code: string }>(async (_req, { user, params }) => {
  if (!/^\d{6,14}$/.test(params.code)) throw new HttpError(400, "Barcode must be 6–14 digits");
  const custom = await prisma.food.findFirst({ where: { userId: user.id, source: "CUSTOM", barcode: params.code }, include: { servings: true } });
  if (custom) return { food: foodToDto(custom) };
  return { food: foodToDto(await resolveExternalFood("OPEN_FOOD_FACTS", params.code)) };
});
