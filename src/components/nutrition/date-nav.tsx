import Link from "next/link";
import { addDays, relativeDayLabel } from "@/lib/nutrition";

export function DateNav({ date, today, basePath, param = "date" }: { date: string; today: string; basePath: string; param?: string }) {
  const href = (d: string) => (d === today ? basePath : `${basePath}?${param}=${d}`);
  const next = addDays(date, 1);
  return (
    <nav aria-label="Date" className="flex items-center justify-between rounded-2xl bg-surface-2 p-1">
      <Link href={href(addDays(date, -1))} aria-label="Previous day" className="grid h-9 w-10 place-items-center rounded-xl text-lg hover:bg-surface">‹</Link>
      <span className="text-sm font-semibold">{relativeDayLabel(date, today)}</span>
      {next <= today ? (
        <Link href={href(next)} aria-label="Next day" className="grid h-9 w-10 place-items-center rounded-xl text-lg hover:bg-surface">›</Link>
      ) : (
        <span className="grid h-9 w-10 place-items-center text-lg text-muted/40" aria-hidden>›</span>
      )}
    </nav>
  );
}
