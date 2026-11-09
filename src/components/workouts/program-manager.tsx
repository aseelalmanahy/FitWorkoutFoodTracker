"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card, ErrorText, Field, Input } from "@/components/ui";

type DayRow = { id: string; name: string; exercises: number; weekdays: string };

/**
 * UI-01: one program's page. Rename it, reorder its days, take a day out (it stays, as an individual plan), or
 * ungroup it (every day stays, as an individual plan). None of this changes a plan's exercises, the schedule or any
 * logged workout.
 */
export function ProgramManager({ id, name: initialName, days: initialDays }: { id: string; name: string; days: DayRow[] }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [days, setDays] = useState(initialDays);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

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
  async function takeOut(day: DayRow) {
    const next = days.filter((d) => d.id !== day.id);
    if (next.length === 0) return ungroup();
    if (await patch({ templateIds: next.map((d) => d.id) }, `“${day.name}” is now an individual plan.`)) setDays(next);
  }
  async function ungroup() {
    if (!confirm("Ungroup this program? Its days stay, as individual plans, with their schedule and history.")) return;
    setBusy(true); setError(null);
    try {
      await api("DELETE", `/api/programs/${id}`);
      router.replace("/workouts");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That couldn't be done. Try again.");
      setBusy(false);
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
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="program-page-day">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold" aria-hidden>{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 font-medium break-words">{d.name}</span>
                <span className="block text-xs text-muted">{d.exercises} exercise{d.exercises === 1 ? "" : "s"} · {d.weekdays}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="sm" aria-label={`Move ${d.name} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}>↑</Button>
                <Button variant="ghost" size="sm" aria-label={`Move ${d.name} down`} disabled={busy || i === days.length - 1} onClick={() => move(i, 1)}>↓</Button>
                <Link href={`/workouts/plans/${d.id}`} className="px-2 text-sm font-medium text-accent-ink">Edit</Link>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => takeOut(d)} data-testid="program-take-out">Take out</Button>
              </span>
            </li>
          ))}
        </ol>
      </Card>
      {note && <p role="status" className="text-sm text-muted">{note}</p>}
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-wrap gap-3">
        <Link href="/workouts/schedule" className="inline-flex h-10 items-center rounded-xl bg-surface-2 px-4 text-sm font-medium">Put days on my schedule</Link>
        <Button variant="ghost" disabled={busy} onClick={ungroup} data-testid="program-ungroup">Ungroup program</Button>
      </div>
      <p className="text-xs text-muted">Taking out a day or ungrouping keeps every plan, its schedule and its workout history.</p>
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
