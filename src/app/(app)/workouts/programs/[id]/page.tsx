import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/server/profile";
import { getIndividualPlans, getPrograms } from "@/lib/server/programs";
import { getSchedule } from "@/lib/server/stats";
import { scheduleExceptions } from "@/lib/active-program";
import { WEEKDAYS_SHORT } from "@/lib/time";
import { PageHeader } from "@/components/ui";
import { Page } from "@/components/page";
import { ProgramManager } from "@/components/workouts/program-manager";

export const metadata = { title: "Program" };

const weekdaysOf = (slots: { weekday: number }[]) => (slots.length ? slots.map((s) => WEEKDAYS_SHORT[s.weekday]).join(", ") : "Not scheduled");

export default async function ProgramPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ add?: string }> }) {
  const { id } = await params;
  const { add } = await searchParams;
  const { user, profile } = await requireProfile();
  const [programs, individualPlans, schedule] = await Promise.all([getPrograms(user.id), getIndividualPlans(user.id), getSchedule(user.id)]);
  const program = programs.find((p) => p.id === id) ?? notFound();
  const active = program.id === profile.activeProgramId;
  const days = program.templates.map((t) => ({ id: t.id, name: t.name, exercises: t.exercises.length, weekdays: weekdaysOf(t.slots) }));
  // UI-05B: the person's individual plans, which can be added to this program.
  const individuals = individualPlans.map((t) => ({ id: t.id, name: t.name, exercises: t._count.exercises, weekdays: weekdaysOf(t.slots) }));
  // UI-06B: on the active program's page, the scheduled workouts outside it, each with a way in or off.
  const exceptions = active
    ? scheduleExceptions(schedule, program.id).map((x) => ({ id: x.templateId, name: x.name, inProgram: x.programName, weekdays: x.weekdays.map((d) => WEEKDAYS_SHORT[d]).join(", ") }))
    : [];
  return (
    <Page>
      <PageHeader wrapTitle title={program.name} subtitle={`${active ? "Active program · " : ""}${days.length} workout day${days.length === 1 ? "" : "s"}${program.origin === "import" ? " · Imported" : ""}`} back="/workouts" />
      <ProgramManager key={`${program.id}:${add ?? ""}`} id={program.id} name={program.name} days={days} active={active}
        individuals={individuals} exceptions={exceptions} addId={add ?? null} />
    </Page>
  );
}
