"use client";

import type { PdfSession } from "@/lib/pdf/document";
import type { LabelSection, PageReading } from "@/lib/pdf/label-text";
import { Button, Card, cx } from "@/components/ui";

function describe(reading: PageReading): string {
  switch (reading.kind) {
    case "scanned": return "No selectable text. It may be a scan.";
    case "text": return "Text, with no nutrition label found.";
    case "ambiguous": return "More than one label side by side. Crop to one using the page image.";
    case "labels": return reading.sections.length === 1 ? "Nutrition label found." : `${reading.sections.length} nutrition labels found.`;
  }
}

export interface PdfPagePreview { number: number; url: string }

/** The pages of a PDF, one chosen at a time. Only the chosen page is drawn. */
export function PdfPagePicker({ fileName, session, selected, preview, working, onSelect, onUseSection, onUseImage, onChooseAnother }: {
  fileName: string;
  session: PdfSession;
  selected: number | null;
  preview: PdfPagePreview | null;
  working: boolean;
  onSelect: (page: number) => void;
  onUseSection: (section: LabelSection) => void;
  onUseImage: () => void;
  onChooseAnother: () => void;
}) {
  const reading = session.pages.find((p) => p.number === selected)?.reading;
  return (
    <div className="space-y-4" data-testid="pdf-pages">
      <p className="text-sm">
        <span className="font-medium" data-testid="pdf-file-name">{fileName}</span> has {session.pageCount} page{session.pageCount === 1 ? "" : "s"}. Choose the one with the label. The PDF stays on your device.
      </p>
      <Card className="divide-y divide-line">
        {session.pages.map((page) => (
          <button
            key={page.number}
            type="button"
            data-testid={`pdf-page-${page.number}`}
            data-kind={page.reading.kind}
            disabled={working}
            onClick={() => onSelect(page.number)}
            className={cx("block w-full p-3 text-left text-sm", selected === page.number && "bg-surface-2")}
          >
            <span className="block font-medium">Page {page.number}</span>
            <span className="block text-muted">{describe(page.reading)}</span>
            {"preview" in page.reading && page.reading.preview && <span className="mt-1 block truncate text-xs text-muted">{page.reading.preview}</span>}
          </button>
        ))}
      </Card>

      {selected !== null && preview?.number === selected && (
        <Card className="space-y-3 p-4" data-testid="pdf-selected">
          <h3 className="font-medium">Page {selected}</h3>
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element -- drawn from the local file, on this device */}
            <img data-testid="pdf-page-image" src={preview.url} alt={`Page ${selected} of the PDF`} className="block w-full" />
          </div>
          {reading?.kind === "labels" && reading.sections.map((section, i) => (
            <div key={i} className="rounded-lg border border-line p-3 text-sm" data-testid={`pdf-section-${i}`}>
              <p className="font-medium">{reading.sections.length > 1 ? `Label ${i + 1}: ` : ""}{section.title}</p>
              {section.result.reliable ? (
                <Button className="mt-2" size="sm" disabled={working} data-testid={`use-section-${i}`} onClick={() => onUseSection(section)}>Read values from the text</Button>
              ) : (
                <p className="mt-1 text-muted" data-testid={`section-unclear-${i}`}>This text isn&apos;t clear enough to read reliably. {section.result.reason} Use the page image instead.</p>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant={reading?.kind === "labels" ? "secondary" : "primary"} disabled={working} data-testid="use-page-image" onClick={onUseImage}>Crop and scan this page image</Button>
          </div>
          <p className="text-xs text-muted">Reading from the text uses no AI. Scanning sends only the part of this page you choose to our AI provider, and counts as a scan.</p>
        </Card>
      )}
      <Button variant="secondary" disabled={working} onClick={onChooseAnother}>Choose another file</Button>
    </div>
  );
}
