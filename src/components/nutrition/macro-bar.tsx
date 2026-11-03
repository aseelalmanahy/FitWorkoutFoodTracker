import { cx } from "@/components/ui";
import { fmtG, fmtKcal } from "@/lib/nutrition";

/** Consumed vs target. The bar is capped at 100 %; exceeding the target is shown explicitly. */
export function MacroBar({ label, consumed, target, unit = "g", incomplete, color = "bg-accent" }: {
  label: string; consumed: number; target: number | null; unit?: "g" | "kcal"; incomplete?: boolean; color?: string;
}) {
  const fmt = unit === "kcal" ? fmtKcal : fmtG;
  const ratio = target && target > 0 ? consumed / target : 0;
  const over = target != null && consumed > target;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="num text-muted">
          <span className={cx("font-semibold", over ? "text-down" : "text-fg")}>{fmt(consumed)}</span>
          {target != null && <> / {fmt(target)}</>} {unit}
          {incomplete && <span title="Some foods don't report this nutrient" className="ml-1 text-xs">*</span>}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={label} aria-valuenow={Math.round(consumed)} aria-valuemax={target ?? undefined}>
        <div className={cx("h-full rounded-full transition-[width]", over ? "bg-down" : color)} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      {over && <p className="num mt-1 text-xs text-down">{fmt(consumed - target!)} {unit} over target</p>}
    </div>
  );
}
