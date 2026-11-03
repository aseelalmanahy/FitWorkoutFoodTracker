-- CreateEnum
CREATE TYPE "FoodSource" AS ENUM ('USDA', 'OPEN_FOOD_FACTS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BasisUnit" AS ENUM ('G', 'ML');

-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK');

-- CreateEnum
CREATE TYPE "TargetSource" AS ENUM ('SUGGESTED', 'MANUAL');

-- CreateTable
CREATE TABLE "Food" (
    "id" TEXT NOT NULL,
    "source" "FoodSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "barcode" TEXT,
    "dataType" TEXT,
    "basisUnit" "BasisUnit" NOT NULL DEFAULT 'G',
    "kcalPer100" DECIMAL(9,3),
    "proteinPer100" DECIMAL(9,3),
    "carbsPer100" DECIMAL(9,3),
    "fatPer100" DECIMAL(9,3),
    "fiberPer100" DECIMAL(9,3),
    "fetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Food_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodServing" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(9,3) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FoodServing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "mealType" "MealType" NOT NULL,
    "foodId" TEXT,
    "foodName" TEXT NOT NULL,
    "brand" TEXT,
    "basisUnit" "BasisUnit" NOT NULL,
    "kcalPer100" DECIMAL(9,3),
    "proteinPer100" DECIMAL(9,3),
    "carbsPer100" DECIMAL(9,3),
    "fatPer100" DECIMAL(9,3),
    "fiberPer100" DECIMAL(9,3),
    "servingLabel" TEXT NOT NULL,
    "servingAmount" DECIMAL(9,3) NOT NULL,
    "quantity" DECIMAL(8,3) NOT NULL,
    "kcal" DECIMAL(10,2),
    "protein" DECIMAL(10,2),
    "carbs" DECIMAL(10,2),
    "fat" DECIMAL(10,2),
    "fiber" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoodEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NutritionTarget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "kcal" INTEGER NOT NULL,
    "proteinG" INTEGER NOT NULL,
    "carbsG" INTEGER NOT NULL,
    "fatG" INTEGER NOT NULL,
    "source" "TargetSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NutritionTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Food_barcode_idx" ON "Food"("barcode");

-- CreateIndex
CREATE INDEX "Food_userId_name_idx" ON "Food"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Food_source_sourceId_key" ON "Food"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "FoodServing_foodId_label_key" ON "FoodServing"("foodId", "label");

-- CreateIndex
CREATE INDEX "FoodEntry_userId_date_idx" ON "FoodEntry"("userId", "date");

-- CreateIndex
CREATE INDEX "FoodEntry_userId_foodId_idx" ON "FoodEntry"("userId", "foodId");

-- CreateIndex
CREATE UNIQUE INDEX "NutritionTarget_userId_effectiveFrom_key" ON "NutritionTarget"("userId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "Food" ADD CONSTRAINT "Food_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodServing" ADD CONSTRAINT "FoodServing_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodEntry" ADD CONSTRAINT "FoodEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodEntry" ADD CONSTRAINT "FoodEntry_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "Food"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NutritionTarget" ADD CONSTRAINT "NutritionTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
