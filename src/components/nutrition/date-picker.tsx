"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { rangeProblem } from "@/lib/nutrition-range";
import { Button } from "@/components/ui";

/**
 * UI-07 and UI-08: the calendar behind the middle of a date bar. It's a dialog with the browser's own date field, which
 * opens the device's calendar on phones and is fully keyboard- and screen-reader-accessible; Escape closes it and
 * focus returns to the button that opened it.
 */
function CalendarDialog({ label, title, testId, children }: { label: ReactNode; title: string; testId: string; children: (close: () => void) => ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={title} data-testid={testId}
        className="flex min-w-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold hover:bg-surface focus-visible:outline-2 focus-visible:outline-ring">
        <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-muted"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></svg>
        <span className="truncate">{label}</span>
      </button>
      <dialog ref={ref} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); setOpen(false); }} onClose={() => setOpen(false)}
        className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-fg shadow-xl backdrop:bg-black/40">
        {open && <div className="space-y-3 p-5"><h2 id={titleId} className="text-lg font-bold">{title.replace(/, currently .*/, "")}</h2>{children(() => setOpen(false))}</div>}
      </dialog>
    </>
  );
}

const dateInput = "w-full rounded-xl border border-line-strong bg-surface-2 px-3 py-2 text-[15px] text-fg";

/** UI-07: choose any day up to today for the Nutrition page. */
export function DateJump({ date, today, label, longLabel }: { date: string; today: string; label: string; longLabel: string }) {
  const router = useRouter();
  const [value, setValue] = useState(date);
  const go = (d: string) => router.push(d === today ? "/nutrition" : `/nutrition?date=${d}`);
  return (
    <CalendarDialog label={label} title={`Choose date, currently ${longLabel}`} testId="nutrition-date-picker">
      {(close) => (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (value && value <= today) { close(); go(value); } }}>
          <label className="block text-sm font-medium">Date
            <input type="date" className={`mt-1 ${dateInput}`} value={value} max={today} required onChange={(e) => setValue(e.target.value)} data-testid="nutrition-date-input" />
          </label>
          {value > today && <p role="alert" className="text-sm font-medium text-fg">Choose today or an earlier day.</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="button" variant="secondary" onClick={() => { close(); go(today); }}>Today</Button>
            <Button type="submit" disabled={!value || value > today} data-testid="nutrition-date-go">Show this day</Button>
          </div>
        </form>
      )}
    </CalendarDialog>
  );
}

/** UI-08: choose a custom start and end date for Nutrition history, or return to this week. */
export function RangeJump({ from, to, today, label }: { from: string; to: string; today: string; label: string }) {
  const router = useRouter();
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to > today ? today : to);
  const problem = rangeProblem(start || undefined, end || undefined, today);
  return (
    <CalendarDialog label={label} title={`Choose dates, currently ${label}`} testId="history-range-picker">
      {(close) => (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!problem) { close(); router.push(`/nutrition/history?from=${start}&to=${end}`); } }}>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm font-medium">Start
              <input type="date" className={`mt-1 ${dateInput}`} value={start} max={today} required onChange={(e) => setStart(e.target.value)} data-testid="history-range-from" />
            </label>
            <label className="block text-sm font-medium">End
              <input type="date" className={`mt-1 ${dateInput}`} value={end} max={today} required onChange={(e) => setEnd(e.target.value)} data-testid="history-range-to" />
            </label>
          </div>
          {problem && <p role="alert" className="text-sm font-medium text-fg" data-testid="history-range-error">{problem}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="button" variant="secondary" onClick={() => { close(); router.push("/nutrition/history"); }}>This week</Button>
            <Button type="submit" disabled={!!problem} data-testid="history-range-apply">Apply</Button>
          </div>
        </form>
      )}
    </CalendarDialog>
  );
}
