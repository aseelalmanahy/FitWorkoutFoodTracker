"use client";

import { useState } from "react";
import { AUTH_TIMEOUT_MS, api, isUncertainFailure } from "@/lib/client/api";
import { Button, Card, ErrorText, Field, Input, SectionTitle } from "@/components/ui";

export function PasswordControls() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await api(
        "POST",
        "/api/account/password",
        { currentPassword: fd.get("currentPassword"), newPassword: fd.get("newPassword") },
        { timeoutMs: AUTH_TIMEOUT_MS },
      );
      form.reset();
      setDone(true);
    } catch (err) {
      setError(isUncertainFailure(err) ? "We can't tell whether this worked. Try logging in with your new password." : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionTitle>Password</SectionTitle>
      <Card className="p-4">
        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          <Field label="Current password">
            <Input name="currentPassword" type="password" autoComplete="current-password" required />
          </Field>
          <Field label="New password" hint="At least 8 characters. A passphrase works well.">
            <Input name="newPassword" type="password" autoComplete="new-password" required minLength={8} />
          </Field>
          <ErrorText>{error}</ErrorText>
          {done && <p role="status" className="text-sm text-up">Password changed. Your other devices have been signed out.</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Please wait…" : "Change password"}</Button>
        </form>
      </Card>
    </>
  );
}
