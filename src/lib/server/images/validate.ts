import "server-only";
/**
 * Proves an uploaded image can be decoded, then produces a clean copy. The file name, extension and
 * declared type are never trusted. Decoding is done by sharp (libvips), a maintained library:
 *
 * 1. The file's first bytes must match an allowed format, and libvips must agree with that format.
 * 2. Dimensions are read from the header and limited before any pixel is decoded.
 * 3. Every pixel is decoded and re-encoded. Damaged data that the decoder notices is rejected.
 * 4. `sanitized` is that re-encoded copy: upright, sRGB, and holding only pixels. Metadata and any
 *    data hidden in the original can't survive. Anything sending an image elsewhere must use it.
 *
 * LIMITATION: baseline JPEG and lossy WebP have no pixel checksums, so some damage decodes cleanly
 * into a wrong-looking picture. No decoder can detect that. PNG data is covered by checksums.
 */
import type sharpModule from "sharp";
import { IMAGE_LIMITS, IMAGE_MEDIA_TYPES, type ImageFormat } from "@/lib/image-limits";

export { IMAGE_LIMITS, IMAGE_MEDIA_TYPES, type ImageFormat };

/** Images accepted or being decoded. Each holds up to maxBytes of input, so this bounds that memory. */
const MAX_PENDING_IMAGES = 4;
const OUTPUT_QUALITY = 90;

export type ImageRejection = "unsupported_format" | "malformed" | "animated" | "too_small" | "too_large" | "timeout" | "busy";

export interface ValidImage {
  ok: true;
  format: ImageFormat;
  mediaType: (typeof IMAGE_MEDIA_TYPES)[ImageFormat];
  /** Dimensions of the upright image, after any EXIF rotation has been applied. */
  width: number;
  height: number;
  sanitized: Uint8Array;
}
export type ImageValidation = ValidImage | { ok: false; code: ImageRejection };

const reject = (code: ImageRejection): ImageValidation => ({ ok: false, code });

let sharpLoad: Promise<typeof sharpModule> | undefined;

/** Loaded on first use, because the settings below must be in place before libvips handles an image. */
function loadSharp() {
  return (sharpLoad ??= (async () => {
    const { default: sharp } = await import("sharp");
    sharp.cache(false); // otherwise libvips keeps recent inputs and results after the request ends
    // Only ever lowered: sharp defaults to 1 on glibc Linux to limit memory fragmentation.
    sharp.concurrency(Math.min(sharp.concurrency(), 2));
    // Don't use sharp.block() here. It's process-wide, and Next's image optimizer sets it too, so
    // each would undo or break the other. Only files passing sniffFormat ever reach libvips.
    return sharp;
  })());
}

function sniffFormat(b: Uint8Array): ImageFormat | null {
  const text = (start: number, length: number) => String.fromCharCode(...b.subarray(start, start + length));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (text(0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (b.length >= 12 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") return "webp";
  return null;
}

/** libvips reads only the first frame of an animated PNG, without saying so. Its marker must come before the image data. */
function isAnimatedPng(b: Uint8Array): boolean {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 8; i + 8 <= b.length; i += 12 + view.getUint32(i)) {
    const type = view.getUint32(i + 4);
    if (type === 0x6163544c) return true; // acTL
    if (type === 0x49444154) return false; // IDAT
  }
  return false;
}

function checkSize(width: number, height: number): ImageRejection | null {
  if (width < IMAGE_LIMITS.minDimension || height < IMAGE_LIMITS.minDimension) return "too_small";
  if (width > IMAGE_LIMITS.maxDimension || height > IMAGE_LIMITS.maxDimension || width * height > IMAGE_LIMITS.maxPixels) return "too_large";
  return null;
}

async function decode(sharp: typeof sharpModule, bytes: Uint8Array, format: ImageFormat, timeoutMs: number): Promise<ImageValidation> {
  const input = { failOn: "warning", limitInputPixels: IMAGE_LIMITS.maxPixels } as const;
  const header = await sharp(bytes, input).metadata();
  if (header.format !== format) return reject("malformed");
  if ((header.pages ?? 1) > 1) return reject("animated");
  const size = checkSize(header.width, header.height);
  if (size) return reject(size);

  const upright = sharp(bytes, input).autoOrient().timeout({ seconds: Math.ceil(timeoutMs / 1000) });
  const encoder = format === "jpeg" ? upright.jpeg({ quality: OUTPUT_QUALITY })
    : format === "webp" ? upright.webp({ quality: OUTPUT_QUALITY })
    : upright.png();
  const { data, info } = await encoder.toBuffer({ resolveWithObject: true });
  if (data.length > IMAGE_LIMITS.maxBytes) return reject("too_large");
  return { ok: true, format, mediaType: IMAGE_MEDIA_TYPES[format], width: info.width, height: info.height, sanitized: data };
}

function decodeFailure(err: unknown): ImageValidation {
  const message = err instanceof Error ? err.message : "";
  if (message.startsWith("timeout")) return reject("timeout");
  if (message.includes("pixel limit")) return reject("too_large");
  return reject("malformed");
}

let queue: Promise<unknown> = Promise.resolve();
let pending = 0;

/**
 * One image is decoded at a time, because each can use hundreds of MB. The caller gets an answer by
 * the deadline, even though libvips can't always be stopped: its timeout doesn't cover PNG encoding.
 * Abandoned work keeps its place in `pending` until it really ends, so it can't pile up.
 * `onFinished` runs exactly once when nothing is using the image any more, which can be after this
 * returns. Whoever limits uploads must hold its slot until then.
 */
export async function validateImage(
  bytes: Uint8Array,
  { timeoutMs = IMAGE_LIMITS.processingMs as number, onFinished }: { timeoutMs?: number; onFinished?: () => void } = {},
): Promise<ImageValidation> {
  let queued = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (bytes.length === 0) return reject("malformed");
    if (bytes.length > IMAGE_LIMITS.maxBytes) return reject("too_large");
    const format = sniffFormat(bytes);
    if (!format) return reject("unsupported_format");
    if (format === "png" && isAnimatedPng(bytes)) return reject("animated");

    const sharp = await loadSharp(); // outside the catch below: a broken install isn't a bad image
    if (pending >= MAX_PENDING_IMAGES) return reject("busy");
    pending++;
    queued = true;

    let expired = false;
    const deadline = new Promise<ImageValidation>((resolve) => {
      timer = setTimeout(() => { expired = true; resolve(reject("timeout")); }, timeoutMs);
    });
    const work = queue
      .then(() => (expired ? reject("timeout") : decode(sharp, bytes, format, timeoutMs)))
      .catch(decodeFailure)
      .finally(() => { pending--; onFinished?.(); });
    queue = work;
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    if (!queued) onFinished?.();
  }
}

/** Test hooks. */
export const _pendingImages = () => pending;
export const _imagesIdle = () => queue;
