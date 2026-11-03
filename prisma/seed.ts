import { PrismaClient, type MuscleGroup, type Equipment } from "@prisma/client";

const prisma = new PrismaClient();

// Built-in exercise library (userId = null). Users can add their own.
const EXERCISES: [string, MuscleGroup, Equipment][] = [
  ["Barbell Bench Press", "CHEST", "BARBELL"],
  ["Incline Barbell Bench Press", "CHEST", "BARBELL"],
  ["Dumbbell Bench Press", "CHEST", "DUMBBELL"],
  ["Dumbbell Incline Press", "CHEST", "DUMBBELL"],
  ["Machine Chest Press", "CHEST", "MACHINE"],
  ["Cable Fly", "CHEST", "CABLE"],
  ["Push-Up", "CHEST", "BODYWEIGHT"],
  ["Dip", "TRICEPS", "BODYWEIGHT"],
  ["Pull-Up", "BACK", "BODYWEIGHT"],
  ["Chin-Up", "BACK", "BODYWEIGHT"],
  ["Lat Pulldown", "BACK", "CABLE"],
  ["Seated Cable Row", "BACK", "CABLE"],
  ["Barbell Row", "BACK", "BARBELL"],
  ["One-Arm Dumbbell Row", "BACK", "DUMBBELL"],
  ["Chest-Supported Row", "BACK", "MACHINE"],
  ["Deadlift", "BACK", "BARBELL"],
  ["Overhead Press", "SHOULDERS", "BARBELL"],
  ["Seated Dumbbell Shoulder Press", "SHOULDERS", "DUMBBELL"],
  ["Dumbbell Lateral Raise", "SHOULDERS", "DUMBBELL"],
  ["Cable Lateral Raise", "SHOULDERS", "CABLE"],
  ["Face Pull", "SHOULDERS", "CABLE"],
  ["Rear Delt Fly", "SHOULDERS", "DUMBBELL"],
  ["Barbell Curl", "BICEPS", "BARBELL"],
  ["Dumbbell Curl", "BICEPS", "DUMBBELL"],
  ["Hammer Curl", "BICEPS", "DUMBBELL"],
  ["Cable Curl", "BICEPS", "CABLE"],
  ["Triceps Pushdown", "TRICEPS", "CABLE"],
  ["Overhead Cable Triceps Extension", "TRICEPS", "CABLE"],
  ["Skull Crusher", "TRICEPS", "BARBELL"],
  ["Back Squat", "QUADS", "BARBELL"],
  ["Front Squat", "QUADS", "BARBELL"],
  ["Leg Press", "QUADS", "MACHINE"],
  ["Hack Squat", "QUADS", "MACHINE"],
  ["Bulgarian Split Squat", "QUADS", "DUMBBELL"],
  ["Walking Lunge", "QUADS", "DUMBBELL"],
  ["Leg Extension", "QUADS", "MACHINE"],
  ["Romanian Deadlift", "HAMSTRINGS", "BARBELL"],
  ["Seated Leg Curl", "HAMSTRINGS", "MACHINE"],
  ["Lying Leg Curl", "HAMSTRINGS", "MACHINE"],
  ["Hip Thrust", "GLUTES", "BARBELL"],
  ["Cable Kickback", "GLUTES", "CABLE"],
  ["Standing Calf Raise", "CALVES", "MACHINE"],
  ["Seated Calf Raise", "CALVES", "MACHINE"],
  ["Plank", "CORE", "BODYWEIGHT"],
  ["Hanging Leg Raise", "CORE", "BODYWEIGHT"],
  ["Cable Crunch", "CORE", "CABLE"],
  ["Kettlebell Swing", "FULL_BODY", "KETTLEBELL"],
];

async function main() {
  let created = 0;
  for (const [name, primaryMuscle, equipment] of EXERCISES) {
    const existing = await prisma.exercise.findFirst({ where: { userId: null, name } });
    if (!existing) {
      await prisma.exercise.create({ data: { name, primaryMuscle, equipment } });
      created++;
    }
  }
  console.log(`Seeded ${created} built-in exercises (${EXERCISES.length} total).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
