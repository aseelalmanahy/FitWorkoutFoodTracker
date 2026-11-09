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
    prisma.workoutTemplate.findMany({ where: { userId: user.id }, select: { id: true, name: true, program: { select: { name: true } } }, orderBy: [{ program: { name: "asc" } }, { programPosition: "asc" }, { name: "asc" }] }),
    getSchedule(user.id),
  ]);
  // UI-01: a program's day is named with its program, so "Day 1" from two programs can't be confused.
  const plans = rows.map((p) => ({ id: p.id, name: p.program ? `${p.name} (${p.program.name})` : p.name }));
  return (
    <Page width="focused">
      <PageHeader title="Weekly schedule" subtitle="Assign plans to days. Days without a plan are rest days." back="/workouts" />
      {plans.length === 0 ? (
        <EmptyState title="Create a plan first" body="Schedules are built from your workout plans." action={<ButtonLink href="/workouts/plans/new">Create a plan</ButtonLink>} />
      ) : (
        <ScheduleEditor plans={plans} initial={schedule.map((d) => d.map((s) => s.templateId))} today={localParts(new Date(), profile.timezone).weekday} />
      )}
    </Page>
  );
}
