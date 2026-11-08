import { requireProfile } from "@/lib/server/profile";
import { localToday } from "@/lib/server/nutrition/targets";
import { PageHeader } from "@/components/ui";
import { MealPhoto } from "@/components/nutrition/meal-photo";
import { mealProcessing } from "@/lib/server/meals/identifier";

export const metadata = { title: "Identify a meal" };

export default async function MealPhotoPage() {
  const { profile } = await requireProfile();
  const today = localToday(profile.timezone);
  const processing = mealProcessing();
  return (
    <>
      <PageHeader title="Identify a meal" subtitle={processing === "server" ? "A model on this server suggests the main dish. You choose the foods and amounts." : "AI suggests what the foods might be. You choose the foods and amounts."} back="/nutrition" />
      <MealPhoto today={today} processing={processing} />
    </>
  );
}
