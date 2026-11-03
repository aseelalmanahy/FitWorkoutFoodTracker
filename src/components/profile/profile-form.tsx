"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, parseNum } from "@/lib/client/api";
import { ACTIVITY_LABELS, ageFromBirthDate, suggestCalories, type ActivityLevel, type FitnessGoal } from "@/lib/energy";
import { cmToIn, inToCm, kgToLb, lbToKg, round, type UnitSystem } from "@/lib/units";
import { Button, Card, ErrorText, Field, Input, Select, cx } from "@/components/ui";

export interface ProfileValues {
  name: string;
  birthDate: string;
  sex: "MALE" | "FEMALE";
  heightCm: number;
  currentWeightKg: number;
  goalWeightKg: number | null;
  goal: FitnessGoal;
  activityLevel: ActivityLevel;
  experience: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  workoutDaysPerWeek: number;
  unitSystem: UnitSystem;
  timezone: string;
  calorieTargetOverride: number | null;
}

const GOALS: { v: FitnessGoal; label: string }[] = [
  { v: "FAT_LOSS", label: "Fat loss" },
  { v: "MUSCLE_GAIN", label: "Muscle gain" },
  { v: "MAINTENANCE", label: "Maintenance" },
  { v: "STRENGTH", label: "Strength" },
];

