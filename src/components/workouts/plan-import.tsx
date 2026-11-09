"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, newIdempotencyKey, SAVE_TIMEOUT_MS } from "@/lib/client/api";
import { extractPlan } from "@/lib/client/plan-extract";
import { PlanFileError } from "@/lib/workout-import/documents";
import { matchExercise, type LibraryExercise } from "@/lib/workout-import/match";
import type { Draft, DraftExercise } from "@/lib/workout-import/parse";
import { EQUIPMENT, MUSCLE_GROUPS, poundsToKg, SAVE_LIMITS, type ImportSave } from "@/lib/workout-import/save-schema";
import { Button, Card, ErrorText, Field, Input, Select, Textarea, cx } from "@/components/ui";

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.csv,.tsv,.txt,.docx,.xlsx,application/pdf,image/png,image/jpeg,image/webp,text/csv,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

type Row = {
  key: string; source: string; name: string; matched: string | null; matchedId: string | null; suggestions: LibraryExercise[]; choice: string;
  newMuscle: string; newEquipment: string; sets: string; repsMin: string; repsMax: string; weight: string; unit: "kg" | "lb"; rest: string; notes: string;
};
/** The choice that leaves an exercise out of what's saved (IM-02): the plan names something the person won't do or track. */
const SKIP = "skip";

/**
 * IM-02: where each exercise stands. Matched: the plan's name is a library exercise's, and it's still the choice.
 * Chosen: the person picked it (it shows what the plan said beside it). Needs confirmation: nothing chosen yet.
 */
type RowStatus = "matched" | "chosen" | "skipped" | "needs";
const statusOf = (r: Row): RowStatus => (r.choice === SKIP ? "skipped" : !r.choice ? "needs" : r.matchedId && r.choice === r.matchedId ? "matched" : "chosen");
const STATUS_LABEL: Record<RowStatus, string> = { matched: "Matched", chosen: "Chosen by you", skipped: "Skipped by you", needs: "Needs confirmation" };
/** "Barbell or Goblet Squat", "Lat Pulldown or Pull-ups": the plan offers a choice. */
const offersChoice = (name: string) => /\s(?:or|\/)\s/i.test(name);
type Day = { key: string; name: string; weekday: string; notes: string; rows: Row[] };

let seq = 0;
const key = () => `k${++seq}`;
const s = (v: number | null) => (v === null ? "" : String(v));

/** A row for the review, matched against the library; nothing missing is filled in. */
function toRow(e: Pick<DraftExercise, "name" | "source" | "sets" | "repsMin" | "repsMax" | "weight" | "restSeconds" | "notes" | "group">, library: LibraryExercise[]): Row {
  const m = matchExercise(e.name, library);
  return {
    key: key(), source: e.source, name: e.name, matched: m.kind === "exact" ? m.exercise.name : null, matchedId: m.kind === "exact" ? m.exercise.id : null,
    suggestions: m.kind === "choose" ? m.suggestions : [], choice: m.kind === "exact" ? m.exercise.id : "",
    newMuscle: "", newEquipment: "", sets: s(e.sets), repsMin: s(e.repsMin), repsMax: s(e.repsMax),
    weight: e.weight ? String(e.weight.value) : "", unit: e.weight?.unit ?? "kg", rest: s(e.restSeconds),
    notes: [...(e.group ? [`Superset ${e.group}`] : []), ...e.notes].join("; "),
  };
}

function toDays(draft: Draft, library: LibraryExercise[]): Day[] {
  return draft.days.slice(0, SAVE_LIMITS.maxDays).map((d) => ({
    key: key(), name: d.name, weekday: d.weekday === null ? "" : String(d.weekday), notes: d.notes.join("\n"),
    rows: d.exercises.slice(0, SAVE_LIMITS.maxExercisesPerDay).map((e) => toRow(e, library)),
  }));
}

const int = (v: string, min: number, max: number) => (/^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max ? Number(v) : null);
function problemsOf(r: Row): string[] {
  const p: string[] = [];
  if (r.choice === SKIP) return p; // left out: nothing of it is saved
  if (!r.choice) p.push("choose an exercise, or skip it");
  if (r.choice === "new" && (!r.newMuscle || !r.newEquipment)) p.push("choose its muscle and equipment");
  if (int(r.sets, 1, 20) === null) p.push("sets (1 to 20)");
  const lo = int(r.repsMin, 1, 100), hi = int(r.repsMax, 1, 100);
  if (lo === null || hi === null) p.push("reps (1 to 100)");
  else if (hi < lo) p.push("max reps below min");
  if (r.weight.trim() && !(/^\d{1,4}([.,]\d{1,2})?$/.test(r.weight.trim()) && (r.unit === "kg" ? Number(r.weight.replace(",", ".")) : poundsToKg(Number(r.weight.replace(",", ".")))) <= 1000)) p.push("a weight up to 1000 kg");
  if (r.rest.trim() && int(r.rest, 0, 1800) === null) p.push("rest in seconds, up to 1800");
  return p;
}

