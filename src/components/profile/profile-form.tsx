"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, isUncertainFailure, parseNum, saveFailureMessage } from "@/lib/client/api";
import { ACTIVITY_LABELS, type ActivityLevel, type FitnessGoal } from "@/lib/energy";
import { cmToIn, inToCm, kgToLb, lbToKg, round, type UnitSystem } from "@/lib/units";
import { LogoutButton } from "@/components/logout-button";
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
}

const GOALS: { v: FitnessGoal; label: string }[] = [
  { v: "FAT_LOSS", label: "Fat loss" },
  { v: "MUSCLE_GAIN", label: "Muscle gain" },
  { v: "MAINTENANCE", label: "Maintenance" },
  { v: "STRENGTH", label: "Strength" },
];

const UNUSED_HINT = "Stored with your profile. Not used for any calculation at the moment.";
const BIRTH_DATE_REFUSED = "This date of birth can't be used.";

// Fixed text in display order, so an error never shows a raw field name or limit.
const COPY = {
  units: "Please choose your units.",
  name: "Please enter your name.",
  birthDate: "Please enter your date of birth.",
  sex: "Please choose an option.",
  height: "Please enter a valid height.",
  weight: "Please enter your current weight.",
  goalWeight: "Please enter a valid goal weight.",
  goal: "Please choose a goal.",
  activity: "Please choose an activity level.",
  experience: "Please choose your training experience.",
  days: "Please choose your workout days.",
} as const;
type FieldKey = keyof typeof COPY;
const ORDER = Object.keys(COPY) as FieldKey[];

const SERVER_FIELDS: Record<string, FieldKey> = {
  unitSystem: "units", name: "name", birthDate: "birthDate", sex: "sex", heightCm: "height", currentWeightKg: "weight",
  goalWeightKg: "goalWeight", goal: "goal", activityLevel: "activity", experience: "experience", workoutDaysPerWeek: "days",
};

const fieldId = (k: FieldKey) => `profile-${k}`;
const errorId = (k: FieldKey) => `profile-${k}-error`;

