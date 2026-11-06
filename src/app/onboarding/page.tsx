import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/db";
import { LogoutButton } from "@/components/logout-button";
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
        <p className="mt-1 text-muted">You can change this any time.</p>
      </header>
      <ProfileForm initial={null} submitLabel="Continue" redirectTo="/dashboard" />
      <Link href="/account" className="mt-4 block text-center text-sm font-semibold text-accent-ink">Download or delete your data</Link>
      <LogoutButton className="mt-3 w-full" />
    </main>
  );
}
