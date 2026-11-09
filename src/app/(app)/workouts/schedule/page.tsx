import { prisma } from "@/lib/server/db";
import { requireProfile } from "@/lib/server/profile";
import { getSchedule } from "@/lib/server/stats";
import { localParts } from "@/lib/time";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { ScheduleEditor } from "@/components/workouts/schedule-editor";
import { Page } from "@/components/page";

export const metadata = { title: "Weekly schedule" };

export default async function SchedulePage() {
  const { user, profile } = await requireProfile();
  const [rows, schedule] = await Promise.all([
    prisma.workoutTemplate.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, programId: true, program: { select: { name: true } }, _count: { select: { exercises: true } } },
      orderBy: [{ program: { name: "asc" } }, { programPosition: "asc" }, { name: "asc" }],
    }),
    getSchedule(user.id),
  ]);
  const plans = rows.map((p) => ({ id: p.id, name: p.name, programId: p.programId, programName: p.program?.name ?? null, exercises: p._count.exercises }));
  const active = profile.activeProgramId ? await prisma.workoutProgram.findFirst({ where: { id: profile.activeProgramId, userId: user.id }, select: { id: true, name: true } }) : null;
  return (
    <Page width="focused">
      <PageHeader title="Weekly schedule" subtitle="Your workouts for each day. Days without one are rest days. Changes are saved only when you choose Save schedule." back="/workouts" />
      {plans.length === 0 ? (
        <EmptyState title="Create a plan first" body="Schedules are built from your workout plans." action={<ButtonLink href="/workouts/plans/new">Create a plan</ButtonLink>} />
      ) : (
        <ScheduleEditor plans={plans} initial={schedule.map((d) => d.map((s) => s.templateId))} today={localParts(new Date(), profile.timezone).weekday} activeProgram={active} />
      )}
    </Page>
  );
}
