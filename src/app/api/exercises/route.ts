import { route, parseBody, HttpError } from "@/lib/server/api";
import { exerciseSchema } from "@/lib/validation";
import { prisma } from "@/lib/server/db";
import { visibleExercises } from "@/lib/server/workouts";

export const GET = route(async (req, { user }) => {
  const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 80) ?? "";
  const exercises = await prisma.exercise.findMany({
    where: { ...visibleExercises(user.id), ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
    orderBy: { name: "asc" },
    take: 200,
  });
  return { exercises };
});

export const POST = route(async (req, { user }) => {
  const input = await parseBody(req, exerciseSchema);
  const clash = await prisma.exercise.findFirst({
    where: { ...visibleExercises(user.id), name: { equals: input.name, mode: "insensitive" } },
  });
  if (clash) throw new HttpError(409, `"${clash.name}" already exists`);
  const exercise = await prisma.exercise.create({ data: { ...input, userId: user.id } });
  return { exercise };
});
