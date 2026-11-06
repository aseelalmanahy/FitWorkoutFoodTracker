"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AUTH_TIMEOUT_MS, api } from "@/lib/client/api";
import { Button, ErrorText, Field, Input } from "@/components/ui";

export function AuthForm({ notice }: { notice?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/api/auth/login", { email: fd.get("email"), password: fd.get("password") }, { timeoutMs: AUTH_TIMEOUT_MS });
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-accent text-xl font-black text-accent-fg">F</div>
        <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-muted">Log in to continue your training.</p>
        {notice && <p role="status" className="mt-2 text-sm font-medium">{notice}</p>}
      </div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required inputMode="email" />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required minLength={8} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? "Please wait…" : "Log in"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        <Link href="/forgot-password" className="font-semibold text-fg underline-offset-4 hover:underline">Forgot your password?</Link>
      </p>
      <p className="mt-3 text-center text-sm text-muted">
        New here? <Link href="/register" className="font-semibold text-fg underline-offset-4 hover:underline">Create an account</Link>
      </p>
    </div>
  );
}
