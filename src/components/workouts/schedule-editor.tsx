"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { WEEKDAYS } from "@/lib/time";
import { Button, Card, ErrorText, Select, cx } from "@/components/ui";

export type SchedulePlan = { id: string; name: string; programId: string | null; programName: string | null; exercises: number };
const MAX_PER_DAY = 3;
const INDIVIDUAL = "__individual";

/** A modal built on the native <dialog>: focus stays inside, Escape cancels, focus returns to the opener. */
function Modal({ open, title, onClose, children, testId }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; testId: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} data-testid={testId} onCancel={(e) => { e.preventDefault(); onClose(); }}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-fg shadow-xl backdrop:bg-black/40">
      <div className="max-h-[85vh] space-y-3 overflow-y-auto p-5">
        <h2 id={titleId} className="text-lg font-bold">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

type Picker = { day: number; index: number | null }; // index null: adding
type Mover = { day: number; index: number };

/**
 * UI-03/UI-04: the weekly schedule, edited as a draft. Each day shows its workouts by name, program and size, each
 * with labelled Change, Move and Remove actions; an empty day is a rest day. Adding or changing a workout always
 * opens a chooser with nothing preselected: nothing is ever filled in for the person. A day holds one workout by
 * default; a second or third is added only on purpose. Nothing is saved until Save schedule; Discard returns to the
 * saved week. Remove takes a workout off the schedule only: the plan itself stays. UI-06: with an active program,
 * only its workouts can be added.
 */
