/**
 * WT-04: what a swapped-in exercise is asked to do. It keeps the plan's sets and reps for the exercise it replaced,
 * which describe the workout's shape, but never its weight: a load is set for one exercise and means nothing for
 * another (a Pull-Up isn't "45 kg" because the Lat Pulldown was). Pure, shared by the server page and the logger.
 */
export interface PlanTarget {
  sets: number;
  repsMin: number;
  repsMax: number;
  weightKg: number | null;
}

export function targetForExercise<T extends PlanTarget>(target: T | null, { swappedIn }: { swappedIn: boolean }): T | null {
  if (!target) return null;
  return swappedIn ? { ...target, weightKg: null } : target;
}
