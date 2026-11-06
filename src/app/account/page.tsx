import Link from "next/link";
import { accessStateFor } from "@/lib/eligibility";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/db";
import { AccountDataControls } from "@/components/account/data-controls";
import { PasswordControls } from "@/components/account/password-controls";
import { LogoutButton } from "@/components/logout-button";

export const metadata = { title: "Your account and data" };

const BACK = { ok: "/profile", no_profile: "/onboarding", restricted: "/account-restricted" } as const;

/** Outside the (app) layout, as someone with no profile, or a restricted one, must be able to reach it. */
export default async function AccountPage() {
  const user = await requireUser();
  const state = accessStateFor(await prisma.profile.findUnique({ where: { userId: user.id }, select: { birthDate: true } }));
  return (
    <main className="mx-auto max-w-xl px-4 pb-16">
      <header className="pt-10 pb-2">
        <Link href={BACK[state]} className="mb-1 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><span aria-hidden>‹</span> Back</Link>
        <h1 className="text-3xl font-bold tracking-tight">Your account and data</h1>
      </header>
      <PasswordControls />
      <AccountDataControls email={user.email} />
      <LogoutButton className="mt-6 w-full" />
    </main>
  );
}