function Segmented<T extends string>({ value, options, onChange, name }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; name: string }) {
  return (
    <div role="radiogroup" aria-label={name} className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={cx("h-9 rounded-lg px-2 text-sm font-medium transition", value === o.v ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProfileForm({ initial, submitLabel, redirectTo }: { initial: ProfileValues | null; submitLabel: string; redirectTo?: string }) {
  const router = useRouter();
  const [units, setUnits] = useState<UnitSystem>(initial?.unitSystem ?? "IMPERIAL");
  const [sex, setSex] = useState<"MALE" | "FEMALE">(initial?.sex ?? "MALE");
  const [goal, setGoal] = useState<FitnessGoal>(initial?.goal ?? "MAINTENANCE");
  const [activity, setActivity] = useState<ActivityLevel>(initial?.activityLevel ?? "MODERATE");
  const [name, setName] = useState(initial?.name ?? "");
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? "");
  const [experience, setExperience] = useState(initial?.experience ?? "BEGINNER");
  const [days, setDays] = useState(String(initial?.workoutDaysPerWeek ?? 4));

  // Display-unit text fields
  const initFt = initial ? Math.floor(cmToIn(initial.heightCm) / 12) : "";
  const initIn = initial ? round(cmToIn(initial.heightCm) - Number(initFt) * 12, 1) : "";
  const [heightCm, setHeightCm] = useState(initial ? String(round(initial.heightCm, 1)) : "");
  const [heightFt, setHeightFt] = useState(String(initFt));
  const [heightIn, setHeightIn] = useState(String(initIn));
  const toDisp = (kg: number | null | undefined, u: UnitSystem) => (kg == null ? "" : String(round(u === "IMPERIAL" ? kgToLb(kg) : kg, 1)));
  const [weight, setWeight] = useState(toDisp(initial?.currentWeightKg, units));
  const [goalWeight, setGoalWeight] = useState(toDisp(initial?.goalWeightKg, units));
  const [override, setOverride] = useState(initial?.calorieTargetOverride != null ? String(initial.calorieTargetOverride) : "");
  const [useOverride, setUseOverride] = useState(initial?.calorieTargetOverride != null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const toKg = (v: string) => (units === "IMPERIAL" ? lbToKg(parseNum(v)) : parseNum(v));
  const computedHeightCm = units === "IMPERIAL" ? inToCm(parseNum(heightFt || "0") * 12 + parseNum(heightIn || "0")) : parseNum(heightCm);

  function switchUnits(u: UnitSystem) {
    if (u === units) return;
    const w = toKg(weight), gw = toKg(goalWeight), h = computedHeightCm;
    setWeight(Number.isFinite(w) ? toDisp(w, u) : "");
    setGoalWeight(Number.isFinite(gw) ? toDisp(gw, u) : "");
    if (Number.isFinite(h) && h > 0) {
      if (u === "METRIC") setHeightCm(String(round(h, 1)));
      else {
        const total = cmToIn(h);
        setHeightFt(String(Math.floor(total / 12)));
        setHeightIn(String(round(total - Math.floor(total / 12) * 12, 1)));
      }
    }
    setUnits(u);
  }

  const estimate = useMemo(() => {
    const w = toKg(weight);
    if (!birthDate || !Number.isFinite(w) || !Number.isFinite(computedHeightCm) || computedHeightCm < 100) return null;
    const age = ageFromBirthDate(new Date(birthDate));
    if (age < 13 || age > 110) return null;
    return suggestCalories({ sex, weightKg: w, heightCm: computedHeightCm, age, activity, goal });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weight, birthDate, computedHeightCm, sex, activity, goal, units]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const w = toKg(weight);
    const gw = goalWeight.trim() ? toKg(goalWeight) : null;
    const ov = useOverride && override.trim() ? Math.round(parseNum(override)) : null;
    if (!name.trim()) return setError("Please enter your name.");
    if (!birthDate) return setError("Please enter your date of birth.");
    if (!Number.isFinite(computedHeightCm) || computedHeightCm < 100 || computedHeightCm > 250) return setError("Please enter a valid height.");
    if (!Number.isFinite(w)) return setError("Please enter your current weight.");
    setBusy(true);
    try {
      await api("PUT", "/api/profile", {
        name: name.trim(),
        birthDate,
        sex,
        heightCm: round(computedHeightCm, 2),
        currentWeightKg: round(w, 3),
        goalWeightKg: gw != null && Number.isFinite(gw) ? round(gw, 3) : null,
        goal,
        activityLevel: activity,
        experience,
        workoutDaysPerWeek: Number(days),
        unitSystem: units,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        calorieTargetOverride: ov,
      });
      setSaved(true);
      if (redirectTo) router.replace(redirectTo);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const mu = units === "IMPERIAL" ? "lb" : "kg";

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field label="Units" group>
        <Segmented name="Units" value={units} onChange={switchUnits} options={[{ v: "IMPERIAL", label: "lb / ft" }, { v: "METRIC", label: "kg / cm" }]} />
      </Field>
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date of birth">
          <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        </Field>
        <Field label="Sex" hint="Used by the BMR equation" group>
          <Segmented name="Sex" value={sex} onChange={setSex} options={[{ v: "MALE", label: "Male" }, { v: "FEMALE", label: "Female" }]} />
        </Field>
      </div>
      {units === "IMPERIAL" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Height (ft)"><Input inputMode="numeric" value={heightFt} onChange={(e) => setHeightFt(e.target.value)} /></Field>
          <Field label="Height (in)"><Input inputMode="decimal" value={heightIn} onChange={(e) => setHeightIn(e.target.value)} /></Field>
        </div>
      ) : (
        <Field label="Height (cm)"><Input inputMode="decimal" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} /></Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Current weight (${mu})`}><Input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
        <Field label={`Goal weight (${mu})`} hint="Optional"><Input inputMode="decimal" value={goalWeight} onChange={(e) => setGoalWeight(e.target.value)} /></Field>
      </div>
      <Field label="Goal" group>
        <div className="grid grid-cols-2 gap-2">
          {GOALS.map((g) => (
            <button key={g.v} type="button" onClick={() => setGoal(g.v)} aria-pressed={goal === g.v}
              className={cx("h-11 rounded-xl border text-sm font-medium transition", goal === g.v ? "border-fg bg-fg text-bg" : "border-line bg-surface-2 text-fg")}>
              {g.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Activity level" hint="Outside of planned training and daily life combined">
        <Select value={activity} onChange={(e) => setActivity(e.target.value as ActivityLevel)}>
          {Object.entries(ACTIVITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Training experience">
          <Select value={experience} onChange={(e) => setExperience(e.target.value as ProfileValues["experience"])}>
            <option value="BEGINNER">Beginner (&lt;1 yr)</option>
            <option value="INTERMEDIATE">Intermediate (1–3 yr)</option>
            <option value="ADVANCED">Advanced (3+ yr)</option>
          </Select>
        </Field>
        <Field label="Workout days / week">
          <Select value={days} onChange={(e) => setDays(e.target.value)}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </Field>
      </div>

      <Card className="p-4">
        <p className="text-sm font-semibold">Estimated daily energy</p>
        {estimate ? (
          <>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div><p className="text-xs text-muted">BMR</p><p className="num text-lg font-bold">{estimate.bmr.toLocaleString()}</p></div>
              <div><p className="text-xs text-muted">TDEE</p><p className="num text-lg font-bold">{estimate.tdee.toLocaleString()}</p></div>
              <div><p className="text-xs text-muted">Suggested</p><p className="num text-lg font-bold text-accent-ink">{estimate.target.toLocaleString()}</p></div>
            </div>
            <p className="mt-2 text-xs text-muted">{estimate.rationale}</p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">Fill in date of birth, height and weight to see an estimate.</p>
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted">
          These are estimates from the Mifflin-St Jeor equation × an activity factor. Individual needs commonly differ by
          ±10% or more. Treat the number as a starting point and adjust it based on your actual weight trend over 2–4 weeks.
        </p>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={useOverride} onChange={(e) => setUseOverride(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          Use my own calorie target
        </label>
        {useOverride && (
          <div className="mt-2">
            <Input inputMode="numeric" placeholder="kcal per day" value={override} onChange={(e) => setOverride(e.target.value)} />
          </div>
        )}
      </Card>

      <ErrorText>{error}</ErrorText>
      {saved && !redirectTo && <p className="text-sm text-up">Saved.</p>}
      <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
    </form>
  );
}
