/** Limits every uploaded image must meet, shared so the browser can prepare images to fit them. The server enforces them. */
export const IMAGE_LIMITS = {
  /** Base64 adds a third, so this still fits within a 10 MB base64 request limit for vision APIs. */
  maxBytes: 7 * 1024 * 1024,
  /** Smaller images are unreadable for label text. */
  minDimension: 200,
  maxDimension: 8000,
  /**
   * Sets the memory used to decode: about 500 MB at worst, for an RGBA WebP. It's well above the
   * 2,576 px long edge vision providers work at. It also keeps images in memory: libvips writes a
   * decoded WebP to a temp file above 100 MiB, so raising this far enough would break that promise.
   */
  maxPixels: 16_000_000,
  processingMs: 15_000,
} as const;

export const IMAGE_MEDIA_TYPES = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
export type ImageFormat = keyof typeof IMAGE_MEDIA_TYPES;
