"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api, isUncertainFailure } from "@/lib/client/api";
import { Sheet } from "@/components/nutrition/sheet";
import { Button, Card, ErrorText, Field, Input, SectionTitle } from "@/components/ui";

const CONFIRM_WORD = "DELETE";
/** Longer than the server allows for the work itself, so its own answer normally arrives first. */
const LONG_TIMEOUT_MS = 150_000;
const NO_ANSWER = "We didn't get an answer. Check your connection and try again.";

/** What to tell the person when a deletion didn't report success. */
function deleteFailure(err: unknown): string {
  if (err instanceof ApiError && err.status === 401) return "You're signed out. If your deletion went through, your account is gone. Try logging in to check.";
  if (isUncertainFailure(err)) return "We can't tell whether this worked. Try logging in again to check.";
  return (err as Error).message;
}

async function downloadExport(password: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/account/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
      credentials: "same-origin",
      ...(typeof AbortSignal.timeout === "function" ? { signal: AbortSignal.timeout(LONG_TIMEOUT_MS) } : {}),
    });
  } catch {
    throw new ApiError(0, NO_ANSWER);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.details);
  }
  // Read whole before offering it, so a dropped connection reports a failure rather than saving part of a file.
  let blob: Blob;
  try {
    blob = await res.blob();
  } catch {
    throw new ApiError(0, NO_ANSWER);
  }
  const name = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "fitworkoutfoodtracker-export.json";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function AccountDataControls({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<"export" | "delete" | null>(null);
  const [password, setPassword] = useState("");
  const [word, setWord] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const show = (which: "export" | "delete") => {
    setPassword("");
    setWord("");
    setError(null);
    setDone(false);
    setOpen(which);
  };
  const close = () => {
    setOpen(null);
    setPassword("");
    setWord("");
    setError(null);
  };

  async function runExport(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!password) return setError("Enter your password.");
    setBusy(true);
    try {
      await downloadExport(password);
      close();
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runDelete(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!password) return setError("Enter your password.");
    if (word !== CONFIRM_WORD) return setError(`Type ${CONFIRM_WORD} to confirm.`);
    setBusy(true);
    try {
      await api("POST", "/api/account/delete", { password, confirmation: word }, { timeoutMs: LONG_TIMEOUT_MS });
      router.replace("/account-deleted");
      router.refresh();
    } catch (err) {
      setError(deleteFailure(err));
      setBusy(false);
    }
  }

  return (
    <>
      <SectionTitle>Your data</SectionTitle>
      <Card className="space-y-3 p-4">
        <p className="text-sm text-muted">Download everything stored for {email} as one JSON file: your profile, workouts, food log and targets.</p>
        <Button variant="secondary" className="w-full" onClick={() => show("export")}>Download my data</Button>
        {done && <p role="status" className="text-sm text-up">Your download has started.</p>}
      </Card>

      <SectionTitle>Delete account</SectionTitle>
      <Card className="space-y-3 p-4">
        <p className="text-sm text-muted">Permanently removes your account and everything in it. This can&apos;t be undone.</p>
        <Button variant="danger" className="w-full" onClick={() => show("delete")}>Delete my account</Button>
      </Card>

      {open === "export" && (
        <Sheet open title="Download your data" locked={busy} onClose={close}>
          <form onSubmit={runExport} className="space-y-3" noValidate>
            <p className="text-sm text-muted">Enter your password to confirm it&apos;s you. The file holds personal information, so keep it somewhere safe.</p>
            <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Preparing…" : "Download"}</Button>
          </form>
        </Sheet>
      )}

      {open === "delete" && (
        <Sheet open title="Delete your account?" locked={busy} onClose={close}>
          <form onSubmit={runDelete} className="space-y-3" noValidate>
            <p className="text-sm font-semibold">This is permanent, and can&apos;t be undone.</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              <li>Your account, sign-in and profile</li>
              <li>Your workout plans, schedule, sessions, sets and custom exercises</li>
              <li>Your food log, custom foods and nutrition targets, including past ones</li>
            </ul>
            <p className="text-sm text-muted">You&apos;ll be signed out on every device. You can download your data first, but you don&apos;t have to.</p>
            <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field label={`Type ${CONFIRM_WORD} to confirm`}><Input autoComplete="off" autoCapitalize="characters" spellCheck={false} value={word} onChange={(e) => setWord(e.target.value)} /></Field>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" variant="danger" size="lg" className="w-full" disabled={busy}>{busy ? "Deleting…" : "Permanently delete my account"}</Button>
            <Button variant="secondary" className="w-full" disabled={busy} onClick={close}>Cancel</Button>
          </form>
        </Sheet>
      )}
    </>
  );
}
