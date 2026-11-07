import { requireProfile } from "@/lib/server/profile";
import { getTargets, localToday } from "@/lib/server/nutrition/targets";
import { fmtMacroTarget, targetForDate } from "@/lib/nutrition";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { TargetsEditor } from "@/components/nutrition/targets-editor";
import { Page } from "@/components/page";

export const metadata = { title: "Nutrition targets" };

export default async function TargetsPage() {
  const { user, profile } = await requireProfile();
  const targets = await getTargets(user.id);
  const today = localToday(profile.timezone);
  const current = targetForDate(targets, today);
  const latest = targets.at(-1);
  return (
    <Page width="medium">
      <PageHeader title="Targets" subtitle="Daily calories and macronutrients" back="/nutrition" />
      <p className="mb-4 text-sm text-muted">Targets are optional, and you can track food without one. This app can&apos;t account for health conditions, pregnancy or medication, and it isn&apos;t medical advice.</p>
      <TargetsEditor current={current} hasEarlierTarget={targets.some((t) => t.effectiveFrom < today)} everSet={targets.length > 0} canStop={!!latest && latest.kcal !== null} />
      {targets.length > 1 && (
        <>
          <SectionTitle>Target history</SectionTitle>
          <Card className="num divide-y divide-line text-sm">
            {[...targets].reverse().map((t) => (
              <div key={t.effectiveFrom} className="flex justify-between gap-3 px-4 py-2.5">
                <span className="text-muted">from {t.effectiveFrom}{t.source === "SUGGESTED" && " · Set automatically earlier"}</span>
                {t.kcal === null
                  ? <span>Stopped</span>
                  : <span>{t.kcal} kcal · P {fmtMacroTarget(t.proteinG)} · C {fmtMacroTarget(t.carbsG)} · F {fmtMacroTarget(t.fatG)}</span>}
              </div>
            ))}
          </Card>
        </>
      )}
    </Page>
  );
}
