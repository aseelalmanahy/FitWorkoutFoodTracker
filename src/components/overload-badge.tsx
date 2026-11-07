import type { OverloadStatus } from "@/lib/overload";
import { cx } from "./ui";

const STYLES: Record<OverloadStatus, { label: string; cls: string; icon: string }> = {
  improved: { label: "Improved", cls: "bg-up/12 text-up", icon: "▲" },
  matched: { label: "Matched", cls: "bg-accent-soft text-accent-ink", icon: "=" },
  decreased: { label: "Down", cls: "bg-down/12 text-down", icon: "▼" },
  mixed: { label: "Mixed", cls: "bg-surface-2 text-muted", icon: "≈" },
  first: { label: "Baseline", cls: "bg-surface-2 text-muted", icon: "•" },
};

export function OverloadBadge({ status, className }: { status: OverloadStatus; className?: string }) {
  const s = STYLES[status];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", s.cls, className)}>
      <span aria-hidden className="text-[10px]">{s.icon}</span>
      {s.label}
    </span>
  );
}

export function PrBadge({ label = "PR" }: { label?: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold tracking-wide text-accent-fg">{label}</span>
  );
}
