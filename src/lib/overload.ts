/**
 * Progressive-overload analysis. Pure functions — no I/O.
 *
 * Definitions
 *  - Working set: any set not flagged as warm-up.
 *  - Volume load: Σ (load × reps) over working sets (Haff, Strength Cond J 2010).
 *    For unloaded bodyweight movements load = 0, so total reps is used instead.
 *  - Estimated 1RM: Epley, 1RM = w·(1 + r/30). Only computed for 1–12 reps;
 *    prediction error grows with rep count (LeSuer et al., JSCR 1997).
 */

export interface SetLike {
  reps: number;
  weightKg: number;
  isWarmup?: boolean;
}

export interface ExerciseSummary {
  workingSets: number;
  totalReps: number;
  topWeightKg: number;
  repsAtTopWeight: number;
  volumeKg: number;
  bestE1rmKg: number | null;
  bestSetReps: number;
}

const EPS = 1e-6;
export const E1RM_MAX_REPS = 12;

export function epley1rm(weightKg: number, reps: number): number | null {
  if (reps < 1 || reps > E1RM_MAX_REPS || weightKg <= 0) return null;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

export function summarizeSets(sets: SetLike[]): ExerciseSummary {
  const working = sets.filter((s) => !s.isWarmup && s.reps > 0);
  let topWeightKg = 0;
  let repsAtTopWeight = 0;
  let volumeKg = 0;
  let totalReps = 0;
  let bestE1rmKg: number | null = null;
  let bestSetReps = 0;
  for (const s of working) {
    totalReps += s.reps;
    volumeKg += s.weightKg * s.reps;
    bestSetReps = Math.max(bestSetReps, s.reps);
    if (s.weightKg > topWeightKg + EPS) {
      topWeightKg = s.weightKg;
      repsAtTopWeight = s.reps;
    } else if (Math.abs(s.weightKg - topWeightKg) <= EPS) {
      repsAtTopWeight = Math.max(repsAtTopWeight, s.reps);
    }
    const e = epley1rm(s.weightKg, s.reps);
    if (e !== null && (bestE1rmKg === null || e > bestE1rmKg)) bestE1rmKg = e;
  }
  return { workingSets: working.length, totalReps, topWeightKg, repsAtTopWeight, volumeKg, bestE1rmKg, bestSetReps };
}

export type Trend = "up" | "same" | "down";
export type OverloadStatus = "first" | "improved" | "matched" | "decreased" | "mixed";

export interface OverloadComparison {
  status: OverloadStatus;
  weight: Trend;
  /** Reps at the top weight; only meaningful when the top weight is unchanged. */
  reps: Trend | null;
  volume: Trend;
  sets: Trend;
  deltas: { weightKg: number; reps: number | null; volumeKg: number; sets: number; totalReps: number };
  headline: string;
}

const trend = (curr: number, prev: number): Trend =>
  curr > prev + EPS ? "up" : curr < prev - EPS ? "down" : "same";

/**
 * Compare a current performance against the previous one for the same exercise.
 * Decision order mirrors how lifters evaluate progression: load first, then
 * reps at that load, then total work.
 */
export function compareToPrevious(prev: ExerciseSummary | null, curr: ExerciseSummary): OverloadComparison {
  if (!prev || prev.workingSets === 0) {
    return {
      status: "first",
      weight: "same",
      reps: null,
      volume: "same",
      sets: "same",
      deltas: { weightKg: 0, reps: null, volumeKg: 0, sets: 0, totalReps: 0 },
      headline: "First logged session — baseline set.",
    };
  }

  const bodyweight = prev.topWeightKg <= EPS && curr.topWeightKg <= EPS;
  const weight = trend(curr.topWeightKg, prev.topWeightKg);
  const sameWeight = weight === "same";
  const reps = sameWeight ? trend(curr.repsAtTopWeight, prev.repsAtTopWeight) : null;
  // For bodyweight movements "volume" is total reps.
  const volume = bodyweight ? trend(curr.totalReps, prev.totalReps) : trend(curr.volumeKg, prev.volumeKg);
  const sets = trend(curr.workingSets, prev.workingSets);

  let status: OverloadStatus;
  let headline: string;
  if (weight === "up") {
    status = "improved";
    headline = "Weight increased.";
  } else if (weight === "down") {
    status = volume === "up" ? "mixed" : "decreased";
    headline = volume === "up" ? "Less weight, but more total volume." : "Weight decreased.";
  } else if (reps === "up") {
    status = "improved";
    headline = "More reps at the same weight.";
  } else if (reps === "down") {
    status = volume === "up" ? "mixed" : "decreased";
    headline = volume === "up" ? "Fewer reps on the top set, but more total volume." : "Fewer reps at the same weight.";
  } else if (volume === "up") {
    status = "improved";
    headline = bodyweight ? "More total reps." : "Total volume increased.";
  } else if (volume === "down") {
    status = "decreased";
    headline = bodyweight ? "Fewer total reps." : "Total volume decreased.";
  } else {
    status = "matched";
    headline = "Matched previous performance.";
  }

  return {
    status,
    weight,
    reps,
    volume,
    sets,
    deltas: {
      weightKg: curr.topWeightKg - prev.topWeightKg,
      reps: sameWeight ? curr.repsAtTopWeight - prev.repsAtTopWeight : null,
      volumeKg: curr.volumeKg - prev.volumeKg,
      sets: curr.workingSets - prev.workingSets,
      totalReps: curr.totalReps - prev.totalReps,
    },
    headline,
  };
}

// ─── Personal records ───────────────────────────────────────────────────────

export interface SessionPerformance {
  sessionId: string;
  date: Date;
  sets: SetLike[];
}

export type RecordKind = "heaviestWeight" | "bestE1rm" | "mostReps" | "bestVolume";

export const RECORD_LABELS: Record<RecordKind, string> = {
  heaviestWeight: "Heaviest weight",
  bestE1rm: "Best est. 1RM",
  mostReps: "Most reps in a set",
  bestVolume: "Best session volume",
};

export interface RecordValue {
  value: number;
  sessionId: string;
  date: Date;
}

export interface RecordHistory {
  current: Partial<Record<RecordKind, RecordValue>>;
  /** sessionId → record kinds that were set (strictly beaten) in that session. */
  prsBySession: Map<string, RecordKind[]>;
}

/**
 * Walk sessions chronologically and track all-time bests. A record counts as
 * a PR only when it strictly exceeds every earlier session; the very first
 * session establishes a baseline and is not flagged.
 */
export function computeRecords(history: SessionPerformance[]): RecordHistory {
  const sorted = [...history].sort((a, b) => a.date.getTime() - b.date.getTime());
  const current: Partial<Record<RecordKind, RecordValue>> = {};
  const prsBySession = new Map<string, RecordKind[]>();

  for (const s of sorted) {
    const sum = summarizeSets(s.sets);
    if (sum.workingSets === 0) continue;
    const candidates: [RecordKind, number | null][] = [
      ["heaviestWeight", sum.topWeightKg > 0 ? sum.topWeightKg : null],
      ["bestE1rm", sum.bestE1rmKg],
      ["mostReps", sum.bestSetReps],
      ["bestVolume", sum.volumeKg > 0 ? sum.volumeKg : null],
    ];
    const set: RecordKind[] = [];
    for (const [kind, value] of candidates) {
      if (value === null) continue;
      const prev = current[kind];
      if (!prev || value > prev.value + EPS) {
        if (prev) set.push(kind);
        current[kind] = { value, sessionId: s.sessionId, date: s.date };
      }
    }
    if (set.length) prsBySession.set(s.sessionId, set);
  }
  return { current, prsBySession };
}
