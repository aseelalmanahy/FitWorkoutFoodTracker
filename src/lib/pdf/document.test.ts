// The real pdf.js on real PDF files built byte by byte, with no browser, network or database.
import { createRequire } from "node:module";
import * as realPdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, vi } from "vitest";
import { BundledDecoders } from "../client/pdf-browser";
import { checkPdfBlob, openPdf, PDF_DOCUMENT_OPTIONS, type PdfLibrary, type PdfLoadingTask } from "./document";
import { checkPdfFile, PDF_LIMITS, PDF_MESSAGES, renderScale, type PdfRejection } from "./limits";

const { fixtures } = createRequire(import.meta.url)("../../../scripts/lib/pdf-fixtures.cjs") as { fixtures: Record<string, (...args: never[]) => Buffer> };
const pdfjs = realPdfjs as unknown as PdfLibrary;
const bytes = (b: Buffer) => new Uint8Array(b);
const open = (b: Buffer) => openPdf(pdfjs, bytes(b));
const rejection = async (p: Promise<unknown>): Promise<PdfRejection> => {
  const err = await p.then(() => { throw new Error("expected a rejection"); }, (e) => e);
  expect(err.name).toBe("PdfError");
  return err.code;
};
const HEAVY = 60_000;

describe("genuine PDFs", () => {
  it("reads a text PDF, keeping page numbers", async () => {
    const session = await open(fixtures.usLabel());
    expect(session.pageCount).toBe(1);
    expect(session.pages[0]).toMatchObject({ number: 1, reading: { kind: "labels" } });
    await session.destroy();
  });

  it("reads the values through the real library's text output", async () => {
    const session = await open(fixtures.euLabel());
    const reading = session.pages[0].reading;
    if (reading.kind !== "labels" || !reading.sections[0].result.reliable) throw new Error("expected a reliable label");
    const { columns, servingSize } = reading.sections[0].result.extraction;
    expect(columns.map((c) => c.basis)).toEqual(["per_100g", "per_serving"]);
    expect(columns[0].kcal).toMatchObject({ value: 400, unit: "kcal" });
    expect(columns[1].protein).toMatchObject({ value: 4 });
    expect(servingSize).toMatchObject({ amount: 30, unit: "g" });
    await session.destroy();
  });

  it("reads compressed content, and a rotated page", async () => {
    for (const file of [fixtures.compressed(), fixtures.rotated()]) {
      const session = await open(file);
      expect(session.pages[0].reading.kind).not.toBe("scanned");
      await session.destroy();
    }
  });

  it("keeps a document's pages apart", async () => {
    const session = await open(fixtures.multiPage());
    expect(session.pages.map((p) => p.reading.kind)).toEqual(["text", "text", "labels", "labels", "text"]);
    const kcal = session.pages.flatMap((p) => (p.reading.kind === "labels" && p.reading.sections[0].result.reliable ? [p.reading.sections[0].result.extraction.columns[0].kcal.value] : []));
    expect(kcal).toEqual([120, 150]);
    await session.destroy();
  });

  it("finds two labels on one page, separately", async () => {
    const session = await open(fixtures.twoLabelsOnePage());
    const reading = session.pages[0].reading;
    if (reading.kind !== "labels") throw new Error(reading.kind);
    expect(reading.sections).toHaveLength(2);
    await session.destroy();
  });

  it("sees a page with no text as a possible scan, and doesn't invent anything", async () => {
    const session = await open(fixtures.blank());
    expect(session.pages[0].reading.kind).toBe("scanned");
    await session.destroy();
  });

  it("refuses to read labels side by side from the text", async () => {
    const session = await open(fixtures.sideBySide());
    expect(session.pages[0].reading.kind).toBe("ambiguous");
    await session.destroy();
  });

  it("keeps missing nutrients missing, and flags nothing it didn't read", async () => {
    const session = await open(fixtures.missingFields());
    const reading = session.pages[0].reading;
    if (reading.kind !== "labels" || !reading.sections[0].result.reliable) throw new Error("expected a reading");
    const column = reading.sections[0].result.extraction.columns[0];
    expect(column.fat.status).toBe("absent");
    expect(column.fat.value).toBeNull();
    await session.destroy();
  });

  it("instructions in a PDF's text do nothing", async () => {
    const session = await open(fixtures.injection());
    const reading = session.pages[0].reading;
    if (reading.kind !== "labels" || !reading.sections[0].result.reliable) throw new Error("expected a reading");
    const { extraction } = reading.sections[0].result;
    expect(extraction.columns[0].kcal.value).toBe(120);
    expect(JSON.stringify(extraction)).not.toMatch(/Ignore|SYSTEM|onerror/);
    await session.destroy();
  });
});

