import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { HttpError, readLimitedBytes, route } from "@/lib/server/api";
import { beginImageUpload } from "@/lib/server/images/upload-limits";
import { IMAGE_LIMITS, IMAGE_MEDIA_TYPES, validateImage, type ImageRejection } from "@/lib/server/images/validate";

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

/**
 * Validate one image sent as the raw request body. No file name is accepted, and nothing is stored:
 * the bytes exist in memory only while the request is processed, and are never logged or returned.
 * The browser shows the user's own file for preview, so no image URL exists.
 */
export const POST = route(async (req, { user }) => {
  const declared = req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!ACCEPTED_TYPES.has(declared) || req.headers.has("content-encoding")) throw new HttpError(415, REJECTIONS.unsupported_format.message);

  const slot = beginImageUpload(user.id);
  if (!slot.allowed) throw new HttpError(429, "Too many image uploads. Try again later.", undefined, { "Retry-After": String(slot.retryAfterSec) });
  let handedOver = false;
  try {
    const bytes = await readLimitedBytes(req, { maxBytes: IMAGE_LIMITS.maxBytes, timeoutMs: READ_TIMEOUT_MS });
    handedOver = true;
    // The slot is held until processing really ends, which can be after a timeout response is sent.
    const image = await validateImage(bytes, { onFinished: slot.release });
    if (!image.ok) {
      const { status, message, headers } = REJECTIONS[image.code];
      throw new HttpError(status, message, undefined, headers);
    }
    if (image.mediaType !== declared) throw new HttpError(415, "The file's content doesn't match its type");
    return NextResponse.json(
      {
        ok: true,
        format: image.format,
        mediaType: image.mediaType,
        width: image.width,
        height: image.height,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    if (!handedOver) slot.release();
  }
});
