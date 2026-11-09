"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card, ErrorText, Field, Input, Select, buttonClass, cx } from "@/components/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DeleteProgramButton } from "@/components/workouts/manage-actions";

type DayRow = { id: string; name: string; exercises: number; weekdays: string };
/** UI-06B: a scheduled workout outside this (active) program. inProgram: the other program it belongs to, if any. */
type ExceptionRow = { id: string; name: string; weekdays: string; inProgram: string | null };
const NOT_SCHEDULED = "Not scheduled";

/**
 * UI-01: one program's page. Rename it, reorder its days, remove a day from the program (it stays, as an individual
 * plan), or delete the program (every day stays, as an individual plan). UI-06: set it as the active program. None of
 * this changes a plan's exercises or any logged workout. UI-05 (owner report): removing a day asks first, and nothing
 * is sent until the person confirms. UI-09: on a phone, each day's name gets the full width and its actions sit on a
 * row of their own, at touch size.
 * UI-05B: Add existing workout puts one of the person's individual plans into the program, at a chosen place; the
 * plan itself is never copied, and its schedule stays as it is. UI-05C: removing a scheduled day from the active
 * program asks whether it also leaves the weekly schedule, or stays there as an exception; nothing is chosen for the
 * person. UI-06B: the active program's page lists the scheduled workouts outside it, with the ways to resolve each.
 */
