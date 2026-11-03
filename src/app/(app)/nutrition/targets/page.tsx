import { requireProfile } from "@/lib/server/profile";
import { getTargets, localToday, suggestionFromProfile } from "@/lib/server/nutrition/targets";
import { targetForDate } from "@/lib/nutrition";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { TargetsEditor } from "@/components/nutrition/targets-editor";

export const metadata = { title: "Nutrition targets" };

export default async function TargetsPage() {
  const { user, profile } = await requireProfile();
  const targets = await getTargets(user.id, profile);
  const current = targetForDate(targets, localToday(profile.timezone));
  const s = suggestionFromProfile(profile);
  return (
    <>
      <PageHeader title="Targets" subtitle="Daily calories and macronutrients" back="/nutrition" />
      <TargetsEditor current={current} suggestion={{ kcal: s.kcal, proteinG: s.proteinG, carbsG: s.carbsG, fatG: s.fatG, bmr: s.bmr, tdee: s.tdee, rationale: s.rationale }} />
      {targets.length > 1 && (
        <>
          <SectionTitle>Target history</SectionTitle>
          <Card className="num divide-y divide-line text-sm">
            {[...targets].reverse().map((t) => (
              <div key={t.effectiveFrom} className="flex justify-between px-4 py-2.5">
                <span className="text-muted">from {t.effectiveFrom}</span>
                <span>{t.kcal} kcal · P {t.proteinG} · C {t.carbsG} · F {t.fatG}</span>
              </div>
            ))}
          </Card>
        </>
      )}
    </>
  );
}
