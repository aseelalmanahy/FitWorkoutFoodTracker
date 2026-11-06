import { formatMass, toDisplayMass, type UnitSystem } from "./units";
import type { TrendPoint } from "./weight-trend";

export type WeightGoal = "FAT_LOSS" | "MUSCLE_GAIN";
export type Goal = WeightGoal | "MAINTENANCE" | "STRENGTH";

/**
 * What the dashboard's goal card can honestly say. Fat loss or muscle gain: trend against goal weight. Strength: recent
 * records. Maintenance: distance from the first logged weight. It predicts no date, gives no percentage, sets no
 * threshold, and doesn't judge a goal: whether a goal is safe is for reviewed safeguards (R-03, Decision 23).
 */
export type GoalProgress =
  | { kind: "choose-goal" }
  | { kind: "strength"; recentRecords: number }
  | { kind: "log-weight"; goal: Goal }
  | { kind: "set-goal-weight"; goal: WeightGoal; trendKg: number }
  | { kind: "weight-goal"; goal: WeightGoal; trendKg: number; goalKg: number; differenceKg: number }
  | { kind: "maintenance"; startKg: number; trendKg: number; differenceKg: number };

export function goalProgress({ goal, goalWeightKg, trend, recentRecords }: { goal: Goal | null; goalWeightKg: number | null; trend: TrendPoint[]; recentRecords: number }): GoalProgress {
  if (!goal) return { kind: "choose-goal" };
  if (goal === "STRENGTH") return { kind: "strength", recentRecords };
  const latest = trend.at(-1);
  if (!latest) return { kind: "log-weight", goal };
  if (goal === "MAINTENANCE") {
    if (trend.length < 2) return { kind: "log-weight", goal };
    return { kind: "maintenance", startKg: trend[0].weightKg, trendKg: latest.trendKg, differenceKg: latest.trendKg - trend[0].weightKg };
  }
  if (goalWeightKg === null) return { kind: "set-goal-weight", goal, trendKg: latest.trendKg };
  return { kind: "weight-goal", goal, trendKg: latest.trendKg, goalKg: goalWeightKg, differenceKg: latest.trendKg - goalWeightKg };
}

export interface GoalCardCopy { title: string; headline?: string; detail?: string; note?: string; link: { href: string; label: string } }

const GOAL_NAMES: Record<Goal, string> = { FAT_LOSS: "Fat loss", MUSCLE_GAIN: "Muscle gain", MAINTENANCE: "Maintenance", STRENGTH: "Strength" };
const WEIGHT_LOG = { href: "/progress/weight", label: "Weight log" };

/** Stated plainly: no praise or warning, and being level with a number isn't treated as reaching anything. */
function difference(kg: number, units: UnitSystem, from: string): string {
  if (toDisplayMass(Math.abs(kg), units) === 0) return `About level with ${from}`;
  return `About ${formatMass(Math.abs(kg), units)} ${kg > 0 ? "above" : "below"} ${from}`;
}

export function goalCardCopy(progress: GoalProgress, units: UnitSystem): GoalCardCopy {
  switch (progress.kind) {
    case "choose-goal":
      return { title: "Your goal", detail: "Choosing a goal is optional, and shows your progress here.", link: { href: "/profile", label: "Choose a goal" } };
    case "strength":
      return {
        title: GOAL_NAMES.STRENGTH,
        headline: progress.recentRecords === 0 ? "No new records" : `${progress.recentRecords} new record${progress.recentRecords === 1 ? "" : "s"}`,
        detail: "In the last 30 days",
        link: { href: "/progress", label: "Progress" },
      };
    case "log-weight":
      return {
        title: GOAL_NAMES[progress.goal],
        detail: progress.goal === "MAINTENANCE" ? "Log your weight on a couple of days to see how it's holding. It's optional." : "Log your weight to see your trend here. It's optional.",
        link: WEIGHT_LOG,
      };
    case "set-goal-weight":
      return { title: GOAL_NAMES[progress.goal], headline: `Trend ${formatMass(progress.trendKg, units)}`, link: { href: "/profile", label: "Add a goal weight" } };
    case "weight-goal":
      return {
        title: GOAL_NAMES[progress.goal],
        headline: `Trend ${formatMass(progress.trendKg, units)}`,
        detail: difference(progress.differenceKg, units, `your goal weight of ${formatMass(progress.goalKg, units)}`),
        note: progress.goal === "MUSCLE_GAIN" ? "Weight alone doesn't show muscle. Your training progress does." : undefined,
        link: WEIGHT_LOG,
      };
    case "maintenance":
      return {
        title: GOAL_NAMES.MAINTENANCE,
        headline: `Trend ${formatMass(progress.trendKg, units)}`,
        detail: difference(progress.differenceKg, units, `your first logged weight of ${formatMass(progress.startKg, units)}`),
        link: WEIGHT_LOG,
      };
  }
}
