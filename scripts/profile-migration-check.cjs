// T44: proves the Profile migration keeps existing rows. It doesn't apply the migration. Applying it needs
// the owner's approval, and only ever on a designated test database.
//   snapshot: adds legacy-shaped rows and records every row in the table. Run just before applying.
//   verify:   run after applying. Checks the columns, that no default appeared, and that every recorded row is unchanged.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser, profileMigrationApplied, PROFILE_NULLABLE_COLUMNS } = require("./lib/test-users.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const FILE = path.join(os.tmpdir(), "fit-profile-migration-snapshot.json");
const mode = process.argv[2];
const allRows = async () => JSON.stringify(await prisma.profile.findMany({ orderBy: { userId: "asc" } }));
const MAX_SNAPSHOT_AGE_MS = 24 * 3_600_000;

async function snapshot() {
  assert.equal(await profileMigrationApplied(prisma), false, "the migration is already applied, so a snapshot now proves nothing");
  const legacy = { birthDate: new Date("1990-01-01T00:00:00Z"), sex: "FEMALE", heightCm: 170.33, currentWeightKg: 60.125, goal: "MAINTENANCE", activityLevel: "LIGHT", experience: "BEGINNER", workoutDaysPerWeek: 2, unitSystem: "IMPERIAL", timezone: "Asia/Dubai" };
  const shapes = [
    { name: "Plain" },
    { name: "Goal weight", goalWeightKg: 55.5 },
    { name: "Override", calorieTargetOverride: 800 }, // a legacy override
    { name: "Zero days", workoutDaysPerWeek: 0 },
    { name: "Under minimum", birthDate: new Date(Date.UTC(new Date().getUTCFullYear() - 10, 0, 1)) }, // a legacy restricted row
  ];
  for (const [i, shape] of shapes.entries()) {
    const { user } = await createSignedInUser(prisma, `profilemigration${i}x${Date.now()}@test.dev`);
    await prisma.profile.create({ data: { userId: user.id, ...legacy, ...shape } });
  }
  fs.writeFileSync(FILE, await allRows());
  console.log(`Snapshot taken: ${JSON.parse(fs.readFileSync(FILE, "utf8")).length} rows`);
}

async function verify() {
  assert.equal(await profileMigrationApplied(prisma), true, "BLOCKED: the migration isn't applied");
  const defaults = await prisma.$queryRawUnsafe(`SELECT column_name, column_default FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Profile' AND column_default IS NOT NULL ORDER BY column_name`);
  assert.deepEqual(defaults.map((d) => d.column_name), ["timezone", "unitSystem"], "no default was added");
  const required = await prisma.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Profile' AND is_nullable = 'NO' ORDER BY column_name`);
  assert.deepEqual(required.map((c) => c.column_name), ["birthDate", "name", "timezone", "unitSystem", "updatedAt", "userId"], "what's used stays required");
  assert.equal(PROFILE_NULLABLE_COLUMNS.length, 7);
  assert.ok(fs.existsSync(FILE), "no snapshot was taken before applying");
  // An old snapshot would show only that rows it happens to contain survived, not the rows at migration time.
  assert.ok(Date.now() - fs.statSync(FILE).mtimeMs < MAX_SNAPSHOT_AGE_MS, "the snapshot is stale: delete it, and take one just before applying");
  const before = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const now = new Map(JSON.parse(await allRows()).map((r) => [r.userId, r]));
  for (const row of before) assert.deepEqual(now.get(row.userId), row, `row ${row.userId} unchanged`);
  console.log(`MIGRATION VERIFIED: ${before.length} rows unchanged, no default added`);
}

(async () => {
  await target.verifyServer();
  if (mode === "snapshot") await snapshot();
  else if (mode === "verify") await verify();
  else throw new Error("usage: snapshot | verify");
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
