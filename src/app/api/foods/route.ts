import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { route, parseBody } from "@/lib/server/api";
import { customFoodSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";
import { dec, foodToDto } from "@/lib/server/foods/service";

/** The user's custom foods. */
export const GET = route(async (_req, { user }) => {
  const foods = await prisma.food.findMany({ where: { userId: user.id, source: "CUSTOM" }, include: { servings: true }, orderBy: { name: "asc" } });
  return { foods: foods.map(foodToDto) };
});

/** Create a custom food from label values (per serving), stored per 100 g/ml. */
export const POST = route(async (req, { user }) => {
  const input = await parseBody(req, customFoodSchema);
  const k = 100 / input.servingAmount;
  const per = (v: number | null | undefined) => (v == null ? null : dec(Math.round(v * k * 1000) / 1000));
  const u = input.basisUnit === "ML" ? "ml" : "g";
  const food = await prisma.food.create({
    data: {
      source: "CUSTOM",
      sourceId: randomUUID(),
      userId: user.id,
      name: input.name,
      brand: input.brand ?? null,
      barcode: input.barcode ?? null,
      dataType: "Custom",
      basisUnit: input.basisUnit,
      kcalPer100: per(input.perServing.kcal),
      proteinPer100: per(input.perServing.protein),
      carbsPer100: per(input.perServing.carbs),
      fatPer100: per(input.perServing.fat),
      fiberPer100: per(input.perServing.fiber),
      servings: {
        create: [
          { label: `${input.servingLabel} (${input.servingAmount} ${u})`, amount: new Prisma.Decimal(input.servingAmount), isDefault: true, position: 0 },
          ...(input.servingAmount !== 100 ? [{ label: `100 ${u}`, amount: new Prisma.Decimal(100), position: 1 }] : []),
        ],
      },
    },
    include: { servings: true },
  });
  return { food: foodToDto(food) };
});
