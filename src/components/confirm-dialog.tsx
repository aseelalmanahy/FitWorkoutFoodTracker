"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui";

/**
 * UI-05: a confirmation that says exactly what an action changes and what it keeps, before anything happens. The
 * native <dialog> traps focus, closes on Escape, and gives focus back to what opened it.
 */
export function ConfirmDialog({ open, title, children, confirmLabel, danger = true, busy = false, error, onConfirm, onCancel, testId }: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} data-testid={testId} onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-fg shadow-xl backdrop:bg-black/40">
      <div className="space-y-3 p-5">
        <h2 id={titleId} className="text-lg font-bold">{title}</h2>
        <div className="space-y-2 text-sm text-muted">{children}</div>
        {error && <p role="alert" className="text-sm text-down">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy} data-testid="confirm-cancel">Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy} data-testid="confirm-ok">{busy ? "Working…" : confirmLabel}</Button>
        </div>
      </div>
    </dialog>
  );
}
