"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { IMAGE_LIMITS } from "@/lib/image-limits";
import { describePreparation, FULL_CROP, isFullCrop, JPEG_QUALITY_STEPS, planPreparation, sniffFileKind, type CropShare, type FileKind } from "@/lib/label-image";
import type { LabelExtraction } from "@/lib/label-extraction";
import { browserPdfOptions, loadPdfLibrary } from "@/lib/client/pdf-browser";
import { checkPdfBlob, openPdf, type PdfSession } from "@/lib/pdf/document";
import type { LabelSection } from "@/lib/pdf/label-text";
import { PDF_MESSAGES, PdfError } from "@/lib/pdf/limits";
import { Button, Card, ErrorText } from "@/components/ui";
import { LabelReview } from "./label-review";
import { PdfPagePicker, type PdfPagePreview } from "./pdf-page-picker";

export const HEIC_HELP = "This browser can't open HEIC photos. Export the photo as JPEG, or set your iPhone camera to Most Compatible, then try again.";
export const OPEN_FAILED = "This file couldn't be opened as an image. Use a JPEG, PNG or WebP photo.";
const TOO_SMALL = `The selected area is too small to read. It needs at least ${IMAGE_LIMITS.minDimension} pixels on each side.`;
const TOO_LARGE = "This image can't be made small enough without losing quality. Crop closer to the label and try again.";
const TEXT_NOTICE = "Unverified. These values were read from the PDF's text, and may be wrong or in the wrong column. Check every value against the page before using it.";
const PDF_FAILED = "This PDF couldn't be read.";
export const PREPARE_FAILED = "This photo is too large for this device to prepare. Crop closer to the label, or use a smaller photo.";

export interface Opened { file: File; url: string; kind: FileKind; image: HTMLImageElement; width: number; height: number }
export interface Prepared { blob: Blob; url: string; width: number; height: number; description: string; suggestCrop: boolean; changed: boolean }
interface ScanResult { notice: string; extraction: LabelExtraction }

const canvasBlob = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

/** Draws only the selected pixels, at their final size. A canvas the size of a large photo can fail on phones. */
export async function prepare(opened: Opened, crop: CropShare): Promise<Prepared | { error: string }> {
  const plan = planPreparation({ kind: opened.kind, fileBytes: opened.file.size, imageWidth: opened.width, imageHeight: opened.height, crop });
  if (plan.action === "reject") return { error: TOO_SMALL };
  const description = describePreparation(plan, opened.width, opened.height);
  if (plan.action === "original") return { blob: opened.file.slice(0, opened.file.size, plan.mediaType), url: URL.createObjectURL(opened.file), width: plan.width, height: plan.height, description, suggestCrop: false, changed: false };

  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const context = canvas.getContext("2d");
  if (!context) return { error: PREPARE_FAILED };
  context.fillStyle = "#fff"; // JPEG has no transparency
  context.fillRect(0, 0, plan.width, plan.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  // Browsers apply EXIF rotation when drawing an image element, but disagree on what a source
  // rectangle means on a rotated one. So the whole upright image is positioned instead, and the
  // canvas clips it to the crop, which needs no canvas larger than the result.
  const scale = plan.width / plan.source.width;
  context.drawImage(opened.image, -plan.source.x * scale, -plan.source.y * scale, opened.width * scale, opened.height * scale);
  // A canvas over a browser's limits can fail silently, leaving nothing but the white background.
  const sample = context.getImageData(Math.floor(plan.width / 2), Math.floor(plan.height / 2), 1, 1).data;
  if (sample[3] === 0) return { error: PREPARE_FAILED };

  for (const quality of JPEG_QUALITY_STEPS) {
    const blob = await canvasBlob(canvas, quality);
    if (!blob) return { error: PREPARE_FAILED };
    if (blob.size <= IMAGE_LIMITS.maxBytes) {
      return { blob, url: URL.createObjectURL(blob), width: plan.width, height: plan.height, description, suggestCrop: plan.suggestCrop, changed: true };
    }
  }
  return { error: TOO_LARGE };
}

function Cropper({ opened, crop, onChange }: { opened: Opened; crop: CropShare; onChange: (crop: CropShare) => void }) {
  const area = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const share = (e: ReactPointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  return (
    <div
      ref={area}
      data-testid="crop-area"
      className="relative touch-none select-none overflow-hidden rounded-lg"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); start.current = share(e); }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const p = share(e);
        const next = { x: Math.min(start.current.x, p.x), y: Math.min(start.current.y, p.y), width: Math.abs(p.x - start.current.x), height: Math.abs(p.y - start.current.y) };
        if (next.width > 0.01 && next.height > 0.01) onChange(next);
      }}
      onPointerUp={() => { start.current = null; }}
      onPointerCancel={() => { start.current = null; }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the user's own file */}
      <img src={opened.url} alt="Your photo" draggable={false} className="block w-full" />
      {!isFullCrop(crop) && (
        <div
          data-testid="crop-box"
          className="pointer-events-none absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
          style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}
        />
      )}
    </div>
  );
}

