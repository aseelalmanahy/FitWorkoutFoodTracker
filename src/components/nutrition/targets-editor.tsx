"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api, parseNum } from "@/lib/client/api";
import { carbsFromRemainder, fmtKcal, macroKcal, type DatedTarget } from "@/lib/nutrition";
import { Button, Card, ErrorText, Field, Input } from "@/components/ui";

// 800 to 8,000 is the range the app accepts. It isn't a safety limit, and nothing here calls it one.
const KCAL_RANGE = "Enter a number from 800 to 8,000. This is the range the app accepts, not a recommendation.";
const MACRO_RANGE = "Enter protein from 0 to 600 g and fat from 0 to 400 g.";

export function TargetsEditor({ current, hasEarlierTarget }: { current: DatedTarget | null; hasEarlierTarget: boolean }) {
  const router = useRouter();
  // Only the person's own numbers are offered back. A legacy automatic row starts blank, so saving
  // without typing can't relabel a value nobody chose as "Set by you".
  const own = current?.source === "MANUAL" ? current : null;
  const [kcal, setKcal] = useState(own ? String(own.kcal) : "");
  const [protein, setProtein] = useState(own ? String(own.proteinG) : "");
  const [fat, setFat] = useState(own ? String(own.fatG) : "");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const k = parseNum(kcal), p = parseNum(protein), f = parseNum(fat);
  const valid = [k, p, f].every((x) => Number.isFinite(x) && x >= 0);
  const carbs = valid ? carbsFromRemainder(Math.round(k), Math.round(p), Math.round(f)) : null;
  const pct = (g: number, per: number) => (k > 0 ? Math.round(((g * per) / k) * 100) : 0);

  async function save() {
    setError(null);
    setMsg(null);
    if (!valid) return setError("Enter each target as a plain number, such as 2000.");
    if (Math.round(k) < 800 || Math.round(k) > 8000) return setError(KCAL_RANGE);
    if (Math.round(p) > 600 || Math.round(f) > 400) return setError(MACRO_RANGE);
    if (carbs === null) return setError("Protein and fat contain more energy than the calorie target.");
    setBusy(true);
    try {
      await api("PUT", "/api/nutrition/targets", { kcal: Math.round(k), proteinG: Math.round(p), fatG: Math.round(f) });
      setMsg(hasEarlierTarget ? "Saved. New targets apply from today. Earlier days keep their previous targets." : "Saved. New targets apply from today.");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 400 && e.details ? "Check the numbers and try again." : (e as Error).message);
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
            <p className="num text-sm text-muted">P {current.proteinG} g · C {current.carbsG} g · F {current.fatG} g · {current.source === "MANUAL" ? "Set by you" : "Set automatically earlier"} · since {current.effectiveFrom}</p>
          </>
        ) : <p className="mt-1 text-sm text-muted">No target yet.</p>}
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
