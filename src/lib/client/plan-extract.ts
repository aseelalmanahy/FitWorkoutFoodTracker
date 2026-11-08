/**
 * Phase 3, in the browser: from a chosen file to a draft. PDFs, documents, spreadsheets and text are read here and
 * never leave the device. An image, or a PDF page with no text layer (a scan), is the only thing sent to the server,
 * as one image per request, to be read as text and released; nothing else about the file is sent.
 */
import { openPdf } from "@/lib/pdf/document";
import { PdfError, PDF_MESSAGES } from "@/lib/pdf/limits";
import { browserPdfOptions, loadPdfLibrary } from "@/lib/client/pdf-browser";
import { PlanFileError, readCsv, readDocx, readXlsx, sniffPlanFile, type Inflate, type PlanFileKind } from "@/lib/workout-import/documents";
import { parseWorkoutTable, parseWorkoutText, type Draft } from "@/lib/workout-import/parse";

export const MAX_OCR_PAGES = 10;
export type Extracted = { draft: Draft; kind: PlanFileKind; imagesRead: number };

/** The browser's own decompression, stopped as soon as it passes the limit. */
const inflate: Inflate = async (data, maxBytes) => {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { await reader.cancel(); throw new Error("too large"); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
};

const exercisesIn = (d: Draft) => d.days.reduce((n, day) => n + day.exercises.length, 0);
/** A document can hold its plan as a table or as text: the reading that finds more exercises is used. */
const better = (a: Draft, b: Draft) => (exercisesIn(b) > exercisesIn(a) ? b : a);

export async function extractPlan(file: File, readImage: (image: Blob) => Promise<string>): Promise<Extracted> {
  if (file.size > 10 * 1024 * 1024) throw new PlanFileError("The file is too large. The limit is 10 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffPlanFile(bytes, file.name);
  const fallbackName = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 60) || null;
  const text = () => new TextDecoder().decode(bytes);
  if (kind === "txt") return { kind, draft: parseWorkoutText(text(), { fallbackName }), imagesRead: 0 };
  if (kind === "csv") return { kind, draft: parseWorkoutTable(readCsv(text()), { fallbackName }), imagesRead: 0 };
  if (kind === "docx") {
    const { text: t, rows } = await readDocx(bytes, inflate);
    return { kind, draft: better(parseWorkoutText(t, { fallbackName }), parseWorkoutTable(rows, { fallbackName })), imagesRead: 0 };
  }
  if (kind === "xlsx") return { kind, draft: parseWorkoutTable(await readXlsx(bytes, inflate), { fallbackName }), imagesRead: 0 };
  if (kind === "image") return { kind, draft: parseWorkoutText(await readImage(file), { fallbackName }), imagesRead: 1 };

  // PDF: the text layer where there is one; a page without one is drawn and read as an image.
  let session;
  try {
    session = await openPdf(await loadPdfLibrary(), bytes, browserPdfOptions());
  } catch (e) {
    throw new PlanFileError(e instanceof PdfError ? PDF_MESSAGES[e.code] : "This PDF couldn't be read.");
  }
  try {
    const lines: string[] = [];
    const rows: string[][] = [];
    let imagesRead = 0;
    for (const page of session.pages) {
      if (page.lines.length) {
        for (const cells of page.lines) { lines.push(cells.join("  ")); rows.push(cells); }
        continue;
      }
      if (imagesRead >= MAX_OCR_PAGES) continue;
      const canvas = await session.renderPage(page.number, (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h }));
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      canvas.width = canvas.height = 0;
      if (!blob) continue;
      lines.push(...(await readImage(blob)).split(/\r?\n/));
      imagesRead++;
    }
    const draft = better(parseWorkoutText(lines.join("\n"), { fallbackName }), parseWorkoutTable(rows, { fallbackName }));
    if (session.pageCount > imagesRead && imagesRead >= MAX_OCR_PAGES) draft.warnings.push(`Only the first ${MAX_OCR_PAGES} scanned pages were read.`);
    return { kind, draft, imagesRead };
  } finally {
    await session.destroy();
  }
}