type Stage = "pick" | "pdf" | "crop" | "review" | "scanning" | "result";
const canvasPng = (canvas: HTMLCanvasElement) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));

export function LabelScanner() {
  const [stage, setStage] = useState<Stage>("pick");
  const [opened, setOpened] = useState<Opened | null>(null);
  const [crop, setCrop] = useState<CropShare>(FULL_CROP);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const urls = useRef(new Set<string>());
  const fileInput = useRef<HTMLInputElement>(null);
  const [pdf, setPdf] = useState<{ session: PdfSession; fileName: string } | null>(null);
  const [pdfPage, setPdfPage] = useState<number | null>(null);
  const [pdfPreview, setPdfPreview] = useState<(PdfPagePreview & { file: File; image: HTMLImageElement; width: number; height: number }) | null>(null);
  const pdfSession = useRef<PdfSession | null>(null);
  const leftPage = useRef(false);
  const [fromText, setFromText] = useState(false);

  const track = useCallback((url: string) => { urls.current.add(url); return url; }, []);
  useEffect(() => {
    const all = urls.current;
    leftPage.current = false;
    return () => {
      leftPage.current = true;
      for (const url of all) URL.revokeObjectURL(url);
      void pdfSession.current?.destroy(); // terminates its worker
    };
  }, []);

  const reset = () => {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
    setOpened(null);
    setPrepared(null);
    setResult(null);
    setCrop(FULL_CROP);
    setStage("pick");
    void pdfSession.current?.destroy();
    pdfSession.current = null;
    setPdf(null);
    setPdfPage(null);
    setPdfPreview(null);
    setFromText(false);
  };

  const openPdfFile = async (file: File) => {
    setWorking(true);
    try {
      const rejection = await checkPdfBlob(file);
      if (rejection) {
        setError(PDF_MESSAGES[rejection]);
        return;
      }
      const pdfjs = await loadPdfLibrary();
      const session = await openPdf(pdfjs, new Uint8Array(await file.arrayBuffer()), browserPdfOptions());
      if (leftPage.current) {
        void session.destroy();
        return;
      }
      pdfSession.current = session;
      setPdf({ session, fileName: file.name });
      setStage("pdf");
    } catch (err) {
      setError(err instanceof PdfError ? err.message : PDF_FAILED);
    } finally {
      setWorking(false);
    }
  };

  /** Draws only the chosen page, then frees its canvas once it's an image. */
  const selectPdfPage = async (number: number) => {
    if (!pdf) return;
    setError(null);
    setPdfPage(number);
    setPdfPreview(null);
    setWorking(true);
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = await pdf.session.renderPage(number, (width, height) => {
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        return c;
      });
      const blob = await canvasPng(canvas);
      if (!blob) throw new PdfError("page_too_large");
      const file = new File([blob], `page-${number}.png`, { type: "image/png" });
      const url = track(URL.createObjectURL(file));
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new PdfError("malformed"));
        image.src = url;
      });
      setPdfPreview({ number, url, file, image, width: image.naturalWidth, height: image.naturalHeight });
    } catch (err) {
      setPdfPage(null);
      setError(err instanceof PdfError ? err.message : PDF_FAILED);
      // A timeout terminated the worker, so this document can't be used again.
      if (err instanceof PdfError && err.code === "timeout") {
        pdfSession.current = null;
        setPdf(null);
        setStage("pick");
      }
    } finally {
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      setWorking(false);
    }
  };

  const openedFromPreview = () => (pdfPreview ? { file: pdfPreview.file, url: pdfPreview.url, kind: "png" as const, image: pdfPreview.image, width: pdfPreview.width, height: pdfPreview.height } : null);

  /** From here a PDF page is an image like any other photo, with the same crop, checks and upload. */
  const usePdfPageImage = () => {
    const page = openedFromPreview();
    if (!page) return;
    setError(null);
    setFromText(false);
    setOpened(page);
    setCrop(FULL_CROP);
    setStage("crop");
  };

  const usePdfSection = async (section: LabelSection) => {
    const page = openedFromPreview();
    if (!page || !section.result.reliable) return;
    setError(null);
    setWorking(true);
    try {
      const next = await prepare(page, FULL_CROP);
      if ("error" in next) {
        setError(next.error);
        return;
      }
      track(next.url);
      setOpened(page);
      setCrop(FULL_CROP);
      setPrepared(next);
      setFromText(true);
      setResult({ notice: TEXT_NOTICE, extraction: section.result.extraction });
      setStage("result");
    } catch {
      setError(PREPARE_FAILED);
    } finally {
      setWorking(false);
    }
  };

  const backToPages = () => {
    setError(null);
    setResult(null);
    setPrepared(null);
    setOpened(null);
    setFromText(false);
    setStage("pdf");
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setError(null);
    const kind = sniffFileKind(new Uint8Array(await file.slice(0, 32).arrayBuffer()));
    if (kind === "pdf") {
      void openPdfFile(file);
      return;
    }
    if (kind === "unknown") {
      setError(OPEN_FAILED);
      return;
    }
    const url = track(URL.createObjectURL(file));
    const image = new Image();
    image.onload = () => {
      setOpened({ file, url, kind, image, width: image.naturalWidth, height: image.naturalHeight });
      setStage("crop");
    };
    // Some browsers decode HEIC and some don't, so trying is the only reliable test.
    image.onerror = () => setError(kind === "heic" ? HEIC_HELP : OPEN_FAILED);
    image.src = url;
  };

  // On a slow connection a file can be chosen before this page becomes interactive, which would otherwise be lost.
  useEffect(() => {
    const input = fileInput.current;
    const early = input?.files?.[0];
    if (!input || !early) return;
    input.value = "";
    void pick(early);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only for a file chosen before the first render
  }, []);

  const onPrepare = async () => {
    if (!opened) return;
    setError(null);
    setWorking(true);
    try {
      const next = await prepare(opened, crop);
      if ("error" in next) {
        setError(next.error);
        return;
      }
      track(next.url);
      setPrepared(next);
      setStage("review");
    } catch {
      setError(PREPARE_FAILED);
    } finally {
      setWorking(false);
    }
  };

  const onScan = async () => {
    if (!prepared) return;
    setError(null);
    setStage("scanning");
    try {
      const response = await fetch("/api/nutrition/label-scans", { method: "POST", headers: { "Content-Type": prepared.blob.type }, body: prepared.blob });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "The label couldn't be scanned. Try again later.");
        setStage("review");
        return;
      }
      setResult(body);
      setStage("result");
    } catch {
      setError("The label couldn't be scanned. Check your connection and try again.");
      setStage("review");
    }
  };

  return (
    <div className="space-y-4">
      {stage === "pick" && (
        <Card className="p-4">
          <label className="block text-sm font-medium" htmlFor="label-photo">Photo or PDF of a nutrition label</label>
          <p className="mb-3 mt-1 text-sm text-muted">JPEG, PNG, WebP or PDF. For a photo, fill the frame with the label, in good light.</p>
          <input ref={fileInput} id="label-photo" type="file" disabled={working} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        </Card>
      )}

      {working && stage === "pick" && <p className="text-sm text-muted" role="status" data-testid="pdf-reading">Reading the PDF on this device…</p>}

      {stage === "pdf" && pdf && (
        <PdfPagePicker
          fileName={pdf.fileName}
          session={pdf.session}
          selected={pdfPage}
          preview={pdfPreview}
          working={working}
          onSelect={(number) => void selectPdfPage(number)}
          onUseSection={(section) => void usePdfSection(section)}
          onUseImage={usePdfPageImage}
          onChooseAnother={reset}
        />
      )}

      {pdf && pdfPage !== null && stage !== "pdf" && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="pdf-source">
          <span>From page {pdfPage} of {pdf.session.pageCount} of <span className="font-medium">{pdf.fileName}</span></span>
          <Button size="sm" variant="secondary" onClick={backToPages}>Choose another page</Button>
        </div>
      )}

      {stage === "crop" && opened && (
        <>
          <p className="text-sm">Drag across the label to crop it. Cropping keeps the text sharpest. This is optional.</p>
          <Cropper opened={opened} crop={crop} onChange={setCrop} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void onPrepare()} disabled={working}>{working ? "Preparing…" : "Continue"}</Button>
            {!isFullCrop(crop) && <Button variant="secondary" onClick={() => setCrop(FULL_CROP)}>Reset crop</Button>}
            <Button variant="secondary" onClick={reset}>{pdf ? "Choose another file" : "Choose another photo"}</Button>
          </div>
        </>
      )}

      {(stage === "review" || stage === "scanning") && prepared && (
        <>
          <p className="font-medium">Can you read the numbers clearly?</p>
          <p className="text-sm text-muted" data-testid="prepared-description">{prepared.description} Shown at full resolution, so scroll to check it.</p>
          {prepared.suggestCrop && <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="crop-advice">This photo was reduced a lot. If any text looks soft, crop closer to the label to keep more detail.</p>}
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview, deliberately at full size */}
            <img data-testid="prepared-image" src={prepared.url} alt="Prepared label" className="block max-w-none" />
          </div>
          <p className="text-sm text-muted">Scanning sends this image to our AI provider, after removing location and other hidden data. Your name and email aren&apos;t sent.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void onScan()} disabled={stage === "scanning"}>{stage === "scanning" ? "Reading label…" : "Use this"}</Button>
            <Button variant="secondary" disabled={stage === "scanning"} onClick={() => { setError(null); setStage("crop"); }}>Crop closer</Button>
            <Button variant="secondary" disabled={stage === "scanning"} onClick={reset}>Retake</Button>
          </div>
        </>
      )}

      {stage === "result" && result && prepared && opened && (
        <LabelReview
          extraction={result.extraction}
          notice={result.notice}
          preparedUrl={prepared.url}
          originalUrl={prepared.changed ? opened.url : null}
          rescanLabel={fromText ? "Scan this page image instead" : undefined}
          // Corrections live in this component, so going back discards them, as the button says.
          onRescan={() => { setResult(null); setError(null); setFromText(false); setStage("review"); }}
          onScanAnother={reset}
        />
      )}

      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
