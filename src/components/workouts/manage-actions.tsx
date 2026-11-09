"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Button } from "@/components/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";

const listDays = (days: string[]) => (days.length <= 1 ? days.join("") : `${days.slice(0, -1).join(", ")} and ${days.at(-1)}`);

function useAction(after: string | null) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(method: "DELETE", url: string) {
    setBusy(true); setError(null);
    try {
      await api(method, url);
      setOpen(false);
      if (after) router.replace(after);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That couldn't be done. Try again.");
    } finally { setBusy(false); }
  }
  return { open, setOpen, busy, error, setError, run };
}

/**
 * UI-05: delete one workout plan. Says what goes (the plan, and its places on the schedule) and what stays (every
 * logged workout from it; a workout in progress carries on). The server keeps history: sessions lose only their link.
 */
export function DeletePlanButton({ id, name, scheduledDays, workouts, inProgress, after = null, size = "sm", label = "Delete" }: {
  id: string; name: string; scheduledDays: string[]; workouts: number; inProgress: boolean; after?: string | null; size?: "sm" | "md"; label?: string;
}) {
  const a = useAction(after);
  return (
    <>
      <Button variant="ghost" size={size} className="text-down" onClick={() => { a.setError(null); a.setOpen(true); }} aria-label={`Delete ${name}`} data-testid="plan-delete">{label}</Button>
      <ConfirmDialog open={a.open} title={`Delete “${name}”?`} confirmLabel="Delete plan" busy={a.busy} error={a.error} testId="plan-delete-dialog"
        onCancel={() => a.setOpen(false)} onConfirm={() => a.run("DELETE", `/api/templates/${id}`)}>
        <p>The plan and its exercise list are deleted.</p>
        <p>{scheduledDays.length ? <>It&apos;s on your weekly schedule on <strong className="text-fg">{listDays(scheduledDays)}</strong>; {scheduledDays.length === 1 ? "that day loses it" : "those days lose it"}. Nothing else on the schedule changes.</> : "It isn't on your weekly schedule."}</p>
        <p>{workouts ? `Your ${workouts} logged workout${workouts === 1 ? "" : "s"} from it stay in History and Progress.` : "No workouts have been logged from it."}</p>
        {inProgress && <p className="text-fg">A workout from this plan is in progress. It carries on, with every set you log.</p>}
      </ConfirmDialog>
    </>
  );
}

/**
 * UI-05: delete a training program. Only the grouping goes: its plans stay, as individual plans, with their schedule
 * places and history (the same as ungrouping).
 */
export function DeleteProgramButton({ id, name, plans, active, after = null, size = "sm" }: {
  id: string; name: string; plans: number; active: boolean; after?: string | null; size?: "sm" | "md";
}) {
  const a = useAction(after);
  return (
    <>
      <Button variant="ghost" size={size} className="text-down" onClick={() => { a.setError(null); a.setOpen(true); }} aria-label={`Delete program ${name}`} data-testid="program-delete">Delete</Button>
      <ConfirmDialog open={a.open} title={`Delete the program “${name}”?`} confirmLabel="Delete program" busy={a.busy} error={a.error} testId="program-delete-dialog"
        onCancel={() => a.setOpen(false)} onConfirm={() => a.run("DELETE", `/api/programs/${id}`)}>
        <p>Only the program is deleted. Its {plans} workout plan{plans === 1 ? "" : "s"} stay, as individual plans, with their exercises, their places on your schedule and all their logged workouts.</p>
        {active && <p className="text-fg">It&apos;s your active program. You&apos;ll have no active program until you choose one; your weekly schedule stays as it is.</p>}
      </ConfirmDialog>
    </>
  );
}
