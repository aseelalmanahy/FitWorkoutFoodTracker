"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Button } from "@/components/ui";
import { chosenGym } from "./gym-picker";

type Source = { templateId: string } | { fromSessionId: string } | { name: string };

export function StartWorkoutButton({ source, children, variant = "primary", size = "md", className }: {
  source: Source;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      const { session } = await api<{ session: { id: string } }>("POST", "/api/sessions", { ...source, ...(chosenGym() ? { gymLocationId: chosenGym() } : {}) });
      router.push(`/workouts/session/${session.id}`);
    } catch (e) {
      const err = e as ApiError;
      const activeId = (err.details as { sessionId?: string } | undefined)?.sessionId;
      if (err.status === 409 && activeId) {
        if (confirm("You already have a workout in progress. Resume it?")) router.push(`/workouts/session/${activeId}`);
      } else alert(err.message);
      setBusy(false);
    }
  }

  return (
    <Button variant={variant} size={size} className={className} onClick={start} disabled={busy}>
      {busy ? "Starting…" : children}
    </Button>
  );
}
