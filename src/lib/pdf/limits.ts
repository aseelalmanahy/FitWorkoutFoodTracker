/**
 * Limits on reading a PDF in the browser. They protect the person's own tab. The server never sees a
 * PDF, and validates the page image or food it does receive by itself.
 */
export const PDF_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  maxPages: 50,
  maxTextCharsPerPage: 20_000,
  maxTextCharsTotal: 200_000,
  /** Embedded images above this aren't rendered. */
  maxImagePixels: 100_000_000,
  maxRenderDpi: 300,
  /** The same limit as any uploaded image. */
  maxRenderPixels: 16_000_000,
  openMs: 20_000,
  pageTextMs: 10_000,
  totalTextMs: 30_000,
  renderMs: 30_000,
} as const;

export type PdfRejection = "too_large" | "not_pdf" | "encrypted" | "malformed" | "empty" | "too_many_pages" | "too_much_text" | "timeout" | "page_too_large";

export const PDF_MESSAGES: Record<PdfRejection, string> = {
  too_large: "This PDF is too large. The limit is 20 MB.",
  not_pdf: "This file isn't a valid PDF.",
  encrypted: "This PDF is encrypted or password-protected, so it can't be read. Save an unprotected copy and try again.",
  malformed: "This PDF is damaged and couldn't be read.",
  empty: "This PDF has no pages.",
  too_many_pages: `This PDF has too many pages. The limit is ${PDF_LIMITS.maxPages}. Save just the relevant pages and try again.`,
  too_much_text: "This PDF holds too much text to read safely. Save just the relevant pages and try again.",
  timeout: "This PDF took too long to read, so it was stopped. Save just the relevant pages and try again.",
  page_too_large: "This page's shape can't be shown at a readable size.",
};

export class PdfError extends Error {
  constructor(public readonly code: PdfRejection) {
    super(PDF_MESSAGES[code]);
    this.name = "PdfError";
  }
}

const text = (b: Uint8Array) => String.fromCharCode(...b);

/**
 * The file's own bytes must say it's a PDF, whatever its name or declared type. The header must be
 * at the very start, and a complete file ends with `startxref` and `%%EOF`.
 */
export function checkPdfFile({ size, head, tail }: { size: number; head: Uint8Array; tail: Uint8Array }): PdfRejection | null {
  if (size > PDF_LIMITS.maxBytes) return "too_large";
  if (!/^%PDF-[12]\.\d/.test(text(head.subarray(0, 8)))) return "not_pdf";
  const end = text(tail);
  if (!end.includes("%%EOF") || !end.includes("startxref")) return "malformed";
  return null;
}

/** Bytes to read for `checkPdfFile`. Some writers leave a little after the end marker. */
export const PDF_HEAD_BYTES = 8;
export const PDF_TAIL_BYTES = 2048;

/** The largest scale for a page, in PDF points (72 per inch), within every rendering limit. */
export function renderScale(pageWidth: number, pageHeight: number): number {
  const byDpi = PDF_LIMITS.maxRenderDpi / 72;
  const byPixels = Math.sqrt(PDF_LIMITS.maxRenderPixels / (pageWidth * pageHeight));
  return Math.min(byDpi, byPixels);
}
