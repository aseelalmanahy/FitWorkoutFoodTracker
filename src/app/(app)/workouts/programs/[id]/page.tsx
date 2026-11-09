import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/server/profile";
import { getPrograms } from "@/lib/server/programs";
import { WEEKDAYS_SHORT } from "@/lib/time";
import { PageHeader } from "@/components/ui";
import { Page } from "@/components/page";
import { ProgramManager } from "@/components/workouts/program-manager";

export const metadata = { title: "Program" };

export default async function ProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, profile } = await requireProfile();
  const program = (await getPrograms(user.id).then((ps) => ps.find((p) => p.id === id))) ?? notFound();
  const days = program.templates.map((t) => ({
    id: t.id, name: t.name, exercises: t.exercises.length,
    weekdays: t.slots.length ? t.slots.map((s) => WEEKDAYS_SHORT[s.weekday]).join(", ") : "Not scheduled",
  }));
  return (
    <Page>
      <PageHeader title={program.name} subtitle={`${program.id === profile.activeProgramId ? "Active program · " : ""}${days.length} workout day${days.length === 1 ? "" : "s"}${program.origin === "import" ? " · Imported" : ""}`} back="/workouts" />
      <ProgramManager key={`${program.id}:${program.name}:${days.map((d) => d.id).join()}`} id={program.id} name={program.name} days={days} active={program.id === profile.activeProgramId} />
    </Page>
  );
}
