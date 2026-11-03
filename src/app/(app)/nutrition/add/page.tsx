import { requireProfile } from "@/lib/server/profile";
import { localToday } from "@/lib/server/nutrition/targets";
import { addDays, isIsoDate, MEAL_TYPES, type MealType } from "@/lib/nutrition";
import { FoodSearch } from "@/components/nutrition/food-search";

export const metadata = { title: "Add food" };

export default async function AddFoodPage({ searchParams }: { searchParams: Promise<{ date?: string; meal?: string }> }) {
  const { profile } = await requireProfile();
  const today = localToday(profile.timezone);
  const sp = await searchParams;
  const date = sp.date && isIsoDate(sp.date) && sp.date <= addDays(today, 1) ? sp.date : today;
  const meal = (MEAL_TYPES as readonly string[]).includes(sp.meal ?? "") ? (sp.meal as MealType) : "BREAKFAST";
  return <FoodSearch date={date} today={today} initialMeal={meal} />;
}
