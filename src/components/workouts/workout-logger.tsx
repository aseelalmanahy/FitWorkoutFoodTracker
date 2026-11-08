"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useRef } from "react";
import { api, parseNum, ApiError, isUncertainFailure, newIdempotencyKey, SAVE_TIMEOUT_MS, saveFailureMessage } from "@/lib/client/api";
import { compareToPrevious, summarizeSets } from "@/lib/overload";
import { formatDuration, fromDisplayMass, massUnit, round, toDisplayMass, type UnitSystem } from "@/lib/units";
import { Button, Card, ErrorText, Input, Textarea, cx } from "@/components/ui";
import { CheckIcon, PlusIcon, TimerIcon, TrashIcon } from "@/components/icons";
import { OverloadBadge } from "@/components/overload-badge";
import { ExercisePicker, type ExerciseOption } from "./exercise-picker";
import { NoteSaver, flushAll, type NoteSaveStatus } from "@/lib/client/note-saver";
import { SwapSheet, type Swapped } from "./swap-sheet";

export interface LoggedSet {
  id: string;
  setNumber: number;
  reps: number;
  weightKg: number;
  isWarmup: boolean;
}

export interface LoggerExercise {
  id: string;
  exercise: { id: string; name: string; equipment: string };
  notes: string | null;
  restSeconds: number | null;
  sets: LoggedSet[];
  prev: { date: string; sets: LoggedSet[] } | null;
  target: { sets: number; repsMin: number; repsMax: number; weightKg: number | null } | null;
  /** Multi-gym: the specific machine, if chosen; its previous performance is that machine's own. */
  machine?: { id: string; name: string } | null;
  /** A swap: the exercise it replaced in this workout. */
  planned?: { name: string } | null;
  /** This one was swapped for another; its own sets stay. */
  swappedOut?: boolean;
}

export type LoggerGym = { id: string; name: string; machines: { id: string; name: string; exerciseId: string | null }[] };

interface Props {
  sessionId: string;
  name: string;
  startedAt: string;
  units: UnitSystem;
  initial: LoggerExercise[];
  /** The workout's own notes, as already saved. */
  initialNotes?: string | null;
  /** Multi-gym: the person's gyms, and the one this workout is at (null: not said). */
  gyms?: LoggerGym[];
  gymId?: string | null;
  /** Started from a plan, so a swap can offer to update it. */
  fromPlan?: boolean;
}

const DEFAULT_REST = 90;
/** The longest note the API accepts, for both exercise and workout notes. */
export const NOTE_MAX = 1000;

const SAVE_STATE_TEXT: Record<NoteSaveStatus, string> = { idle: "", saving: "Saving…", saved: "Saved", failed: "Not saved. Try again, or check your connection." };

