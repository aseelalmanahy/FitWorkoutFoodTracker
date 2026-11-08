"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { CATEGORY_LABELS, FEEDBACK_CATEGORIES, FEEDBACK_PRIORITIES, FEEDBACK_SEVERITIES, FEEDBACK_STATUSES, STATUS_LABELS } from "@/lib/feedback";
import { Button, Card, ErrorText, Input, Select, Textarea } from "@/components/ui";

type Row = {
  id: string; reporter: string; category: (typeof FEEDBACK_CATEGORIES)[number]; description: string; route: string | null;
  status: (typeof FEEDBACK_STATUSES)[number]; severity: string | null; priority: string | null; duplicateOfId: string | null;
  decisionNote: string | null; taskLink: string | null; createdAt: string;
};

function Item({ row }: { row: Row }) {
  const [v, setV] = useState(row);
  const [state, setState] = useState<string | null>(null);
  const set = (k: keyof Row) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value === "" ? null : e.target.value });
  async function save() {
    setState(null);
    try {
      await api("PATCH", `/api/admin/feedback/${row.id}`, { status: v.status, severity: v.severity, priority: v.priority, duplicateOfId: v.duplicateOfId, decisionNote: v.decisionNote, taskLink: v.taskLink });
      setState("Saved");
    } catch (e) { setState(e instanceof ApiError ? e.message : "Not saved"); }
  }
  return (
    <Card className="space-y-3 p-4" data-testid="admin-feedback-item">
      <div className="flex flex-wrap justify-between gap-2 text-sm text-muted">
        <span>{CATEGORY_LABELS[row.category]} · {row.route ?? "no page"} · reporter …{row.reporter}</span>
        <span>{new Date(row.createdAt).toLocaleString()} · <code>{row.id}</code></span>
      </div>
      <p className="whitespace-pre-wrap break-words">{row.description}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <Select aria-label="Status" value={v.status} onChange={set("status")}>{FEEDBACK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</Select>
        <Select aria-label="Severity" value={v.severity ?? ""} onChange={set("severity")}><option value="">Severity…</option>{FEEDBACK_SEVERITIES.map((s) => <option key={s}>{s}</option>)}</Select>
        <Select aria-label="Priority" value={v.priority ?? ""} onChange={set("priority")}><option value="">Priority…</option>{FEEDBACK_PRIORITIES.map((s) => <option key={s}>{s}</option>)}</Select>
      </div>
      <Input aria-label="Repeats report" placeholder="Repeats report (its ID)" value={v.duplicateOfId ?? ""} onChange={set("duplicateOfId")} />
      <Textarea aria-label="Decision note" rows={2} placeholder="Decision note" value={v.decisionNote ?? ""} onChange={set("decisionNote")} />
      <Input aria-label="Task link" placeholder="https:// link to the approved task" value={v.taskLink ?? ""} onChange={set("taskLink")} />
      <div className="flex items-center gap-3"><Button size="sm" onClick={save}>Save</Button>{state && <span className="text-sm text-muted" role="status">{state}</span>}</div>
    </Card>
  );
}

export function AdminFeedback({ initial, counts }: { initial: Row[]; counts: Record<string, number> }) {
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState({ status: "", category: "" });
  const [error, setError] = useState<string | null>(null);
  const query = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
  async function load(next: typeof filter) {
    setFilter(next);
    setError(null);
    try {
      const q = new URLSearchParams(Object.entries(next).filter(([, v]) => v)).toString();
      setRows((await api<{ feedback: Row[] }>("GET", `/api/admin/feedback${q ? `?${q}` : ""}`)).feedback);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Couldn't load"); }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{FEEDBACK_STATUSES.map((s) => `${STATUS_LABELS[s]} ${counts[s] ?? 0}`).join(" · ")}</p>
      <div className="flex flex-wrap gap-2">
        <Select aria-label="Filter by status" value={filter.status} onChange={(e) => load({ ...filter, status: e.target.value })}><option value="">Every status</option>{FEEDBACK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</Select>
        <Select aria-label="Filter by category" value={filter.category} onChange={(e) => load({ ...filter, category: e.target.value })}><option value="">Every category</option>{FEEDBACK_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</Select>
        <a className="text-sm font-medium underline" href={`/api/admin/feedback/export${query ? `?${query}` : ""}`} data-testid="admin-feedback-export">Download a redacted review export</a>
      </div>
      <ErrorText>{error}</ErrorText>
      {rows.length === 0 ? <p className="text-sm text-muted">No feedback here.</p> : rows.map((r) => <Item key={r.id} row={r} />)}
    </div>
  );
}
