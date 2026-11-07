"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { EQUIPMENT, EQUIPMENT_LABELS, MUSCLE_GROUPS, MUSCLE_LABELS } from "@/lib/labels";
import { Button, ErrorText, Input, Select, cx } from "@/components/ui";
import { PlusIcon } from "@/components/icons";

export interface ExerciseOption {
  id: string;
  name: string;
  primaryMuscle: string;
  equipment: string;
  userId: string | null;
}

export function ExercisePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (e: ExerciseOption) => void }) {
  const [all, setAll] = useState<ExerciseOption[] | null>(null);
  const [q, setQ] = useState("");
  const [muscle, setMuscle] = useState<string>("ALL");
  const [creating, setCreating] = useState(false);
  const [newMuscle, setNewMuscle] = useState<string>("CHEST");
  const [newEquip, setNewEquip] = useState<string>("DUMBBELL");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setCreating(false);
    setError(null);
    if (!all) api<{ exercises: ExerciseOption[] }>("GET", "/api/exercises").then((r) => setAll(r.exercises)).catch((e) => setError(e.message));
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [open, all, onClose]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (all ?? []).filter((e) => (muscle === "ALL" || e.primaryMuscle === muscle) && (!term || e.name.toLowerCase().includes(term)));
  }, [all, q, muscle]);

  async function create() {
    setError(null);
    try {
      const { exercise } = await api<{ exercise: ExerciseOption }>("POST", "/api/exercises", { name: q.trim(), primaryMuscle: newMuscle, equipment: newEquip });
      setAll((a) => [...(a ?? []), exercise].sort((x, y) => x.name.localeCompare(y.name)));
      onPick(exercise);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Choose exercise" onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85dvh] w-full max-w-xl flex-col rounded-t-3xl bg-surface pb-[env(safe-area-inset-bottom)] sm:rounded-3xl">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="text-lg font-bold">Add exercise</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        <div className="space-y-2 px-4 pt-3 pb-2">
          <Input ref={inputRef} placeholder="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
            {["ALL", ...MUSCLE_GROUPS].map((m) => (
              <button key={m} type="button" onClick={() => setMuscle(m)}
                className={cx("h-8 shrink-0 rounded-full px-3 text-xs font-medium", muscle === m ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted hover:text-fg")}>
                {m === "ALL" ? "All" : MUSCLE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto px-2 pb-2">
          {all === null && !error && <li className="p-4 text-sm text-muted">Loading…</li>}
          {filtered.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => onPick(e)} className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left hover:bg-surface-2">
                <span>
                  <span className="block font-medium">{e.name}</span>
                  <span className="text-xs text-muted">{MUSCLE_LABELS[e.primaryMuscle]} · {EQUIPMENT_LABELS[e.equipment]}{e.userId ? " · Custom" : ""}</span>
                </span>
                <PlusIcon width={18} height={18} className="text-muted" />
              </button>
            </li>
          ))}
          {all !== null && q.trim().length >= 2 && !filtered.some((e) => e.name.toLowerCase() === q.trim().toLowerCase()) && (
            <li className="px-3 py-3">
              {!creating ? (
                <Button variant="secondary" className="w-full" onClick={() => setCreating(true)}>Create “{q.trim()}”</Button>
              ) : (
                <div className="space-y-2 rounded-xl bg-surface-2 p-3">
                  <p className="text-sm font-medium">New exercise: {q.trim()}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={newMuscle} onChange={(e) => setNewMuscle(e.target.value)}>
                      {MUSCLE_GROUPS.map((m) => <option key={m} value={m}>{MUSCLE_LABELS[m]}</option>)}
                    </Select>
                    <Select value={newEquip} onChange={(e) => setNewEquip(e.target.value)}>
                      {EQUIPMENT.map((m) => <option key={m} value={m}>{EQUIPMENT_LABELS[m]}</option>)}
                    </Select>
                  </div>
                  <Button className="w-full" onClick={create}>Create and add</Button>
                </div>
              )}
            </li>
          )}
        </ul>
        {error && <div className="px-4 pb-3"><ErrorText>{error}</ErrorText></div>}
      </div>
    </div>
  );
}
