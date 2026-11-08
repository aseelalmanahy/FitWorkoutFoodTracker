"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, newIdempotencyKey, SAVE_TIMEOUT_MS } from "@/lib/client/api";
import { extractPlan } from "@/lib/client/plan-extract";
import { PlanFileError } from "@/lib/workout-import/documents";
import { matchExercise, type LibraryExercise } from "@/lib/workout-import/match";
import type { Draft } from "@/lib/workout-import/parse";
import { EQUIPMENT, MUSCLE_GROUPS, planName, poundsToKg, SAVE_LIMITS, type ImportSave } from "@/lib/workout-import/save-schema";
import { Button, Card, ErrorText, Field, Input, Select, Textarea, cx } from "@/components/ui";

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.csv,.tsv,.txt,.docx,.xlsx,application/pdf,image/png,image/jpeg,image/webp,text/csv,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

type Row = {
  key: string; source: string; name: string; matched: string | null; suggestions: LibraryExercise[]; choice: string;
  newMuscle: string; newEquipment: string; sets: string; repsMin: string; repsMax: string; weight: string; unit: "kg" | "lb"; rest: string; notes: string;
};
type Day = { key: string; name: string; weekday: string; notes: string; rows: Row[] };

let seq = 0;
const key = () => `k${++seq}`;
const s = (v: number | null) => (v === null ? "" : String(v));

function toDays(draft: Draft, library: LibraryExercise[]): Day[] {
  return draft.days.slice(0, SAVE_LIMITS.maxDays).map((d) => ({
    key: key(), name: d.name, weekday: d.weekday === null ? "" : String(d.weekday), notes: d.notes.join("\n"),
    rows: d.exercises.slice(0, SAVE_LIMITS.maxExercisesPerDay).map((e) => {
      const m = matchExercise(e.name, library);
      return {
        key: key(), source: e.source, name: e.name, matched: m.kind === "exact" ? m.exercise.name : null,
        suggestions: m.kind === "choose" ? m.suggestions : [], choice: m.kind === "exact" ? m.exercise.id : "",
        newMuscle: "", newEquipment: "", sets: s(e.sets), repsMin: s(e.repsMin), repsMax: s(e.repsMax),
        weight: e.weight ? String(e.weight.value) : "", unit: e.weight?.unit ?? "kg", rest: s(e.restSeconds),
        notes: [...(e.group ? [`Superset ${e.group}`] : []), ...e.notes].join("; "),
      };
    }),
  }));
}

