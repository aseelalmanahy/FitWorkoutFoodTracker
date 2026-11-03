import { route, parseBody, HttpError, notFound } from "@/lib/server/api";
import { startSessionSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";

export const GET = route(async (req, { user }) => {
  const take = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20) || 20, 100);
  const cursor = req.nextUrl.searchParams.get("cursor");
  const sessions = await prisma.workoutSession.findMany({
    where: { userId: user.id, status: "COMPLETED" },
    orderBy: { startedAt: "desc" },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { exercises: { include: { sets: true, exercise: { select: { name: true } } } } },
  });
  const hasMore = sessions.length > take;
  return { sessions: sessions.slice(0, take), nextCursor: hasMore ? sessions[take - 1].id : null };
});

/**
 * Start a workout: from a plan, by repeating a previous workout, or empty.
 * Only one in-progress workout is allowed at a time.
 */
export const POST = route(async (req, { user }) => {
  const input = await parseBody(req, startSessionSchema);
  const active = await prisma.workoutSession.findFirst({ where: { userId: user.id, status: "IN_PROGRESS" } });
  if (active) throw new HttpError(409, "Finish or discard your current workout first", { sessionId: active.id });

  if ("templateId" in input) {
    const t = await prisma.workoutTemplate.findFirst({
      where: { id: input.templateId, userId: user.id },
      include: { exercises: { orderBy: { position: "asc" } } },
    });
    if (!t) throw notFound("Workout plan");
    const session = await prisma.workoutSession.create({
      data: {
        userId: user.id,
        templateId: t.id,
        name: t.name,
        exercises: {
          create: t.exercises.map((e, position) => ({
            exerciseId: e.exerciseId,
            position,
            restSeconds: e.restSeconds,
            notes: e.notes,
          })),
        },
      },
    });
    return { session };
  }

  if ("fromSessionId" in input) {
    const src = await prisma.workoutSession.findFirst({
      where: { id: input.fromSessionId, userId: user.id },
      include: { exercises: { orderBy: { position: "asc" } } },
    });
    if (!src) throw notFound("Workout");
    const session = await prisma.workoutSession.create({
      data: {
        userId: user.id,
        templateId: src.templateId,
        name: src.name,
        exercises: {
          create: src.exercises.map((e, position) => ({ exerciseId: e.exerciseId, position, restSeconds: e.restSeconds })),
        },
      },
    });
    return { session };
  }

  const session = await prisma.workoutSession.create({ data: { userId: user.id, name: input.name } });
  return { session };
});
