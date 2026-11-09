"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card, ErrorText, Field, Input, buttonClass } from "@/components/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DeleteProgramButton } from "@/components/workouts/manage-actions";

type DayRow = { id: string; name: string; exercises: number; weekdays: string };

/**
 * UI-01: one program's page. Rename it, reorder its days, remove a day from the program (it stays, as an individual
 * plan), or delete the program (every day stays, as an individual plan). UI-06: set it as the active program. None of
 * this changes a plan's exercises or any logged workout. UI-05 (owner report): removing a day asks first, and nothing
 * is sent until the person confirms. UI-09: on a phone, each day's name gets the full width and its actions sit on a
 * row of their own, at touch size.
 */
export function ProgramManager({ id, name: initialName, days: initialDays, active = false }: { id: string; name: string; days: DayRow[]; active?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [days, setDays] = useState(initialDays);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [removing, setRemoving] = useState<DayRow | null>(null);

  async function patch(body: { name?: string; templateIds?: string[] }, done: string) {
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
  /** Runs only from the confirmation. The last day isn't offered: the program would be empty (Delete keeps it). */
  async function removeFromProgram(day: DayRow) {
    const next = days.filter((d) => d.id !== day.id);
    if (next.length === 0) return;
    if (await patch({ templateIds: next.map((d) => d.id) }, `“${day.name}” was removed from the program. It's now an individual plan.`)) {
      setDays(next);
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void patch({ name: name.trim() }, "Name saved."); }}>
          <div className="min-w-0 flex-1"><Field label="Program name"><Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} data-testid="program-name-input" /></Field></div>
          <Button type="submit" disabled={busy || !name.trim() || name.trim() === initialName} data-testid="program-rename">Save name</Button>
        </form>
      </Card>
      <Card className="divide-y divide-line">
        <ol>
          {days.map((d, i) => (
            <li key={d.id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center" data-testid="program-page-day">
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
                  <Button variant="ghost" disabled={busy} onClick={() => { setError(null); setRemoving(d); }} aria-label={`Remove ${d.name} from the program`} data-testid="program-remove">Remove from program</Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Card>
      {note && <p role="status" className="text-sm text-muted">{note}</p>}
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-wrap items-center gap-3">
        {/* UI-06: the schedule follows the active program, set with a preview and a confirmation. */}
        <Link href={`/workouts/programs/${id}/activate`} className="inline-flex h-10 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg" data-testid="program-activate">{active ? "Change its weekdays" : "Set as active"}</Link>
        <DeleteProgramButton id={id} name={initialName} plans={days.length} active={active} after="/workouts" size="md" />
      </div>
      <p className="text-xs text-muted">Removing a workout from the program, or deleting the program, keeps every plan, its place on your schedule and its workout history.{active ? " A workout removed from the program stays on your schedule, marked as outside your active program, until you change that day." : ""}</p>
      <ConfirmDialog open={removing !== null} title={removing ? `Remove ${removing.name} from ${initialName}?` : ""} confirmLabel="Remove from program" danger={false}
        busy={busy} error={removing ? error : null} onConfirm={() => removing && void removeFromProgram(removing)} onCancel={() => { setRemoving(null); setError(null); }} testId="program-remove-dialog">
        {removing && <>
          <p>It leaves this program and becomes an individual plan. Nothing is deleted:</p>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>the workout plan and its {removing.exercises} exercise{removing.exercises === 1 ? "" : "s"} stay as they are;</li>
            <li>{removing.weekdays === "Not scheduled" ? "it isn't on your weekly schedule, and that doesn't change" : `its place on your weekly schedule (${removing.weekdays}) stays`};</li>
            <li>every completed workout and its exercise history stay.</li>
          </ul>
          {active && removing.weekdays !== "Not scheduled" && <p>Because this is your active program, the schedule will mark it as outside the program until you change that day.</p>}
        </>}
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
