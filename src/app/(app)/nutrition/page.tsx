import { requireProfile } from "@/lib/server/profile";
import { ageFromBirthDate, suggestCalories } from "@/lib/energy";
import { ButtonLink, Card, PageHeader, Stat } from "@/components/ui";

export const metadata = { title: "Nutrition" };

export default async function NutritionPage() {
  const { profile } = await requireProfile();
  const s = suggestCalories({
    sex: profile.sex,
    weightKg: profile.currentWeightKg,
    heightCm: profile.heightCm,
    age: ageFromBirthDate(profile.birthDate),
    activity: profile.activityLevel,
    goal: profile.goal,
  });
  const target = profile.calorieTargetOverride ?? s.target;

  return (
    <>
      <PageHeader title="Nutrition" subtitle="Food logging arrives in the next release" />
      <Card className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Daily calorie target</p>
        <p className="num mt-1 text-4xl font-bold">{target.toLocaleString()} <span className="text-base font-medium text-muted">kcal</span></p>
        <p className="mt-1 text-sm text-muted">{profile.calorieTargetOverride ? "Your custom target." : s.rationale}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4">
          <Stat label="Estimated BMR" value={`${s.bmr.toLocaleString()} kcal`} sub="Mifflin-St Jeor" />
          <Stat label="Estimated TDEE" value={`${s.tdee.toLocaleString()} kcal`} sub="BMR × activity factor" />
        </div>
        <p className="mt-4 text-xs leading-relaxed text-muted">
          Estimates only. Equations predict resting energy expenditure within ±10% for most, but not all, adults, and
          activity multipliers add further uncertainty. Once weight logging is available, the target can be adjusted
          from your observed weight trend.
        </p>
        <ButtonLink href="/profile" variant="secondary" className="mt-4 w-full">Adjust in profile</ButtonLink>
      </Card>
    </>
  );
}
