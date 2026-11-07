import { requireProfile } from "@/lib/server/profile";
import { localToday } from "@/lib/server/nutrition/targets";
import { addDays, isIsoDate, MEAL_TYPES, type MealType } from "@/lib/nutrition";
import { isLabelScanningConfigured } from "@/lib/server/labels/extractor";
import { isMealIdentificationConfigured } from "@/lib/server/meals/identifier";
import { FoodSearch } from "@/components/nutrition/food-search";
import { ButtonLink } from "@/components/ui";
import { Page } from "@/components/page";

export const metadata = { title: "Add food" };

export default async function AddFoodPage({ searchParams }: { searchParams: Promise<{ date?: string; meal?: string }> }) {
  const { profile } = await requireProfile();
  const today = localToday(profile.timezone);
  const sp = await searchParams;
  const date = sp.date && isIsoDate(sp.date) && sp.date <= addDays(today, 1) ? sp.date : today;
  const meal = (MEAL_TYPES as readonly string[]).includes(sp.meal ?? "") ? (sp.meal as MealType) : "BREAKFAST";
  return (
    <Page width="medium">
      <FoodSearch date={date} today={today} initialMeal={meal} />
      {isLabelScanningConfigured() && <div className="mt-4 text-center"><ButtonLink href="/nutrition/scan" variant="secondary">Scan a nutrition label</ButtonLink></div>}
      {isMealIdentificationConfigured() && <div className="mt-2 text-center"><ButtonLink href="/nutrition/meal" variant="secondary">Identify foods in a photo</ButtonLink></div>}
    </Page>
  );
}
