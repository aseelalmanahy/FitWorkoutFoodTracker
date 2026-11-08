"use client";

import { useEffect, useState } from "react";

/**
 * Phase 1: registers the service worker in production builds, and says plainly when the connection is gone, so a
 * save that can't reach the server isn't mistaken for a saved one. Nothing here stores data.
 */
export function PwaClient({ register }: { register: boolean }) {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    if (register && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [register]);
  if (online) return null;
  return (
    <div role="status" data-testid="offline-banner" className="fixed inset-x-0 top-0 z-50 bg-down px-4 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))] text-center text-sm font-medium text-white">
      You&apos;re offline. Nothing can be saved until the connection is back.
    </div>
  );
}
