"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { Button, ErrorText, Field, Input } from "@/components/ui";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/api/auth/${mode}`, { email: fd.get("email"), password: fd.get("password") });
      router.replace(mode === "register" ? "/onboarding" : "/dashboard");
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
        <h1 className="text-3xl font-bold tracking-tight">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        <p className="mt-1 text-muted">{mode === "login" ? "Log in to continue your training." : "Plan, log and track your progress."}</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required inputMode="email" />
        </Field>
        <Field label="Password" hint={mode === "register" ? "At least 8 characters. A passphrase works well." : undefined}>
          <Input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        {mode === "login" ? (
          <>New here? <Link href="/register" className="font-semibold text-fg underline-offset-4 hover:underline">Create an account</Link></>
        ) : (
          <>Already have an account? <Link href="/login" className="font-semibold text-fg underline-offset-4 hover:underline">Log in</Link></>
        )}
      </p>
    </div>
  );
}
