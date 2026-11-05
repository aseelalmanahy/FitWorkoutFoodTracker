/** Loads pdf.js in the browser, only when a PDF is chosen, so nobody else downloads it. */
import type { PdfLibrary } from "@/lib/pdf/document";

// Bundled with the app and named exactly, so nothing else can load: not from a document, and not elsewhere.
const DECODERS: Record<string, string> = {
  "jbig2.wasm": new URL("pdfjs-dist/wasm/jbig2.wasm", import.meta.url).toString(),
  "openjpeg.wasm": new URL("pdfjs-dist/wasm/openjpeg.wasm", import.meta.url).toString(),
  "qcms_bg.wasm": new URL("pdfjs-dist/wasm/qcms_bg.wasm", import.meta.url).toString(),
};

/** Serves pdf.js's image decoders, and refuses everything else, such as fonts and character maps. */
export class BundledDecoders {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = kind === "wasmUrl" ? DECODERS[filename] : undefined;
    if (!url) throw new Error("Not available");
    const response = await fetch(url);
    if (!response.ok) throw new Error("Not available");
    return new Uint8Array(await response.arrayBuffer());
  }
}

let loaded: Promise<PdfLibrary> | undefined;

export function loadPdfLibrary(): Promise<PdfLibrary> {
  return (loaded ??= (async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
    return pdfjs as unknown as PdfLibrary;
  })());
}

export const browserPdfOptions = () => ({ BinaryDataFactory: BundledDecoders, wasmUrl: "bundled/" });
