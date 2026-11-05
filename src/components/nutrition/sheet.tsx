"use client";

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui";

/**
 * A modal sheet. It's placed directly in <body>, so no ancestor's CSS transform can pull it off screen,
 * and everything else is inert while it's open, so neither a keyboard nor a screen reader can change
 * the page behind it, including in the middle of a save.
 *
 * `locked` keeps it open while something is saving, so nobody can walk away from a save and repeat it.
 * That lasts only as long as the save, which has a deadline, so it can't trap anyone.
 */
export function Sheet({ open, title, locked = false, onClose, children }: { open: boolean; title: string; locked?: boolean; onClose: () => void; children: React.ReactNode }) {
  const overlay = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || locked) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, locked, onClose]);

  useLayoutEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const others = Array.from(document.body.children).filter((el) => el !== overlay.current && !el.hasAttribute("inert"));
    for (const el of others) el.setAttribute("inert", "");
    return () => {
      for (const el of others) el.removeAttribute("inert");
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  // Focus starts in the sheet. Saving disables whatever has focus, so it comes back here when that ends too.
  useLayoutEffect(() => {
    if (open && !locked && !dialog.current?.contains(document.activeElement)) dialog.current?.focus();
  }, [open, locked]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div ref={overlay} className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={locked ? undefined : onClose}>
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] outline-none sm:rounded-3xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold leading-tight">{title}</h2>
          <Button variant="ghost" size="sm" disabled={locked} onClick={onClose}>Close</Button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
