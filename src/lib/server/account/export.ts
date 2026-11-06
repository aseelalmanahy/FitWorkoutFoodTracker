import "server-only";
import { Prisma } from "@prisma/client";
import { HttpError } from "../api";
import { prisma } from "../db";
import dataMap from "@/lib/account-data-map.json";

type Row = Record<string, unknown>;
type Model = keyof typeof dataMap;

export const EXPORT_FORMAT = "fitworkoutfoodtracker-export";
export const EXPORT_VERSION = 1;
/** Judgement, not measurement: far beyond years of real use, and a bound on what one request can load. */
export const MAX_EXPORT_ROWS = 250_000;
export const MAX_EXPORT_BYTES = 128 * 1024 * 1024;
const MAX_CONCURRENT_EXPORTS = 2;

const DATE_ONLY = new Set(["birthDate", "date", "effectiveFrom"]);
const TOO_LARGE = "This account has too much data to export in one file. Contact support.";

/** Only fields named in the map can leave the database, so a new column can't be exported by accident. */
const fields = (model: Model) => Object.fromEntries(dataMap[model].export.map((f) => [f, true])) as Record<string, true>;

/** Null stays null, and zero stays zero. Decimals become numbers, and dates are stated in UTC. */
export function exportValue(field: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Prisma.Decimal.isDecimal(value)) return Number(value);
  if (value instanceof Date) return DATE_ONLY.has(field) ? value.toISOString().slice(0, 10) : value.toISOString();
  return value;
}

/** Every mapped field is present, so a missing value reads as null and never as an absent key. */
export function exportRow(model: Model, row: Row): Row {
  return Object.fromEntries(dataMap[model].export.map((f) => [f, exportValue(f, row[f])]));
}

/** A reference to an exercise or food: the person's own or a shared one, and never another person's. */
const visibleOwner = (ownerId: unknown, userId: string) => ownerId === null || ownerId === userId;

function exerciseRef(exercise: Row, userId: string): Row | null {
  if (!visibleOwner(exercise.userId, userId)) return null;
  return { name: exercise.name, primaryMuscle: exercise.primaryMuscle, equipment: exercise.equipment, builtIn: exercise.userId === null };
}

const refFields = { name: true, primaryMuscle: true, equipment: true, userId: true };

/** Plain facts from completed sessions. A summary only: the sessions above it are the record. */
function progressFrom(sessions: Row[]): Row[] {
  const byExercise = new Map<string, { name: unknown; sessions: Set<string>; workingSets: number; heaviest: number | null; first: string; last: string }>();
  for (const session of sessions) {
    if (session.status !== "COMPLETED") continue;
    const at = session.startedAt as string;
    for (const e of session.exercises as Row[]) {
      for (const set of e.sets as Row[]) {
        if (set.isWarmup || (set.reps as number) <= 0) continue;
        const key = e.exerciseId as string;
        const p = byExercise.get(key) ?? { name: (e.exercise as Row | null)?.name ?? null, sessions: new Set(), workingSets: 0, heaviest: null, first: at, last: at };
        p.sessions.add(session.id as string);
        p.workingSets++;
        p.heaviest = Math.max(p.heaviest ?? 0, set.weightKg as number);
        if (at < p.first) p.first = at;
        if (at > p.last) p.last = at;
        byExercise.set(key, p);
      }
    }
  }
  return [...byExercise].map(([exerciseId, p]) => ({
    exerciseId, exerciseName: p.name, completedSessions: p.sessions.size, workingSets: p.workingSets, heaviestWorkingSetKg: p.heaviest, firstPerformedAt: p.first, lastPerformedAt: p.last,
  }));
}

/**
 * One consistent view of the person's data, or a refusal. It's counted first, inside the same snapshot,
 * so the reads that follow are bounded. A deletion that commits during this can't produce a partial file.
 */
