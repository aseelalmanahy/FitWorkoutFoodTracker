import Link from "next/link";

const LINK = "font-semibold text-fg underline-offset-4 hover:underline";

/** Public pages, linked from sign-up, login, profile and the account page. */
export function LegalLinks({ className = "mt-6" }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={`${className} text-center text-sm text-muted`}>
      <Link href="/privacy" className={LINK}>Privacy notice</Link>
      <span aria-hidden> · </span>
      <Link href="/terms" className={LINK}>Terms</Link>
    </nav>
  );
}
