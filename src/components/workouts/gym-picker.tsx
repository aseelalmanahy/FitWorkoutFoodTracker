"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Multi-gym: the gym for the next workout, chosen before starting. Remembered in this browser only, as a convenience;
 * a remembered gym that isn't one of this person's (another account on the same browser) is ignored. It can be changed
 * during the workout too.
 */
const KEY = "fit.nextGym";
let chosen: string | null = null;

/** The gym the next workout starts at, if one was chosen on this page; read by StartWorkoutButton. */
export const chosenGym = () => chosen;

export function GymPicker({ gyms }: { gyms: { id: string; name: string }[] }) {
  const [value, setValue] = useState("");

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* storage unavailable: nothing remembered */ }
    const valid = saved && gyms.some((g) => g.id === saved) ? saved : "";
    chosen = valid || null;
    setValue(valid);
    return () => { chosen = null; };
  }, [gyms]);

  function choose(id: string) {
    setValue(id);
    chosen = id || null;
    try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* not remembered */ }
  }

  if (!gyms.length) {
    return <p className="mb-3 text-sm text-muted">Train at more than one gym? <Link href="/workouts/gyms" className="font-medium text-accent-ink">Add your gyms</Link> to keep each one&apos;s machines apart.</p>;
  }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor="start-gym" className="text-muted">Training at</label>
      <select id="start-gym" className="h-9 rounded-lg border border-line bg-surface px-2" value={value} onChange={(e) => choose(e.target.value)} data-testid="start-gym">
        <option value="">No gym chosen</option>
        {gyms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      <Link href="/workouts/gyms" className="font-medium text-accent-ink" data-testid="gyms-link">Gyms</Link>
    </div>
  );
}
