// Reads the pending migration as text, so it runs without applying anything. It can't show that
// PostgreSQL accepts the SQL or that rows survive. scripts/nutrition-target-migration-check.cjs does,
// once the owner has approved applying the migration to a designated test database.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../../..");
const raw = readFileSync(path.join(ROOT, "prisma/migrations/20261106120000_nullable_nutrition_targets/migration.sql"), "utf8");
const sql = raw.replace(/--.*$/gm, "");
const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");

describe("the NutritionTarget migration", () => {
  it.each(["kcal", "proteinG", "carbsG", "fatG"])("T44: makes %s nullable", (column) => {
    expect(sql).toContain(`ALTER COLUMN "${column}" DROP NOT NULL`);
  });
  it("T44: rewrites no row, and touches only this table", () => {
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|INSERT|TRUNCATE|DROP TABLE|DROP COLUMN|SET DEFAULT|COALESCE)\b/i);
    expect(sql.match(/ALTER TABLE "(\w+)"/g)).toEqual(['ALTER TABLE "NutritionTarget"']);
  });
  it("T38: a stopped row must have no macros and be the person's own", () => {
    expect(sql.replace(/\s+/g, " ")).toContain(`ADD CONSTRAINT "NutritionTarget_stop_shape" CHECK ( "kcal" IS NOT NULL OR ("proteinG" IS NULL AND "carbsG" IS NULL AND "fatG" IS NULL AND "source" = 'MANUAL'))`);
  });
  it("T38: carbs need both protein and fat", () => {
    expect(sql.replace(/\s+/g, " ")).toContain(`ADD CONSTRAINT "NutritionTarget_carbs_derived" CHECK ( "carbsG" IS NULL OR ("proteinG" IS NOT NULL AND "fatG" IS NOT NULL))`);
  });
  it("matches the schema, which also names the constraints it can't express", () => {
    const model = schema.slice(schema.indexOf("model NutritionTarget {"));
    for (const column of ["kcal", "proteinG", "carbsG", "fatG"]) expect(model).toMatch(new RegExp(`^\\s+${column}\\s+Int\\?$`, "m"));
    for (const name of ["NutritionTarget_stop_shape", "NutritionTarget_carbs_derived"]) expect(schema).toContain(name);
  });
  it("leaves Profile alone, which is 4.0.1c", () => {
    expect(schema).toMatch(/^\s+sex\s+Sex$/m);
    expect(schema).toMatch(/^\s+goal\s+FitnessGoal$/m);
    expect(schema).toMatch(/^\s+heightCm\s+Float$/m);
  });
});
