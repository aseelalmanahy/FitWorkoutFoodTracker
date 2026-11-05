/**
 * One open PDF, with limits and deadlines. A deadline destroys the document, which terminates its
 * worker, so no unfinished work outlives it. The pdf.js library is passed in, so these rules can be
 * tested against it directly, and this file has no browser or server dependencies of its own.
 */
import { linesFromTextItems, readPage, type PageReading, type TextItem } from "./label-text";
import { checkPdfFile, PDF_HEAD_BYTES, PDF_LIMITS, PDF_TAIL_BYTES, PdfError, renderScale } from "./limits";

/** The parts of pdf.js used here. */
export interface PdfPageProxy {
  getTextContent(): Promise<{ items: unknown[] }>;
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: { canvas: HTMLCanvasElement; viewport: unknown; annotationMode: number }): { promise: Promise<void>; cancel(): void };
  cleanup(): void;
}
export interface PdfDocumentProxy {
  numPages: number;
  getMetadata(): Promise<{ info: unknown }>;
  getPage(n: number): Promise<PdfPageProxy>;
}
export interface PdfLoadingTask {
  promise: Promise<PdfDocumentProxy>;
  destroy(): Promise<void>;
}
export interface PdfLibrary {
  getDocument(options: Record<string, unknown>): PdfLoadingTask;
  AnnotationMode: { DISABLE: number };
}

export interface PdfPageSummary {
  number: number;
  reading: PageReading;
}

export interface PdfSession {
  pageCount: number;
  pages: PdfPageSummary[];
  /** Draws one page. The caller gives the canvas it created, and owns what's on it. */
  renderPage(number: number, createCanvas: (width: number, height: number) => HTMLCanvasElement): Promise<HTMLCanvasElement>;
  destroy(): Promise<void>;
}

export type DeadlineOverrides = Partial<Record<"openMs" | "pageTextMs" | "totalTextMs" | "renderMs" | "maxTextCharsPerPage" | "maxTextCharsTotal", number>>;

/**
 * Nothing here can reach the network or run document content. The file is passed as bytes, so there's
 * no URL to resolve against. Worker fetching is off, so only `binaryDataFactory`, if given, can load
 * anything. XFA is off. Scripts need a sandbox that's never created. Damage rejects rather than being
 * patched over.
 */
export const PDF_DOCUMENT_OPTIONS = {
  stopAtErrors: true,
  enableXfa: false,
  disableAutoFetch: true,
  disableStream: true,
  disableRange: true,
  useWorkerFetch: false,
  maxImageSize: PDF_LIMITS.maxImagePixels,
  verbosity: 0,
} as const;

function classify(err: unknown): PdfError {
  if (err instanceof PdfError) return err;
  const name = err instanceof Error ? err.name : "";
  if (name === "PasswordException") return new PdfError("encrypted");
  return new PdfError("malformed");
}

/** The file's own first and last bytes, read without loading the whole of a file that may be refused. */
export async function checkPdfBlob(file: Blob) {
  if (file.size > PDF_LIMITS.maxBytes) return "too_large" as const;
  const head = new Uint8Array(await file.slice(0, PDF_HEAD_BYTES).arrayBuffer());
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - PDF_TAIL_BYTES)).arrayBuffer());
  return checkPdfFile({ size: file.size, head, tail });
}

/** Opens a PDF and reads every page's text, within limits. Any failure leaves nothing running. */
export async function openPdf(pdfjs: PdfLibrary, bytes: Uint8Array, extraOptions: Record<string, unknown> = {}, overrides: DeadlineOverrides = {}): Promise<PdfSession> {
  const limits = { ...PDF_LIMITS, ...overrides };
  const task = pdfjs.getDocument({ ...PDF_DOCUMENT_OPTIONS, ...extraOptions, data: bytes });
  let destroyed: Promise<void> | null = null;
  const destroy = () => (destroyed ??= task.destroy().catch(() => {}));

  /** Waits for `work` until the deadline. At the deadline, the worker is terminated. */
  const within = async <T>(work: Promise<T>, ms: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, fail) => {
      timer = setTimeout(() => {
        fail(new PdfError("timeout"));
        void destroy();
      }, ms);
    });
    try {
      return await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const doc = await within(task.promise, limits.openMs);
    if (doc.numPages < 1) throw new PdfError("empty");
    if (doc.numPages > limits.maxPages) throw new PdfError("too_many_pages");
    // A file that opens with an empty password is still encrypted, and still refused.
    const { info } = await within(doc.getMetadata(), limits.pageTextMs);
    if ((info as { EncryptFilterName?: unknown } | null)?.EncryptFilterName) throw new PdfError("encrypted");

    const pages: PdfPageSummary[] = [];
    const started = Date.now();
    let total = 0;
    for (let number = 1; number <= doc.numPages; number++) {
      const remaining = limits.totalTextMs - (Date.now() - started);
      const reading = await within((async () => {
        const page = await doc.getPage(number);
        const { items } = await page.getTextContent();
        page.cleanup();
        return items as TextItem[];
      })(), Math.max(0, Math.min(limits.pageTextMs, remaining)));
      const chars = reading.reduce((n, item) => n + (item.str?.length ?? 0), 0);
      total += chars;
      if (chars > limits.maxTextCharsPerPage || total > limits.maxTextCharsTotal) throw new PdfError("too_much_text");
      pages.push({ number, reading: readPage(linesFromTextItems(reading)) });
    }

    return {
      pageCount: doc.numPages,
      pages,
      destroy,
      async renderPage(number, createCanvas) {
        const render = async () => {
          const page = await doc.getPage(number);
          const base = page.getViewport({ scale: 1 });
          const scale = renderScale(base.width, base.height);
          const viewport = page.getViewport({ scale });
          const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
          // Annotations stay off, so links and form fields are never drawn or made active.
          await page.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE }).promise;
          page.cleanup();
          return canvas;
        };
        try {
          return await within(render(), limits.renderMs);
        } catch (err) {
          throw classify(err);
        }
      },
    };
  } catch (err) {
    await destroy();
    throw classify(err);
  }
}
