import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/db";
import { ProfileForm } from "@/components/profile/profile-form";

export const metadata = { title: "Set up your profile" };

export default async function OnboardingPage() {
  const user = await requireUser();
  if (await prisma.profile.findUnique({ where: { userId: user.id } })) redirect("/dashboard");
  return (
    <main className="mx-auto max-w-xl px-4 pb-16">
      <header className="pt-10 pb-6">
        <p className="text-sm font-semibold text-accent-ink">Step 1 of 1</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">About you</h1>
        <p className="mt-1 text-muted">Used to personalise calorie estimates and training plans. You can change it any time.</p>
      </header>
      <ProfileForm initial={null} submitLabel="Continue" redirectTo="/dashboard" />
    </main>
  );
}
