-- Phase 4.0.1c: Profile data minimization, Decisions 21 and 25.
-- Makes the seven fields nothing reads nullable, so they no longer have to be collected. Rows keep their
-- values: nothing is backfilled, and no default is added. name, birthDate, unitSystem and timezone stay
-- required, as they're used. Rollback is forward-only once a null exists, Annex H6.
ALTER TABLE "Profile"
  ALTER COLUMN "sex" DROP NOT NULL,
  ALTER COLUMN "heightCm" DROP NOT NULL,
  ALTER COLUMN "currentWeightKg" DROP NOT NULL,
  ALTER COLUMN "goal" DROP NOT NULL,
  ALTER COLUMN "activityLevel" DROP NOT NULL,
  ALTER COLUMN "experience" DROP NOT NULL,
  ALTER COLUMN "workoutDaysPerWeek" DROP NOT NULL;
