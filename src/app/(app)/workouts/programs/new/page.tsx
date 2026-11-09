import { requireProfile } from "@/lib/server/profile";
import { prisma } from "@/lib/server/db";
import { EmptyState, ButtonLink, PageHeader } from "@/components/ui";
import { Page } from "@/components/page";
import { ProgramGrouper } from "@/components/workouts/program-manager";

export const metadata = { title: "Group plans into a program" };

/** UI-01: the safe, manual way to organize plans saved before programs existed. Nothing is grouped for the person. */
export default async function NewProgramPage() {
  const { user } = await requireProfile();
  const plans = await prisma.workoutTemplate.findMany({
    where: { userId: user.id, programId: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, _count: { select: { exercises: true } } },
  });
  return (
    <Page>
      <PageHeader title="Group plans into a program" subtitle="Tick the plans that are days of one program, in order." back="/workouts" />
      {plans.length === 0
        ? <EmptyState title="No individual plans" body="Every plan is already in a program." action={<ButtonLink href="/workouts">Back to workouts</ButtonLink>} />
        : <ProgramGrouper plans={plans.map((p) => ({ id: p.id, name: p.name, exercises: p._count.exercises }))} />}
    </Page>
  );
}
