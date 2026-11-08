"use client";

import { useState } from "react";
import { api, ApiError, SAVE_TIMEOUT_MS } from "@/lib/client/api";
import { CATEGORY_LABELS, FEEDBACK_CATEGORIES, MAX_FEEDBACK_CHARS, MIN_FEEDBACK_CHARS, STATUS_LABELS } from "@/lib/feedback";
import { Button, Card, ErrorText, Field, SectionTitle, Select, Textarea } from "@/components/ui";

type Own = { id: string; category: keyof typeof CATEGORY_LABELS; description: string; status: keyof typeof STATUS_LABELS; createdAt: string };

export function FeedbackForm({ from, initial }: { from: string | null; initial: Own[] }) {
  const [category, setCategory] = useState<keyof typeof CATEGORY_LABELS>("BUG");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState(initial);
  const length = description.trim().length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSent(null);
    if (length < MIN_FEEDBACK_CHARS) { setError(`Please write at least ${MIN_FEEDBACK_CHARS} characters.`); return; }
    setBusy(true);
    try {
      const r = await api<{ feedback: Own; repeated: boolean }>("POST", "/api/feedback", { category, description, route: from }, { timeoutMs: SAVE_TIMEOUT_MS });
      setSent(r.repeated ? "You sent this already today, so it wasn't sent twice." : "Thank you. It's been sent.");
      if (!r.repeated) { setMine([r.feedback, ...mine]); setDescription(""); }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "It couldn't be sent. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card className="p-5">
        <form onSubmit={submit} className="space-y-4" data-testid="feedback-form">
          <Field label="What is it about?">
            <Select value={category} onChange={(e) => setCategory(e.target.value as keyof typeof CATEGORY_LABELS)} data-testid="feedback-category">
              {FEEDBACK_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </Select>
          </Field>
          <Field label="Tell us" hint={`${length} of ${MAX_FEEDBACK_CHARS} characters${from ? `. Sent from ${from}` : ""}`}>
            <Textarea rows={6} maxLength={MAX_FEEDBACK_CHARS} value={description} onChange={(e) => setDescription(e.target.value)} data-testid="feedback-description" />
          </Field>
          <p className="text-sm text-muted" data-testid="feedback-notice">
            Only the app&apos;s owner reads this. To plan changes, they may share a summary with AI tools after email addresses, links and
            numbers are removed, and your name is never included. Please don&apos;t write health details or other people&apos;s names.
            Nothing else about you, your device or your data is attached.
          </p>
          <ErrorText>{error}</ErrorText>
          {sent && <p role="status" className="text-sm font-medium text-up" data-testid="feedback-sent">{sent}</p>}
          <Button type="submit" disabled={busy} data-testid="feedback-submit">{busy ? "Sending…" : "Send feedback"}</Button>
        </form>
      </Card>
      <SectionTitle>What you&apos;ve sent</SectionTitle>
      {mine.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : (
        <ul className="space-y-2" data-testid="feedback-mine">
          {mine.map((f) => (
            <li key={f.id}>
              <Card className="p-4">
                <div className="flex justify-between gap-3 text-sm text-muted"><span>{CATEGORY_LABELS[f.category]}</span><span>{STATUS_LABELS[f.status]}</span></div>
                <p className="mt-1 whitespace-pre-wrap break-words">{f.description}</p>
                <p className="mt-1 text-xs text-muted">{new Date(f.createdAt).toLocaleDateString()}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
