import { route, parseBody, notFound } from "@/lib/server/api";
import { updateSetSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";

type P = { id: string; seId: string; setId: string };

async function ownedSet(userId: string, p: P) {
  const set = await prisma.setEntry.findFirst({
    where: { id: p.setId, sessionExerciseId: p.seId, sessionExercise: { sessionId: p.id, session: { userId } } },
  });
  if (!set) throw notFound("Set");
  return set;
}

export const PATCH = route<P>(async (req, { user, params }) => {
  const set = await ownedSet(user.id, params);
  const input = await parseBody(req, updateSetSchema);
  return { set: await prisma.setEntry.update({ where: { id: set.id }, data: input }) };
});

export const DELETE = route<P>(async (_req, { user, params }) => {
  const set = await ownedSet(user.id, params);
  await prisma.$transaction(async (tx) => {
    await tx.setEntry.delete({ where: { id: set.id } });
    // Keep set numbers contiguous.
    const rest = await tx.setEntry.findMany({ where: { sessionExerciseId: set.sessionExerciseId }, orderBy: { setNumber: "asc" } });
    for (const [i, s] of rest.entries()) {
      if (s.setNumber !== i + 1) await tx.setEntry.update({ where: { id: s.id }, data: { setNumber: i + 1 } });
    }
  });
  return { ok: true };
});
