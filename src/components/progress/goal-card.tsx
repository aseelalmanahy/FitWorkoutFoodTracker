import Link from "next/link";
import { goalCardCopy, type GoalProgress } from "@/lib/goal-progress";
import type { UnitSystem } from "@/lib/units";
import { Card } from "@/components/ui";

/** The wording is in goalCardCopy, where it's tested. No colour here reads as good or bad. */
export function GoalCard({ progress, units }: { progress: GoalProgress; units: UnitSystem }) {
  const copy = goalCardCopy(progress, units);
  return (
    <Card className="p-5" aria-label="Goal progress">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{copy.title}</p>
      {copy.headline && <p className="num mt-1 text-xl font-bold">{copy.headline}</p>}
      {copy.detail && <p className="num mt-1 text-sm text-muted">{copy.detail}</p>}
      {copy.note && <p className="mt-1 text-xs text-muted">{copy.note}</p>}
      {copy.asOf && <p className="mt-1 text-xs text-muted">{copy.asOf}</p>}
      <Link href={copy.link.href} className="mt-2 inline-block text-sm font-medium text-accent-ink">{copy.link.label}</Link>
    </Card>
  );
}