describe("refused files", () => {
  it.each([
    ["encrypted, requiring a password", "encryptedPassword", "encrypted"],
    ["encrypted, opening with an empty password", "encryptedEmptyPassword", "encrypted"],
    ["with no pages", "noPages", "empty"],
    ["over the page limit", "manyPages", "too_many_pages"],
    ["overwritten with junk", "corrupted", "malformed"],
    ["a signature on something else", "fakeSignature", "malformed"],
    ["with too much text on a page", "tooMuchTextOnPage", "too_much_text"],
    ["with too much text overall", "tooMuchTextOverall", "too_much_text"],
  ] as const)("refuses a PDF %s", async (_name, fixture, code) => {
    expect(await rejection(open(fixtures[fixture]()))).toBe(code);
  }, HEAVY);

  it("accepts exactly the page limit", async () => {
    const session = await open((fixtures.manyPages as unknown as (n: number) => Buffer)(PDF_LIMITS.maxPages));
    expect(session.pageCount).toBe(PDF_LIMITS.maxPages);
    await session.destroy();
  }, HEAVY);

  it("gives every rejection a plain message", () => {
    for (const code of ["too_large", "not_pdf", "encrypted", "malformed", "empty", "too_many_pages", "too_much_text", "timeout", "page_too_large"] as const) expect(PDF_MESSAGES[code]).toMatch(/\.$/);
  });
});

describe("checks before opening", () => {
  const check = (b: Buffer) => checkPdfFile({ size: b.length, head: b.subarray(0, 8), tail: b.subarray(-2048) });

  it("accepts a real PDF", () => {
    expect(check(fixtures.usLabel())).toBeNull();
  });

  it("goes by content, not name or type", async () => {
    expect(await checkPdfBlob(new File([bytes(fixtures.htmlNamedPdf())], "label.pdf", { type: "application/pdf" }))).toBe("not_pdf");
    expect(await checkPdfBlob(new File([bytes(fixtures.usLabel())], "photo.jpg", { type: "image/jpeg" }))).toBeNull();
  });

  it.each([["an HTML file", "<!doctype html>"], ["a JPEG", "\xff\xd8\xff\xe0"], ["empty", ""], ["a signature that isn't at the start", " %PDF-1.7"], ["a bad version", "%PDF-9.9"]])("refuses %s", (_name, text) => {
    expect(check(Buffer.from(text, "latin1"))).toBe("not_pdf");
  });

  it("refuses a file cut off before its end markers", () => {
    expect(check(fixtures.truncated())).toBe("malformed");
  });

  it("refuses an oversized file without reading it into memory", async () => {
    const huge = new Blob([new Uint8Array(PDF_LIMITS.maxBytes + 1)]);
    const slice = vi.spyOn(huge, "slice");
    expect(await checkPdfBlob(huge)).toBe("too_large");
    expect(slice).not.toHaveBeenCalled();
    expect(checkPdfFile({ size: PDF_LIMITS.maxBytes + 1, head: new Uint8Array(0), tail: new Uint8Array(0) })).toBe("too_large");
  });

  it("the oversized fixture really is over the limit", () => {
    expect(fixtures.oversized().length).toBeGreaterThan(PDF_LIMITS.maxBytes);
    expect(check(fixtures.oversized())).toBe("too_large");
  });
});

