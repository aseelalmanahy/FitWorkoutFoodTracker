import Link from "next/link";
import { requireProfile } from "@/lib/server/profile";
import { daySummary } from "@/lib/server/nutrition/entries";
import { localToday } from "@/lib/server/nutrition/targets";
import { addDays, fmtG, fmtKcal, isIsoDate } from "@/lib/nutrition";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { DateNav } from "@/components/nutrition/date-nav";
import { MacroBar } from "@/components/nutrition/macro-bar";
import { MealList } from "@/components/nutrition/meal-list";

export const metadata = { title: "Nutrition" };

function CalorieRing({ fraction, over }: { fraction: number; over: boolean }) {
  const r = 52, c = 2 * Math.PI * r;
  return (
    <svg width="128" height="128" viewBox="0 0 128 128" aria-hidden>
      <circle cx="64" cy="64" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="12" />
      <circle cx="64" cy="64" r={r} fill="none" stroke={over ? "var(--muted)" : "var(--accent)"} strokeWidth="12" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - fraction)} transform="rotate(-90 64 64)" />
    </svg>
  );
}

export default async function NutritionPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { user, profile } = await requireProfile();
  const today = localToday(profile.timezone);
  const raw = (await searchParams).date;
  const date = raw && isIsoDate(raw) && raw <= addDays(today, 1) ? raw : today;
  const day = await daySummary(user.id, profile, date);
  const t = day.target;
  const over = !!day.calories && (day.calories.over ?? 0) > 0;
  // What's left, worked out from a total that's missing some foods, can only be an upper limit.
  const partialKcal = day.totals.kcal !== null && day.totals.incomplete.includes("kcal");

  return (
    <>
      <PageHeader title="Nutrition" action={
        <div className="flex gap-2">
          <ButtonLink href="/nutrition/history" variant="secondary" size="sm">History</ButtonLink>
          <ButtonLink href="/nutrition/targets" variant="secondary" size="sm">Targets</ButtonLink>
        </div>
      } />
      <DateNav date={date} today={today} basePath="/nutrition" />

      <Card className="mt-3 p-5">
        {t && day.calories ? (
          <div className="flex items-center gap-5">
            <div className="relative shrink-0">
              <CalorieRing fraction={day.calories.fraction ?? 0} over={over} />
              <div className="absolute inset-0 grid place-items-center text-center">
                <div>
                  <p className="num text-2xl font-bold leading-none">{fmtKcal(over ? day.calories.over : day.calories.remaining)}</p>
                  <p className="mt-1 text-[11px] text-muted">{over ? "kcal over" : partialKcal ? "kcal left *" : "kcal left"}</p>
                </div>
              </div>
            </div>
            <div className="num min-w-0 space-y-2 text-sm">
              <div><p className="text-xs text-muted">Target</p><p className="font-semibold">{fmtKcal(t.kcal)} kcal</p>{t.source === "SUGGESTED" && <p className="text-[11px] text-muted">Set automatically earlier</p>}</div>
              <div><p className="text-xs text-muted">Consumed</p><p className="font-semibold">{fmtKcal(day.totals.kcal)} kcal{day.totals.incomplete.includes("kcal") && " *"}</p></div>
              <div><p className="text-xs text-muted">Remaining</p><p className="font-semibold">{over ? `0 (${fmtKcal(day.calories.over)} over)` : `${fmtKcal(day.calories.remaining)} kcal${partialKcal ? " *" : ""}`}</p></div>
            </div>
          </div>
        ) : (
          <div className="num text-sm">
            <p className="text-xs text-muted">Consumed</p>
            <p className="font-semibold">{fmtKcal(day.totals.kcal)} kcal{day.totals.incomplete.includes("kcal") && " *"}</p>
            {date === today && <Link href="/nutrition/targets" className="mt-2 inline-block text-xs text-muted underline">Add a target</Link>}
          </div>
        )}
        <div className="mt-5 space-y-3.5 border-t border-line pt-4">
          <MacroBar label="Protein" consumed={day.totals.protein} target={t?.proteinG ?? null} incomplete={day.totals.incomplete.includes("protein")} />
          <MacroBar label="Carbs" consumed={day.totals.carbs} target={t?.carbsG ?? null} incomplete={day.totals.incomplete.includes("carbs")} color="bg-info" />
          <MacroBar label="Fat" consumed={day.totals.fat} target={t?.fatG ?? null} incomplete={day.totals.incomplete.includes("fat")} color="bg-up" />
        </div>
        {day.totals.fiber != null && day.totals.fiber > 0 && <p className="num mt-3 text-xs text-muted">Fiber {fmtG(day.totals.fiber)} g{day.totals.incomplete.includes("fiber") && " (not reported by all foods)"}</p>}
        {day.totals.incomplete.some((k) => k !== "fiber") && (
          <p className="mt-2 text-xs text-muted">* Some logged foods don&apos;t report this value, so the total includes only reported values, and what&apos;s left may be less. A dash means none of them do.</p>
        )}
      </Card>

      <div className="mt-4">
        <MealList meals={day.meals} date={date} />
      </div>

      <Card className="num mt-4 grid grid-cols-4 gap-2 p-4 text-center">
        <div><p className="text-lg font-bold">{fmtKcal(day.totals.kcal)}</p><p className="text-[11px] text-muted">kcal</p></div>
        <div><p className="text-lg font-bold">{fmtG(day.totals.protein)}</p><p className="text-[11px] text-muted">Protein g</p></div>
        <div><p className="text-lg font-bold">{fmtG(day.totals.carbs)}</p><p className="text-[11px] text-muted">Carbs g</p></div>
        <div><p className="text-lg font-bold">{fmtG(day.totals.fat)}</p><p className="text-[11px] text-muted">Fat g</p></div>
      </Card>
      <p className="mt-2 text-center text-xs text-muted">Daily totals</p>
    </>
  );
}