export async function buildExport(userId: string, now = new Date()): Promise<Row> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: fields("User") }) as Row | null;
    if (!user) throw new HttpError(401, "Not authenticated");

    const counts = await Promise.all([
      tx.exercise.count({ where: { userId } }),
      tx.workoutTemplate.count({ where: { userId } }),
      tx.templateExercise.count({ where: { template: { userId } } }),
      tx.scheduleSlot.count({ where: { userId } }),
      tx.workoutSession.count({ where: { userId } }),
      tx.sessionExercise.count({ where: { session: { userId } } }),
      tx.setEntry.count({ where: { sessionExercise: { session: { userId } } } }),
      tx.food.count({ where: { userId } }),
      tx.foodServing.count({ where: { food: { userId } } }),
      tx.foodEntry.count({ where: { userId } }),
      tx.nutritionTarget.count({ where: { userId } }),
    ]);
    if (counts.reduce((a, b) => a + b, 0) > MAX_EXPORT_ROWS) throw new HttpError(413, TOO_LARGE);

    const profile = await tx.profile.findUnique({ where: { userId }, select: fields("Profile") }) as Row | null;
    const exercises = await tx.exercise.findMany({ where: { userId }, select: fields("Exercise"), orderBy: { createdAt: "asc" } }) as Row[];
    const templates = await tx.workoutTemplate.findMany({
      where: { userId },
      select: { ...fields("WorkoutTemplate"), exercises: { select: { ...fields("TemplateExercise"), exercise: { select: refFields } }, orderBy: { position: "asc" } } },
      orderBy: { createdAt: "asc" },
    }) as unknown as Row[];
    const schedule = await tx.scheduleSlot.findMany({ where: { userId }, select: fields("ScheduleSlot"), orderBy: [{ weekday: "asc" }, { position: "asc" }] }) as Row[];
    const sessions = await tx.workoutSession.findMany({
      where: { userId },
      select: {
        ...fields("WorkoutSession"),
        exercises: {
          select: { ...fields("SessionExercise"), exercise: { select: refFields }, sets: { select: fields("SetEntry"), orderBy: { setNumber: "asc" } } },
          orderBy: { position: "asc" },
        },
      },
      orderBy: { startedAt: "asc" },
    }) as unknown as Row[];
    const foods = await tx.food.findMany({
      where: { userId },
      select: { ...fields("Food"), servings: { select: fields("FoodServing"), orderBy: { position: "asc" } } },
      orderBy: { createdAt: "asc" },
    }) as unknown as Row[];
    const entries = await tx.foodEntry.findMany({
      where: { userId },
      select: { ...fields("FoodEntry"), food: { select: { source: true, sourceId: true, dataType: true, origin: true, fetchedAt: true, userId: true } } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }) as unknown as Row[];
    const targets = await tx.nutritionTarget.findMany({ where: { userId }, select: fields("NutritionTarget"), orderBy: { effectiveFrom: "asc" } }) as Row[];

    const exportedSessions = sessions.map((s) => ({
      ...exportRow("WorkoutSession", s),
      exercises: (s.exercises as Row[]).map((e) => ({
        ...exportRow("SessionExercise", e),
        exercise: exerciseRef(e.exercise as Row, userId),
        sets: (e.sets as Row[]).map((set) => exportRow("SetEntry", set)),
      })),
    }));

    return {
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_VERSION,
      exportedAt: now.toISOString(),
      notes: {
        missingValues: "null means no value is stored. It's different from 0.",
        stoppedTargets: "A nutrition target with a null kcal means the person stopped using a target from that date.",
        dates: "Timestamps are UTC. birthDate, date and effectiveFrom are calendar dates.",
        progress: "Calculated for this file from completed sessions, excluding warm-ups. Nothing else in this file is calculated by the export.",
      },
      units: { mass: "kg", length: "cm", restSeconds: "seconds", energy: "kcal", macronutrients: "g", per100: "per 100 of basisUnit (g or ml)", targetCalories: "kcal/day", targetMacronutrients: "g/day" },
      account: exportRow("User", user),
      profile: profile ? exportRow("Profile", profile) : null,
      customExercises: exercises.map((e) => exportRow("Exercise", e)),
      workoutPlans: templates.map((t) => ({
        ...exportRow("WorkoutTemplate", t),
        exercises: (t.exercises as Row[]).map((e) => ({ ...exportRow("TemplateExercise", e), exercise: exerciseRef(e.exercise as Row, userId) })),
      })),
      schedule: schedule.map((s) => exportRow("ScheduleSlot", s)),
      workoutSessions: exportedSessions,
      progress: progressFrom(exportedSessions),
      customFoods: foods.map((f) => ({ ...exportRow("Food", f), servings: (f.servings as Row[]).map((s) => exportRow("FoodServing", s)) })),
      foodEntries: entries.map((e) => {
        const food = e.food as Row | null;
        const shared = food?.userId === null;
        return {
          ...exportRow("FoodEntry", e),
          // Where the logged values came from. The food's own id is internal unless it's a provider's.
          provenance: food && visibleOwner(food.userId, userId)
            ? { source: food.source, sourceId: shared ? food.sourceId : null, dataType: food.dataType ?? null, origin: food.origin ?? null, fetchedAt: exportValue("fetchedAt", food.fetchedAt) }
            : null,
        };
      }),
      nutritionTargets: targets.map((t) => exportRow("NutritionTarget", t)),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 120_000 });
}

/** Buffered, not streamed, as a cut-off stream would look like a valid file. */
export function serializeExport(document: Row, maxBytes = MAX_EXPORT_BYTES): Buffer {
  const bytes = Buffer.from(JSON.stringify(document, null, 2), "utf8");
  if (bytes.length > maxBytes) throw new HttpError(413, TOO_LARGE);
  return bytes;
}

export const exportFilename = (now: Date) => `fitworkoutfoodtracker-export-${now.toISOString().slice(0, 10)}.json`;

// One at a time per person, and a few across the process, as each one is buffered in memory.
const running = new Set<string>();

export async function withExportSlot<T>(userId: string, work: () => Promise<T>): Promise<T> {
  if (running.has(userId) || running.size >= MAX_CONCURRENT_EXPORTS) throw new HttpError(429, "An export is already running. Try again shortly.", undefined, { "Retry-After": "5" });
  running.add(userId);
  try {
    return await work();
  } finally {
    running.delete(userId);
  }
}
