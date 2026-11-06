"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, parseNum } from "@/lib/client/api";
import { fromDisplayMass, massUnit, round, type UnitSystem } from "@/lib/units";
import { Button, Card, ErrorText, Field, Input } from "@/components/ui";

export function WeightLogForm({ today, units }: { today: string; units: UnitSystem }) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [weight, setWeight] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = parseNum(weight);
    const kg = Number.isFinite(value) ? round(fromDisplayMass(value, units), 2) : NaN;
    if (!Number.isFinite(kg) || kg < 30 || kg > 300) {
      setError("Enter a valid weight.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("PUT", "/api/weight", { date, weightKg: kg });
      setWeight("");
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
          <Field label="Date"><Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={`Weight (${massUnit(units)})`}><Input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
        </div>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Save weight"}</Button>
      </form>
      <p className="mt-2 text-xs text-muted">One entry a day. Saving a date again replaces it.</p>
    </Card>
  );
}

export function DeleteWeightButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function remove() {
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
    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={remove} aria-label={`Delete the entry for ${label}`}>
      {failed ? "Retry" : "Delete"}
    </Button>
  );
}
