"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui";

export function DeleteSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="ghost" className="w-full text-down" disabled={busy} onClick={async () => {
      if (!confirm("Delete this workout permanently?")) return;
      setBusy(true);
      try {
        await api("DELETE", `/api/sessions/${sessionId}`);
        router.replace("/workouts/history");
        router.refresh();
      } catch (e) {
        alert((e as Error).message);
        setBusy(false);
      }
    }}>Delete workout</Button>
  );
}
