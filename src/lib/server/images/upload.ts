import "server-only";
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { HttpError, readLimitedBytes } from "@/lib/server/api";
import { beginImageUpload } from "./upload-limits";
import { IMAGE_LIMITS, IMAGE_MEDIA_TYPES, validateImage, type ImageRejection, type ValidImage } from "./validate";

const READ_TIMEOUT_MS = 30_000;
const ACCEPTED_TYPES = new Set<string>(Object.values(IMAGE_MEDIA_TYPES));

const REJECTIONS: Record<ImageRejection, { status: number; message: string; headers?: Record<string, string> }> = {
  unsupported_format: { status: 415, message: "Use a JPEG, PNG or WebP image" },
  malformed: { status: 400, message: "This image is damaged or incomplete" },
  animated: { status: 415, message: "Animated images aren't supported" },
  too_small: { status: 422, message: `The image must be at least ${IMAGE_LIMITS.minDimension} pixels on each side` },
  too_large: { status: 413, message: "The image is too large" },
  timeout: { status: 503, message: "This image took too long to process. Try a smaller one.", headers: { "Retry-After": "5" } },
  busy: { status: 503, message: "Too many images are being processed. Try again shortly.", headers: { "Retry-After": "5" } },
};

export interface ValidatedUpload {
  image: ValidImage;
  /** Size of the file as uploaded. */
  bytes: number;
  /** SHA-256 of the file as uploaded. */
  sha256: string;
  /**
   * For work that can outlast the handler, such as a provider request after its deadline. The slot
   * stays held until the returned function is called. Calling it again has no effect.
   */
  holdSlot: () => () => void;
}

/**
 * Receives one image sent as the raw request body and hands the validated result to `handler`. No
 * file name is accepted, and nothing is stored: the bytes exist in memory only while the request
 * is processed, and are never logged. Call this after authentication.
 *
 * The upload's slot is held until the handler, any decoding and any work under `holdSlot` have
 * really ended, which can be after a timeout response was sent, so slow work always counts against
 * the limits. Work that never ends keeps its slot: new uploads are refused once all slots are held,
 * and routes that don't take uploads are unaffected.
 */
export async function withValidatedImage<T>(req: NextRequest, userId: string, handler: (upload: ValidatedUpload) => Promise<T>): Promise<T> {
  const declared = req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!ACCEPTED_TYPES.has(declared) || req.headers.has("content-encoding")) throw new HttpError(415, REJECTIONS.unsupported_format.message);

  const slot = beginImageUpload(userId);
  if (!slot.allowed) throw new HttpError(429, "Too many image uploads. Try again later.", undefined, { "Retry-After": String(slot.retryAfterSec) });

  let holders = 1;
  const releaseOne = () => { if (--holders === 0) slot.release(); };
  const holdSlot = () => {
    holders++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseOne();
    };
  };
  try {
    const bytes = await readLimitedBytes(req, { maxBytes: IMAGE_LIMITS.maxBytes, timeoutMs: READ_TIMEOUT_MS });
    holders++;
    const image = await validateImage(bytes, { onFinished: releaseOne });
    if (!image.ok) {
      const { status, message, headers } = REJECTIONS[image.code];
      throw new HttpError(status, message, undefined, headers);
    }
    if (image.mediaType !== declared) throw new HttpError(415, "The file's content doesn't match its type");
    return await handler({ image, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), holdSlot });
  } finally {
    releaseOne();
  }
}
