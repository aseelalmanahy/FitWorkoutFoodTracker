import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma, type Food, type FoodServing } from "@prisma/client";
import { prisma } from "../db";
import { idempotencyConflict, idempotentId, isUniqueViolation } from "../idempotency";
import { dec, foodToDto, type FoodDto } from "./service";
import type { CustomFoodInput } from "@/lib/validation";

const sameDecimal = (a: Prisma.Decimal | null, b: Prisma.Decimal | null) => (a === null || b === null ? a === b : a.equals(b));

type FoodValues = Pick<Food, "name" | "brand" | "barcode" | "basisUnit" | "kcalPer100" | "proteinPer100" | "carbsPer100" | "fatPer100" | "fiberPer100">;

function sameFood(food: Food & { servings: FoodServing[] }, values: FoodValues, servingLabel: string, servingAmount: Prisma.Decimal) {
  const serving = food.servings.find((s) => s.isDefault);
  return food.name === values.name && food.brand === values.brand && food.barcode === values.barcode && food.basisUnit === values.basisUnit
    && sameDecimal(food.kcalPer100, values.kcalPer100) && sameDecimal(food.proteinPer100, values.proteinPer100) && sameDecimal(food.carbsPer100, values.carbsPer100)
    && sameDecimal(food.fatPer100, values.fatPer100) && sameDecimal(food.fiberPer100, values.fiberPer100)
    && serving?.label === servingLabel && serving.amount.equals(servingAmount);
}

/** Create a custom food from label values (per serving), stored per 100 g/ml. */
export async function createCustomFood(userId: string, input: CustomFoodInput, idempotencyKey: string | null): Promise<FoodDto> {
  const k = 100 / input.servingAmount;
  const per = (v: number | null | undefined) => (v == null ? null : dec(Math.round(v * k * 1000) / 1000));
  const u = input.basisUnit === "ML" ? "ml" : "g";
  const values: FoodValues = {
    name: input.name,
    brand: input.brand ?? null,
    barcode: input.barcode ?? null,
    basisUnit: input.basisUnit,
    kcalPer100: per(input.perServing.kcal),
    proteinPer100: per(input.perServing.protein),
    carbsPer100: per(input.perServing.carbs),
    fatPer100: per(input.perServing.fat),
    fiberPer100: per(input.perServing.fiber),
  };
  const servingLabel = `${input.servingLabel} (${input.servingAmount} ${u})`;
  // As the column stores it, Decimal(9,3), so a retry of the same request compares equal.
  const servingAmount = new Prisma.Decimal(input.servingAmount).toDecimalPlaces(3);
  const sourceId = idempotencyKey ? idempotentId("food", userId, idempotencyKey) : randomUUID();

  const earlierAttempt = async (): Promise<FoodDto | null> => {
    const food = await prisma.food.findUnique({ where: { source_sourceId: { source: "CUSTOM", sourceId } }, include: { servings: true } });
    if (!food || food.userId !== userId) return null;
    if (!sameFood(food, values, servingLabel, servingAmount)) throw idempotencyConflict();
    return foodToDto(food);
  };

  if (idempotencyKey) {
    const earlier = await earlierAttempt();
    if (earlier) return earlier;
  }
  try {
    const food = await prisma.food.create({
      data: {
        source: "CUSTOM",
        sourceId,
        userId,
        dataType: "Custom",
        ...values,
        servings: {
          create: [
            { label: servingLabel, amount: servingAmount, isDefault: true, position: 0 },
            ...(input.servingAmount !== 100 ? [{ label: `100 ${u}`, amount: new Prisma.Decimal(100), position: 1 }] : []),
          ],
        },
      },
      include: { servings: true },
    });
    return foodToDto(food);
  } catch (err) {
    // Two attempts raced, and the database let one through. This is the other.
    if (idempotencyKey && isUniqueViolation(err)) {
      const earlier = await earlierAttempt();
      if (earlier) return earlier;
    }
    throw err;
  }
}
