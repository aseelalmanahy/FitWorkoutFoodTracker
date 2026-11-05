"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { IMAGE_LIMITS } from "@/lib/image-limits";
import { describePreparation, FULL_CROP, isFullCrop, JPEG_QUALITY_STEPS, planPreparation, sniffFileKind, type CropShare, type FileKind } from "@/lib/label-image";
import type { LabelExtraction } from "@/lib/label-extraction";
import { Button, Card, ErrorText } from "@/components/ui";
import { LabelReview } from "./label-review";

const HEIC_HELP = "This browser can't open HEIC photos. Export the photo as JPEG, or set your iPhone camera to Most Compatible, then try again.";
const OPEN_FAILED = "This file couldn't be opened as an image. Use a JPEG, PNG or WebP photo.";
const TOO_SMALL = `The selected area is too small to read. It needs at least ${IMAGE_LIMITS.minDimension} pixels on each side.`;
const TOO_LARGE = "This image can't be made small enough without losing quality. Crop closer to the label and try again.";
const PREPARE_FAILED = "This photo is too large for this device to prepare. Crop closer to the label, or use a smaller photo.";

interface Opened { file: File; url: string; kind: FileKind; image: HTMLImageElement; width: number; height: number }
interface Prepared { blob: Blob; url: string; width: number; height: number; description: string; suggestCrop: boolean; changed: boolean }
interface ScanResult { notice: string; extraction: LabelExtraction }

const canvasBlob = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

/** Draws only the selected pixels, at their final size. A canvas the size of a large photo can fail on phones. */
async function prepare(opened: Opened, crop: CropShare): Promise<Prepared | { error: string }> {
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

type Stage = "pick" | "crop" | "review" | "scanning" | "result";

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

  const track = useCallback((url: string) => { urls.current.add(url); return url; }, []);
  useEffect(() => {
    const all = urls.current;
    return () => { for (const url of all) URL.revokeObjectURL(url); };
  }, []);

  const reset = () => {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
    setOpened(null);
    setPrepared(null);
    setResult(null);
    setCrop(FULL_CROP);
    setStage("pick");
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setError(null);
    const kind = sniffFileKind(new Uint8Array(await file.slice(0, 32).arrayBuffer()));
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
          <label className="block text-sm font-medium" htmlFor="label-photo">Photo of a nutrition label</label>
          <p className="mb-3 mt-1 text-sm text-muted">JPEG, PNG or WebP. Fill the frame with the label, in good light.</p>
          <input ref={fileInput} id="label-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        </Card>
      )}

      {stage === "crop" && opened && (
        <>
          <p className="text-sm">Drag across the label to crop it. Cropping keeps the text sharpest. This is optional.</p>
          <Cropper opened={opened} crop={crop} onChange={setCrop} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void onPrepare()} disabled={working}>{working ? "Preparing…" : "Continue"}</Button>
            {!isFullCrop(crop) && <Button variant="secondary" onClick={() => setCrop(FULL_CROP)}>Reset crop</Button>}
            <Button variant="secondary" onClick={reset}>Choose another photo</Button>
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
          // Corrections live in this component, so going back discards them, as the button says.
          onRescan={() => { setResult(null); setError(null); setStage("review"); }}
          onScanAnother={reset}
        />
      )}

      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
