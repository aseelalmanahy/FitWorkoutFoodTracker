// T44: proves the NutritionTarget migration keeps existing rows. It doesn't apply the migration.
// Applying it needs the owner's approval, and only ever on a designated test database.
//   snapshot: adds legacy-shaped rows and records every row in the table. Run just before applying.
//   verify:   run after applying. Checks the columns and constraints, and that every recorded row is unchanged.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser, targetMigrationApplied } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const FILE = path.join(os.tmpdir(), "fit-nutrition-target-migration-snapshot.json");
const mode = process.argv[2];
const allRows = async () => JSON.stringify(await prisma.nutritionTarget.findMany({ orderBy: { id: "asc" } }));

async function snapshot() {
  assert.equal(await targetMigrationApplied(prisma), false, "the migration is already applied, so a snapshot now proves nothing");
  const { user } = await createSignedInUser(prisma, `migration${Date.now()}@test.dev`);
  const row = (date, values) => prisma.nutritionTarget.create({ data: { userId: user.id, effectiveFrom: new Date(`${date}T00:00:00Z`), ...values } });
  await row("2026-01-01", { kcal: 2000, proteinG: 0, carbsG: 500, fatG: 0, source: "MANUAL" }); // a legacy zero
  await row("2026-02-01", { kcal: 1110, proteinG: 80, carbsG: 100, fatG: 20, source: "SUGGESTED" }); // a legacy automatic row
  await row("2026-03-01", { kcal: 800, proteinG: 200, carbsG: 0, fatG: 0, source: "MANUAL" }); // a legacy macro collapse
  fs.writeFileSync(FILE, await allRows());
  console.log(`Snapshot taken: ${JSON.parse(fs.readFileSync(FILE, "utf8")).length} rows`);
}

async function verify() {
  assert.equal(await targetMigrationApplied(prisma), true, "BLOCKED: the migration isn't applied");
  const constraints = await prisma.$queryRawUnsafe(`SELECT conname FROM pg_constraint WHERE conrelid = '"NutritionTarget"'::regclass AND contype = 'c' ORDER BY conname`);
  assert.deepEqual(constraints.map((c) => c.conname), ["NutritionTarget_carbs_derived", "NutritionTarget_stop_shape"]);
  assert.ok(fs.existsSync(FILE), "no snapshot was taken before applying");
  const before = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const now = new Map(JSON.parse(await allRows()).map((r) => [r.id, r]));
  for (const row of before) assert.deepEqual(now.get(row.id), row, `row ${row.id} unchanged`);
  console.log(`MIGRATION VERIFIED: ${before.length} rows unchanged, both constraints present`);
}

(async () => {
  await target.verifyServer();
  if (mode === "snapshot") await snapshot();
  else if (mode === "verify") await verify();
  else throw new Error("usage: snapshot | verify");
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
