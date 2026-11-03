export const MUSCLE_GROUPS = [
  "CHEST", "BACK", "SHOULDERS", "BICEPS", "TRICEPS", "FOREARMS", "QUADS",
  "HAMSTRINGS", "GLUTES", "CALVES", "CORE", "FULL_BODY", "OTHER",
] as const;
export const EQUIPMENT = ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT", "KETTLEBELL", "BAND", "OTHER"] as const;

export const MUSCLE_LABELS: Record<string, string> = {
  CHEST: "Chest", BACK: "Back", SHOULDERS: "Shoulders", BICEPS: "Biceps", TRICEPS: "Triceps",
  FOREARMS: "Forearms", QUADS: "Quads", HAMSTRINGS: "Hamstrings", GLUTES: "Glutes", CALVES: "Calves",
  CORE: "Core", FULL_BODY: "Full body", OTHER: "Other",
};
export const EQUIPMENT_LABELS: Record<string, string> = {
  BARBELL: "Barbell", DUMBBELL: "Dumbbell", MACHINE: "Machine", CABLE: "Cable", BODYWEIGHT: "Bodyweight",
  KETTLEBELL: "Kettlebell", BAND: "Band", OTHER: "Other",
};
