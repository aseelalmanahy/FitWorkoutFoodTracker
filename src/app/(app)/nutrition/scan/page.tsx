import { PageHeader } from "@/components/ui";
import { LabelScanner } from "@/components/nutrition/label-scanner";
import { labelProcessing } from "@/lib/server/labels/extractor";

// Where scans are read is this server's setting at run time, so the page is never built ahead.
export const dynamic = "force-dynamic";

export const metadata = { title: "Scan a label" };

export default function ScanLabelPage() {
  return (
    <>
      <PageHeader title="Scan a label" subtitle="The app reads what's printed. You check every value." back="/nutrition" />
      <LabelScanner processing={labelProcessing()} />
    </>
  );
}
