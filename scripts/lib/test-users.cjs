// Creates a signed-in user directly in the test database, in the form auth.ts stores one: the session
// id is the SHA-256 of the cookie token. Sign-up allows 10 per 15 minutes per client, and that limit
// is correct, so suites needing many users shouldn't spend it or have it loosened. The password can't
// be used to log in. Sign up through the API when a test is about registration or login.
"use strict";
const { createHash, randomBytes } = require("node:crypto");

const UNUSABLE_PASSWORD_HASH = "test-user-without-a-usable-password";

async function createSignedInUser(prisma, email) {
  const user = await prisma.user.create({ data: { email, passwordHash: UNUSABLE_PASSWORD_HASH } });
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: { id: createHash("sha256").update(token).digest("hex"), userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { user, token };
}

/** Read-only. False until the Phase 4.0.1b migration is applied to this database. */
async function targetMigrationApplied(prisma) {
  const rows = await prisma.$queryRawUnsafe(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'NutritionTarget' AND column_name IN ('kcal', 'proteinG', 'carbsG', 'fatG')`);
  return rows.length === 4 && rows.every((r) => r.is_nullable === "YES");
}

const PROFILE_NULLABLE_COLUMNS = ["sex", "heightCm", "currentWeightKg", "goal", "activityLevel", "experience", "workoutDaysPerWeek"];

/** Read-only. False until the Phase 4.0.1c migration is applied to this database. */
async function profileMigrationApplied(prisma) {
  const rows = await prisma.$queryRawUnsafe(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Profile' AND column_name IN (${PROFILE_NULLABLE_COLUMNS.map((c) => `'${c}'`).join(", ")})`);
  return rows.length === PROFILE_NULLABLE_COLUMNS.length && rows.every((r) => r.is_nullable === "YES");
}

module.exports = { createSignedInUser, targetMigrationApplied, profileMigrationApplied, PROFILE_NULLABLE_COLUMNS };
