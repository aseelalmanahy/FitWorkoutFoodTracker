import Link from "next/link";
import type { ScheduleException } from "@/lib/active-program";
import { WEEKDAYS_SHORT } from "@/lib/time";

/**
 * UI-06B: one short notice, used on Workouts and Today, for scheduled workouts outside the active program. They are
 * exceptions: kept on the schedule, never removed or hidden by themselves. Resolving them happens on the active
 * program's page (add it to the program) or the weekly schedule (remove it there).
 */
export function ScheduleExceptionsNotice({ exceptions, program, compact = false }: { exceptions: ScheduleException[]; program: { id: string; name: string }; compact?: boolean }) {
  if (exceptions.length === 0) return null;
  const list = exceptions.map((x) => `${x.name} (${x.weekdays.map((d) => WEEKDAYS_SHORT[d]).join(", ")})`).join(", ");
  return (
    <div className="mt-2 rounded-xl border border-line bg-surface-2/50 px-3 py-2.5 text-sm" data-testid="schedule-exceptions">
      <p>
        <span className="font-semibold">{exceptions.length === 1 ? "1 exception" : `${exceptions.length} exceptions`}</span>
        {" "}on your schedule {exceptions.length === 1 ? "isn't" : "aren't"} in <strong>{program.name}</strong>: {list}.
      </p>
      {!compact && <p className="mt-0.5 text-xs text-muted">They stay scheduled until you add them to the program or remove them from the schedule. Nothing changes by itself.</p>}
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        <Link href={`/workouts/programs/${program.id}#exceptions-title`} className="inline-flex min-h-11 items-center font-medium text-accent-ink underline-offset-2 hover:underline" data-testid="exceptions-resolve">Resolve on the program page</Link>
        <Link href="/workouts/schedule" className="inline-flex min-h-11 items-center font-medium text-accent-ink underline-offset-2 hover:underline">Weekly schedule</Link>
      </p>
    </div>
  );
}
