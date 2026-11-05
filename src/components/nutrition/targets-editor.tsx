"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, parseNum } from "@/lib/client/api";
import { carbsFromRemainder, fmtKcal, macroKcal, type DatedTarget } from "@/lib/nutrition";
import { Button, Card, ErrorText, Field, Input } from "@/components/ui";

interface Suggestion { kcal: number; proteinG: number; carbsG: number; fatG: number; bmr: number; tdee: number; rationale: string }

export function TargetsEditor({ current, suggestion }: { current: DatedTarget | null; suggestion: Suggestion }) {
  const router = useRouter();
  const start = current ?? { ...suggestion, source: "SUGGESTED" as const, effectiveFrom: "" };
  const [kcal, setKcal] = useState(String(start.kcal));
  const [protein, setProtein] = useState(String(start.proteinG));
  const [fat, setFat] = useState(String(start.fatG));
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const k = parseNum(kcal), p = parseNum(protein), f = parseNum(fat);
  const valid = [k, p, f].every((x) => Number.isFinite(x) && x >= 0);
  const carbs = valid ? carbsFromRemainder(Math.round(k), Math.round(p), Math.round(f)) : null;
  const pct = (g: number, per: number) => (k > 0 ? Math.round(((g * per) / k) * 100) : 0);
  const differsFromSuggestion = current && (current.kcal !== suggestion.kcal || current.proteinG !== suggestion.proteinG || current.fatG !== suggestion.fatG);

  async function save() {
    setError(null);
    setMsg(null);
    if (!valid) return setError("Enter each target as a plain number, such as 2000.");
    if (carbs === null) return setError("Protein and fat contain more energy than the calorie target.");
    setBusy(true);
    try {
      await api("PUT", "/api/nutrition/targets", { kcal: Math.round(k), proteinG: Math.round(p), fatG: Math.round(f) });
      setMsg("Saved. New targets apply from today. Earlier days keep their previous targets.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function useSuggestion() {
    setBusy(true);
    setError(null);
    try {
      const { target } = await api<{ target: DatedTarget }>("POST", "/api/nutrition/targets/suggestion");
      setKcal(String(target.kcal)); setProtein(String(target.proteinG)); setFat(String(target.fatG));
      setMsg("Suggested targets applied from today. They will follow future profile changes until you edit them.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Current target</p>
        {current ? (
          <>
            <p className="num mt-1 text-2xl font-bold">{fmtKcal(current.kcal)} kcal</p>
            <p className="num text-sm text-muted">P {current.proteinG} g · C {current.carbsG} g · F {current.fatG} g · {current.source === "MANUAL" ? "Set by you" : "Suggested"} · since {current.effectiveFrom}</p>
          </>
        ) : <p className="mt-1 text-sm text-muted">No target yet.</p>}
      </Card>

      <Card className="p-4">
        <p className="text-sm font-semibold">Suggestion from your profile</p>
        <div className="num mt-2 grid grid-cols-3 gap-2 text-sm">
          <div><p className="text-xs text-muted">BMR</p><p className="font-semibold">{fmtKcal(suggestion.bmr)}</p></div>
          <div><p className="text-xs text-muted">TDEE</p><p className="font-semibold">{fmtKcal(suggestion.tdee)}</p></div>
          <div><p className="text-xs text-muted">Target</p><p className="font-semibold text-accent-ink">{fmtKcal(suggestion.kcal)}</p></div>
        </div>
        <p className="num mt-1 text-sm text-muted">P {suggestion.proteinG} g · C {suggestion.carbsG} g · F {suggestion.fatG} g</p>
        <p className="mt-2 text-xs text-muted">{suggestion.rationale}</p>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Estimates only: Mifflin-St Jeor BMR × activity factor. Individual needs commonly differ by 10 % or more. Protein is
          1.6 g/kg body weight (2.0 g/kg when losing fat), fat is 25 % of energy, and carbohydrate is the remainder. Adjust based
          on your weight trend over 2–4 weeks.
        </p>
        {differsFromSuggestion && <Button variant="secondary" className="mt-3 w-full" onClick={useSuggestion} disabled={busy}>Use suggestion</Button>}
      </Card>

      <Card className="space-y-3 p-4">
        <p className="text-sm font-semibold">Set your own targets</p>
        <Field label="Calories (kcal/day)"><Input inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Protein (g)" hint={valid ? `${pct(p, 4)} % of energy` : undefined}><Input inputMode="numeric" value={protein} onChange={(e) => setProtein(e.target.value)} /></Field>
          <Field label="Fat (g)" hint={valid ? `${pct(f, 9)} % of energy` : undefined}><Input inputMode="numeric" value={fat} onChange={(e) => setFat(e.target.value)} /></Field>
        </div>
        <div className="rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
          <p className="flex justify-between"><span>Carbohydrate (calculated)</span><span className="num font-semibold">{carbs != null ? `${carbs} g · ${pct(carbs, 4)} %` : "—"}</span></p>
          <p className="mt-0.5 text-xs text-muted">Carbs fill the remaining energy (4 kcal/g), so macros always add up to your calorie target.
            {carbs != null && ` Check: 4×${Math.round(p)} + 4×${carbs} + 9×${Math.round(f)} = ${macroKcal(Math.round(p), carbs, Math.round(f))} kcal.`}</p>
        </div>
        <ErrorText>{error}</ErrorText>
        {msg && <p className="text-sm text-up">{msg}</p>}
        <Button size="lg" className="w-full" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save targets"}</Button>
      </Card>
    </div>
  );
}
