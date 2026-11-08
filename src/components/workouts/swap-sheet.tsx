"use client";

import { useEffect, useState } from "react";
import { api, ApiError, SAVE_TIMEOUT_MS } from "@/lib/client/api";
import { EQUIPMENT_LABELS } from "@/lib/gyms";
import { Button, ErrorText, Field, Select } from "@/components/ui";
import { Sheet } from "@/components/nutrition/sheet";
import { ExercisePicker, type ExerciseOption } from "./exercise-picker";

type Alt = { id: string; name: string; equipment: keyof typeof EQUIPMENT_LABELS; reason: "same-pattern" | "used-before"; pattern: string | null; available: boolean };
type Answer = { planned: { id: string; name: string }; gym: { id: string; name: string; equipmentKnown: boolean } | null; alternatives: Alt[]; machines: { id: string; name: string; kind: string; exerciseId: string | null }[] };
export type Swapped = { sessionExercise: { id: string; exerciseId: string; gymEquipmentId: string | null; restSeconds: number | null; notes: string | null; exercise: { id: string; name: string; equipment: string } }; planUpdated: boolean };

/**
 * Multi-gym: swap an exercise in this workout for another. Only reviewed movement-pattern alternatives and the person's
 * own earlier swaps are suggested, each said to be a substitution; they can also choose any exercise themselves. The
 * planned exercise keeps its sets; the plan changes only if they tick the box.
 */
export function SwapSheet({ sessionId, seId, fromPlan, onClose, onSwapped }: { sessionId: string; seId: string; fromPlan: boolean; onClose: () => void; onSwapped: (s: Swapped) => void }) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null);
  const [machine, setMachine] = useState("");
  const [updatePlan, setUpdatePlan] = useState(false);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Answer>("GET", `/api/sessions/${sessionId}/exercises/${seId}/alternatives`).then(setAnswer).catch((e) => setError(e instanceof ApiError ? e.message : "Alternatives couldn't be loaded."));
  }, [sessionId, seId]);

  async function confirm() {
    if (!chosen) return;
    setBusy(true); setError(null);
    try {
      onSwapped(await api<Swapped>("POST", `/api/sessions/${sessionId}/exercises/${seId}/substitute`, { exerciseId: chosen.id, gymEquipmentId: machine || null, updatePlan }, { timeoutMs: SAVE_TIMEOUT_MS }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The swap couldn't be saved.");
      setBusy(false);
    }
  }

  const machines = answer?.machines.filter((m) => !chosen || m.exerciseId === null || m.exerciseId === chosen.id) ?? [];
  return (
    <Sheet open title={answer ? `Swap ${answer.planned.name}` : "Swap exercise"} locked={busy} onClose={onClose}>
      {!answer && !error && <p role="status">Finding alternatives…</p>}
      {answer && (
        <div className="space-y-3" data-testid="swap-sheet">
          <p className="text-sm text-muted">
            Alternatives use the same movement, reviewed by hand, never just the same muscle. Each is a different exercise with its own history; the sets you
            already logged stay with {answer.planned.name}.{answer.gym ? (answer.gym.equipmentKnown ? ` Marked by what ${answer.gym.name} has.` : ` ${answer.gym.name}'s equipment isn't set up, so availability isn't known.`) : " Choose this workout's gym to see what's available."}
          </p>
          {answer.alternatives.length === 0 && <p className="text-sm">No reviewed alternative for this exercise. You can choose one yourself.</p>}
          <ul className="space-y-1.5">
            {answer.alternatives.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => setChosen({ id: a.id, name: a.name })} aria-pressed={chosen?.id === a.id} data-testid="swap-option" data-available={a.available}
                  className={`w-full rounded-xl border px-3 py-2 text-left ${chosen?.id === a.id ? "border-accent bg-accent-soft" : "border-line"} ${a.available ? "" : "opacity-60"}`}>
                  <span className="font-medium">{a.name}</span>
                  <span className="block text-xs text-muted">
                    {a.reason === "used-before" ? "You swapped to this before" : `Same movement: ${a.pattern}`} · {EQUIPMENT_LABELS[a.equipment]}{a.available ? "" : " · not listed at this gym"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Button variant="ghost" size="sm" onClick={() => setPicker(true)} data-testid="swap-choose-own">Choose another exercise myself</Button>
          {chosen && !answer.alternatives.some((a) => a.id === chosen.id) && <p className="text-sm" data-testid="swap-own-choice">Your choice: <strong>{chosen.name}</strong> (not a reviewed match).</p>}
          {chosen && machines.length > 0 && (
            <Field label="Machine (optional)" hint="Its history is kept apart from other machines'.">
              <Select value={machine} onChange={(e) => setMachine(e.target.value)} data-testid="swap-machine">
                <option value="">No specific machine</option>
                {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
          )}
          {fromPlan && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={updatePlan} onChange={(e) => setUpdatePlan(e.target.checked)} data-testid="swap-update-plan" />
              <span>Also change my plan to use it from now on. Otherwise only this workout changes.</span>
            </label>
          )}
          <ErrorText>{error}</ErrorText>
          <Button disabled={!chosen || busy} onClick={confirm} data-testid="swap-confirm">{chosen ? `Swap to ${chosen.name}` : "Choose an exercise"}</Button>
        </div>
      )}
      {!answer && <ErrorText>{error}</ErrorText>}
      <ExercisePicker open={picker} onClose={() => setPicker(false)} onPick={(o: ExerciseOption) => { setPicker(false); setChosen({ id: o.id, name: o.name }); }} />
    </Sheet>
  );
}
