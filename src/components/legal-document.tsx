import Link from "next/link";
import { noticeIsFinal, NOTICE, type NoticeSection } from "@/lib/legal/notice";

/** One source for both pages. A draft says so at the top, in words that can't be missed. */
export function LegalDocument({ title, sections, other }: { title: string; sections: NoticeSection[]; other: { href: string; label: string } }) {
  const final = noticeIsFinal();
  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted">Version {NOTICE.version}</p>
      {!final && (
        <p role="note" className="mt-4 rounded-xl border border-line p-4 text-sm font-semibold">
          Draft. This isn&apos;t final, hasn&apos;t had legal review, and isn&apos;t for real users. Marked gaps are still to be decided.
        </p>
      )}
      {sections.map((s) => (
        <section key={s.heading} className="mt-8">
          <h2 className="text-lg font-semibold">{s.heading}</h2>
          {s.paragraphs.map((p) => <p key={p} className="mt-2 text-muted">{p}</p>)}
        </section>
      ))}
      <p className="mt-10 text-sm"><Link href={other.href} className="font-semibold underline-offset-4 hover:underline">{other.label}</Link> · <Link href="/login" className="font-semibold underline-offset-4 hover:underline">Log in</Link></p>
    </main>
  );
}
