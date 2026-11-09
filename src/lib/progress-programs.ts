import { compareToPrevious, summarizeSets, type ExerciseSummary, type OverloadStatus, type SetLike } from "./overload";
import { localParts } from "./time";

/**
 * UI-02: the Progress page's Training programs view. Completed workouts grouped by program, then month, then workout,
 * then exercise. A workout's program is its plan's CURRENT program (session → plan → program), so grouping or
 * ungrouping a plan moves its past workouts with it; the page says so. Workouts with no program (individual plans,
 * empty workouts, plans deleted since) go under one group, "Not in a program": nothing is grouped by guessing.
 *
 * Each exercise's status is the one Exercise progress uses (compareToPrevious over summarizeSets), comparing that
 * workout with the previous workout of the same exercise in the same context (a named machine, or none: WT-03),
 * across every program, so switching programs never resets anything to Baseline.
 */

export interface ProgressSessionInput {
  id: string;
  name: string;
  startedAt: Date;
  program: { id: string; name: string } | null;
  exercises: { exerciseId: string; name: string; gymEquipmentId: string | null; machineName: string | null; sets: SetLike[] }[];
}

export interface ProgressExerciseRow {
  exerciseId: string;
  name: string;
  gymEquipmentId: string | null;
  machineName: string | null;
  summary: ExerciseSummary;
  /** Null when this workout has no working sets of it: there's nothing to compare. */
  status: OverloadStatus | null;
}

export interface ProgressWorkout {
  sessionId: string;
  name: string;
  date: Date;
  exercises: ProgressExerciseRow[];
}

export interface ProgressMonth {
  /** "2026-11", in the person's time zone. */
  key: string;
  label: string;
  workouts: ProgressWorkout[];
}

export interface ProgressProgram {
  /** Null for "Not in a program". */
  id: string | null;
  name: string;
  workoutCount: number;
  lastDate: Date;
  months: ProgressMonth[];
}

export const NOT_IN_A_PROGRAM = "Not in a program";

const contextKey = (exerciseId: string, gymEquipmentId: string | null) => `${exerciseId}\u0000${gymEquipmentId ?? ""}`;

export function groupProgressByProgram(sessions: ProgressSessionInput[], timeZone: string): ProgressProgram[] {
  const ordered = [...sessions].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id.localeCompare(b.id));
  // The previous workout's summary of each exercise in each context, as the workouts are read oldest first.
  const previous = new Map<string, ExerciseSummary>();
  const workouts: { program: ProgressSessionInput["program"]; workout: ProgressWorkout }[] = [];
  for (const s of ordered) {
    // An exercise done twice in one workout, in the same context, is one row with all its sets (as Exercise progress).
    const rows = new Map<string, Omit<ProgressExerciseRow, "summary" | "status"> & { sets: SetLike[] }>();
    for (const e of s.exercises) {
      const key = contextKey(e.exerciseId, e.gymEquipmentId);
      const row = rows.get(key);
      if (row) row.sets.push(...e.sets);
      else rows.set(key, { exerciseId: e.exerciseId, name: e.name, gymEquipmentId: e.gymEquipmentId, machineName: e.machineName, sets: [...e.sets] });
    }
    const exercises: ProgressExerciseRow[] = [];
    for (const [key, { sets, ...row }] of rows) {
      const summary = summarizeSets(sets);
      const status = summary.workingSets > 0 ? compareToPrevious(previous.get(key) ?? null, summary).status : null;
      previous.set(key, summary);
      exercises.push({ ...row, summary, status });
    }
    workouts.push({ program: s.program, workout: { sessionId: s.id, name: s.name, date: s.startedAt, exercises } });
  }

  const monthLabel = new Intl.DateTimeFormat("en-US", { timeZone, month: "long", year: "numeric" });
  const programs = new Map<string, ProgressProgram>();
  for (const { program, workout } of workouts.reverse()) { // newest first
    const id = program?.id ?? "";
    const group = programs.get(id) ?? { id: program?.id ?? null, name: program?.name ?? NOT_IN_A_PROGRAM, workoutCount: 0, lastDate: workout.date, months: [] };
    programs.set(id, group);
    group.workoutCount++;
    const { year, month } = localParts(workout.date, timeZone);
    const key = `${year}-${String(month).padStart(2, "0")}`;
    let m = group.months.at(-1);
    if (m?.key !== key) group.months.push((m = { key, label: monthLabel.format(workout.date), workouts: [] }));
    m.workouts.push(workout);
  }
  // Programs by their latest workout; "Not in a program" always last.
  return [...programs.values()].sort((a, b) => (a.id === null ? 1 : 0) - (b.id === null ? 1 : 0) || b.lastDate.getTime() - a.lastDate.getTime());
}
