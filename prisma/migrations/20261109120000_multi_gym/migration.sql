-- AlterTable
ALTER TABLE "WorkoutSession" ADD COLUMN     "gymLocationId" TEXT;

-- AlterTable
ALTER TABLE "SessionExercise" ADD COLUMN     "gymEquipmentId" TEXT,
ADD COLUMN     "plannedExerciseId" TEXT,
ADD COLUMN     "substitutesId" TEXT;

-- CreateTable
CREATE TABLE "GymLocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GymLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GymEquipment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "kind" "Equipment" NOT NULL,
    "name" TEXT,
    "exerciseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GymEquipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GymLocation_userId_idx" ON "GymLocation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GymLocation_userId_name_key" ON "GymLocation"("userId", "name");

-- CreateIndex
CREATE INDEX "GymEquipment_userId_idx" ON "GymEquipment"("userId");

-- CreateIndex
CREATE INDEX "GymEquipment_gymId_idx" ON "GymEquipment"("gymId");

-- CreateIndex
CREATE UNIQUE INDEX "GymEquipment_gymId_kind_name_key" ON "GymEquipment"("gymId", "kind", "name");

-- CreateIndex
CREATE INDEX "WorkoutSession_gymLocationId_idx" ON "WorkoutSession"("gymLocationId");

-- CreateIndex
CREATE INDEX "SessionExercise_exerciseId_gymEquipmentId_idx" ON "SessionExercise"("exerciseId", "gymEquipmentId");

-- CreateIndex
CREATE INDEX "SessionExercise_substitutesId_idx" ON "SessionExercise"("substitutesId");

-- AddForeignKey
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_gymLocationId_fkey" FOREIGN KEY ("gymLocationId") REFERENCES "GymLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionExercise" ADD CONSTRAINT "SessionExercise_gymEquipmentId_fkey" FOREIGN KEY ("gymEquipmentId") REFERENCES "GymEquipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionExercise" ADD CONSTRAINT "SessionExercise_substitutesId_fkey" FOREIGN KEY ("substitutesId") REFERENCES "SessionExercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionExercise" ADD CONSTRAINT "SessionExercise_plannedExerciseId_fkey" FOREIGN KEY ("plannedExerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymLocation" ADD CONSTRAINT "GymLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymEquipment" ADD CONSTRAINT "GymEquipment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymEquipment" ADD CONSTRAINT "GymEquipment_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "GymLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymEquipment" ADD CONSTRAINT "GymEquipment_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

