-- UI-06 (MIG-ACTIVE): the one active training program per person. Additive and backward-compatible: one nullable
-- column, unique (at most one profile per program, so at most one active program each), cleared if the program is
-- deleted. Existing rows get NULL: no program is made active by this migration.

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "activeProgramId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Profile_activeProgramId_key" ON "Profile"("activeProgramId");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_activeProgramId_fkey" FOREIGN KEY ("activeProgramId") REFERENCES "WorkoutProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;
