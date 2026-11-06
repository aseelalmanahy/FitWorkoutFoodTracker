-- Phase 4.0.1b: nullable nutrition targets. See docs/PHASE_4_0_1_IMPLEMENTATION_PLAN.md, Annex H4 and H6.
--
-- Decisions 20 and 26 share this migration: same table, readers, export shape and rollback hazard.
-- A null macro means "not set", and zero stays zero. A null kcal means "no target from this date".
-- No existing row is rewritten, and every existing row already satisfies both constraints.
--
-- Rollback is one-way once a null exists: PostgreSQL refuses NOT NULL while nulls exist, filling them
-- with 0 would invent targets, and deleting stopped rows would change history. Forward fix only.

ALTER TABLE "NutritionTarget"
  ALTER COLUMN "kcal" DROP NOT NULL,
  ALTER COLUMN "proteinG" DROP NOT NULL,
  ALTER COLUMN "carbsG" DROP NOT NULL,
  ALTER COLUMN "fatG" DROP NOT NULL,
  ADD CONSTRAINT "NutritionTarget_stop_shape" CHECK (
    "kcal" IS NOT NULL
    OR ("proteinG" IS NULL AND "carbsG" IS NULL AND "fatG" IS NULL AND "source" = 'MANUAL')),
  ADD CONSTRAINT "NutritionTarget_carbs_derived" CHECK (
    "carbsG" IS NULL OR ("proteinG" IS NOT NULL AND "fatG" IS NOT NULL));
