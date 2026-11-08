import { requireProfile } from "@/lib/server/profile";
import { listGyms } from "@/lib/server/gyms";
import { PageHeader } from "@/components/ui";
import { Page } from "@/components/page";
import { GymsManager, type ManagedGym } from "@/components/workouts/gyms-manager";

export const metadata = { title: "Gyms" };

export default async function GymsPage() {
  const { user } = await requireProfile();
  const gyms: ManagedGym[] = (await listGyms(user.id)).map((g) => ({
    id: g.id,
    name: g.name,
    kinds: g.equipment.filter((e) => e.name === null).map((e) => e.kind),
    machines: g.equipment.flatMap((e) => (e.name ? [{ id: e.id, name: e.name, kind: e.kind, exercise: e.exercise }] : [])),
  }));
  return (
    <Page width="medium">
      <PageHeader title="Gyms" subtitle="Private to you. No location is used." back="/workouts" />
      <GymsManager initial={gyms} />
    </Page>
  );
}
