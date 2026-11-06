"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AUTH_TIMEOUT_MS, ApiError, api, isUncertainFailure } from "@/lib/client/api";
import { Button, ErrorText, Field, Input } from "@/components/ui";

const LINK = "font-semibold text-fg underline-offset-4 hover:underline";
const TOKEN_HASH = /^#token=([A-Za-z0-9_-]{43})$/;

interface Props {
  endpoint: string;
  doneUrl: string;
  heading: string;
  button: string;
  /** Extra line under the heading. */
  note?: string;
  /** Where to ask for a new link. */
  retryHref: string;
  retryText: string;
}

/** Reads a one-time token from the URL fragment, clears it from the address bar at once, and keeps it in memory only. */
export function PasswordForm({ endpoint, doneUrl, heading, button, note, retryHref, retryText }: Props) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const match = TOKEN_HASH.exec(window.location.hash);
    if (match) setToken(match[1]);
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    setReady(true);
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("POST", endpoint, { token, password: fd.get("password") }, { timeoutMs: AUTH_TIMEOUT_MS });
      setToken(null);
      router.replace(doneUrl);
    } catch (err) {
      // With no answer, the password may already be set, and asking again would just report a used link.
      setError(isUncertainFailure(err) ? "We can't tell whether this worked. Try logging in with this password before asking for a new link." : (err as Error).message);
      // A password that's too short says nothing about the link, which still works.
      const passwordProblem = err instanceof ApiError && !!(err.details as { fieldErrors?: { password?: unknown } } | undefined)?.fieldErrors?.password;
      if (err instanceof ApiError && err.status === 400 && !passwordProblem) setRejected(true);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-accent text-xl font-black text-accent-fg">F</div>
        <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
        {note && <p className="mt-2 text-sm font-medium">{note}</p>}
      </div>
      {!ready ? null : !token ? (
        <p className="text-sm text-muted">This link isn&apos;t complete. <Link href={retryHref} className={LINK}>{retryText}</Link></p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Password" hint="At least 8 characters. A passphrase works well.">
            <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
          </Field>
          <ErrorText>{error}</ErrorText>
          {rejected && <p className="text-sm text-muted"><Link href={retryHref} className={LINK}>{retryText}</Link></p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Please wait…" : button}</Button>
        </form>
      )}
    </div>
  );
}
