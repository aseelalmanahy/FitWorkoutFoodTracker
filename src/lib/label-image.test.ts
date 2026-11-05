import { describe, expect, it } from "vitest";
import { IMAGE_LIMITS } from "./image-limits";
import { cropToPixels, describePreparation, FULL_CROP, isFullCrop, JPEG_QUALITY_STEPS, planPreparation, PREPARED_LONG_EDGE, sniffFileKind } from "./label-image";

const bytes = (...parts: (number[] | string)[]) => Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const plan = (over: Partial<Parameters<typeof planPreparation>[0]> = {}) => planPreparation({ kind: "jpeg", fileBytes: 2_000_000, imageWidth: 2000, imageHeight: 1500, crop: FULL_CROP, ...over });

describe("file kinds come from content", () => {
  it("recognises the accepted formats", () => {
    expect(sniffFileKind(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffFileKind(bytes("\x89PNG\r\n\x1a\n"))).toBe("png");
    expect(sniffFileKind(bytes("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
  });

  it.each(["heic", "heix", "hevc", "mif1", "msf1"])("recognises HEIC with the brand %s", (brand) => {
    expect(sniffFileKind(bytes([0, 0, 0, 24], "ftyp", brand))).toBe("heic");
  });

  it("recognises a PDF, which is never treated as an image", () => {
    expect(sniffFileKind(bytes("%PDF-1.7"))).toBe("pdf");
    expect(plan({ kind: "pdf" }).action).toBe("reencode");
  });

  it("doesn't mistake other files for images", () => {
    expect(sniffFileKind(bytes("<svg>"))).toBe("unknown");
    expect(sniffFileKind(bytes("GIF89a"))).toBe("unknown");
    expect(sniffFileKind(bytes([0, 0, 0, 24], "ftyp", "isom"))).toBe("unknown"); // an MP4 video
    expect(sniffFileKind(bytes("RIFF\0\0\0\0WAVEfmt "))).toBe("unknown");
    expect(sniffFileKind(new Uint8Array(0))).toBe("unknown");
  });
});

describe("avoiding unnecessary changes", () => {
  it.each(["jpeg", "png", "webp"] as const)("uploads a %s unchanged when it already fits", (kind) => {
    expect(plan({ kind })).toEqual({ action: "original", mediaType: `image/${kind}`, width: 2000, height: 1500 });
  });

  it("uploads an image exactly at the long-edge limit unchanged", () => {
    expect(plan({ imageWidth: PREPARED_LONG_EDGE, imageHeight: 1000 }).action).toBe("original");
    expect(plan({ imageWidth: PREPARED_LONG_EDGE + 1, imageHeight: 1000 }).action).toBe("reencode");
  });

  it("never enlarges a small crop or image", () => {
    const p = plan({ imageWidth: 2000, imageHeight: 1500, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } });
    expect(p).toMatchObject({ action: "reencode", width: 1000, height: 750, scaled: false, source: { x: 500, y: 375, width: 1000, height: 750 } });
  });
});

describe("large phone photos", () => {
  it("scales a 48 MP photo to the long-edge limit, keeping its shape", () => {
    const p = plan({ imageWidth: 8000, imageHeight: 6000, fileBytes: 6_000_000 });
    expect(p).toMatchObject({ action: "reencode", width: 2576, height: 1932, scaled: true, suggestCrop: true });
  });

  it("handles a 200 MP photo the same way, staying under the server's pixel limit", () => {
    const p = plan({ imageWidth: 16320, imageHeight: 12240, fileBytes: 20_000_000 });
    if (p.action !== "reencode") throw new Error("expected re-encoding");
    expect(Math.max(p.width, p.height)).toBe(PREPARED_LONG_EDGE);
    expect(p.width * p.height).toBeLessThanOrEqual(IMAGE_LIMITS.maxPixels);
  });

  it("works for portrait photos, whose dimensions are already upright", () => {
    expect(plan({ imageWidth: 6000, imageHeight: 8000 })).toMatchObject({ width: 1932, height: 2576 });
  });

  it("a crop of a large photo keeps its original pixels", () => {
    const p = plan({ imageWidth: 8000, imageHeight: 6000, crop: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 } });
    expect(p).toMatchObject({ action: "reencode", source: { x: 3200, y: 2400, width: 1600, height: 1200 }, width: 1600, height: 1200, scaled: false, suggestCrop: false });
  });

  it("a crop larger than the limit is scaled but doesn't suggest cropping again unless uncropped", () => {
    expect(plan({ imageWidth: 8000, imageHeight: 6000, crop: { x: 0, y: 0, width: 0.9, height: 0.9 } })).toMatchObject({ scaled: true, suggestCrop: false });
  });

  it("only suggests cropping when the reduction is heavy", () => {
    expect(plan({ imageWidth: 4000, imageHeight: 3000 })).toMatchObject({ scaled: true, suggestCrop: false });
    expect(plan({ imageWidth: 6000, imageHeight: 4500 })).toMatchObject({ scaled: true, suggestCrop: true });
  });

  it("re-encodes a small file that's over the byte limit, without scaling it", () => {
    expect(plan({ fileBytes: IMAGE_LIMITS.maxBytes + 1, kind: "png" })).toMatchObject({ action: "reencode", width: 2000, height: 1500, scaled: false });
  });
});

describe("HEIC and other formats", () => {
  it("a HEIC the browser can decode is re-encoded, as the server doesn't accept it", () => {
    expect(plan({ kind: "heic" })).toMatchObject({ action: "reencode", scaled: false });
  });

  it("never uploads an unknown file unchanged", () => {
    expect(plan({ kind: "unknown" }).action).toBe("reencode");
  });
});

describe("limits", () => {
  it("refuses a crop too small to read, rather than enlarging it", () => {
    expect(plan({ imageWidth: 1000, imageHeight: 1000, crop: { x: 0, y: 0, width: 0.1, height: 0.5 } })).toEqual({ action: "reject", reason: "too_small" });
  });

  it("refuses a very narrow image that scaling would make unreadable", () => {
    expect(plan({ imageWidth: 16000, imageHeight: 1000 })).toEqual({ action: "reject", reason: "too_small" });
  });

  it("quality has a floor, and only two steps", () => {
    expect(JPEG_QUALITY_STEPS).toEqual([0.92, 0.85]);
  });

  it("every prepared image fits the server's limits", () => {
    for (const [w, h] of [[200, 200], [8000, 8000], [16320, 12240], [3000, 400]]) {
      const p = plan({ imageWidth: w, imageHeight: h });
      if (p.action === "reject") continue;
      expect(p.width).toBeGreaterThanOrEqual(IMAGE_LIMITS.minDimension);
      expect(p.height).toBeGreaterThanOrEqual(IMAGE_LIMITS.minDimension);
      expect(p.width * p.height).toBeLessThanOrEqual(IMAGE_LIMITS.maxPixels);
    }
  });
});

describe("crop", () => {
  it("recognises the whole image", () => {
    expect(isFullCrop(FULL_CROP)).toBe(true);
    expect(isFullCrop({ x: 0, y: 0, width: 0.99, height: 1 })).toBe(false);
  });

  it("always stays inside the image", () => {
    expect(cropToPixels({ x: -1, y: -1, width: 5, height: 5 }, 100, 50)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(cropToPixels({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }, 100, 100)).toEqual({ x: 90, y: 90, width: 10, height: 10 });
  });
});

describe("descriptions say what changed", () => {
  it.each([
    [{ imageWidth: 2000, imageHeight: 1500 }, "Your original photo, unchanged (2,000 x 1,500)."],
    [{ imageWidth: 8000, imageHeight: 6000 }, "Scaled from 8,000 x 6,000 to 2,576 x 1,932."],
    [{ imageWidth: 8000, imageHeight: 6000, crop: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 } }, "Cropped to 1,600 x 1,200, with every pixel kept."],
    [{ imageWidth: 8000, imageHeight: 6000, crop: { x: 0, y: 0, width: 0.9, height: 0.9 } }, "Cropped and scaled from 7,200 x 5,400 to 2,576 x 1,932."],
    [{ imageWidth: 2000, imageHeight: 1500, kind: "heic" as const }, "Converted to JPEG at 2,000 x 1,500, with every pixel kept."],
  ])("%j", (over, text) => {
    const p = plan(over);
    if (p.action === "reject") throw new Error("unexpected");
    expect(describePreparation(p, over.imageWidth, over.imageHeight)).toBe(text);
  });
});
