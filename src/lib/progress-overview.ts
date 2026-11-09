import type { SessionPerformance, SetLike } from "./overload";

/**
 * WT-03: one row of the Progress list per exercise, counting every completed session of it, on any machine or none.
 * Comparisons stay within one context (a named machine, or no specific machine), because different machines
 * aren't mechanically equivalent: the list's latest result and its status come from the context of the most recent
 * session, compared only with that context's previous session. Nothing is added up across contexts.
 */
export interface ExerciseSessionRow {
  exerciseId: string;
  /** The named machine the sets were on, or null for no specific machine. */
  gymEquipmentId: string | null;
  sessionId: string;
  date: Date;
  sets: SetLike[];
}

export interface ExerciseOverview {
  /** Distinct completed sessions of the exercise, in every context. */
  sessions: number;
  /** The context of the most recent session: link to it, and compare within it. */
  latestContext: string | null;
  /** That context's sessions, oldest first. */
  history: SessionPerformance[];
}

export function overviewByExercise(rows: ExerciseSessionRow[]): Map<string, ExerciseOverview> {
  const byExercise = new Map<string, { sessions: Set<string>; contexts: Map<string, Map<string, SessionPerformance>>; latest: { date: number; context: string | null } | null }>();
  for (const r of rows) {
    const e = byExercise.get(r.exerciseId) ?? { sessions: new Set<string>(), contexts: new Map(), latest: null };
    byExercise.set(r.exerciseId, e);
    e.sessions.add(r.sessionId);
    const key = r.gymEquipmentId ?? "";
    const ctx = e.contexts.get(key) ?? new Map<string, SessionPerformance>();
    e.contexts.set(key, ctx);
    const s = ctx.get(r.sessionId);
    if (s) s.sets.push(...r.sets);
    else ctx.set(r.sessionId, { sessionId: r.sessionId, date: r.date, sets: [...r.sets] });
    if (!e.latest || r.date.getTime() > e.latest.date) e.latest = { date: r.date.getTime(), context: r.gymEquipmentId };
  }
  const out = new Map<string, ExerciseOverview>();
  for (const [id, e] of byExercise) {
    const context = e.latest?.context ?? null;
    const history = [...(e.contexts.get(context ?? "")?.values() ?? [])].sort((a, b) => a.date.getTime() - b.date.getTime());
    out.set(id, { sessions: e.sessions.size, latestContext: context, history });
  }
  return out;
}
