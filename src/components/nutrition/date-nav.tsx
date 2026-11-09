import Link from "next/link";
import { addDays, relativeDayLabel } from "@/lib/nutrition";
import { dayLabel } from "@/lib/nutrition-range";
import { DateJump } from "@/components/nutrition/date-picker";

/** UI-07: previous day | the day, which opens a calendar | next day, with a way back to today. */
export function DateNav({ date, today, basePath, param = "date" }: { date: string; today: string; basePath: string; param?: string }) {
  const href = (d: string) => (d === today ? basePath : `${basePath}?${param}=${d}`);
  const next = addDays(date, 1);
  const relative = relativeDayLabel(date, today);
  const label = relative === "Today" || relative === "Yesterday" ? `${relative} · ${dayLabel(date)}` : dayLabel(date);
  return (
    <div>
      <nav aria-label="Date" className="flex items-center justify-between gap-1 rounded-2xl bg-surface-2 p-1">
        <Link href={href(addDays(date, -1))} aria-label="Previous day" className="grid h-9 w-10 shrink-0 place-items-center rounded-xl text-lg hover:bg-surface">‹</Link>
        <DateJump date={date} today={today} label={label} longLabel={dayLabel(date)} />
        {next <= today ? (
          <Link href={href(next)} aria-label="Next day" className="grid h-9 w-10 shrink-0 place-items-center rounded-xl text-lg hover:bg-surface">›</Link>
        ) : (
          <span className="grid h-9 w-10 shrink-0 place-items-center text-lg text-muted/40" aria-hidden>›</span>
        )}
      </nav>
      {date !== today && <Link href={basePath} className="mt-1.5 inline-block text-xs font-medium text-accent-ink" data-testid="nutrition-today">Jump to today</Link>}
    </div>
  );
}
