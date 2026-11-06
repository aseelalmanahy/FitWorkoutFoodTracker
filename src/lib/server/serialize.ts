import type { Profile } from "@prisma/client";
import type { ProfileValues } from "@/components/profile/profile-form";

/** Passes nulls through. A default here would show a value the person never gave, and could save it. */
export function profileToValues(p: Profile): ProfileValues {
  return {
    name: p.name,
    birthDate: p.birthDate.toISOString().slice(0, 10),
    sex: p.sex,
    heightCm: p.heightCm,
    currentWeightKg: p.currentWeightKg,
    goalWeightKg: p.goalWeightKg,
    goal: p.goal,
    activityLevel: p.activityLevel,
    experience: p.experience,
    workoutDaysPerWeek: p.workoutDaysPerWeek,
    unitSystem: p.unitSystem,
    timezone: p.timezone,
  };
}
