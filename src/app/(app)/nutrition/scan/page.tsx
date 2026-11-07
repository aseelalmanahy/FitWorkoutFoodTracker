import { PageHeader } from "@/components/ui";
import { LabelScanner } from "@/components/nutrition/label-scanner";

export const metadata = { title: "Scan a label" };

export default function ScanLabelPage() {
  return (
    <>
      <PageHeader title="Scan a label" subtitle="The app reads what's printed. You check every value." back="/nutrition" />
      <LabelScanner />
    </>
  );
}