export function WorkoutLogger({ sessionId, name, startedAt, units, initial, initialNotes, gyms = [], gymId: initialGymId = null, fromPlan = false }: Props) {
  const router = useRouter();
  const [exercises, setExercises] = useState(initial);
  const [gymId, setGymId] = useState<string | null>(initialGymId);
  const [swapping, setSwapping] = useState<string | null>(null);
  const machines = gyms.find((g) => g.id === gymId)?.machines ?? [];
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [restEnd, setRestEnd] = useState<number | null>(null);
  // Workout notes: how the whole session went. Separate from each exercise's own note.
  const [sessionNotes, setSessionNotes] = useState(initialNotes ?? "");
  const [sessionNotesState, setSessionNotesState] = useState<NoteSaveStatus>("idle");
  // Every note on the page saves through a NoteSaver: one request at a time, the latest text last.
  const sessionSaver = useRef<NoteSaver | null>(null);
  sessionSaver.current ??= new NoteSaver(
    (v) => run(() => api("PATCH", `/api/sessions/${sessionId}`, { notes: v || null })).then(Boolean),
    initialNotes ?? null, setSessionNotesState,
  );
  const noteSavers = useRef(new Map<string, NoteSaver>());

  // Closing or reloading the page while a note is unsaved, or still saving, asks first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (![sessionSaver.current!, ...noteSavers.current.values()].some((n) => n.dirty)) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (restEnd && now >= restEnd) {
      setRestEnd(null);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(200);
    }
  }, [now, restEnd]);

  const base = `/api/sessions/${sessionId}/exercises`;
  const patchEx = (id: string, fn: (e: LoggerExercise) => LoggerExercise) => setExercises((xs) => xs.map((x) => (x.id === id ? fn(x) : x)));

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // One key per exercise until its set is saved, so trying again after a lost response can't log it twice.
  const setKeys = useRef(new Map<string, string>());
  // A second Enter can land before the button is disabled.
  const logging = useRef(new Set<string>());

  /** What's really saved for this exercise, or null if that can't be found out either. */
  async function savedSets(exId: string): Promise<LoggedSet[] | null> {
    const res = await api<{ session: { exercises: { id: string; sets: LoggedSet[] }[] } }>("GET", `/api/sessions/${sessionId}`, undefined, { timeoutMs: SAVE_TIMEOUT_MS }).catch(() => null);
    return res?.session.exercises.find((x) => x.id === exId)?.sets ?? null;
  }

  async function logSet(ex: LoggerExercise, weightKg: number, reps: number, isWarmup: boolean) {
    if (logging.current.has(ex.id)) return false;
    logging.current.add(ex.id);
    setError(null);
    const startRest = () => { if (!isWarmup) setRestEnd(Date.now() + (ex.restSeconds ?? DEFAULT_REST) * 1000); };
    const idempotencyKey = setKeys.current.get(ex.id) ?? newIdempotencyKey();
    setKeys.current.set(ex.id, idempotencyKey);
    try {
      const res = await api<{ set: LoggedSet }>("POST", `${base}/${ex.id}/sets`, { weightKg, reps, isWarmup }, { idempotencyKey, timeoutMs: SAVE_TIMEOUT_MS });
      setKeys.current.delete(ex.id);
      patchEx(ex.id, (e) => ({ ...e, sets: e.sets.some((s) => s.id === res.set.id) ? e.sets : [...e.sets, res.set] }));
      startRest();
      return true;
    } catch (e) {
      // A conflict means an earlier attempt saved other values, so the next save is a new set.
      const conflict = e instanceof ApiError && e.status === 409;
      if (conflict) setKeys.current.delete(ex.id);
      if (conflict || isUncertainFailure(e)) {
        const saved = await savedSets(ex.id);
        if (saved) {
          patchEx(ex.id, (x) => ({ ...x, sets: saved }));
          // It did save, and only the answer was lost. The screen now shows it, so the next save is a new set.
          if (!conflict && saved.length > ex.sets.length) {
            setKeys.current.delete(ex.id);
            startRest();
            return true;
          }
        }
      }
      setError(saveFailureMessage(e));
      return false;
    } finally {
      logging.current.delete(ex.id);
    }
  }

  async function updateSet(ex: LoggerExercise, set: LoggedSet, patch: Partial<LoggedSet>) {
    const res = await run(() => api<{ set: LoggedSet }>("PATCH", `${base}/${ex.id}/sets/${set.id}`, patch));
    if (res) patchEx(ex.id, (e) => ({ ...e, sets: e.sets.map((s) => (s.id === set.id ? res.set : s)) }));
  }

  async function deleteSet(ex: LoggerExercise, set: LoggedSet) {
    const ok = await run(() => api("DELETE", `${base}/${ex.id}/sets/${set.id}`));
    if (ok) patchEx(ex.id, (e) => ({ ...e, sets: e.sets.filter((s) => s.id !== set.id).map((s, i) => ({ ...s, setNumber: i + 1 })) }));
  }

  async function addExercise(opt: ExerciseOption) {
    setPicker(false);
    const res = await run(() =>
      api<{ sessionExercise: { id: string; restSeconds: number | null; notes: string | null } }>("POST", base, { exerciseId: opt.id }),
    );
    if (!res) return;
    const prevRes = await api<{ previous: { date: string; sets: LoggedSet[] } | null }>(
      "GET", `/api/exercises/${opt.id}/previous?exclude=${encodeURIComponent(sessionId)}`,
    ).catch(() => null);
    const prev = prevRes?.previous ?? null;
    setExercises((xs) => [
      ...xs,
      { id: res.sessionExercise.id, exercise: { id: opt.id, name: opt.name, equipment: opt.equipment }, notes: null, restSeconds: null, sets: [], prev, target: null },
    ]);
  }

  /** Previous performance in a context: the exercise, on a machine or not. */
  async function previousFor(exerciseId: string, machineId: string | null) {
    const q = new URLSearchParams({ exclude: sessionId, ...(machineId ? { machine: machineId } : {}) });
    return (await api<{ previous: { date: string; sets: LoggedSet[] } | null }>("GET", `/api/exercises/${exerciseId}/previous?${q}`).catch(() => null))?.previous ?? null;
  }

  async function chooseGym(id: string) {
    const ok = await run(() => api("PUT", `/api/sessions/${sessionId}/gym`, { gymLocationId: id || null }));
    if (ok) setGymId(id || null);
  }

  async function chooseMachine(ex: LoggerExercise, machineId: string) {
    const ok = await run(() => api("PUT", `${base}/${ex.id}/machine`, { gymEquipmentId: machineId || null }));
    if (!ok) return;
    const m = machines.find((x) => x.id === machineId) ?? null;
    const prev = await previousFor(ex.exercise.id, m?.id ?? null);
    patchEx(ex.id, (e) => ({ ...e, machine: m ? { id: m.id, name: m.name } : null, prev }));
  }

  async function swapped(original: LoggerExercise, s: Swapped) {
    setSwapping(null);
    const se = s.sessionExercise;
    const m = machines.find((x) => x.id === se.gymEquipmentId) ?? null;
    const prev = await previousFor(se.exerciseId, se.gymEquipmentId);
    const replacement: LoggerExercise = { id: se.id, exercise: { id: se.exercise.id, name: se.exercise.name, equipment: se.exercise.equipment }, notes: se.notes, restSeconds: se.restSeconds, sets: [], prev, target: original.target, machine: m ? { id: m.id, name: m.name } : null, planned: { name: original.planned?.name ?? original.exercise.name } };
    setExercises((xs) => xs.flatMap((x) => (x.id === original.id ? [{ ...x, swappedOut: true }, replacement] : [x])));
  }

  async function removeExercise(ex: LoggerExercise) {
    if (ex.sets.length && !confirm(`Remove ${ex.exercise.name} and its ${ex.sets.length} logged set(s)?`)) return;
    const ok = await run(() => api("DELETE", `${base}/${ex.id}`));
    if (ok) setExercises((xs) => xs.filter((x) => x.id !== ex.id));
  }

  async function moveExercise(i: number, dir: "up" | "down") {
    const ex = exercises[i];
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= exercises.length) return;
    const ok = await run(() => api("PATCH", `${base}/${ex.id}`, { move: dir }));
    if (ok) setExercises((xs) => { const c = [...xs]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  }

  async function saveExerciseMeta(ex: LoggerExercise, patch: { notes?: string | null; restSeconds?: number | null }) {
    const ok = await run(() => api("PATCH", `${base}/${ex.id}`, patch));
    if (ok) patchEx(ex.id, (e) => ({ ...e, ...patch }));
    return Boolean(ok);
  }


  async function finish() {
    // A set still on its way would be refused once the workout is finished, and the page would be gone before anyone saw why.
    if (logging.current.size > 0) return setError("A set is still saving. Try Finish again in a moment.");
    const total = exercises.reduce((n, e) => n + e.sets.length, 0);
    if (total === 0) return setError("Log at least one set before finishing.");
    const skipped = exercises.filter((e) => e.sets.length === 0).length;
    // Every note is saved first, including one still on its way from a blur, so none lands after the finish,
    // and none is lost behind the page change. If one can't be saved, the workout isn't finished.
    setBusy(true);
    const notesSaved = await flushAll([sessionSaver.current!, ...noteSavers.current.values()]);
    if (!notesSaved) {
      setBusy(false);
      return setError("A note couldn't be saved, so the workout wasn't finished. Your text is still here: check your connection, then try Finish again.");
    }
    if (!confirm(skipped ? `Finish workout? ${skipped} exercise(s) with no sets will be removed.` : "Finish workout?")) return setBusy(false);
    const ok = await run(() => api("PATCH", `/api/sessions/${sessionId}`, { finish: true }));
    if (ok) {
      router.replace(`/workouts/history/${sessionId}?done=1`);
      router.refresh();
    } else setBusy(false);
  }

  async function discard() {
    if (!confirm("Discard this workout? Logged sets will be deleted.")) return;
    setBusy(true);
    const ok = await run(() => api("DELETE", `/api/sessions/${sessionId}`));
    if (ok) {
      router.replace("/workouts");
      router.refresh();
    } else setBusy(false);
  }

  const elapsed = (now - new Date(startedAt).getTime()) / 1000;
  const restLeft = restEnd ? Math.max(0, Math.ceil((restEnd - now) / 1000)) : 0;

  return (
    <div className="pb-24">
      <header className="sticky top-0 z-30 -mx-4 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-3 backdrop-blur-xl">
        <div className="min-w-0">
          <p className="truncate font-bold">{name}</p>
          <p className="num text-xs text-muted">{formatDuration(elapsed)} elapsed</p>
          {gyms.length > 0 && (
            <select aria-label="Gym" className="mt-1 max-w-[12rem] rounded-lg border border-line bg-surface px-2 py-1 text-xs" value={gymId ?? ""} onChange={(e) => chooseGym(e.target.value)} disabled={busy} data-testid="session-gym">
              <option value="">No gym chosen</option>
              {gyms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
        </div>
        <Button onClick={finish} disabled={busy}>Finish</Button>
      </header>

      <div className="mt-4 space-y-3">
        {error && <ErrorText>{error}</ErrorText>}
        {exercises.map((ex, i) => (
          <ExerciseCard
            key={ex.id}
            ex={ex}
            units={units}
            first={i === 0}
            last={i === exercises.length - 1}
            onLog={(w, r, wu) => logSet(ex, w, r, wu)}
            onUpdate={(s, p) => updateSet(ex, s, p)}
            onDelete={(s) => deleteSet(ex, s)}
            onRemove={() => removeExercise(ex)}
            onMove={(d) => moveExercise(i, d)}
            onMeta={(p) => saveExerciseMeta(ex, p)}
            noteSavers={noteSavers.current}
            locked={busy}
            machines={machines.filter((m) => m.exerciseId === null || m.exerciseId === ex.exercise.id)}
            onMachine={(id) => chooseMachine(ex, id)}
            onSwap={() => setSwapping(ex.id)}
          />
        ))}
        {exercises.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted">Add your first exercise to start logging.</Card>
        )}
        <Button variant="secondary" size="lg" className="w-full" onClick={() => setPicker(true)}>
          <PlusIcon width={18} height={18} /> Add exercise
        </Button>
        <Card className="p-4" data-testid="workout-notes">
          <label htmlFor="workout-notes" className="block font-semibold">Workout notes</label>
          <p id="workout-notes-help" className="mt-0.5 text-xs text-muted">How the whole workout went: energy, difficulty, anything to remember next time. Optional. For one exercise, use its own note.</p>
          <Textarea id="workout-notes" className="mt-2" maxLength={NOTE_MAX} aria-describedby="workout-notes-help workout-notes-status"
            placeholder="For example: felt strong, short on time, gym was busy…"
            readOnly={busy}
            value={sessionNotes} onChange={(e) => { setSessionNotes(e.target.value); sessionSaver.current!.set(e.target.value); }} onBlur={() => void sessionSaver.current!.flush()} />
          <p id="workout-notes-status" className={cx("mt-1 min-h-4 text-xs", sessionNotesState === "failed" ? "text-down" : "text-muted")} aria-live="polite">{SAVE_STATE_TEXT[sessionNotesState]}</p>
        </Card>
        <Button variant="ghost" className="w-full text-down" onClick={discard} disabled={busy}>Discard workout</Button>
      </div>

      {restEnd && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 px-4 lg:bottom-6 lg:pl-60">
          <div className="mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-fg px-4 py-3 text-bg shadow-xl">
            <TimerIcon width={20} height={20} />
            <span className="num flex-1 text-lg font-bold">Rest {Math.floor(restLeft / 60)}:{String(restLeft % 60).padStart(2, "0")}</span>
            <button type="button" className="rounded-lg px-2 py-1 text-sm font-semibold opacity-80" onClick={() => setRestEnd((r) => (r ? Math.max(Date.now(), r - 15000) : r))}>−15</button>
            <button type="button" className="rounded-lg px-2 py-1 text-sm font-semibold opacity-80" onClick={() => setRestEnd((r) => (r ? r + 15000 : r))}>+15</button>
            <button type="button" className="rounded-lg bg-bg/15 px-3 py-1 text-sm font-semibold" onClick={() => setRestEnd(null)}>Skip</button>
          </div>
        </div>
      )}

      <ExercisePicker open={picker} onClose={() => setPicker(false)} onPick={addExercise} />
      {swapping && <SwapSheet sessionId={sessionId} seId={swapping} fromPlan={fromPlan} onClose={() => setSwapping(null)} onSwapped={(s) => swapped(exercises.find((x) => x.id === swapping)!, s)} />}
    </div>
  );
}

function fmtSets(sets: LoggedSet[], units: UnitSystem) {
  return sets
    .filter((s) => !s.isWarmup)
    .map((s) => (s.weightKg > 0 ? `${toDisplayMass(s.weightKg, units)}×${s.reps}` : `${s.reps}`))
    .join(", ");
}

function ExerciseCard({ ex, units, first, last, onLog, onUpdate, onDelete, onRemove, onMove, onMeta, noteSavers, locked, machines = [], onMachine, onSwap }: {
  ex: LoggerExercise;
  units: UnitSystem;
  first: boolean;
  last: boolean;
  onLog: (weightKg: number, reps: number, warmup: boolean) => Promise<boolean>;
  onUpdate: (s: LoggedSet, p: Partial<LoggedSet>) => void;
  onDelete: (s: LoggedSet) => void;
  onRemove: () => void;
  onMove: (d: "up" | "down") => void;
  onMeta: (p: { notes?: string | null; restSeconds?: number | null }) => Promise<boolean>;
  /** Where this card's note saver is registered, so Finish can save every note first. */
  noteSavers: Map<string, NoteSaver>;
  /** The workout is finishing: notes can't change underneath it. */
  locked: boolean;
  /** Multi-gym: machines at this workout's gym that suit this exercise. */
  machines?: { id: string; name: string }[];
  onMachine?: (id: string) => void;
  onSwap?: () => void;
}) {
  const mu = massUnit(units);
  const working = ex.sets.filter((s) => !s.isWarmup);
  const prevWorking = ex.prev?.sets.filter((s) => !s.isWarmup) ?? [];
  const idx = working.length; // index of the next working set
  const prevAtIdx = prevWorking[idx] ?? prevWorking.at(-1);
  const lastLogged = working.at(-1);

  const suggestedWeightKg = lastLogged?.weightKg ?? prevAtIdx?.weightKg ?? ex.target?.weightKg ?? null;
  const suggestedReps = prevAtIdx?.reps ?? ex.target?.repsMin ?? null;

  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [warmup, setWarmup] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showRest, setShowRest] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [notes, setNotes] = useState(ex.notes ?? "");
  const [noteState, setNoteState] = useState<NoteSaveStatus>("idle");
  const noteId = `exercise-note-${ex.id}`;
  const saverRef = useRef<NoteSaver | null>(null);
  saverRef.current ??= new NoteSaver((v) => onMeta({ notes: v || null }), ex.notes, setNoteState);
  const saver = saverRef.current;
  useEffect(() => {
    noteSavers.set(ex.id, saver);
    return () => { noteSavers.delete(ex.id); };
  }, [noteSavers, ex.id, saver]);
  const [rest, setRest] = useState(ex.restSeconds != null ? String(ex.restSeconds) : "");

  const comparison = useMemo(() => {
    if (!working.length) return null;
    return compareToPrevious(ex.prev ? summarizeSets(ex.prev.sets) : null, summarizeSets(ex.sets));
  }, [ex.sets, ex.prev, working.length]);

  async function submit() {
    if (busy) return;
    const w = weight.trim() === "" ? (suggestedWeightKg != null ? toDisplayMass(suggestedWeightKg, units) : 0) : parseNum(weight);
    const r = reps.trim() === "" ? suggestedReps ?? NaN : parseInt(reps);
    if (!Number.isFinite(w) || w < 0 || !Number.isFinite(r) || r < 0) return setInvalid(true);
    setInvalid(false);
    setBusy(true);
    const ok = await onLog(round(fromDisplayMass(w, units), 4), r, warmup);
    setBusy(false);
    if (ok) {
      setReps("");
      setWarmup(false);
    }
  }

  const targetLabel = ex.target
    ? `${ex.target.sets} × ${ex.target.repsMin === ex.target.repsMax ? ex.target.repsMin : `${ex.target.repsMin}–${ex.target.repsMax}`}${ex.target.weightKg != null ? ` @ ${toDisplayMass(ex.target.weightKg, units)} ${mu}` : ""}`
    : null;

  return (
    <Card className="overflow-hidden" data-testid="exercise-card">
      <div className="flex items-start justify-between gap-2 px-4 pt-4">
        <div className="min-w-0">
          <h3 className="font-bold leading-tight">{ex.exercise.name}</h3>
          {ex.planned && <p className="text-xs font-medium text-accent-ink" data-testid="swapped-in">Swapped in for {ex.planned.name}</p>}
          {ex.swappedOut && <p className="text-xs font-medium text-muted" data-testid="swapped-out">Swapped out{ex.sets.length ? "; its sets are kept" : ""}</p>}
          {ex.machine && <p className="text-xs text-muted" data-testid="exercise-machine">On {ex.machine.name}: compared with this machine only</p>}
          <p className="mt-0.5 text-xs text-muted">
            {targetLabel && <>Target {targetLabel} · </>}
            {ex.prev ? <>Last: {fmtSets(ex.prev.sets, units) || "—"}</> : "No previous data"}
          </p>
        </div>
        {comparison && <OverloadBadge status={comparison.status} />}
      </div>
      {comparison && comparison.status !== "first" && <p className="px-4 pt-1 text-xs text-muted">{comparison.headline}</p>}
      {!ex.swappedOut && (onSwap || machines.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-2">
          {onSwap && <Button variant="secondary" size="sm" onClick={onSwap} disabled={locked} data-testid="swap-exercise">Swap exercise</Button>}
          {machines.length > 0 && working.length === 0 && (
            <select aria-label={`Machine for ${ex.exercise.name}`} className="h-8 rounded-lg border border-line bg-surface px-2 text-sm" value={ex.machine?.id ?? ""} onChange={(e) => onMachine?.(e.target.value)} disabled={locked} data-testid="exercise-machine-select">
              <option value="">No specific machine</option>
              {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-center gap-x-2 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <span>Set</span><span>Previous</span><span>{mu}</span><span>Reps</span><span />
      </div>

      <div className="px-4 pb-2">
        {ex.sets.map((s) => {
          const wIdx = working.indexOf(s);
          const p = wIdx >= 0 ? prevWorking[wIdx] : undefined;
          return <LoggedRow key={s.id} set={s} label={s.isWarmup ? "W" : String(wIdx + 1)} prev={p} units={units} onUpdate={(patch) => onUpdate(s, patch)} onDelete={() => onDelete(s)} />;
        })}

        <div className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-center gap-x-2 py-1.5">
          <button type="button" onClick={() => setWarmup((w) => !w)} aria-pressed={warmup} title="Toggle warm-up"
            className={cx("h-8 rounded-lg text-sm font-bold", warmup ? "bg-info/15 text-info" : "text-muted")}>
            {warmup ? "W" : idx + 1}
          </button>
          <span className="num truncate text-sm text-muted">{prevWorking[idx] && !warmup ? (prevWorking[idx].weightKg > 0 ? `${toDisplayMass(prevWorking[idx].weightKg, units)}×${prevWorking[idx].reps}` : `${prevWorking[idx].reps}`) : "—"}</span>
          <Input inputMode="decimal" aria-label="Weight" className="num h-10 px-2 text-center"
            placeholder={suggestedWeightKg != null ? String(toDisplayMass(suggestedWeightKg, units)) : "0"}
            value={weight} onChange={(e) => setWeight(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
          <Input inputMode="numeric" aria-label="Reps" className="num h-10 px-2 text-center"
            placeholder={suggestedReps != null ? String(suggestedReps) : "0"}
            value={reps} onChange={(e) => setReps(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
          <button type="button" onClick={submit} disabled={busy} aria-label="Log set"
            className="grid h-10 w-11 place-items-center rounded-xl bg-accent text-accent-fg disabled:opacity-50">
            <CheckIcon width={20} height={20} />
          </button>
        </div>
      </div>

      {invalid && <p className="px-4 pb-2 text-xs text-down" role="alert" data-testid="set-input-error">Enter the weight and reps as plain numbers, such as 62.5 and 8. Nothing was logged.</p>}

      <div className="border-t border-line px-4 py-3" data-testid="exercise-note">
        {editingNote ? (
          <div>
            <label htmlFor={noteId} className="block text-sm font-semibold">Exercise note</label>
            <p id={`${noteId}-help`} className="mt-0.5 text-xs text-muted">How {ex.exercise.name} felt: difficulty, form, cues, seat height. Shown in its history.</p>
            <Textarea id={noteId} className="mt-2" maxLength={NOTE_MAX} autoFocus aria-describedby={`${noteId}-help ${noteId}-status`}
              placeholder="For example: last set was hard, keep elbows tucked…"
              readOnly={locked}
              value={notes} onChange={(e) => { setNotes(e.target.value); saver.set(e.target.value); }} onBlur={() => void saver.flush()} />
            <div className="mt-1 flex items-center justify-between gap-2">
              <p id={`${noteId}-status`} className={cx("min-h-4 text-xs", noteState === "failed" ? "text-down" : "text-muted")} aria-live="polite">{SAVE_STATE_TEXT[noteState]}</p>
              <Button size="sm" variant="secondary" disabled={locked} onClick={async () => { if (await saver.flush()) setEditingNote(false); }}>Done</Button>
            </div>
          </div>
        ) : ex.notes ? (
          <button type="button" onClick={() => setEditingNote(true)} className="block w-full rounded-xl bg-surface-2 px-3 py-2 text-left" aria-label={`Edit exercise note for ${ex.exercise.name}`}>
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">Exercise note</span>
            <span className="mt-0.5 block whitespace-pre-line text-sm text-fg">{ex.notes}</span>
          </button>
        ) : (
          <Button variant="ghost" size="sm" className="-ml-2 text-accent-ink" onClick={() => setEditingNote(true)}>
            <PlusIcon width={16} height={16} /> Add a note on how it felt
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-line px-2 py-1">
        <Button variant="ghost" size="sm" className="text-muted" aria-expanded={showRest} onClick={() => setShowRest((v) => !v)}>
          <TimerIcon width={15} height={15} /> Rest {ex.restSeconds ?? DEFAULT_REST}s
        </Button>
        <div className="flex">
          <Button variant="ghost" size="sm" aria-label="Move up" onClick={() => onMove("up")} disabled={first}>↑</Button>
          <Button variant="ghost" size="sm" aria-label="Move down" onClick={() => onMove("down")} disabled={last}>↓</Button>
          <Button variant="ghost" size="sm" aria-label={`Remove ${ex.exercise.name}`} onClick={onRemove}><TrashIcon width={16} height={16} /></Button>
        </div>
      </div>
      {showRest && (
        <div className="space-y-2 border-t border-line p-4">
          <label className="flex items-center gap-2 text-sm">
            Rest timer (sec)
            <Input inputMode="numeric" className="w-24" value={rest} placeholder={String(DEFAULT_REST)} onChange={(e) => setRest(e.target.value)}
              onBlur={() => {
                const v = rest.trim() ? parseInt(rest) : null;
                if (v === null || (v >= 0 && v <= 1800)) onMeta({ restSeconds: v });
              }} />
          </label>
        </div>
      )}
    </Card>
  );
}

function LoggedRow({ set, label, prev, units, onUpdate, onDelete }: {
  set: LoggedSet;
  label: string;
  prev?: LoggedSet;
  units: UnitSystem;
  onUpdate: (p: Partial<LoggedSet>) => void;
  onDelete: () => void;
}) {
  const [w, setW] = useState(String(toDisplayMass(set.weightKg, units)));
  const [r, setR] = useState(String(set.reps));
  useEffect(() => { setW(String(toDisplayMass(set.weightKg, units))); setR(String(set.reps)); }, [set.weightKg, set.reps, units]);

  const commit = () => {
    const wn = parseNum(w), rn = parseInt(r);
    // Something unclear isn't saved, so it shouldn't stay on screen looking as if it was.
    if (!(Number.isFinite(wn) && wn >= 0)) setW(String(toDisplayMass(set.weightKg, units)));
    const patch: Partial<LoggedSet> = {};
    if (Number.isFinite(wn) && wn >= 0 && Math.abs(wn - toDisplayMass(set.weightKg, units)) > 1e-9) patch.weightKg = round(fromDisplayMass(wn, units), 4);
    if (Number.isFinite(rn) && rn >= 0 && rn !== set.reps) patch.reps = rn;
    if (Object.keys(patch).length) onUpdate(patch);
  };

  return (
    <div className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-center gap-x-2 py-1">
      <span className={cx("text-center text-sm font-bold", set.isWarmup ? "text-info" : "text-fg")}>{label}</span>
      <span className="num truncate text-sm text-muted">{prev ? (prev.weightKg > 0 ? `${toDisplayMass(prev.weightKg, units)}×${prev.reps}` : `${prev.reps}`) : "—"}</span>
      <input inputMode="decimal" aria-label={`Set ${label} weight`} className="num h-9 w-full min-w-0 rounded-lg bg-up/8 text-center text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-fg/30"
        value={w} onChange={(e) => setW(e.target.value)} onBlur={commit} />
      <input inputMode="numeric" aria-label={`Set ${label} reps`} className="num h-9 w-full min-w-0 rounded-lg bg-up/8 text-center text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-fg/30"
        value={r} onChange={(e) => setR(e.target.value)} onBlur={commit} />
      <button type="button" onClick={onDelete} aria-label={`Delete set ${label}`} className="grid h-9 w-11 place-items-center rounded-lg text-muted hover:text-down">✕</button>
    </div>
  );
}
