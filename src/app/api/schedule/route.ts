import { route, parseBody, HttpError } from "@/lib/server/api";
import { scheduleSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";

export const GET = route(async (_req, { user }) => {
  const slots = await prisma.scheduleSlot.findMany({
    where: { userId: user.id },
    orderBy: [{ weekday: "asc" }, { position: "asc" }],
    include: { template: { select: { id: true, name: true } } },
  });
  return { slots };
});

/** Replace the whole weekly schedule. days[0] = Monday; empty array = rest day. */
export const PUT = route(async (req, { user }) => {
  const { days } = await parseBody(req, scheduleSchema);
  const ids = [...new Set(days.flat())];
  const owned = await prisma.workoutTemplate.count({ where: { userId: user.id, id: { in: ids } } });
  if (owned !== ids.length) throw new HttpError(400, "Unknown workout plan in schedule");
  await prisma.$transaction([
    prisma.scheduleSlot.deleteMany({ where: { userId: user.id } }),
    prisma.scheduleSlot.createMany({
      data: days.flatMap((templateIds, weekday) =>
        templateIds.map((templateId, position) => ({ userId: user.id, weekday, templateId, position })),
      ),
    }),
  ]);
  return { ok: true };
});
