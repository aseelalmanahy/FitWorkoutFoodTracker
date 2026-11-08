"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { EQUIPMENT_KINDS, EQUIPMENT_LABELS, MAX_GYMS } from "@/lib/gyms";
import { Button, Card, ErrorText, Field, Input, SectionTitle, Select } from "@/components/ui";
import { ExercisePicker, type ExerciseOption } from "./exercise-picker";

type Kind = (typeof EQUIPMENT_KINDS)[number];
export type ManagedGym = { id: string; name: string; kinds: Kind[]; machines: { id: string; name: string; kind: Kind; exercise: { id: string; name: string } | null }[] };
type GymRow = { id: string; name: string; equipment: { id: string; kind: Kind; name: string | null; exercise: { id: string; name: string } | null }[] };

const toManaged = (g: GymRow): ManagedGym => ({
  id: g.id, name: g.name,
  kinds: g.equipment.filter((e) => e.name === null).map((e) => e.kind),
  machines: g.equipment.flatMap((e) => (e.name ? [{ id: e.id, name: e.name, kind: e.kind, exercise: e.exercise }] : [])),
});

/**
 * Multi-gym: the person's gyms, what each has, and its named machines. A machine's sets are compared only with that
 * machine's, so a machine with workouts logged on it can't be removed. Gyms are never shared and no location is read.
 */
export function GymsManager({ initial }: { initial: ManagedGym[] }) {
  const [gyms, setGyms] = useState(initial);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true); setError(null);
    try {
      const { gym } = await api<{ gym: GymRow }>("POST", "/api/gyms", { name });
      setGyms((gs) => [...gs, toManaged(gym)].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
    } catch (e) { setError(e instanceof ApiError ? e.message : "The gym couldn't be added."); }
    setBusy(false);
  }

  const replace = (g: ManagedGym) => setGyms((gs) => gs.map((x) => (x.id === g.id ? g : x)));
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) create(); }} className="flex items-end gap-2">
          <div className="flex-1"><Field label="Add a gym" hint="A name only you see, like “Home” or “City gym”."><Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} data-testid="gym-name" /></Field></div>
          <Button type="submit" disabled={busy || !name.trim() || gyms.length >= MAX_GYMS} data-testid="gym-add">Add</Button>
        </form>
        <ErrorText>{error}</ErrorText>
      </Card>
      {gyms.length === 0 && <p className="text-sm text-muted">No gyms yet. Workouts work the same without one; a gym lets you keep each place&apos;s machines apart.</p>}
      {gyms.map((g) => <GymCard key={g.id} gym={g} onChange={replace} />)}
    </div>
  );
}

