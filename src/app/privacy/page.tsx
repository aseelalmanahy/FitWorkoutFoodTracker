import { LegalDocument } from "@/components/legal-document";
import { NOTICE } from "@/lib/legal/notice";

export const metadata = { title: "Privacy notice" };

export default function PrivacyPage() {
  return <LegalDocument title="Privacy notice" sections={NOTICE.privacy} other={{ href: "/terms", label: "Terms" }} />;
}