export function ScheduleEditor({ plans, initial, today, activeProgram }: {
  plans: SchedulePlan[]; initial: string[][]; today: number; activeProgram: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const [days, setDays] = useState<string[][]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [mover, setMover] = useState<Mover | null>(null);
  const [announce, setAnnounce] = useState("");
  const dirty = useMemo(() => JSON.stringify(days) !== JSON.stringify(initial), [days, initial]);
  const byId = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);
  const choosable = activeProgram ? plans.filter((p) => p.programId === activeProgram.id) : plans;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const change = (next: string[][], message: string) => { setDays(next); setAnnounce(`${message} Not saved yet.`); };
  const nameOf = (id: string) => byId.get(id)?.name ?? "A workout";

  function pick(id: string) {
    if (!picker) return;
    const { day, index } = picker;
    const next = days.map((d, k) => (k !== day ? d : index === null ? [...d, id] : d.map((x, j) => (j === index ? id : x))));
    change(next, index === null ? `${nameOf(id)} added to ${WEEKDAYS[day]}.` : `${WEEKDAYS[day]} changed to ${nameOf(id)}.`);
    setPicker(null);
  }
  function move(to: number) {
    if (!mover) return;
    const id = days[mover.day][mover.index];
    const next = days.map((d, k) => (k === mover.day ? d.filter((_, j) => j !== mover.index) : k === to ? [...d, id] : d));
    change(next, `${nameOf(id)} moved from ${WEEKDAYS[mover.day]} to ${WEEKDAYS[to]}.`);
    setMover(null);
  }
  function remove(day: number, index: number) {
    const id = days[day][index];
    change(days.map((d, k) => (k === day ? d.filter((_, j) => j !== index) : d)), `${nameOf(id)} taken off ${WEEKDAYS[day]}.`);
  }

  async function save() {
    setBusy(true); setError(null);
    try {
      await api("PUT", "/api/schedule", { days });
      router.push("/workouts");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The schedule couldn't be saved. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      <p className="text-sm text-muted" data-testid="schedule-scope">
        {activeProgram
          ? <>Workouts from your active program, <strong className="text-fg">{activeProgram.name}</strong>, can be added. Plans outside it, such as an extra mobility session, can still be started from Workouts at any time.</>
          : "No active program is chosen, so any of your plans can be added. Choosing an active program on Workouts sets the schedule from it."}
      </p>
      {WEEKDAYS.map((label, d) => (
        <Card key={label} className="p-3 sm:p-4" data-testid="schedule-day">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">{label}{d === today && <span className="ml-2 text-xs font-medium text-accent-ink">Today</span>}</h2>
            {days[d].length === 0 && <span className="text-sm text-muted" data-testid="schedule-rest">Rest day</span>}
          </div>
          <ul className="mt-2 space-y-2">
            {days[d].map((id, i) => {
              const p = byId.get(id);
              const outside = activeProgram && p?.programId !== activeProgram.id;
              return (
                <li key={`${id}-${i}`} className="rounded-xl border border-line bg-surface-2/40 p-3" data-testid="schedule-slot">
                  <p className="line-clamp-2 font-medium break-words" data-testid="schedule-slot-name">{p?.name ?? "A deleted plan"}</p>
                  <p className="text-xs text-muted">
                    {p?.programName ?? "Individual plan"} · {p?.exercises ?? 0} exercise{p?.exercises === 1 ? "" : "s"}
                    {outside && <span className="text-down"> · not in your active program</span>}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setPicker({ day: d, index: i })} aria-label={`Change the workout on ${label}: ${p?.name ?? ""}`}>Change</Button>
                    <Button variant="secondary" size="sm" onClick={() => setMover({ day: d, index: i })} aria-label={`Move ${p?.name ?? ""} from ${label} to another day`}>Move</Button>
                    <Button variant="ghost" size="sm" className="text-down" onClick={() => remove(d, i)} aria-label={`Remove ${p?.name ?? ""} from ${label}`}>Remove</Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {choosable.length > 0 && days[d].length === 0 && (
            <Button variant="secondary" size="sm" className="mt-1" onClick={() => setPicker({ day: d, index: null })} aria-label={`Add a workout to ${label}`}>Add workout</Button>
          )}
          {choosable.length > 0 && days[d].length > 0 && days[d].length < MAX_PER_DAY && (
            <button type="button" className="mt-2 text-xs font-medium text-muted underline underline-offset-2 hover:text-fg" onClick={() => setPicker({ day: d, index: null })} aria-label={`Add another workout to ${label}`}>
              Add another workout to this day
            </button>
          )}
        </Card>
      ))}

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 rounded-2xl border border-line bg-surface/95 px-4 py-3 shadow-lg backdrop-blur lg:bottom-4" data-testid="schedule-actions">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cx("min-w-0 flex-1 text-sm", dirty ? "font-medium text-fg" : "hidden text-muted sm:inline")} data-testid="schedule-state">{dirty ? "Unsaved changes" : "No changes"}</span>
          <Button variant="secondary" onClick={() => { setDays(initial); setAnnounce("Changes discarded."); setError(null); }} disabled={!dirty || busy}>Discard changes</Button>
          <Button onClick={save} disabled={!dirty || busy}>{busy ? "Saving…" : "Save schedule"}</Button>
        </div>
        {error && <ErrorText>{error}</ErrorText>}
      </div>

      {picker && (
        <WorkoutChooser key={`${picker.day}-${picker.index}`} plans={choosable} activeProgram={activeProgram} current={picker.index === null ? null : days[picker.day][picker.index]}
          title={picker.index === null ? `Add a workout to ${WEEKDAYS[picker.day]}` : `Change the workout on ${WEEKDAYS[picker.day]}`}
          taken={days[picker.day]} onPick={pick} onClose={() => setPicker(null)} />
      )}
      {mover && (
        <Modal open title={`Move ${nameOf(days[mover.day][mover.index])}`} onClose={() => setMover(null)} testId="schedule-move">
          <p className="text-sm text-muted">Choose the day to move it to. It leaves {WEEKDAYS[mover.day]}.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {WEEKDAYS.map((w, k) => {
              const full = days[k].length >= MAX_PER_DAY;
              return k === mover.day ? null : (
                <Button key={w} variant="secondary" disabled={full} onClick={() => move(k)} aria-label={full ? `${w}, full` : w}>
                  {w}{days[k].length ? <span className="ml-1 text-xs text-muted">({days[k].length})</span> : null}
                </Button>
              );
            })}
          </div>
          <div className="flex justify-end"><Button variant="ghost" onClick={() => setMover(null)}>Cancel</Button></div>
        </Modal>
      )}
    </div>
  );
}

/** Choose a program, then one of its workouts. Nothing is preselected when adding. */
function WorkoutChooser({ plans, activeProgram, current, title, taken, onPick, onClose }: {
  plans: SchedulePlan[]; activeProgram: { id: string; name: string } | null; current: string | null; title: string; taken: string[]; onPick: (id: string) => void; onClose: () => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; label: string; plans: SchedulePlan[] }>();
    for (const p of plans) {
      const key = p.programId ?? INDIVIDUAL;
      const g = m.get(key) ?? { key, label: p.programName ?? "Individual plans", plans: [] };
      g.plans.push(p);
      m.set(key, g);
    }
    return [...m.values()];
  }, [plans]);
  const currentGroup = plans.find((p) => p.id === current)?.programId ?? (current ? INDIVIDUAL : null);
  const [group, setGroup] = useState<string>(currentGroup ?? groups[0]?.key ?? INDIVIDUAL);
  const [chosen, setChosen] = useState<string | null>(current);
  const shown = groups.find((g) => g.key === group)?.plans ?? [];
  const name = useId();
  return (
    <Modal open title={title} onClose={onClose} testId="schedule-chooser">
      {!activeProgram && groups.length > 1 && (
        <label className="block text-sm font-medium">Program
          <Select className="mt-1" value={group} onChange={(e) => { setGroup(e.target.value); setChosen(null); }} data-testid="chooser-program">
            {groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </Select>
        </label>
      )}
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{activeProgram ? `Workouts in ${activeProgram.name}` : "Workout"}</legend>
        <div className="space-y-1.5">
          {shown.map((p) => (
            <label key={p.id} className={cx("flex cursor-pointer items-start gap-3 rounded-xl border p-3", chosen === p.id ? "border-accent bg-accent-soft" : "border-line")}>
              <input type="radio" name={name} value={p.id} checked={chosen === p.id} onChange={() => setChosen(p.id)} className="mt-1" data-testid="chooser-option" />
              <span className="min-w-0">
                <span className="block font-medium break-words">{p.name}</span>
                <span className="text-xs text-muted">{p.exercises} exercise{p.exercises === 1 ? "" : "s"}{taken.includes(p.id) && p.id !== current ? " · already on this day" : ""}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!chosen || chosen === current} onClick={() => chosen && onPick(chosen)} data-testid="chooser-choose">Choose</Button>
      </div>
    </Modal>
  );
}