function GymCard({ gym, onChange }: { gym: ManagedGym; onChange: (g: ManagedGym) => void }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(gym.name);
  const [machine, setMachine] = useState<{ name: string; kind: Kind; exercise: ExerciseOption | null }>({ name: "", kind: "MACHINE", exercise: null });
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(work: () => Promise<void>, fallback: string) {
    setBusy(true); setError(null);
    try { await work(); } catch (e) { setError(e instanceof ApiError ? e.message : fallback); }
    setBusy(false);
  }
  const rename = () => act(async () => { const { gym: g } = await api<{ gym: GymRow }>("PATCH", `/api/gyms/${gym.id}`, { name }); onChange(toManaged(g)); setRenaming(false); }, "The name couldn't be saved.");
  // The box changes as soon as it's tapped; if the save fails it goes back, with the reason shown.
  const toggle = (k: Kind) => {
    const before = gym;
    const kinds = gym.kinds.includes(k) ? gym.kinds.filter((x) => x !== k) : [...gym.kinds, k];
    onChange({ ...gym, kinds });
    return act(async () => {
      try {
        const { gym: g } = await api<{ gym: GymRow }>("PUT", `/api/gyms/${gym.id}/equipment`, { kinds });
        onChange(toManaged(g));
      } catch (e) { onChange(before); throw e; }
    }, "The equipment couldn't be saved.");
  };
  const add = () => act(async () => {
    const { machine: m } = await api<{ machine: { id: string; name: string; kind: Kind } }>("POST", `/api/gyms/${gym.id}/equipment`, { kind: machine.kind, name: machine.name, exerciseId: machine.exercise?.id ?? null });
    onChange({ ...gym, machines: [...gym.machines, { id: m.id, name: m.name, kind: m.kind, exercise: machine.exercise ? { id: machine.exercise.id, name: machine.exercise.name } : null }] });
    setMachine({ name: "", kind: "MACHINE", exercise: null });
  }, "The machine couldn't be added.");
  const remove = (id: string) => act(async () => { await api("DELETE", `/api/gyms/${gym.id}/machines/${id}`); onChange({ ...gym, machines: gym.machines.filter((m) => m.id !== id) }); }, "The machine couldn't be removed.");

  return (
    <Card className="space-y-3 p-4" data-testid="gym-card">
      <div className="flex items-center justify-between gap-2">
        {renaming ? (
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) rename(); }} className="flex flex-1 gap-2">
            <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Gym name" data-testid="gym-rename-input" />
            <Button type="submit" size="sm" disabled={busy || !name.trim()} data-testid="gym-rename-save">Save</Button>
          </form>
        ) : (
          <>
            <h2 className="font-bold" data-testid="gym-title">{gym.name}</h2>
            <span className="flex items-center gap-3 text-sm">
              <Link href={`/workouts/history?gym=${gym.id}`} className="font-medium text-accent-ink" data-testid="gym-history">History</Link>
              <button type="button" className="font-medium text-accent-ink" onClick={() => setRenaming(true)} data-testid="gym-rename">Rename</button>
            </span>
          </>
        )}
      </div>

      <fieldset>
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted">What it has</legend>
        <p className="text-xs text-muted">Used to mark which alternatives you can do here when you swap an exercise.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {EQUIPMENT_KINDS.map((k) => (
            <label key={k} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm">
              <input type="checkbox" checked={gym.kinds.includes(k)} onChange={() => toggle(k)} disabled={busy} data-testid={`gym-kind-${k}`} />
              {EQUIPMENT_LABELS[k]}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <SectionTitle>Machines</SectionTitle>
        <p className="text-xs text-muted">Name a specific machine to keep its numbers apart: the same exercise on two machines isn&apos;t the same load.</p>
        <ul className="mt-2 divide-y divide-line">
          {gym.machines.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm" data-testid="gym-machine">
              <span><span className="font-medium">{m.name}</span> <span className="text-muted">· {EQUIPMENT_LABELS[m.kind]}{m.exercise ? ` · for ${m.exercise.name}` : ""}</span></span>
              <Button variant="ghost" size="sm" onClick={() => remove(m.id)} disabled={busy} data-testid="gym-machine-remove">Remove</Button>
            </li>
          ))}
        </ul>
        <form onSubmit={(e) => { e.preventDefault(); if (machine.name.trim()) add(); }} className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input placeholder="Machine name, like “Hammer chest press”" value={machine.name} maxLength={60} onChange={(e) => setMachine({ ...machine, name: e.target.value })} aria-label="Machine name" data-testid="machine-name" />
          <Select value={machine.kind} onChange={(e) => setMachine({ ...machine, kind: e.target.value as Kind })} aria-label="Machine type" data-testid="machine-kind">
            {EQUIPMENT_KINDS.map((k) => <option key={k} value={k}>{EQUIPMENT_LABELS[k]}</option>)}
          </Select>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setPicker(true)} data-testid="machine-exercise">{machine.exercise ? `For ${machine.exercise.name}` : "For one exercise (optional)"}</Button>
            {machine.exercise && <Button type="button" variant="ghost" size="sm" onClick={() => setMachine({ ...machine, exercise: null })}>Any exercise</Button>}
            <Button type="submit" size="sm" disabled={busy || !machine.name.trim()} data-testid="machine-add">Add machine</Button>
          </div>
        </form>
      </div>
      <ErrorText>{error}</ErrorText>
      <ExercisePicker open={picker} onClose={() => setPicker(false)} onPick={(o) => { setPicker(false); setMachine({ ...machine, exercise: o }); }} />
    </Card>
  );
}