describe("active content", () => {
  it("a script, page action, link and attachment do nothing while reading", async () => {
    const fetched = vi.spyOn(globalThis, "fetch");
    const session = await open(fixtures.active());
    expect(session.pages[0].reading.kind).toBe("labels");
    expect(fetched).not.toHaveBeenCalled();
    await session.destroy();
    fetched.mockRestore();
  });

  it("the library's worker has no eval, and the session never loads the scripting sandbox", async () => {
    const { readFileSync } = await import("node:fs");
    const worker = readFileSync(createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"), "utf8");
    expect(worker).not.toMatch(/[^.\w]eval\(/);
    expect(worker).not.toMatch(/\bnew Function\(/);
    const own = readFileSync(createRequire(import.meta.url).resolve("./document.ts"), "utf8") + readFileSync(createRequire(import.meta.url).resolve("../client/pdf-browser.ts"), "utf8");
    expect(own).not.toMatch(/pdf\.sandbox|getJSActions\(|getAttachments\(|getAnnotations\(/);
  });

  it("every option that limits the library is set, and no URL is ever given", () => {
    expect(PDF_DOCUMENT_OPTIONS).toEqual({ stopAtErrors: true, enableXfa: false, disableAutoFetch: true, disableStream: true, disableRange: true, useWorkerFetch: false, maxImageSize: PDF_LIMITS.maxImagePixels, verbosity: 0 });
    const getDocument = vi.fn(() => ({ promise: new Promise(() => {}), destroy: async () => {} }) as unknown as PdfLoadingTask);
    void openPdf({ getDocument, AnnotationMode: { DISABLE: 0 } }, new Uint8Array(1), {}, { openMs: 1 }).catch(() => {});
    const options = (getDocument.mock.calls as unknown as Record<string, unknown>[][])[0][0];
    expect(options.data).toBeInstanceOf(Uint8Array);
    for (const key of ["url", "cMapUrl", "standardFontDataUrl", "docBaseUrl"]) expect(options, key).not.toHaveProperty(key);
  });
});

describe("the only thing that can load", () => {
  it.each([
    ["a font", "standardFontDataUrl", "LiberationSans-Regular.ttf"],
    ["a character map", "cMapUrl", "Identity-H.bcmap"],
    ["the scripting engine", "wasmUrl", "quickjs-eval.wasm"],
    ["a path out of the folder", "wasmUrl", "../../secret"],
    ["an address", "wasmUrl", "https://evil.example/x.wasm"],
    ["a decoder's name, asked for as a font", "standardFontDataUrl", "jbig2.wasm"],
  ])("refuses %s, without fetching anything", async (_name, kind, filename) => {
    const fetched = vi.spyOn(globalThis, "fetch");
    await expect(new BundledDecoders().fetch({ kind, filename })).rejects.toThrow();
    expect(fetched).not.toHaveBeenCalled();
    fetched.mockRestore();
  });

  it.each(["jbig2.wasm", "openjpeg.wasm", "qcms_bg.wasm"])("serves the image decoder %s, from the app's own assets", async (filename) => {
    const fetched = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([0, 97, 115, 109])));
    expect(await new BundledDecoders().fetch({ kind: "wasmUrl", filename })).toEqual(new Uint8Array([0, 97, 115, 109]));
    expect(String(fetched.mock.calls[0][0])).toContain(filename);
    expect(String(fetched.mock.calls[0][0])).not.toMatch(/https?:/);
    fetched.mockRestore();
  });

  it("a decoder that can't be loaded fails rather than returning nothing", async () => {
    const fetched = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    await expect(new BundledDecoders().fetch({ kind: "wasmUrl", filename: "jbig2.wasm" })).rejects.toThrow();
    fetched.mockRestore();
  });
});

describe("deadlines end the work", () => {
  const stuckLibrary = () => {
    const destroy = vi.fn(async () => {});
    const getDocument = vi.fn(() => ({ promise: new Promise(() => {}), destroy }) as unknown as PdfLoadingTask);
    return { library: { getDocument, AnnotationMode: { DISABLE: 0 } } satisfies PdfLibrary, destroy };
  };

  it("a file that never opens times out, and its worker is destroyed once", async () => {
    const { library, destroy } = stuckLibrary();
    expect(await rejection(openPdf(library, new Uint8Array(1), {}, { openMs: 5 }))).toBe("timeout");
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  const workingDocument = (page: Record<string, unknown>, numPages = 1) => {
    const destroy = vi.fn(async () => {});
    const doc = { numPages, getMetadata: async () => ({ info: {} }), getPage: async () => ({ cleanup: () => {}, getTextContent: async () => ({ items: [] }), ...page }) };
    const getDocument = () => ({ promise: Promise.resolve(doc), destroy }) as unknown as PdfLoadingTask;
    return { library: { getDocument, AnnotationMode: { DISABLE: 0 } } satisfies PdfLibrary, destroy };
  };

  it("a page whose text never finishes times out, and the worker is destroyed", async () => {
    const { library, destroy } = workingDocument({ getTextContent: () => new Promise(() => {}) });
    expect(await rejection(openPdf(library, new Uint8Array(1), {}, { pageTextMs: 5 }))).toBe("timeout");
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("reading text has an overall deadline across pages", async () => {
    const slow = () => new Promise((resolve) => setTimeout(() => resolve({ items: [] }), 15));
    const { library, destroy } = workingDocument({ getTextContent: slow }, 10);
    expect(await rejection(openPdf(library, new Uint8Array(1), {}, { totalTextMs: 20 }))).toBe("timeout");
    expect(destroy).toHaveBeenCalled();
  });

  it("a render that never finishes times out, the worker is destroyed, and nothing is left unhandled", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const { library, destroy } = workingDocument({
      getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 100 * scale }),
      render: () => ({ promise: new Promise(() => {}), cancel: () => {} }),
    });
    const session = await openPdf(library, new Uint8Array(1), {}, { renderMs: 5 });
    expect(await rejection(session.renderPage(1, () => ({}) as HTMLCanvasElement))).toBe("timeout");
    expect(destroy).toHaveBeenCalledTimes(1);
    await session.destroy();
    expect(destroy).toHaveBeenCalledTimes(1); // once, however many paths reach it
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
  });

  it("draws with annotations off, so links and form fields are never made active", async () => {
    const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: () => {} }));
    const { library } = workingDocument({ getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 100 * scale }), render });
    const session = await openPdf({ ...library, AnnotationMode: { DISABLE: 77 } }, new Uint8Array(1));
    await session.renderPage(1, () => ({}) as HTMLCanvasElement);
    expect((render.mock.calls as unknown as { annotationMode: number }[][])[0][0].annotationMode).toBe(77);
  });

  it("opening a document draws nothing: a page is drawn only when chosen, one at a time", async () => {
    const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: () => {} }));
    const { library } = workingDocument({ getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 100 * scale }), render }, 5);
    const session = await openPdf(library, new Uint8Array(1));
    expect(session.pageCount).toBe(5);
    expect(render).not.toHaveBeenCalled();
    await session.renderPage(3, () => ({}) as HTMLCanvasElement);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("the real library's annotation-off setting exists, and is what's used", () => {
    expect(typeof pdfjs.AnnotationMode.DISABLE).toBe("number");
  });

  it("any refusal destroys the worker too", async () => {
    const { library, destroy } = workingDocument({}, PDF_LIMITS.maxPages + 1);
    expect(await rejection(openPdf(library, new Uint8Array(1)))).toBe("too_many_pages");
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("the real library's worker work is ended by destroy", async () => {
    const session = await open(fixtures.usLabel());
    await session.destroy();
    await expect(session.renderPage(1, () => ({}) as HTMLCanvasElement)).rejects.toBeDefined();
  });

  it("a bomb is bounded: the file is small, and it finishes or stops by the deadline", async () => {
    const file = (fixtures.bomb as unknown as (mb: number) => Buffer)(100);
    expect(file.length).toBeLessThan(1024 * 1024);
    const started = Date.now();
    const outcome = await openPdf(pdfjs, bytes(file), {}, { pageTextMs: 5000 }).then(async (s) => { await s.destroy(); return "read"; }, (e) => e.code);
    expect(["read", "timeout", "malformed"]).toContain(outcome);
    expect(Date.now() - started).toBeLessThan(15_000);
  }, HEAVY);
});

describe("rendering limits", () => {
  it("never above 300 DPI", () => {
    expect(renderScale(612, 792)).toBeCloseTo(300 / 72, 5);
  });

  it.each([[14400, 14400], [5000, 200], [200, 5000], [10000, 10000]])("a %d by %d point page stays within the pixel limit", (w, h) => {
    const scale = renderScale(w, h);
    expect(Math.floor(w * scale) * Math.floor(h * scale)).toBeLessThanOrEqual(PDF_LIMITS.maxRenderPixels);
  });
});
