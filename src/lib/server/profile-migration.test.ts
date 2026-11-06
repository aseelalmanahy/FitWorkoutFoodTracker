// Reads the pending migration as text, so it runs without applying anything. It can't show that
// PostgreSQL accepts the SQL or that rows survive. scripts/profile-migration-check.cjs does, once the
// owner has approved applying the migration to a designated test database.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const sql = readFileSync(path.join(ROOT, "prisma/migrations/20261106130000_nullable_profile_fields/migration.sql"), "utf8").replace(/--.*$/gm, "");
const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
const model = schema.slice(schema.indexOf("model Profile {"), schema.indexOf("// ─── Exercise library"));

const NULLABLE = ["sex", "heightCm", "currentWeightKg", "goal", "activityLevel", "experience", "workoutDaysPerWeek"];

describe("the Profile migration", () => {
  it("T44: makes exactly the seven approved columns nullable", () => {
    const columns = [...sql.matchAll(/ALTER COLUMN "(\w+)" DROP NOT NULL/g)].map((m) => m[1]);
    expect(columns).toEqual(NULLABLE);
  });
  it("T44: rewrites no row, adds no default, and touches only this table", () => {
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|INSERT|TRUNCATE|DROP TABLE|DROP COLUMN|DEFAULT|COALESCE|ADD COLUMN|TYPE)\b/i);
    expect(sql.match(/ALTER TABLE "(\w+)"/g)).toEqual(['ALTER TABLE "Profile"']);
  });
  it("leaves what's used required: date of birth, for eligibility, above all", () => {
    for (const column of ["name", "birthDate", "unitSystem", "timezone"]) {
      expect(sql).not.toContain(`"${column}"`);
    }
    expect(model).toMatch(/^\s+name\s+String$/m);
    expect(model).toMatch(/^\s+birthDate\s+DateTime\s+@db\.Date$/m);
    expect(model).toMatch(/^\s+unitSystem\s+UnitSystem\s+@default\(IMPERIAL\)$/m);
    expect(model).toMatch(/^\s+timezone\s+String\s+@default\("UTC"\)$/m);
  });
  it("matches the schema, with no default on a nullable field", () => {
    for (const column of NULLABLE) expect(model).toMatch(new RegExp(`^\\s+${column}\\s+\\w+\\?$`, "m"));
  });
});
