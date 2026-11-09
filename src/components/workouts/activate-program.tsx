"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { buildWeek, MAX_PER_DAY, scheduleChanges } from "@/lib/active-program";
import { WEEKDAYS, WEEKDAYS_SHORT } from "@/lib/time";
import { Button, Card, ErrorText, cx } from "@/components/ui";

type Day = { id: string; name: string; exercises: number };
type Slot = { weekday: number; position: number; templateId: string; name: string; program: string | null };

/**
 * UI-06: the preview before a program becomes the active one. Each workout day gets its weekdays (suggested, and
 * changeable); the exact changes to the weekly schedule are listed, removals first; nothing happens until Confirm.
 */
export function ActivateProgram({ programId, programName, days, proposed, current, version, alreadyActive }: {
  programId: string; programName: string; days: Day[]; proposed: Record<string, number[]>; current: Slot[]; version: string; alreadyActive: boolean;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState(proposed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const dayIds = days.map((d) => d.id);
  const nameOf = (id: string) => days.find((d) => d.id === id)?.name ?? current.find((s) => s.templateId === id)?.name ?? "A workout";

  const plan = useMemo(() => {
    try {
      const week = buildWeek(dayIds, chosen);
      return { week, ...scheduleChanges(current, week), problem: null as string | null };
    } catch (e) { return { week: null, removed: [], added: [], problem: (e as Error).message }; }
  }, [chosen, current, dayIds]);
  const kept = current.filter((s) => !plan.removed.some((r) => r.weekday === s.weekday && r.templateId === s.templateId));

  const toggle = (id: string, d: number) => setChosen((c) => {
    const has = (c[id] ?? []).includes(d);
    return { ...c, [id]: has ? c[id].filter((x) => x !== d) : [...(c[id] ?? []), d].sort() };
  });

  async function confirm() {
    setBusy(true); setError(null);
    try {
      await api("POST", `/api/programs/${programId}/activate`, { weekdays: chosen, version });
      router.replace("/workouts");
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setStale(true);
      setError(e instanceof ApiError ? e.message : "That couldn't be saved. Try again.");
      setBusy(false);
    }
  }

  const slotLabel = (s: { weekday: number; templateId: string }) => {
    const c = current.find((x) => x.templateId === s.templateId);
    return <>{WEEKDAYS[s.weekday]}: <strong className="text-fg">{nameOf(s.templateId)}</strong>{c && c.program !== programName && <span> ({c.program ?? "individual plan"})</span>}</>;
  };

  return (
    <div className="space-y-5">
      {alreadyActive && <p className="rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent-ink">This is already your active program. Confirming again sets its weekdays as chosen below.</p>}
      <section aria-labelledby="days-title">
        <h2 id="days-title" className="mb-2 font-semibold">1. Choose the days for each workout</h2>
        <p className="mb-3 text-sm text-muted">Suggested from your current schedule, or spread across the week. Change any of them. A workout with no day stays in the program and can still be started at any time.</p>
        <p className="mb-3 text-sm font-medium text-fg" data-testid="activate-help">Select one or more days. Select a day again to remove it.</p>
        <div className="space-y-2">
          {days.map((d, i) => (
            <Card key={d.id} className="p-4" data-testid="activate-day">
              <p className="font-semibold break-words"><span className="text-muted">{i + 1}.</span> {d.name}</p>
              <p className="mb-2 text-xs text-muted">{d.exercises} exercise{d.exercises === 1 ? "" : "s"}</p>
              <div role="group" aria-label={`Days for ${d.name}`} className="flex flex-wrap gap-1.5">
                {WEEKDAYS_SHORT.map((w, k) => {
                  const on = (chosen[d.id] ?? []).includes(k);
                  return (
                    <button key={w} type="button" aria-pressed={on} aria-label={`${WEEKDAYS[k]}${on ? ", selected" : ""}`} onClick={() => toggle(d.id, k)} data-testid="activate-weekday"
                      className={cx("min-w-11 rounded-full border px-2.5 py-1.5 text-sm", on ? "border-accent bg-accent text-accent-fg font-semibold" : "border-line text-muted hover:text-fg")}>{w}</button>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="changes-title" data-testid="activate-changes">
        <h2 id="changes-title" className="mb-2 font-semibold">2. Check the changes to your weekly schedule</h2>
        {plan.problem ? <ErrorText>{plan.problem} At most {MAX_PER_DAY} workouts a day.</ErrorText> : (
          <Card className="space-y-3 p-4 text-sm">
            <div data-testid="activate-removed">
              <p className="font-semibold">{plan.removed.length ? `Removed from the schedule (${plan.removed.length})` : "Nothing removed from the schedule"}</p>
              {plan.removed.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">{plan.removed.map((s) => <li key={`${s.weekday}-${s.templateId}`}>{slotLabel(s)}</li>)}</ul>}
              {plan.removed.length > 0 && <p className="mt-1 text-xs text-muted">Only the schedule entries go. Those plans, their exercises and their workout history all stay.</p>}
            </div>
            <div data-testid="activate-added">
              <p className="font-semibold">{plan.added.length ? `Added (${plan.added.length})` : "Nothing added"}</p>
              {plan.added.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">{plan.added.map((s) => <li key={`${s.weekday}-${s.templateId}`}>{slotLabel(s)}</li>)}</ul>}
            </div>
            <div>
              <p className="font-semibold">{kept.length ? `Unchanged (${kept.length})` : "Nothing unchanged"}</p>
              {kept.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">{kept.map((s) => <li key={`${s.weekday}-${s.templateId}`}>{slotLabel(s)}</li>)}</ul>}
            </div>
          </Card>
        )}
      </section>

      <p className="text-sm text-muted">Completed workouts and progress don&apos;t change. Other programs and plans stay saved, and you can still start any of them when you like.</p>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex flex-wrap gap-2">
        {stale ? (
          <Button onClick={() => router.refresh()} data-testid="activate-reload">Show the updated preview</Button>
        ) : (
          <Button onClick={confirm} disabled={busy || !!plan.problem} data-testid="activate-confirm">{busy ? "Saving…" : `Make “${programName}” active`}</Button>
        )}
        <Button variant="secondary" onClick={() => router.back()} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}
