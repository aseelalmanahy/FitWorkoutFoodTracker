"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { IMAGE_LIMITS } from "@/lib/image-limits";
import { describePreparation, FULL_CROP, isFullCrop, JPEG_QUALITY_STEPS, planPreparation, sniffFileKind, type CropShare, type FileKind } from "@/lib/label-image";
import type { LabelExtraction, LabelFlag, NutrientField } from "@/lib/label-extraction";
import { Button, Card, ErrorText } from "@/components/ui";

const HEIC_HELP = "This browser can't open HEIC photos. Export the photo as JPEG, or set your iPhone camera to Most Compatible, then try again.";
const OPEN_FAILED = "This file couldn't be opened as an image. Use a JPEG, PNG or WebP photo.";
const TOO_SMALL = `The selected area is too small to read. It needs at least ${IMAGE_LIMITS.minDimension} pixels on each side.`;
const TOO_LARGE = "This image can't be made small enough without losing quality. Crop closer to the label and try again.";
const PREPARE_FAILED = "This photo is too large for this device to prepare. Crop closer to the label, or use a smaller photo.";

interface Opened { file: File; url: string; kind: FileKind; image: HTMLImageElement; width: number; height: number }
interface Prepared { blob: Blob; url: string; width: number; height: number; description: string; suggestCrop: boolean }
interface ScanResult { notice: string; extraction: LabelExtraction; flags: LabelFlag[] }

const canvasBlob = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

/** Draws only the selected pixels, at their final size. A canvas the size of a large photo can fail on phones. */
async function prepare(opened: Opened, crop: CropShare): Promise<Prepared | { error: string }> {
  const plan = planPreparation({ kind: opened.kind, fileBytes: opened.file.size, imageWidth: opened.width, imageHeight: opened.height, crop });
  if (plan.action === "reject") return { error: TOO_SMALL };
  const description = describePreparation(plan, opened.width, opened.height);
  if (plan.action === "original") return { blob: opened.file.slice(0, opened.file.size, plan.mediaType), url: URL.createObjectURL(opened.file), width: plan.width, height: plan.height, description, suggestCrop: false };

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
      return { blob, url: URL.createObjectURL(blob), width: plan.width, height: plan.height, description, suggestCrop: plan.suggestCrop };
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

function NutrientValue({ field }: { field: NutrientField }) {
  if (field.status === "absent") return <span className="text-muted">Not on label</span>;
  if (field.status === "unreadable") return <span className="text-amber-700 dark:text-amber-400">Couldn&apos;t read</span>;
  return <span>{field.printed}</span>;
}

const NUTRIENT_ROWS = [["kcal", "Calories"], ["protein", "Protein"], ["carbs", "Carbohydrate"], ["fat", "Fat"], ["fiber", "Fiber"]] as const;
const BASIS_LABELS = { per_serving: "Per serving", per_100g: "Per 100 g", per_100ml: "Per 100 ml", other: "Other" } as const;

function FieldText({ label, value, unreadable, absent }: { label: string; value: string | null; unreadable: boolean; absent: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right">{absent ? <span className="text-muted">Not on label</span> : unreadable ? <span className="text-amber-700 dark:text-amber-400">Couldn&apos;t read</span> : value}</span>
    </div>
  );
}

function Result({ result }: { result: ScanResult }) {
  const { extraction: e, flags, notice } = result;
  return (
    <div className="space-y-4" data-testid="scan-result">
      <Card className="border-amber-500/60 p-4">
        <p className="font-medium text-amber-700 dark:text-amber-400" role="status">{notice}</p>
      </Card>
      <Card className="p-4">
        <FieldText label="Product" value={e.productName.value} absent={e.productName.status === "absent"} unreadable={e.productName.status === "unreadable"} />
        <FieldText label="Brand" value={e.brand.value} absent={e.brand.status === "absent"} unreadable={e.brand.status === "unreadable"} />
        <FieldText label="Serving size" value={e.servingSize.printed} absent={e.servingSize.status === "absent"} unreadable={e.servingSize.status === "unreadable"} />
        <FieldText label="Servings per container" value={e.servingsPerContainer.printed} absent={e.servingsPerContainer.status === "absent"} unreadable={e.servingsPerContainer.status === "unreadable"} />
      </Card>
      {e.columns.map((column, i) => (
        <Card key={i} className="p-4">
          <h3 className="mb-2 font-medium">{BASIS_LABELS[column.basis]}{column.printedHeading ? ` (printed: ${column.printedHeading})` : ""}</h3>
          <dl>
            {NUTRIENT_ROWS.map(([key, label]) => (
              <div key={key} className="flex justify-between gap-4 py-1 text-sm">
                <dt className="text-muted">{label}</dt>
                <dd className="text-right"><NutrientValue field={column[key]} /></dd>
              </div>
            ))}
          </dl>
        </Card>
      ))}
      {flags.length > 0 && (
        <Card className="p-4" data-testid="scan-flags">
          <h3 className="mb-2 font-medium">Check these</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {flags.map((flag, i) => <li key={i}>{flag.message}</li>)}
          </ul>
        </Card>
      )}
      <p className="text-sm text-muted">Nothing has been saved. Correcting and saving these values isn&apos;t available yet.</p>
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

      {stage === "result" && result && (
        <>
          <Result result={result} />
          <Button variant="secondary" onClick={reset}>Scan another label</Button>
        </>
      )}

      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
