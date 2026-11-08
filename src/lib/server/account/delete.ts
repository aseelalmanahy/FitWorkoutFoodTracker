import "server-only";
import { Prisma } from "@prisma/client";
import { HttpError } from "../api";
import { prisma } from "../db";

/** A foreign key stopped it. PostgreSQL reports RESTRICT as 23001, which Prisma doesn't map to P2003. */
const isReferenceConflict = (err: unknown) =>
  (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") ||
  (err instanceof Prisma.PrismaClientUnknownRequestError && /\b(23001|23503)\b/.test(err.message));

/**
 * Removes everything the person owns, in one transaction, or nothing at all. Every step is explicit and
 * scoped to this user, and each model's rule is in account-data-map.json. Sessions and templates go before
 * exercises, because their rows restrict deleting an exercise. Shared rows have no owner, so no step
 * reaches them, and other people's food entries keep their own copy of what they logged.
 * Returns false if the account had already gone, which is the same outcome for a repeated request. `verifiedHash`
 * is what the password was checked against: a reset committing meanwhile means that check no longer counts.
 */
export async function deleteAccount(userId: string, verifiedHash: string): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      // Waits for a concurrent deletion, and blocks any new row that refers to this user until this ends.
      const locked = await tx.$queryRaw<{ id: string; email: string; passwordHash: string }[]>`SELECT id, email, "passwordHash" FROM "User" WHERE id = ${userId} FOR UPDATE`;
      if (!locked.length) return false;
      if (locked[0].passwordHash !== verifiedHash) throw new HttpError(409, "Your password was changed elsewhere just now, and nothing was deleted. Log in again and retry.");
      await tx.workoutSession.deleteMany({ where: { userId } });
      // Multi-gym: machines and gyms, now that no session refers to them.
      await tx.gymEquipment.deleteMany({ where: { userId } });
      await tx.gymLocation.deleteMany({ where: { userId } });
      await tx.scheduleSlot.deleteMany({ where: { userId } });
      await tx.workoutTemplate.deleteMany({ where: { userId } });
      await tx.exercise.deleteMany({ where: { userId } });
      await tx.foodEntry.deleteMany({ where: { userId } });
      await tx.food.deleteMany({ where: { userId } });
      await tx.nutritionTarget.deleteMany({ where: { userId } });
      await tx.bodyMetric.deleteMany({ where: { userId } });
      await tx.feedback.deleteMany({ where: { userId } });
      await tx.profile.deleteMany({ where: { userId } });
      await tx.session.deleteMany({ where: { userId } });
      await tx.accountToken.deleteMany({ where: { userId } });
      // A sign-up token has no user, so no cascade reaches it, and it holds the address.
      await tx.accountToken.deleteMany({ where: { email: locked[0].email } });
      await tx.user.delete({ where: { id: userId } });
      return true;
    }, { maxWait: 10_000, timeout: 120_000 });
  } catch (err) {
    // Someone else's row refers to something of theirs. The transaction undid every step.
    if (isReferenceConflict(err)) {
      throw new HttpError(409, "Your account couldn't be deleted, and nothing was changed. Try again later.");
    }
    throw err;
  }
}
