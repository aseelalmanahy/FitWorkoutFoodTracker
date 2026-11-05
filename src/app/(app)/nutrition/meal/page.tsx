import { requireProfile } from "@/lib/server/profile";
import { localToday } from "@/lib/server/nutrition/targets";
import { PageHeader } from "@/components/ui";
import { MealPhoto } from "@/components/nutrition/meal-photo";

export const metadata = { title: "Identify a meal" };

export default async function MealPhotoPage() {
  const { profile } = await requireProfile();
  const today = localToday(profile.timezone);
  return (
    <>
      <PageHeader title="Identify a meal" subtitle="AI suggests what the foods might be. You choose the foods and amounts." back="/nutrition" />
      <MealPhoto today={today} />
    </>
  );
}
