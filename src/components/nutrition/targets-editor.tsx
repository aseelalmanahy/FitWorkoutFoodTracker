"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api, parseNum } from "@/lib/client/api";
import { carbsFromRemainder, fmtKcal, fmtMacroTarget, macroKcal, type DatedTarget } from "@/lib/nutrition";
import { Button, Card, ErrorText, Field, Input } from "@/components/ui";
import { Sheet } from "./sheet";

// 800 to 8,000 is the range the app accepts. It isn't a safety limit, and nothing here calls it one.
const KCAL_RANGE = "Enter a number from 800 to 8,000. This is the range the app accepts, not a recommendation.";
const MACRO_RANGE = "Enter protein from 0 to 600 g and fat from 0 to 400 g.";

/** Blank is null, which means "not set". Zero stays zero. Anything unclear is NaN, for the form to refuse. */
const macroValue = (text: string) => (text.trim() === "" ? null : parseNum(text));
const usable = (x: number | null) => x === null || (Number.isFinite(x) && x >= 0);
const whole = (x: number | null) => (x === null ? null : Math.round(x));

export function TargetsEditor({ current, hasEarlierTarget, everSet, canStop }: { current: DatedTarget | null; hasEarlierTarget: boolean; everSet: boolean; canStop: boolean }) {
  const router = useRouter();
  // Only the person's own numbers are offered back. A legacy automatic row starts blank, so saving
  // without typing can't relabel a value nobody chose as "Set by you".
  const own = current?.source === "MANUAL" ? current : null;
  const [kcal, setKcal] = useState(own ? String(own.kcal) : "");
  const [protein, setProtein] = useState(own?.proteinG != null ? String(own.proteinG) : "");
  const [fat, setFat] = useState(own?.fatG != null ? String(own.fatG) : "");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);

  const k = parseNum(kcal), p = macroValue(protein), f = macroValue(fat);
  const valid = Number.isFinite(k) && k >= 0 && usable(p) && usable(f);
  const pw = whole(p), fw = whole(f);
  const remainder = valid ? carbsFromRemainder(Math.round(k), pw ?? 0, fw ?? 0) : null;
  // Calculated only from values the person gave. A missing macro target is never invented.
  const carbs = pw !== null && fw !== null ? remainder : null;
  const pct = (g: number, per: number) => (k > 0 ? Math.round(((g * per) / k) * 100) : 0);

  async function save() {
    setError(null);
    setMsg(null);
    if (!valid) return setError("Enter each target as a plain number, such as 2000. Only calories are required.");
    if (Math.round(k) < 800 || Math.round(k) > 8000) return setError(KCAL_RANGE);
    if ((pw ?? 0) > 600 || (fw ?? 0) > 400) return setError(MACRO_RANGE);
    if (remainder === null) return setError("Protein and fat contain more energy than the calorie target.");
    setBusy(true);
    try {
      await api("PUT", "/api/nutrition/targets", { kcal: Math.round(k), proteinG: pw, fatG: fw });
      setMsg(hasEarlierTarget ? "Saved. New targets apply from today. Earlier days keep their previous targets." : "Saved. New targets apply from today.");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 400 && e.details ? "Check the numbers and try again." : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      await api("POST", "/api/nutrition/targets/stop");
      setKcal(""); setProtein(""); setFat("");
      setMsg("Stopped. Days from today won't be compared with a target.");
      setConfirmingStop(false);
      router.refresh();
    } catch (e) {
      setConfirmingStop(false);
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
            <p className="num text-sm text-muted">P {fmtMacroTarget(current.proteinG)} · C {fmtMacroTarget(current.carbsG)} · F {fmtMacroTarget(current.fatG)} · {current.source === "MANUAL" ? "Set by you" : "Set automatically earlier"} · since {current.effectiveFrom}</p>
          </>
        ) : <p className="mt-1 text-sm text-muted">{everSet ? "No target in use." : "No target yet."}</p>}
        {canStop && <Button variant="secondary" className="mt-3 w-full" disabled={busy} onClick={() => setConfirmingStop(true)}>Stop using a target</Button>}
      </Card>

      <Card className="space-y-3 p-4">
        <p className="text-sm font-semibold">Set your own targets</p>
        <Field label="Calories (kcal/day)"><Input inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Protein (g)" hint={valid && pw !== null ? `${pct(pw, 4)} % of energy` : "Optional"}><Input inputMode="numeric" value={protein} onChange={(e) => setProtein(e.target.value)} /></Field>
          <Field label="Fat (g)" hint={valid && fw !== null ? `${pct(fw, 9)} % of energy` : "Optional"}><Input inputMode="numeric" value={fat} onChange={(e) => setFat(e.target.value)} /></Field>
        </div>
        <div className="rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
          <p className="flex justify-between"><span>Carbohydrate (calculated)</span><span className="num font-semibold" data-testid="carb-preview">{carbs != null ? `${carbs} g · ${pct(carbs, 4)} %` : "Not set"}</span></p>
          <p className="mt-0.5 text-xs text-muted">Calculated only when you enter both protein and fat: carbs then fill the remaining energy (4 kcal/g).
            {carbs != null && pw !== null && fw !== null && ` Check: 4×${pw} + 4×${carbs} + 9×${fw} = ${macroKcal(pw, carbs, fw)} kcal.`}</p>
        </div>
        <ErrorText>{error}</ErrorText>
        {msg && <p className="text-sm text-up">{msg}</p>}
        <Button size="lg" className="w-full" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save targets"}</Button>
      </Card>

      {confirmingStop && (
        <Sheet open title="Stop using a target?" locked={busy} onClose={() => setConfirmingStop(false)}>
          <p className="text-sm text-muted">Your food log and past targets stay. Days from today won&apos;t be compared with a target. You can set a new one at any time.</p>
          <div className="mt-4 space-y-2">
            <Button size="lg" className="w-full" disabled={busy} onClick={stop}>{busy ? "Stopping…" : "Stop using a target"}</Button>
            <Button variant="secondary" className="w-full" disabled={busy} onClick={() => setConfirmingStop(false)}>Keep my target</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
