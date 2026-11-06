import Link from "next/link";
import { redirect } from "next/navigation";
import { accessStateFor } from "@/lib/eligibility";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/db";
import { profileToValues } from "@/lib/server/serialize";
import { LogoutButton } from "@/components/logout-button";
import { ProfileForm } from "@/components/profile/profile-form";

export const metadata = { title: "Account restricted" };

/** Outside the (app) layout, which would redirect here again. */
export default async function AccountRestrictedPage() {
  const user = await requireUser();
  const profile = await prisma.profile.findUnique({ where: { userId: user.id } });
  const state = accessStateFor(profile);
  if (state === "no_profile") redirect("/onboarding");
  if (state === "ok") redirect("/dashboard");
  return (
    <main className="mx-auto max-w-xl px-4 pb-16">
      <header className="pt-10 pb-6">
        <h1 className="text-3xl font-bold tracking-tight">Your account is restricted</h1>
        <p className="mt-1 text-muted">This app isn&apos;t available with the date of birth on this account. If that date is wrong, you can correct it below. Your data hasn&apos;t been deleted.</p>
      </header>
      <ProfileForm initial={profileToValues(profile!)} submitLabel="Save changes" redirectTo="/dashboard" hideGoals />
      <Link href="/account" className="mt-4 block text-center text-sm font-semibold text-accent-ink">Download or delete your data</Link>
      <LogoutButton className="mt-3 w-full" />
    </main>
  );
}
