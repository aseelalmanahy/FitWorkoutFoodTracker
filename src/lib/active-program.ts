/**
 * UI-06: pure rules for making a training program the active one. The server module uses these; they're kept here,
 * without the database, so they can be tested exactly.
 */

/** Suggested weekdays (0 = Monday) for a program of n days, when none of its days is on the schedule yet. Editable. */
export function defaultSpread(n: number): number[] {
  const spreads: Record<number, number[]> = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };
  return spreads[Math.min(Math.max(n, 0), 7)] ?? [];
}

export interface SlotLike { weekday: number; position: number; templateId: string }

/** A stable fingerprint of the whole schedule, so activation can refuse a preview that's no longer current. */
export function scheduleVersion(slots: SlotLike[]): string {
  const key = [...slots].sort((a, b) => a.weekday - b.weekday || a.position - b.position || a.templateId.localeCompare(b.templateId))
    .map((s) => `${s.weekday}:${s.position}:${s.templateId}`).join("|");
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return `${slots.length}-${h.toString(36)}`;
}

/**
 * The proposal, for each program day in order: the weekdays it's on now, if it's already scheduled (an existing
 * arrangement is kept); otherwise one free weekday, its place in the default spread if that's free, or else the next
 * free one in the spread, then the rest of the week. Days beyond seven, or with no free weekday, get none: the person
 * can add one.
 */
export function proposeWeekdays(dayIds: string[], slots: SlotLike[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const used = new Set<number>();
  for (const id of dayIds) {
    out[id] = [...new Set(slots.filter((s) => s.templateId === id).map((s) => s.weekday))].sort();
    out[id].forEach((d) => used.add(d));
  }
  const spread = defaultSpread(dayIds.length);
  const order = [...spread, ...[0, 1, 2, 3, 4, 5, 6].filter((d) => !spread.includes(d))];
  dayIds.forEach((id, i) => {
    if (out[id].length || i >= 7) return;
    const d = i < spread.length && !used.has(spread[i]) ? spread[i] : order.find((x) => !used.has(x));
    if (d !== undefined) { out[id] = [d]; used.add(d); }
  });
  return out;
}

export const MAX_PER_DAY = 3;

/** The new week from the chosen weekdays, in program order within each day. Throws a message if a day holds too many. */
export function buildWeek(dayIds: string[], chosen: Record<string, number[]>): string[][] {
  const week: string[][] = Array.from({ length: 7 }, () => []);
  for (const id of dayIds) for (const d of new Set(chosen[id] ?? [])) {
    if (!Number.isInteger(d) || d < 0 || d > 6) throw new Error("A weekday is out of range.");
    week[d].push(id);
  }
  const full = week.findIndex((d) => d.length > MAX_PER_DAY);
  if (full >= 0) throw new Error(`A day can hold at most ${MAX_PER_DAY} workouts.`);
  return week;
}

/** What changes: assignments that go (with their weekday), and those that are added, compared with today's slots. */
export function scheduleChanges(slots: SlotLike[], week: string[][]) {
  const before = new Set(slots.map((s) => `${s.weekday}:${s.templateId}`));
  const after = new Set(week.flatMap((ids, d) => ids.map((id) => `${d}:${id}`)));
  const removed = slots.filter((s) => !after.has(`${s.weekday}:${s.templateId}`)).map((s) => ({ weekday: s.weekday, templateId: s.templateId }));
  const added = week.flatMap((ids, d) => ids.filter((id) => !before.has(`${d}:${id}`)).map((id) => ({ weekday: d, templateId: id })));
  return { removed, added };
}

export interface ScheduledLike { templateId: string; template: { id: string; name: string; programId: string | null; program?: { name: string } | null } }
export interface ScheduleException { templateId: string; name: string; programName: string | null; weekdays: number[] }

/**
 * UI-06B: the workouts on the weekly schedule that aren't in the active program: kept, never removed by themselves,
 * and shown as exceptions until the person removes them from the schedule or adds them to the program. Worked out
 * from the schedule each time, never stored. None without an active program.
 */
export function scheduleExceptions(days: ScheduledLike[][], activeProgramId: string | null): ScheduleException[] {
  if (!activeProgramId) return [];
  const out = new Map<string, ScheduleException>();
  days.forEach((slots, weekday) => {
    for (const s of slots) {
      if (s.template.programId === activeProgramId) continue;
      const e = out.get(s.templateId) ?? { templateId: s.templateId, name: s.template.name, programName: s.template.program?.name ?? null, weekdays: [] };
      if (!e.weekdays.includes(weekday)) e.weekdays.push(weekday);
      out.set(s.templateId, e);
    }
  });
  return [...out.values()].sort((a, b) => a.weekdays[0] - b.weekdays[0]);
}
