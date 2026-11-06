import { LegalDocument } from "@/components/legal-document";
import { NOTICE } from "@/lib/legal/notice";

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return <LegalDocument title="Terms" sections={NOTICE.terms} other={{ href: "/privacy", label: "Privacy notice" }} />;
}
