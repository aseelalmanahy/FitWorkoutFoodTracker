import "server-only";
import { Prisma, type NutritionTarget, type Profile } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../api";
import { ageFromBirthDate, suggestCalories, suggestMacros } from "@/lib/energy";
import { carbsFromRemainder, targetForDate, toIsoDate, fromIsoDate, type DatedTarget } from "@/lib/nutrition";
import { localParts } from "@/lib/time";

/**
 * Run an upsert on NutritionTarget(userId, effectiveFrom). Concurrent requests
 * (e.g. a user's first page load firing several nutrition calls at once) can
 * race on the unique key. The loser retries once, and that retry updates the
 * row the winner created.
 */
async function upsertWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fn();
    throw e;
  }
}

export function localToday(timeZone: string, now = new Date()): string {
  const p = localParts(now, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function suggestionFromProfile(p: Profile) {
  const cal = suggestCalories({
    sex: p.sex, weightKg: p.currentWeightKg, heightCm: p.heightCm, age: ageFromBirthDate(p.birthDate), activity: p.activityLevel, goal: p.goal,
  });
  const macros = suggestMacros({ kcal: cal.target, weightKg: p.currentWeightKg, goalWeightKg: p.goalWeightKg, goal: p.goal });
  return { ...macros, bmr: cal.bmr, tdee: cal.tdee, rationale: cal.rationale, floorApplied: cal.floorApplied };
}

export const toDated = (t: NutritionTarget): DatedTarget => ({
  effectiveFrom: toIsoDate(t.effectiveFrom), kcal: t.kcal, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG, source: t.source,
});

/**
 * All targets for the user, oldest first. The first target always covers the
 * earliest logged day. The first time this runs it seeds an initial target from the profile: the Phase 1 calorie override if one was set
 * (MANUAL), otherwise the suggestion (SUGGESTED). It starts at the earliest
 * logged day so existing history has a target.
 */
export async function getTargets(userId: string, profile: Profile): Promise<DatedTarget[]> {
  let rows = await prisma.nutritionTarget.findMany({ where: { userId }, orderBy: { effectiveFrom: "asc" } });
  if (rows.length === 0) {
    const first = await prisma.foodEntry.findFirst({ where: { userId }, orderBy: { date: "asc" }, select: { date: true } });
    const today = localToday(profile.timezone);
    const start = first && toIsoDate(first.date) < today ? toIsoDate(first.date) : today;
    const s = suggestionFromProfile(profile);
    const override = profile.calorieTargetOverride;
    const m = override ? suggestMacros({ kcal: override, weightKg: profile.currentWeightKg, goalWeightKg: profile.goalWeightKg, goal: profile.goal }) : s;
    await upsertWithRetry(() => prisma.nutritionTarget.upsert({
      where: { userId_effectiveFrom: { userId, effectiveFrom: fromIsoDate(start) } },
      create: { userId, effectiveFrom: fromIsoDate(start), kcal: m.kcal, proteinG: m.proteinG, carbsG: m.carbsG, fatG: m.fatG, source: override ? "MANUAL" : "SUGGESTED" },
      update: {},
    }));
    rows = await prisma.nutritionTarget.findMany({ where: { userId }, orderBy: { effectiveFrom: "asc" } });
  } else {
    // Entries backdated before the first target (logged after seeding) are covered by
    // extending the *first* target back to them. Later targets are untouched, so days
    // after any change keep the target in force then.
    const first = await prisma.foodEntry.findFirst({ where: { userId }, orderBy: { date: "asc" }, select: { date: true } });
    if (first && first.date < rows[0].effectiveFrom) {
      await prisma.nutritionTarget.updateMany({
        where: { id: rows[0].id, effectiveFrom: { gt: first.date } },
        data: { effectiveFrom: first.date },
      });
      rows = await prisma.nutritionTarget.findMany({ where: { userId }, orderBy: { effectiveFrom: "asc" } });
    }
  }
  return rows.map(toDated);
}

export async function getTargetFor(userId: string, profile: Profile, date: string): Promise<DatedTarget | null> {
  return targetForDate(await getTargets(userId, profile), date);
}

async function upsertToday(userId: string, date: string, t: { kcal: number; proteinG: number; carbsG: number; fatG: number; source: "MANUAL" | "SUGGESTED" }) {
  const effectiveFrom = fromIsoDate(date);
  const row = await upsertWithRetry(() => prisma.nutritionTarget.upsert({
    where: { userId_effectiveFrom: { userId, effectiveFrom } },
    create: { userId, effectiveFrom, ...t },
    update: t,
  }));
  return toDated(row);
}

/** Manual target from today on. Carbs are the energy remainder, so the target is always consistent. */
export async function setManualTarget(userId: string, profile: Profile, input: { kcal: number; proteinG: number; fatG: number }) {
  const carbsG = carbsFromRemainder(input.kcal, input.proteinG, input.fatG);
  if (carbsG === null) throw new HttpError(400, "Protein and fat targets contain more energy than the calorie target.");
  await getTargets(userId, profile); // make sure earlier history keeps its seeded target
  return upsertToday(userId, localToday(profile.timezone), { ...input, carbsG, source: "MANUAL" });
}

export async function applySuggestion(userId: string, profile: Profile) {
  await getTargets(userId, profile);
  const s = suggestionFromProfile(profile);
  return upsertToday(userId, localToday(profile.timezone), { kcal: s.kcal, proteinG: s.proteinG, carbsG: s.carbsG, fatG: s.fatG, source: "SUGGESTED" });
}

/**
 * After a profile change: if today's target is a suggestion, follow the new
 * suggestion from today on. Manual targets are never overwritten, and past
 * days keep their targets.
 */
export async function syncSuggestedTarget(userId: string, profile: Profile) {
  const existing = await prisma.nutritionTarget.count({ where: { userId } });
  if (existing === 0) return; // seeded lazily on first nutrition use
  const today = localToday(profile.timezone);
  const current = await getTargetFor(userId, profile, today);
  if (current && current.source !== "SUGGESTED") return;
  const s = suggestionFromProfile(profile);
  if (current && current.kcal === s.kcal && current.proteinG === s.proteinG && current.fatG === s.fatG && current.carbsG === s.carbsG) return;
  await upsertToday(userId, today, { kcal: s.kcal, proteinG: s.proteinG, carbsG: s.carbsG, fatG: s.fatG, source: "SUGGESTED" });
}