/** The date in words, from UTC parts, so no time zone can move it by a day. */
function dateInWords(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${iso}T00:00:00.000Z`));
}

function Segmented<T extends string>({ value, options, onChange, name, id, describedBy }: { value: T | null; options: { v: T; label: string }[]; onChange: (v: T) => void; name: string; id: string; describedBy?: string }) {
  return (
    <div role="radiogroup" aria-label={name} aria-invalid={describedBy ? true : undefined} aria-describedby={describedBy} className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-surface-2 p-1">
      {options.map((o, i) => (
        <button
          key={o.v}
          id={i === 0 ? id : undefined}
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
  // Nothing is preselected for a new profile. A default here would save a value the person never chose.
  const [units, setUnits] = useState<UnitSystem | null>(initial?.unitSystem ?? null);
  const [sex, setSex] = useState<"MALE" | "FEMALE" | null>(initial?.sex ?? null);
  const [goal, setGoal] = useState<FitnessGoal | null>(initial?.goal ?? null);
  const [activity, setActivity] = useState<ActivityLevel | "">(initial?.activityLevel ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? "");
  const [experience, setExperience] = useState<ProfileValues["experience"] | "">(initial?.experience ?? "");
  const [days, setDays] = useState(initial ? String(initial.workoutDaysPerWeek) : "");

  // Display-unit text fields
  const initFt = initial ? Math.floor(cmToIn(initial.heightCm) / 12) : "";
  const initIn = initial ? round(cmToIn(initial.heightCm) - Number(initFt) * 12, 1) : "";
  const [heightCm, setHeightCm] = useState(initial ? String(round(initial.heightCm, 1)) : "");
  const [heightFt, setHeightFt] = useState(String(initFt));
  const [heightIn, setHeightIn] = useState(String(initIn));
  const toDisp = (kg: number | null | undefined, u: UnitSystem | null) => (kg == null ? "" : String(round(u === "IMPERIAL" ? kgToLb(kg) : kg, 1)));
  const [weight, setWeight] = useState(toDisp(initial?.currentWeightKg, units));
  const [goalWeight, setGoalWeight] = useState(toDisp(initial?.goalWeightKg, units));
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [refused, setRefused] = useState(false);
  const [focusNext, setFocusNext] = useState<string | null>(null);
  const refusalHeading = useRef<HTMLHeadingElement>(null);

  const toKg = (v: string) => (units === "IMPERIAL" ? lbToKg(parseNum(v)) : parseNum(v));
  const computedHeightCm = units === "IMPERIAL" ? inToCm(parseNum(heightFt || "0") * 12 + parseNum(heightIn || "0")) : parseNum(heightCm);

  // Runs after the render that shows the element, so a field that has only just appeared can take focus.
  useEffect(() => {
    if (!focusNext) return;
    document.getElementById(focusNext)?.focus();
    setFocusNext(null);
  }, [focusNext]);
  useEffect(() => {
    if (refused) refusalHeading.current?.focus();
  }, [refused]);

  function switchUnits(u: UnitSystem) {
    if (u === units) return;
    setErrors((e) => ({ ...e, units: undefined }));
    if (units) {
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
    }
    setUnits(u);
  }

  function validate(): Partial<Record<FieldKey, string>> {
    const found: Partial<Record<FieldKey, string>> = {};
    const fail = (k: FieldKey) => { found[k] = COPY[k]; };
    if (!units) fail("units");
    if (!name.trim()) fail("name");
    if (!birthDate) fail("birthDate");
    if (!sex) fail("sex");
    if (units) {
      if (!Number.isFinite(computedHeightCm) || computedHeightCm < 100 || computedHeightCm > 250) fail("height");
      const w = toKg(weight);
      if (!Number.isFinite(w) || w < 30 || w > 300) fail("weight");
      if (goalWeight.trim()) {
        const gw = toKg(goalWeight);
        if (!Number.isFinite(gw) || gw < 30 || gw > 300) fail("goalWeight");
      }
    }
    if (!goal) fail("goal");
    if (!activity) fail("activity");
    if (!experience) fail("experience");
    if (days === "") fail("days");
    return found;
  }

  function showErrors(found: Partial<Record<FieldKey, string>>) {
    setErrors(found);
    const first = ORDER.find((k) => found[k]);
    if (first) setFocusNext(fieldId(first));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const found = validate();
    if (Object.keys(found).length) return showErrors(found);
    setErrors({});
    // A new or changed date is read back in words first, as a typing mistake can refuse someone.
    if (birthDate !== initial?.birthDate) return setConfirming(true);
    void save();
  }

  async function save() {
    setConfirming(false);
    setBusy(true);
    try {
      const gw = goalWeight.trim() ? toKg(goalWeight) : null;
      await api("PUT", "/api/profile", {
        name: name.trim(),
        birthDate,
        sex,
        heightCm: round(computedHeightCm, 2),
        currentWeightKg: round(toKg(weight), 3),
        goalWeightKg: gw != null ? round(gw, 3) : null,
        goal,
        activityLevel: activity,
        experience,
        workoutDaysPerWeek: Number(days),
        unitSystem: units,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      });
      setSaved(true);
      if (redirectTo) router.replace(redirectTo);
      router.refresh();
    } catch (err) {
      onSaveError(err);
    } finally {
      setBusy(false);
    }
  }

  function onSaveError(err: unknown) {
    if (err instanceof ApiError && err.status === 422 && (err.details as { reason?: string } | undefined)?.reason === "age_ineligible") {
      if (!initial) return setRefused(true);
      return showErrors({ birthDate: BIRTH_DATE_REFUSED });
    }
    if (err instanceof ApiError && err.status === 400) {
      const fieldErrors = (err.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors;
      if (!fieldErrors) return showErrors({ birthDate: "Check the date of birth." });
      const found: Partial<Record<FieldKey, string>> = {};
      for (const server of Object.keys(fieldErrors)) {
        const k = SERVER_FIELDS[server];
        if (k) found[k] = COPY[k];
      }
      if (Object.keys(found).length) return showErrors(found);
      return setError("Something in this form couldn't be saved. Check it and try again.");
    }
    setError(isUncertainFailure(err) ? saveFailureMessage(err) : (err as Error).message);
  }

  if (refused) {
    return (
      <Card className="space-y-3 p-5">
        <h2 ref={refusalHeading} tabIndex={-1} className="text-xl font-bold outline-none">We can&apos;t set up an account with that date of birth.</h2>
        <p className="text-sm text-muted">You entered {dateInWords(birthDate)}. We didn&apos;t save that date.</p>
        <Button type="button" variant="secondary" className="w-full" onClick={() => { setRefused(false); setFocusNext(fieldId("birthDate")); }}>Check the date</Button>
        <LogoutButton className="w-full" />
      </Card>
    );
  }

  const mu = units === "IMPERIAL" ? "lb" : "kg";
  const inputProps = (k: FieldKey) => ({ id: fieldId(k), "aria-invalid": errors[k] ? true : undefined, "aria-describedby": errors[k] ? errorId(k) : undefined });
  const fieldProps = (k: FieldKey) => ({ error: errors[k], errorId: errorId(k) });
  const describedBy = (k: FieldKey) => (errors[k] ? errorId(k) : undefined);

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field label="Units" group {...fieldProps("units")}>
        <Segmented name="Units" id={fieldId("units")} describedBy={describedBy("units")} value={units} onChange={switchUnits} options={[{ v: "IMPERIAL", label: "lb / ft" }, { v: "METRIC", label: "kg / cm" }]} />
      </Field>
      <Field label="Name" {...fieldProps("name")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" {...inputProps("name")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date of birth" {...fieldProps("birthDate")}>
          <Input type="date" value={birthDate} onChange={(e) => { setBirthDate(e.target.value); setConfirming(false); }} {...inputProps("birthDate")} />
        </Field>
        <Field label="Sex" hint={UNUSED_HINT} group {...fieldProps("sex")}>
          <Segmented name="Sex" id={fieldId("sex")} describedBy={describedBy("sex")} value={sex} onChange={setSex} options={[{ v: "MALE", label: "Male" }, { v: "FEMALE", label: "Female" }]} />
        </Field>
      </div>
      {!units ? (
        <p className="text-sm text-muted">Choose your units to enter height and weight.</p>
      ) : (
        <>
          {units === "IMPERIAL" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Height (ft)" {...fieldProps("height")}><Input inputMode="numeric" value={heightFt} onChange={(e) => setHeightFt(e.target.value)} {...inputProps("height")} /></Field>
              <Field label="Height (in)"><Input inputMode="decimal" value={heightIn} onChange={(e) => setHeightIn(e.target.value)} /></Field>
            </div>
          ) : (
            <Field label="Height (cm)" {...fieldProps("height")}><Input inputMode="decimal" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} {...inputProps("height")} /></Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Current weight (${mu})`} {...fieldProps("weight")}><Input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} {...inputProps("weight")} /></Field>
            <Field label={`Goal weight (${mu})`} hint="Optional" {...fieldProps("goalWeight")}><Input inputMode="decimal" value={goalWeight} onChange={(e) => setGoalWeight(e.target.value)} {...inputProps("goalWeight")} /></Field>
          </div>
        </>
      )}
      <Field label="Goal" group {...fieldProps("goal")}>
        <div className="grid grid-cols-2 gap-2">
          {GOALS.map((g, i) => (
            <button key={g.v} id={i === 0 ? fieldId("goal") : undefined} type="button" onClick={() => setGoal(g.v)} aria-pressed={goal === g.v} aria-describedby={describedBy("goal")}
              className={cx("h-11 rounded-xl border text-sm font-medium transition", goal === g.v ? "border-fg bg-fg text-bg" : "border-line bg-surface-2 text-fg")}>
              {g.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Activity level" hint={UNUSED_HINT} {...fieldProps("activity")}>
        <Select value={activity} onChange={(e) => setActivity(e.target.value as ActivityLevel)} {...inputProps("activity")}>
          <option value="" disabled>Choose…</option>
          {Object.entries(ACTIVITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Training experience" {...fieldProps("experience")}>
          <Select value={experience} onChange={(e) => setExperience(e.target.value as ProfileValues["experience"])} {...inputProps("experience")}>
            <option value="" disabled>Choose…</option>
            <option value="BEGINNER">Beginner (&lt;1 yr)</option>
            <option value="INTERMEDIATE">Intermediate (1–3 yr)</option>
            <option value="ADVANCED">Advanced (3+ yr)</option>
          </Select>
        </Field>
        <Field label="Workout days / week" {...fieldProps("days")}>
          <Select value={days} onChange={(e) => setDays(e.target.value)} {...inputProps("days")}>
            <option value="" disabled>Choose…</option>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </Field>
      </div>

      {initial ? (
        <a href="/nutrition/targets" className="inline-block text-sm font-semibold text-accent-ink">Set calorie and macro targets →</a>
      ) : (
        <p className="text-sm text-muted">Targets are optional. You can set your own in Nutrition → Targets.</p>
      )}

      <ErrorText>{error}</ErrorText>
      {saved && !redirectTo && <p className="text-sm text-up">Saved.</p>}
      {confirming ? (
        <div className="space-y-3 rounded-xl border border-line p-4" role="group" aria-label="Confirm date of birth">
          <p role="status" className="text-sm font-semibold">You entered {dateInWords(birthDate)}. Is this right?</p>
          <Button type="button" size="lg" className="w-full" onClick={() => void save()}>Yes, that&apos;s right</Button>
          <Button type="button" variant="secondary" className="w-full" onClick={() => { setConfirming(false); setFocusNext(fieldId("birthDate")); }}>Change date</Button>
        </div>
      ) : (
        <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
      )}
    </form>
  );
}