export function ProgramManager({ id, name: initialName, days: initialDays, active = false, individuals = [], exceptions = [], addId = null }: {
  id: string; name: string; days: DayRow[]; active?: boolean; individuals?: DayRow[]; exceptions?: ExceptionRow[]; addId?: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [days, setDays] = useState(initialDays);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [removing, setRemoving] = useState<DayRow | null>(null);
  const [unschedule, setUnschedule] = useState<"remove" | "keep" | null>(null);
  const initialAdd = addId && individuals.some((p) => p.id === addId) ? addId : null;
  const [adding, setAdding] = useState(initialAdd !== null);
  const [addChoice, setAddChoice] = useState<string | null>(initialAdd);
  const [position, setPosition] = useState(initialDays.length);
  const radioName = useId();
  // After a change, the page's fresh data replaces the list here; the component stays, so its message stays too.
  const daysKey = JSON.stringify(initialDays);
  useEffect(() => { setDays(JSON.parse(daysKey) as DayRow[]); }, [daysKey]);

  async function patch(body: { name?: string; templateIds?: string[]; unscheduleRemoved?: boolean }, done: string) {
    setBusy(true); setError(null); setNote(null);
    try {
      await api("PATCH", `/api/programs/${id}`, body);
      setNote(done);
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That couldn't be saved. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function move(i: number, by: -1 | 1) {
    const next = [...days];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    if (await patch({ templateIds: next.map((d) => d.id) }, "Order saved.")) setDays(next);
  }
  const removingScheduled = removing !== null && removing.weekdays !== NOT_SCHEDULED;
  const mustChoose = active && removingScheduled;
  /** Runs only from the confirmation. The last day isn't offered: the program would be empty (Delete keeps it). */
  async function removeFromProgram(day: DayRow) {
    const next = days.filter((d) => d.id !== day.id);
    if (next.length === 0 || (mustChoose && !unschedule)) return;
    const off = mustChoose && unschedule === "remove";
    const done = off
      ? `“${day.name}” was removed from the program and from your weekly schedule. It's now an individual plan.`
      : `“${day.name}” was removed from the program. It's now an individual plan${mustChoose ? `, still scheduled on ${day.weekdays} as an exception` : ""}.`;
    if (await patch({ templateIds: next.map((d) => d.id), ...(off ? { unscheduleRemoved: true } : {}) }, done)) {
      setDays(next);
      setRemoving(null);
    }
  }
  function openAdd(planId: string | null) {
    setError(null); setAddChoice(planId); setPosition(days.length); setAdding(true);
  }
  function closeAdd() {
    setAdding(false); setAddChoice(null); setError(null);
    if (initialAdd) router.replace(`/workouts/programs/${id}`, { scroll: false });
  }
  const addPlan = individuals.find((p) => p.id === addChoice) ?? null;
  async function add() {
    if (!addPlan) return;
    const next = [...days.map((d) => d.id)];
    next.splice(position, 0, addPlan.id);
    if (await patch({ templateIds: next }, `“${addPlan.name}” was added to the program as day ${position + 1}.`)) {
      setAdding(false); setAddChoice(null);
      if (initialAdd) router.replace(`/workouts/programs/${id}`, { scroll: false });
    }
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <Card className="p-3 sm:p-4">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void patch({ name: name.trim() }, "Name saved."); }}>
          <div className="min-w-0 flex-1 basis-48"><Field label="Program name"><Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} data-testid="program-name-input" /></Field></div>
          <Button type="submit" disabled={busy || !name.trim() || name.trim() === initialName} data-testid="program-rename">Save name</Button>
        </form>
      </Card>
      <Card className="divide-y divide-line">
        <ol>
          {days.map((d, i) => (
            <li key={d.id} className="flex flex-col gap-2 px-3 py-3 sm:gap-3 sm:px-4 lg:flex-row lg:items-center" data-testid="program-page-day">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold" aria-hidden>{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium [overflow-wrap:anywhere]" data-testid="program-day-name">{d.name}</span>
                  <span className="block text-sm text-muted">{d.exercises} exercise{d.exercises === 1 ? "" : "s"} · {d.weekdays}</span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-10 lg:shrink-0 lg:pl-0" data-testid="program-day-actions">
                <span className="flex gap-2" role="group" aria-label={`Reorder ${d.name}`}>
                  <Button variant="secondary" className="min-w-11 px-3" aria-label={`Move ${d.name} up`} title="Move up" disabled={busy || i === 0} onClick={() => move(i, -1)}><span aria-hidden>↑</span></Button>
                  <Button variant="secondary" className="min-w-11 px-3" aria-label={`Move ${d.name} down`} title="Move down" disabled={busy || i === days.length - 1} onClick={() => move(i, 1)}><span aria-hidden>↓</span></Button>
                </span>
                <Link href={`/workouts/plans/${d.id}`} className={buttonClass("secondary", "md")} aria-label={`Edit ${d.name}`}>Edit</Link>
                {days.length > 1 && (
                  <Button variant="ghost" disabled={busy} onClick={() => { setError(null); setUnschedule(null); setRemoving(d); }} aria-label={`Remove ${d.name} from the program`} data-testid="program-remove">Remove from program</Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Card>
      {individuals.length > 0 && (
        <Button variant="secondary" className="w-full sm:w-auto" disabled={busy} onClick={() => openAdd(null)} data-testid="program-add">+ Add existing workout</Button>
      )}
      {note && <p role="status" className="text-sm text-muted" data-testid="program-note">{note}</p>}
      {!removing && !adding && <ErrorText>{error}</ErrorText>}

      {active && exceptions.length > 0 && (
        <section aria-labelledby="exceptions-title" className="rounded-2xl border border-line bg-surface-2/40 p-3 sm:p-4" data-testid="program-exceptions">
          <h2 id="exceptions-title" className="font-semibold">Also on your schedule, outside this program ({exceptions.length})</h2>
          <p className="mt-1 text-sm text-muted">These stay on your weekly schedule as exceptions until you decide. Nothing changes by itself.</p>
          <ul className="mt-2 space-y-2">
            {exceptions.map((x) => (
              <li key={x.id} className="rounded-xl border border-line bg-surface p-3" data-testid="program-exception">
                <p className="font-medium [overflow-wrap:anywhere]">{x.name}</p>
                <p className="text-sm text-muted">{x.weekdays}{x.inProgram ? ` · in ${x.inProgram}` : " · individual plan"}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {!x.inProgram && <Button variant="secondary" disabled={busy} onClick={() => openAdd(x.id)} aria-label={`Add ${x.name} to this program`}>Add to this program</Button>}
                  <Link href="/workouts/schedule" className={buttonClass("ghost", "md")} aria-label={`Remove ${x.name} from the weekly schedule`}>Remove from schedule…</Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {/* UI-06: the schedule follows the active program, set with a preview and a confirmation. */}
        <Link href={`/workouts/programs/${id}/activate`} className="inline-flex h-11 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg" data-testid="program-activate">{active ? "Change its weekdays" : "Set as active"}</Link>
        <DeleteProgramButton id={id} name={initialName} plans={days.length} active={active} after="/workouts" size="md" />
      </div>
      <p className="text-xs text-muted">Adding or removing a workout, or deleting the program, never copies or deletes a plan, its exercises or its workout history.</p>

      <ConfirmDialog open={removing !== null} title={removing ? `Remove ${removing.name} from ${initialName}?` : ""} confirmLabel="Remove from program" danger={false}
        busy={busy} confirmDisabled={mustChoose && !unschedule} error={removing ? error : null} onConfirm={() => removing && void removeFromProgram(removing)}
        onCancel={() => { setRemoving(null); setUnschedule(null); setError(null); }} testId="program-remove-dialog">
        {removing && <>
          <p>It leaves this program and becomes an individual plan. In every case:</p>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>the workout plan and its {removing.exercises} exercise{removing.exercises === 1 ? "" : "s"} stay as they are;</li>
            <li>every completed workout, its exercise history and your progress stay.</li>
            {!mustChoose && <li>{removingScheduled ? `its place on your weekly schedule (${removing.weekdays}) stays` : "it isn't on your weekly schedule, and that doesn't change"}.</li>}
          </ul>
          {mustChoose && (
            <fieldset className="space-y-2 pt-1" data-testid="remove-schedule-choice">
              <legend className="mb-1 font-medium text-fg">It&apos;s on your weekly schedule ({removing.weekdays}). What should happen there?</legend>
              {([
                ["remove", "Remove from program and weekly schedule", `${removing.weekdays} ${removing.weekdays.includes(",") ? "become rest days" : "becomes a rest day"}, unless another workout is scheduled then.`],
                ["keep", "Remove from program, keep it scheduled", `It stays on ${removing.weekdays}, shown as an exception outside your active program until you change it.`],
              ] as const).map(([v, label, help]) => (
                <label key={v} className={cx("flex cursor-pointer items-start gap-3 rounded-xl border p-3", unschedule === v ? "border-accent bg-accent-soft" : "border-line")}>
                  <input type="radio" name={`${radioName}-sched`} value={v} checked={unschedule === v} onChange={() => setUnschedule(v)} className="mt-1" data-testid={`remove-${v}`} />
                  <span><span className="block font-medium text-fg">{label}</span><span className="text-xs">{help}</span></span>
                </label>
              ))}
            </fieldset>
          )}
        </>}
      </ConfirmDialog>

      <ConfirmDialog open={adding} title={`Add a workout to ${initialName}`} confirmLabel="Add to program" danger={false} busy={busy} confirmDisabled={!addPlan}
        error={adding ? error : null} onConfirm={() => void add()} onCancel={closeAdd} testId="program-add-dialog">
        <fieldset>
          <legend className="mb-2 font-medium text-fg">Your individual workouts</legend>
          <div className="max-h-[40vh] space-y-1.5 overflow-y-auto">
            {individuals.map((p) => (
              <label key={p.id} className={cx("flex cursor-pointer items-start gap-3 rounded-xl border p-3", addChoice === p.id ? "border-accent bg-accent-soft" : "border-line")}>
                <input type="radio" name={`${radioName}-add`} value={p.id} checked={addChoice === p.id} onChange={() => setAddChoice(p.id)} className="mt-1" data-testid="add-option" />
                <span className="min-w-0"><span className="block font-medium text-fg [overflow-wrap:anywhere]">{p.name}</span><span className="text-xs">{p.exercises} exercise{p.exercises === 1 ? "" : "s"} · {p.weekdays}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block font-medium text-fg">Position in the program
          <Select className="mt-1" value={position} onChange={(e) => setPosition(Number(e.target.value))} data-testid="add-position">
            {Array.from({ length: days.length + 1 }, (_, i) => (
              <option key={i} value={i}>{i === days.length ? `Day ${i + 1} (last)` : `Day ${i + 1}, before ${days[i].name}`}</option>
            ))}
          </Select>
        </label>
        <p data-testid="add-schedule-effect">
          {!addPlan ? "Choose a workout. The plan is moved into the program, not copied; its exercises and history stay as they are."
            : addPlan.weekdays === NOT_SCHEDULED
              ? `${addPlan.name} isn't on your weekly schedule, and adding it doesn't schedule it.${active ? " Use Change its weekdays to give it a day." : ""}`
              : `${addPlan.name} stays on your weekly schedule (${addPlan.weekdays}), unchanged.${active ? " As part of your active program it's no longer an exception." : ""}`}
        </p>
      </ConfirmDialog>
    </div>
  );
}

/** UI-01: group plans saved earlier (each its own plan) into one program, in the order they're ticked. */
export function ProgramGrouper({ plans }: { plans: { id: string; name: string; exercises: number }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  async function create() {
    setBusy(true); setError(null);
    try {
      const { program } = await api<{ program: { id: string } }>("POST", "/api/programs", { name: name.trim(), templateIds: picked });
      router.replace(`/workouts/programs/${program.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That couldn't be saved. Try again.");
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <Field label="Program name"><Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} data-testid="group-name" /></Field>
      <Card className="divide-y divide-line">
        {plans.map((p) => (
          <label key={p.id} className="flex cursor-pointer items-center gap-3 px-4 py-3">
            <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} data-testid="group-plan" />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 font-medium break-words">{p.name}</span>
              <span className="block text-xs text-muted">{p.exercises} exercise{p.exercises === 1 ? "" : "s"}{picked.includes(p.id) ? ` · day ${picked.indexOf(p.id) + 1}` : ""}</span>
            </span>
          </label>
        ))}
      </Card>
      <ErrorText>{error}</ErrorText>
      <Button disabled={busy || !name.trim() || picked.length === 0} onClick={create} data-testid="group-create">Make a program of {picked.length} day{picked.length === 1 ? "" : "s"}</Button>
      <p className="text-xs text-muted">Only the grouping changes: each plan, its schedule and its workout history stay as they are.</p>
    </div>
  );
}
