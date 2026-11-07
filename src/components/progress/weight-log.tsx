"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, parseNum } from "@/lib/client/api";
import { formatMass, fromDisplayMass, kgToLb, massUnit, round, type UnitSystem } from "@/lib/units";
import { Button, Card, ErrorText, Field, Input } from "@/components/ui";

const MIN_KG = 30;
const MAX_KG = 300;

/** The range as it can be typed, as 30 kg displayed in pounds rounds to a value that's just under it. */
function rangeText(units: UnitSystem): string {
  if (units === "METRIC") return `${MIN_KG} and ${MAX_KG} kg`;
  return `${Math.ceil(kgToLb(MIN_KG) * 10) / 10} and ${Math.floor(kgToLb(MAX_KG) * 10) / 10} lb`;
}

export function WeightLogForm({ today, units, logged }: { today: string; units: UnitSystem; logged: Record<string, number> }) {
  const router = useRouter();
  // Null means today, whichever day that now is, so a tab left open overnight doesn't keep yesterday's date.
  const [picked, setPicked] = useState<string | null>(null);
  const [weight, setWeight] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const date = picked ?? today;
  const existing = logged[date];

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = parseNum(weight);
    const kg = Number.isFinite(value) ? round(fromDisplayMass(value, units), 2) : NaN;
    if (!Number.isFinite(kg) || kg < MIN_KG || kg > MAX_KG) {
      setError(`Enter a weight between ${rangeText(units)}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("PUT", "/api/weight", { date, weightKg: kg });
      setWeight("");
      setPicked(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={date} max={today} onChange={(e) => setPicked(e.target.value || null)} /></Field>
          <Field label={`Weight (${massUnit(units)})`}><Input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
        </div>
        {existing !== undefined && <p role="status" className="text-xs text-muted">You logged {formatMass(existing, units)} on this date. Saving replaces it.</p>}
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : existing !== undefined ? "Replace entry" : "Save weight"}</Button>
      </form>
    </Card>
  );
}

export function DeleteWeightButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function remove() {
    if (!confirm(`Delete the entry for ${label}?`)) return;
    setBusy(true);
    setFailed(false);
    try {
      await api("DELETE", `/api/weight/${id}`);
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={remove} aria-label={failed ? `Couldn't delete the entry for ${label}. Try again` : `Delete the entry for ${label}`}>
      {failed ? "Retry" : "Delete"}
    </Button>
  );
}
