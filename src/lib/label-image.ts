/**
 * Decides how to prepare a photo of a label in the browser. Pure logic, so the rules can be tested
 * without one. The goal is the most readable label, not the smallest file: pixels are changed only
 * when they must be, and quality is never lowered in a loop until a file fits.
 */
import { IMAGE_LIMITS, IMAGE_MEDIA_TYPES, type ImageFormat } from "./image-limits";

/** Vision providers work at up to this long edge, so more detail isn't read. */
export const PREPARED_LONG_EDGE = 2576;
/** Tried in order, once each. Below the last, the user is asked to crop instead. */
export const JPEG_QUALITY_STEPS = [0.92, 0.85] as const;
/** Uncropped photos scaled below this share of their size get advice to crop to the label. */
const HEAVY_SCALE = 0.5;

export type FileKind = ImageFormat | "heic" | "unknown";

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

/** The file's real kind from its first bytes. A browser's file type and extension aren't reliable. */
export function sniffFileKind(head: Uint8Array): FileKind {
  const text = (start: number, length: number) => String.fromCharCode(...head.subarray(start, start + length));
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (text(0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (text(0, 4) === "RIFF" && text(8, 4) === "WEBP") return "webp";
  if (text(4, 4) === "ftyp" && HEIC_BRANDS.has(text(8, 4))) return "heic";
  return "unknown";
}

/** A crop as shares of the upright image, each from 0 to 1. */
export interface CropShare { x: number; y: number; width: number; height: number }
export const FULL_CROP: CropShare = { x: 0, y: 0, width: 1, height: 1 };

export const isFullCrop = (c: CropShare) => c.x <= 0 && c.y <= 0 && c.width >= 1 && c.height >= 1;

export interface PixelRect { x: number; y: number; width: number; height: number }

/** Maps a crop onto original pixels, always inside the image. */
export function cropToPixels(crop: CropShare, imageWidth: number, imageHeight: number): PixelRect {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const x = Math.round(clamp(crop.x) * imageWidth);
  const y = Math.round(clamp(crop.y) * imageHeight);
  const right = Math.round(clamp(crop.x + crop.width) * imageWidth);
  const bottom = Math.round(clamp(crop.y + crop.height) * imageHeight);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

export type PreparationPlan =
  /** The file is uploaded unchanged, with no re-encoding. The server applies rotation and removes metadata. */
  | { action: "original"; mediaType: string; width: number; height: number }
  | { action: "reencode"; source: PixelRect; width: number; height: number; scaled: boolean; suggestCrop: boolean }
  | { action: "reject"; reason: "too_small" };

export function planPreparation(input: { kind: FileKind; fileBytes: number; imageWidth: number; imageHeight: number; crop: CropShare }): PreparationPlan {
  const { kind, fileBytes, imageWidth, imageHeight, crop } = input;
  const full = isFullCrop(crop);
  const source = full ? { x: 0, y: 0, width: imageWidth, height: imageHeight } : cropToPixels(crop, imageWidth, imageHeight);
  const longEdge = Math.max(source.width, source.height);
  const scale = Math.min(1, PREPARED_LONG_EDGE / longEdge); // never enlarged
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);
  if (width < IMAGE_LIMITS.minDimension || height < IMAGE_LIMITS.minDimension) return { action: "reject", reason: "too_small" };

  if (full && scale === 1 && fileBytes <= IMAGE_LIMITS.maxBytes && (kind === "jpeg" || kind === "png" || kind === "webp")) {
    return { action: "original", mediaType: IMAGE_MEDIA_TYPES[kind], width, height };
  }
  return { action: "reencode", source, width, height, scaled: scale < 1, suggestCrop: full && scale < HEAVY_SCALE };
}

/** Plain words for what preparation changed, shown so that nothing happens silently. */
export function describePreparation(plan: Exclude<PreparationPlan, { action: "reject" }>, imageWidth: number, imageHeight: number): string {
  const size = (w: number, h: number) => `${w.toLocaleString("en-US")} x ${h.toLocaleString("en-US")}`;
  if (plan.action === "original") return `Your original photo, unchanged (${size(plan.width, plan.height)}).`;
  const cropped = plan.source.width !== imageWidth || plan.source.height !== imageHeight;
  if (plan.scaled) return `${cropped ? "Cropped and scaled" : "Scaled"} from ${size(plan.source.width, plan.source.height)} to ${size(plan.width, plan.height)}.`;
  return cropped ? `Cropped to ${size(plan.width, plan.height)}, with every pixel kept.` : `Converted to JPEG at ${size(plan.width, plan.height)}, with every pixel kept.`;
}
