"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { WEEKDAYS } from "@/lib/time";
import { Button, Card, ErrorText, Select } from "@/components/ui";

export function ScheduleEditor({ plans, initial, today }: { plans: { id: string; name: string }[]; initial: string[][]; today: number }) {
  const router = useRouter();
  const [days, setDays] = useState<string[][]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameOf = (id: string) => plans.find((p) => p.id === id)?.name ?? "Unknown";

  const setDay = (d: number, ids: string[]) => setDays((ds) => ds.map((x, i) => (i === d ? ids : x)));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api("PUT", "/api/schedule", { days });
      router.push("/workouts");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {WEEKDAYS.map((label, d) => (
        <Card key={label} className="p-3">
          <div className="flex items-center justify-between">
            <p className="font-semibold">{label}{d === today && <span className="ml-2 text-xs font-medium text-accent-ink">Today</span>}</p>
            {days[d].length === 0 && <span className="text-xs text-muted">Rest day</span>}
          </div>
          <div className="mt-2 space-y-2">
            {days[d].map((id, i) => (
              <div key={`${id}-${i}`} className="flex items-center gap-2">
                <Select
                  aria-label={`${label} workout ${i + 1}`}
                  value={id}
                  onChange={(e) => setDay(d, days[d].map((x, j) => (j === i ? e.target.value : x)))}
                >
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
                <Select aria-label="Move to day" value={d} className="w-28 shrink-0"
                  onChange={(e) => {
                    const to = Number(e.target.value);
                    setDays((ds) => ds.map((x, k) => (k === d ? x.filter((_, j) => j !== i) : k === to ? [...x, id] : x)));
                  }}>
                  {WEEKDAYS.map((w, k) => <option key={w} value={k}>{k === d ? "Move…" : w.slice(0, 3)}</option>)}
                </Select>
                <Button variant="ghost" size="sm" aria-label={`Remove ${nameOf(id)}`} onClick={() => setDay(d, days[d].filter((_, j) => j !== i))}>✕</Button>
              </div>
            ))}
            {plans.length > 0 && days[d].length < 3 && (
              <Button variant="ghost" size="sm" className="text-muted" onClick={() => setDay(d, [...days[d], plans[0].id])}>+ Add workout</Button>
            )}
          </div>
        </Card>
      ))}
      <ErrorText>{error}</ErrorText>
      <Button size="lg" className="w-full" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save schedule"}</Button>
    </div>
  );
}
