"use client";

import Link from "next/link";
import { useState } from "react";
import { AUTH_TIMEOUT_MS, api } from "@/lib/client/api";
import { Button, ErrorText, Field, Input } from "@/components/ui";

const LINK = "font-semibold text-fg underline-offset-4 hover:underline";

export function RegisterForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/api/auth/register", { email: fd.get("email") }, { timeoutMs: AUTH_TIMEOUT_MS });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-accent text-xl font-black text-accent-fg">F</div>
        {sent ? (
          <>
            <h1 className="text-3xl font-bold tracking-tight">Check your email</h1>
            <p role="status" className="mt-1 text-muted">If this address can be used, we&apos;ve sent a link to finish creating your account. It works for 24 hours.</p>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold tracking-tight">Create your account</h1>
            <p className="mt-1 text-muted">Plan, log and track your progress.</p>
            <p className="mt-2 text-sm font-medium">For adults 18 and over.</p>
          </>
        )}
      </div>
      {!sent && (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Email">
            <Input name="email" type="email" autoComplete="email" required inputMode="email" />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Please wait…" : "Send sign-up link"}</Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account? <Link href="/login" className={LINK}>Log in</Link>
        {" · "}
        <Link href="/forgot-password" className={LINK}>Forgot your password?</Link>
      </p>
    </div>
  );
}
