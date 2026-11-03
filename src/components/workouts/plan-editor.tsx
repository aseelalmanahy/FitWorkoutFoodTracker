"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, parseNum } from "@/lib/client/api";
import { fromDisplayMass, massUnit, round, toDisplayMass, type UnitSystem } from "@/lib/units";
import { Button, Card, ErrorText, Field, Input, Textarea } from "@/components/ui";
import { PlusIcon, TrashIcon } from "@/components/icons";
import { ExercisePicker, type ExerciseOption } from "./exercise-picker";

export interface PlanExercise {
  exerciseId: string;
  name: string;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  targetWeightKg: number | null;
  restSeconds: number | null;
  notes: string | null;
}

interface Row {
  key: string;
  exerciseId: string;
  name: string;
  sets: string;
  repsMin: string;
  repsMax: string;
  weight: string;
  rest: string;
  notes: string;
}

let k = 0;
const nextKey = () => `r${++k}`;

export function PlanEditor({ planId, initial, units }: { planId?: string; initial?: { name: string; notes: string | null; exercises: PlanExercise[] }; units: UnitSystem }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [rows, setRows] = useState<Row[]>(
    (initial?.exercises ?? []).map((e) => ({
      key: nextKey(),
      exerciseId: e.exerciseId,
      name: e.name,
      sets: String(e.targetSets),
      repsMin: String(e.targetRepsMin),
      repsMax: String(e.targetRepsMax),
      weight: e.targetWeightKg != null ? String(toDisplayMass(e.targetWeightKg, units)) : "",
      rest: e.restSeconds != null ? String(e.restSeconds) : "",
      notes: e.notes ?? "",
    })),
  );
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  function add(e: ExerciseOption) {
    setRows((rs) => [...rs, { key: nextKey(), exerciseId: e.id, name: e.name, sets: "3", repsMin: "8", repsMax: "12", weight: "", rest: "90", notes: "" }]);
    setPicker(false);
  }

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Give the plan a name.");
    const exercises = [];
    for (const r of rows) {
      const sets = parseInt(r.sets), min = parseInt(r.repsMin), max = parseInt(r.repsMax || r.repsMin);
      if (!(sets >= 1) || !(min >= 1) || !(max >= min)) return setError(`Check sets/reps for ${r.name}.`);
      const w = r.weight.trim() ? parseNum(r.weight) : null;
      if (w != null && !(w >= 0)) return setError(`Check target weight for ${r.name}.`);
      const rest = r.rest.trim() ? parseInt(r.rest) : null;
      exercises.push({
        exerciseId: r.exerciseId,
        targetSets: sets,
        targetRepsMin: min,
        targetRepsMax: max,
        targetWeightKg: w != null ? round(fromDisplayMass(w, units), 3) : null,
        restSeconds: rest != null && rest >= 0 ? rest : null,
        notes: r.notes.trim() || null,
      });
    }
    setBusy(true);
    try {
      const body = { name: name.trim(), notes: notes.trim() || null, exercises };
      if (planId) await api("PUT", `/api/templates/${planId}`, body);
      else await api("POST", "/api/templates", body);
      router.push("/workouts");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!planId || !confirm("Delete this plan? Logged workouts are kept.")) return;
    setBusy(true);
    try {
      await api("DELETE", `/api/templates/${planId}`);
      router.push("/workouts");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const mu = massUnit(units);
  return (
    <div className="space-y-4">
      <Field label="Plan name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Upper Body A" /></Field>
      <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>

      <div className="space-y-3">
        {rows.map((r, i) => (
          <Card key={r.key} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">{i + 1}. {r.name}</p>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="sm" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>↑</Button>
                <Button variant="ghost" size="sm" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === rows.length - 1}>↓</Button>
                <Button variant="ghost" size="sm" aria-label="Remove" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}><TrashIcon width={16} height={16} /></Button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              <Field label="Sets"><Input inputMode="numeric" value={r.sets} onChange={(e) => update(r.key, { sets: e.target.value })} /></Field>
              <Field label="Reps min"><Input inputMode="numeric" value={r.repsMin} onChange={(e) => update(r.key, { repsMin: e.target.value })} /></Field>
              <Field label="Reps max"><Input inputMode="numeric" value={r.repsMax} onChange={(e) => update(r.key, { repsMax: e.target.value })} /></Field>
              <Field label={`Wt (${mu})`}><Input inputMode="decimal" value={r.weight} placeholder="—" onChange={(e) => update(r.key, { weight: e.target.value })} /></Field>
            </div>
            <div className="mt-2 grid grid-cols-[1fr_2fr] gap-2">
              <Field label="Rest (sec)"><Input inputMode="numeric" value={r.rest} onChange={(e) => update(r.key, { rest: e.target.value })} /></Field>
              <Field label="Notes"><Input value={r.notes} placeholder="Tempo, cues…" onChange={(e) => update(r.key, { notes: e.target.value })} /></Field>
            </div>
          </Card>
        ))}
        <Button variant="secondary" className="w-full" onClick={() => setPicker(true)}><PlusIcon width={18} height={18} /> Add exercise</Button>
      </div>

      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        {planId && <Button variant="danger" onClick={remove} disabled={busy}>Delete</Button>}
        <Button className="flex-1" size="lg" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save plan"}</Button>
      </div>
      <ExercisePicker open={picker} onClose={() => setPicker(false)} onPick={add} />
    </div>
  );
}