const int = (v: string, min: number, max: number) => (/^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max ? Number(v) : null);
function problemsOf(r: Row): string[] {
  const p: string[] = [];
  if (!r.choice) p.push("choose an exercise");
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
  const [saved, setSaved] = useState<{ templates: { id: string; name: string }[]; unscheduled: string[] } | null>(null);
  const idem = useRef(newIdempotencyKey());

  useEffect(() => {
    api<{ exercises: LibraryExercise[] }>("GET", "/api/exercises").then((r) => setLibrary(r.exercises)).catch(() => setError("The exercise library couldn't be loaded. Reload the page."));
  }, []);

  async function readImage(image: Blob): Promise<string> {
    const res = await fetch("/api/workouts/import/ocr", { method: "POST", headers: { "Content-Type": image.type || "image/jpeg" }, body: image, credentials: "same-origin" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new PlanFileError(body.error ?? "The image couldn't be read.");
    return String(body.text ?? "");
  }

  async function choose(file: File | undefined) {
    if (!file || !library) return;
    setError(null); setDraft(null); setDays([]); setSaved(null);
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
  const ready = program.trim().length > 0 && days.length > 0 && days.every((d) => d.name.trim() && d.rows.length > 0) && issues.length === 0;
  const setDay = (k: string, patch: Partial<Day>) => setDays((ds) => ds.map((d) => (d.key === k ? { ...d, ...patch } : d)));
  const setRow = (dk: string, rk: string, patch: Partial<Row>) => setDays((ds) => ds.map((d) => (d.key === dk ? { ...d, rows: d.rows.map((r) => (r.key === rk ? { ...r, ...patch } : r)) } : d)));

  async function save() {
    if (!ready) return;
    const body: ImportSave = {
      programName: program.trim(),
      days: days.map((d) => ({
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
        <p className="font-semibold">Saved {saved.templates.length} plan{saved.templates.length === 1 ? "" : "s"}.</p>
        <ul className="list-disc pl-5 text-sm">{saved.templates.map((t) => <li key={t.id}>{t.name}</li>)}</ul>
        {saved.unscheduled.length > 0 && <p className="text-sm text-down">Not put on the schedule, as those days already have three plans: {saved.unscheduled.join(", ")}.</p>}
        <Link href="/workouts" className="font-medium text-accent-ink underline">Go to your workouts</Link>
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
                <details><summary>{draft.unparsed.length} line{draft.unparsed.length === 1 ? " wasn't" : "s weren't"} read as exercises</summary><ul className="mt-1 list-disc pl-5 text-muted">{draft.unparsed.slice(0, 50).map((u, i) => <li key={i}>{u}</li>)}</ul></details>
              )}
            </Card>
          )}
          {days.length > 0 && (
            <>
              <Field label="Program name"><Input value={program} maxLength={60} onChange={(e) => setProgram(e.target.value)} data-testid="import-program" /></Field>
              {days.map((d) => (
                <Card key={d.key} className="space-y-3 p-4" data-testid="import-day">
                  <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
                    <Field label="Day"><Input value={d.name} maxLength={80} onChange={(e) => setDay(d.key, { name: e.target.value })} data-testid="import-day-name" /></Field>
                    <Field label="On the schedule">
                      <Select value={d.weekday} onChange={(e) => setDay(d.key, { weekday: e.target.value })} data-testid="import-day-weekday">
                        <option value="">Not scheduled</option>
                        {WEEKDAY_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
                      </Select>
                    </Field>
                  </div>
                  <p className="text-xs text-muted">Saved as the plan “{planName(program || "Program", d.name || "Day")}”.</p>
                  {d.rows.map((r) => {
                    const p = problemsOf(r);
                    return (
                      <div key={r.key} className={cx("space-y-2 rounded-xl border p-3", p.length ? "border-down/50" : "border-line")} data-testid="import-row" data-ready={p.length === 0}>
                        <p className="text-xs text-muted">From the plan: <span className="font-mono">{r.source}</span></p>
                        <Field label="Exercise" hint={r.matched ? `Matched: ${r.matched}` : "Not matched for certain: choose one"}>
                          <Select value={r.choice} onChange={(e) => setRow(d.key, r.key, { choice: e.target.value })} data-testid="import-exercise">
                            <option value="">Choose…</option>
                            {r.suggestions.length > 0 && <optgroup label="Suggested">{r.suggestions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>}
                            <optgroup label="Library">{(library ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
                            <option value="new">New exercise: {title(r.name).slice(0, 60)}</option>
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
                        <Button variant="ghost" size="sm" onClick={() => setDay(d.key, { rows: d.rows.filter((x) => x.key !== r.key) })}>Remove this exercise</Button>
                      </div>
                    );
                  })}
                  <Field label="Notes for this day"><Textarea rows={2} maxLength={1000} value={d.notes} onChange={(e) => setDay(d.key, { notes: e.target.value })} /></Field>
                  <Button variant="ghost" size="sm" onClick={() => setDays(days.filter((x) => x.key !== d.key))}>Remove this day</Button>
                </Card>
              ))}
              <p className="text-sm text-muted" data-testid="import-status">{issues.length ? `${issues.length} exercise${issues.length === 1 ? " needs" : "s need"} something before saving.` : "Everything is filled in. Check it, then save."}</p>
              <Button disabled={!ready || Boolean(busy)} onClick={save} data-testid="import-save">Save {days.length} plan{days.length === 1 ? "" : "s"}</Button>
            </>
          )}
        </>
      )}
    </div>
  );
}
