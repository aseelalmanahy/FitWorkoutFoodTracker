import Link from "next/link";

export const metadata = { title: "Account deleted" };

/** Public, as the person has no session by now. It shows nothing about any account. */
export default function AccountDeletedPage() {
  return (
    <main className="mx-auto max-w-xl px-4 pb-16">
      <header className="pt-10 pb-4">
        <h1 className="text-3xl font-bold tracking-tight">Your account has been deleted</h1>
      </header>
      <div className="space-y-3 text-sm text-muted">
        <p>Your account, profile, workouts, custom exercises, food log, custom foods and nutrition targets have been removed from the app&apos;s database, and you&apos;ve been signed out everywhere.</p>
        <p>Shared food and exercise information that other people also use stays. Any backups may keep a copy until they expire.</p>
      </div>
      <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-accent-ink">Go to the login page</Link>
    </main>
  );
}