export function PlanImport() {
  const [library, setLibrary] = useState<LibraryExercise[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [program, setProgram] = useState("");
  const [days, setDays] = useState<Day[]>([]);
  const [saved, setSaved] = useState<{ program: { id: string; name: string }; templates: { id: string; name: string }[]; scheduled: { name: string; weekday: number }[]; unscheduled: string[] } | null>(null);
  // UI-01: importing doesn't touch the weekly schedule unless this is ticked, with the proposed days shown first.
  const [schedule, setSchedule] = useState(false);
  const [current, setCurrent] = useState<{ weekday: number; template: { name: string } }[] | null>(null);
  const idem = useRef(newIdempotencyKey());

  useEffect(() => {
    api<{ exercises: LibraryExercise[] }>("GET", "/api/exercises").then((r) => setLibrary(r.exercises)).catch(() => setError("The exercise library couldn't be loaded. Reload the page."));
    api<{ slots: { weekday: number; template: { name: string } }[] }>("GET", "/api/schedule").then((r) => setCurrent(r.slots)).catch(() => setCurrent([]));
  }, []);

  async function readImage(image: Blob): Promise<string> {
    const res = await fetch("/api/workouts/import/ocr", { method: "POST", headers: { "Content-Type": image.type || "image/jpeg" }, body: image, credentials: "same-origin" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new PlanFileError(body.error ?? "The image couldn't be read.");
    return String(body.text ?? "");
  }

  async function choose(file: File | undefined) {
    if (!file || !library) return;
    setError(null); setDraft(null); setDays([]); setSaved(null); setAdded(new Set()); setSchedule(false);
    setBusy(`Reading ${file.name}…`);
    try {
      const { draft: d } = await extractPlan(file, readImage);
      setDraft(d);
      setProgram((d.programName ?? "").slice(0, 60));
      setDays(toDays(d, library));
      idem.current = newIdempotencyKey();
    } catch (e) {
      setError(e instanceof PlanFileError ? e.message : "This file couldn't be read.");
    } finally {
      setBusy(null);
    }
  }

  const issues = useMemo(() => days.flatMap((d) => d.rows.map((r) => ({ d, r, p: problemsOf(r) }))).filter((x) => x.p.length), [days]);
  // What's saved: skipped exercises left out, and a day with nothing left in it left out too.
  const kept = useMemo(() => days.map((d) => ({ ...d, rows: d.rows.filter((r) => r.choice !== SKIP) })).filter((d) => d.rows.length > 0), [days]);
  const ready = program.trim().length > 0 && kept.length > 0 && kept.every((d) => d.name.trim()) && issues.length === 0;
  const all = days.flatMap((d) => d.rows);
  const counts = { matched: all.filter((r) => statusOf(r) === "matched").length, chosen: all.filter((r) => statusOf(r) === "chosen").length, skipped: all.filter((r) => statusOf(r) === "skipped").length, needs: all.filter((r) => statusOf(r) === "needs").length };
  const nameOf = (r: Row) => (r.choice === "new" ? `${title(r.name)} (new)` : library?.find((x) => x.id === r.choice)?.name ?? "");
  const proposed = kept.filter((d) => d.weekday !== "").map((d) => ({ day: d.name, weekday: Number(d.weekday), already: (current ?? []).filter((c) => c.weekday === Number(d.weekday)).map((c) => c.template.name) }));
  const setDay = (k: string, patch: Partial<Day>) => setDays((ds) => ds.map((d) => (d.key === k ? { ...d, ...patch } : d)));
  const setRow = (dk: string, rk: string, patch: Partial<Row>) => setDays((ds) => ds.map((d) => (d.key === dk ? { ...d, rows: d.rows.map((r) => (r.key === rk ? { ...r, ...patch } : r)) } : d)));
  // Recovery when a page's day labels weren't read: start a new day at this exercise; the rest of the day moves with it.
  const splitDay = (dk: string, rk: string) => setDays((ds) => ds.flatMap((d) => {
    const at = d.key === dk ? d.rows.findIndex((r) => r.key === rk) : -1;
    if (at <= 0 || ds.length >= SAVE_LIMITS.maxDays) return [d];
    return [{ ...d, rows: d.rows.slice(0, at) }, { key: key(), name: `Day ${ds.length + 1}`, weekday: "", notes: "", rows: d.rows.slice(at) }];
  }));
  // Recovery for a line that wasn't read as an exercise: add it to the last day, with nothing filled in that wasn't read.
  const addLine = (line: string) => {
    if (!library) return;
    const row = toRow({ name: line.replace(/^[^A-Za-z]+/, "").slice(0, 120), source: line, sets: null, repsMin: null, repsMax: null, weight: null, restSeconds: null, notes: [], group: null }, library);
    setDays((ds) => (ds.length === 0
      ? [{ key: key(), name: "Day 1", weekday: "", notes: "", rows: [row] }]
      : ds.map((d, i) => (i === ds.length - 1 && d.rows.length < SAVE_LIMITS.maxExercisesPerDay ? { ...d, rows: [...d.rows, row] } : d))));
    setAdded((a) => new Set(a).add(line));
  };
  const [added, setAdded] = useState<Set<string>>(new Set());

  async function save() {
    if (!ready) return;
    const body: ImportSave = {
      programName: program.trim(),
      schedule,
      days: kept.map((d) => ({
        name: d.name.trim(), weekday: d.weekday === "" ? null : Number(d.weekday), notes: d.notes.trim() || null,
        exercises: d.rows.map((r) => {
          const w = r.weight.trim() ? Number(r.weight.replace(",", ".")) : null;
          return {
            ...(r.choice === "new" ? { newExercise: { name: r.name.trim().slice(0, 80), primaryMuscle: r.newMuscle as (typeof MUSCLE_GROUPS)[number], equipment: r.newEquipment as (typeof EQUIPMENT)[number] } } : { exerciseId: r.choice }),
            targetSets: Number(r.sets), targetRepsMin: Number(r.repsMin), targetRepsMax: Number(r.repsMax),
            targetWeightKg: w === null ? null : r.unit === "kg" ? w : poundsToKg(w),
            restSeconds: r.rest.trim() ? Number(r.rest) : null, notes: r.notes.trim().slice(0, 1000) || null,
          };
        }),
      })),
    };
    setBusy("Saving…"); setError(null);
    try {
      setSaved(await api("POST", "/api/workouts/import", body, { idempotencyKey: idem.current, timeoutMs: SAVE_TIMEOUT_MS }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "It couldn't be saved. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (saved) {
    return (
      <Card className="space-y-3 p-5" data-testid="import-saved">
        <p className="font-semibold">Saved the program “{saved.program.name}”, with {saved.templates.length} workout day{saved.templates.length === 1 ? "" : "s"}.</p>
        <ol className="list-decimal pl-5 text-sm">{saved.templates.map((t) => <li key={t.id}>{t.name}</li>)}</ol>
        <p className="text-sm" data-testid="import-saved-schedule">
          {saved.scheduled.length === 0
            ? "Your weekly schedule wasn't changed."
            : `Added to your weekly schedule: ${saved.scheduled.map((x) => `${x.name} on ${WEEKDAY_NAMES[x.weekday]}`).join("; ")}.`}
        </p>
        {saved.unscheduled.length > 0 && <p className="text-sm text-down">Not put on the schedule, as those days already have three plans: {saved.unscheduled.join(", ")}.</p>}
        <div className="flex flex-wrap gap-4">
          <Link href={`/workouts/programs/${saved.program.id}`} className="font-medium text-accent-ink underline">View the program</Link>
          <Link href="/workouts" className="font-medium text-accent-ink underline">Go to your workouts</Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <p className="text-sm text-muted">
          Choose a plan as a PDF, a photo or screenshot, or a CSV, TXT, Word or Excel file (up to 10 MB). Documents are read in your browser and
          not uploaded. A photo, screenshot or scanned page is read as text on our server and not kept. Nothing is saved until you check it and press Save.
        </p>
        <input type="file" accept={ACCEPT} disabled={!library || Boolean(busy)} onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} data-testid="import-file" aria-label="Choose a plan file" />
        {busy && <p role="status" data-testid="import-busy">{busy}</p>}
        <ErrorText>{error}</ErrorText>
      </Card>

      {draft && (
        <>
          {(draft.warnings.length > 0 || draft.unparsed.length > 0) && (
            <Card className="space-y-2 p-4 text-sm" data-testid="import-warnings">
              {draft.warnings.map((w, i) => <p key={i} className="text-down">{w}</p>)}
              {draft.unparsed.length > 0 && (
                <details open={days.length === 0}>
                  <summary>{draft.unparsed.length} line{draft.unparsed.length === 1 ? " wasn't" : "s weren't"} read as exercises</summary>
                  <ul className="mt-1 space-y-1 pl-1 text-muted" data-testid="import-unparsed">
                    {draft.unparsed.slice(0, 50).map((u, i) => (
                      <li key={i} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 break-words">{u}</span>
                        {/[A-Za-z]{3}/.test(u) && (added.has(u)
                          ? <span className="shrink-0 text-xs">Added</span>
                          : <Button variant="ghost" size="sm" className="shrink-0" onClick={() => addLine(u)} data-testid="import-add-line">Add as an exercise</Button>)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          )}
          {days.length > 0 && (
            <>
              <Field label="Program name" hint="One name for the whole program; each day keeps its own short name."><Input value={program} maxLength={60} onChange={(e) => setProgram(e.target.value)} data-testid="import-program" /></Field>
              {days.map((d, di) => (
                <Card key={d.key} className="space-y-3 p-4" data-testid="import-day">
                  <div className={cx("grid gap-2", schedule && "sm:grid-cols-[1fr_12rem]")}>
                    <Field label={`Day ${di + 1}`}><Input value={d.name} maxLength={80} onChange={(e) => setDay(d.key, { name: e.target.value })} data-testid="import-day-name" /></Field>
                    {schedule && (
                      <Field label="On the schedule">
                        <Select value={d.weekday} onChange={(e) => setDay(d.key, { weekday: e.target.value })} data-testid="import-day-weekday">
                          <option value="">Not scheduled</option>
                          {WEEKDAY_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
                        </Select>
                      </Field>
                    )}
                  </div>
                  {d.rows.map((r) => {
                    const p = problemsOf(r);
                    const st = statusOf(r);
                    return (
                      <div key={r.key} className={cx("space-y-2 rounded-xl border p-3", st === "skipped" ? "border-line opacity-70" : p.length ? "border-down/50" : "border-line")} data-testid="import-row" data-ready={p.length === 0} data-status={st}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 text-xs text-muted">From the plan: <span className="font-mono break-words">{r.source}</span></p>
                          <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", st === "matched" ? "bg-up/12 text-up" : st === "needs" ? "bg-down/12 text-down" : "bg-surface-2 text-muted")} data-testid="import-row-status">{STATUS_LABEL[st]}</span>
                        </div>
                        <Field label="Exercise" hint={st === "matched" ? `Matched: ${r.matched}` : st === "skipped" ? "Left out: it won't be saved." : st === "chosen" ? `The plan says “${r.name}”; you chose ${nameOf(r)}.` : offersChoice(r.name) ? "The plan gives a choice: pick the one you'll do, or skip it." : "Not matched for certain: choose one, or skip it."}>
                          <Select value={r.choice} onChange={(e) => setRow(d.key, r.key, { choice: e.target.value })} data-testid="import-exercise">
                            <option value="">Choose…</option>
                            {r.suggestions.length > 0 && <optgroup label="Suggested">{r.suggestions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>}
                            <optgroup label="Library">{(library ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
                            <option value="new">New exercise: {title(r.name).slice(0, 60)}</option>
                            <option value={SKIP}>Skip: don&apos;t save this exercise</option>
                          </Select>
                        </Field>
                        {r.choice === "new" && (
                          <div className="grid gap-2 sm:grid-cols-3">
                            <Field label="Name"><Input value={r.name} maxLength={80} onChange={(e) => setRow(d.key, r.key, { name: e.target.value })} /></Field>
                            <Field label="Muscle"><Select value={r.newMuscle} onChange={(e) => setRow(d.key, r.key, { newMuscle: e.target.value })} data-testid="import-new-muscle"><option value="">Choose…</option>{MUSCLE_GROUPS.map((m) => <option key={m} value={m}>{title(m.replace("_", " "))}</option>)}</Select></Field>
                            <Field label="Equipment"><Select value={r.newEquipment} onChange={(e) => setRow(d.key, r.key, { newEquipment: e.target.value })} data-testid="import-new-equipment"><option value="">Choose…</option>{EQUIPMENT.map((m) => <option key={m} value={m}>{title(m)}</option>)}</Select></Field>
                          </div>
                        )}
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                          <Field label="Sets"><Input inputMode="numeric" value={r.sets} onChange={(e) => setRow(d.key, r.key, { sets: e.target.value })} data-testid="import-sets" /></Field>
                          <Field label="Reps min"><Input inputMode="numeric" value={r.repsMin} onChange={(e) => setRow(d.key, r.key, { repsMin: e.target.value })} data-testid="import-reps-min" /></Field>
                          <Field label="Reps max"><Input inputMode="numeric" value={r.repsMax} onChange={(e) => setRow(d.key, r.key, { repsMax: e.target.value })} data-testid="import-reps-max" /></Field>
                          <Field label="Weight"><Input inputMode="decimal" value={r.weight} onChange={(e) => setRow(d.key, r.key, { weight: e.target.value })} data-testid="import-weight" /></Field>
                          <Field label="Unit"><Select value={r.unit} onChange={(e) => setRow(d.key, r.key, { unit: e.target.value as "kg" | "lb" })} data-testid="import-unit"><option value="kg">kg</option><option value="lb">lb</option></Select></Field>
                          <Field label="Rest (s)"><Input inputMode="numeric" value={r.rest} onChange={(e) => setRow(d.key, r.key, { rest: e.target.value })} data-testid="import-rest" /></Field>
                        </div>
                        {r.unit === "lb" && r.weight.trim() && /^\d/.test(r.weight) && <p className="text-xs text-muted">Saved as {poundsToKg(Number(r.weight.replace(",", ".")))} kg.</p>}
                        <Field label="Notes"><Textarea rows={2} maxLength={1000} value={r.notes} onChange={(e) => setRow(d.key, r.key, { notes: e.target.value })} data-testid="import-notes" /></Field>
                        {p.length > 0 && <p className="text-xs text-down" data-testid="import-row-problems">Needs: {p.join(", ")}.</p>}
                        <div className="flex flex-wrap gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setDay(d.key, { rows: d.rows.filter((x) => x.key !== r.key) })}>Remove this exercise</Button>
                          {d.rows[0]?.key !== r.key && days.length < SAVE_LIMITS.maxDays && (
                            <Button variant="ghost" size="sm" onClick={() => splitDay(d.key, r.key)} data-testid="import-split-day">Start a new day here</Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <Field label="Notes for this day"><Textarea rows={2} maxLength={1000} value={d.notes} onChange={(e) => setDay(d.key, { notes: e.target.value })} /></Field>
                  <Button variant="ghost" size="sm" onClick={() => setDays(days.filter((x) => x.key !== d.key))}>Remove this day</Button>
                </Card>
              ))}
              <Card className="space-y-3 p-4" data-testid="import-summary">
                <p className="font-semibold">Before you save</p>
                <p className="text-sm" data-testid="import-counts">
                  {counts.matched} matched · {counts.chosen} chosen by you · {counts.skipped} skipped{counts.needs ? ` · ${counts.needs} still to confirm` : ""}
                </p>
                {all.some((r) => statusOf(r) === "chosen" || statusOf(r) === "skipped") && (
                  <ul className="space-y-1 text-sm" data-testid="import-choices">
                    {days.flatMap((d) => d.rows.filter((r) => statusOf(r) === "chosen" || statusOf(r) === "skipped").map((r) => (
                      <li key={r.key} className="break-words"><span className="text-muted">{d.name}: “{r.name}” →</span> {statusOf(r) === "skipped" ? <em>skipped</em> : nameOf(r)}</li>
                    )))}
                  </ul>
                )}
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} data-testid="import-schedule" />
                  <span>Also add these days to my weekly schedule. <span className="text-muted">Otherwise the program is saved under My programs, and your schedule stays as it is.</span></span>
                </label>
                {schedule && (
                  <div className="text-sm" data-testid="import-schedule-preview">
                    {proposed.length === 0 ? <p className="text-down">Choose a day of the week for each day you want scheduled, above.</p> : (
                      <ul className="space-y-1">
                        {proposed.map((x) => (
                          <li key={x.day}><strong>{WEEKDAY_NAMES[x.weekday]}</strong>: {x.day}{x.already.length > 0 && <span className="text-muted"> (added beside {x.already.join(", ")}, which stay{x.already.length >= 3 ? "; that day is full, so this one won't be added" : ""})</span>}</li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-xs text-muted">Nothing already on your schedule is removed or replaced.</p>
                  </div>
                )}
              </Card>
              <p className="text-sm text-muted" data-testid="import-status">{issues.length ? `${issues.length} exercise${issues.length === 1 ? " needs" : "s need"} something before saving.` : "Everything is filled in. Check it, then save."}</p>
              <Button disabled={!ready || Boolean(busy)} onClick={save} data-testid="import-save">Save program ({kept.length} day{kept.length === 1 ? "" : "s"})</Button>
            </>
          )}
        </>
      )}
    </div>
  );
}
