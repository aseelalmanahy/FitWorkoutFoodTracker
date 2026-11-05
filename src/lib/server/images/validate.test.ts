// Real images through the real decoder. Only the damage and hidden data are added by hand.
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  bytesOf, contains, cornerColours, exifBlock, exifSegment, jpegComment, jpegXmp, PNG_SIGNATURE, pngChunk, pngChunks, pngClaiming, pngFrom,
  noisy, quadrants, riff, solid, textured, webpAnimated, webpChunk, webpExtended, webpImageChunk, webpVp8x, withJpegSegments, withPngChunks,
} from "@/test/image-fixtures";
import { _imagesIdle, _pendingImages, IMAGE_LIMITS, validateImage, type ValidImage } from "./validate";

const ok = async (bytes: Uint8Array) => {
  const r = await validateImage(bytes);
  if (!r.ok) throw new Error(`expected a valid image, got ${r.code}`);
  return r as ValidImage;
};
const rejected = async (bytes: Uint8Array) => {
  const r = await validateImage(bytes);
  return r.ok ? "accepted" : r.code;
};
const HEAVY_TEST_MS = 60_000;

const JPEG = await textured(800, 600).jpeg({ quality: 85 }).toBuffer();
const PROGRESSIVE = await textured(800, 600).jpeg({ quality: 85, progressive: true }).toBuffer();
const PNG = await textured(640, 480).png().toBuffer();
const WEBP = await textured(500, 400).webp({ quality: 80 }).toBuffer();
const WEBP_LOSSLESS = await textured(321, 654).webp({ lossless: true }).toBuffer();
const SMALL_WEBP = await solid(500, 400).webp().toBuffer();

describe("valid images", () => {
  it("accepts JPEG, including progressive, and reads its dimensions", async () => {
    expect(await ok(JPEG)).toMatchObject({ format: "jpeg", mediaType: "image/jpeg", width: 800, height: 600 });
    expect(await ok(PROGRESSIVE)).toMatchObject({ format: "jpeg", width: 800, height: 600 });
  });

  it("accepts PNG, including palette, greyscale and 16-bit images", async () => {
    expect(await ok(PNG)).toMatchObject({ format: "png", mediaType: "image/png", width: 640, height: 480 });
    expect((await ok(await textured(300, 300).png({ palette: true }).toBuffer())).format).toBe("png");
    expect((await ok(await textured(300, 300).greyscale().png().toBuffer())).format).toBe("png");
    expect((await ok(await textured(300, 300).toColourspace("rgb16").png().toBuffer())).format).toBe("png");
  });

  it("accepts WebP: lossy, lossless, extended and with transparency", async () => {
    expect(await ok(WEBP)).toMatchObject({ format: "webp", mediaType: "image/webp", width: 500, height: 400 });
    expect(await ok(WEBP_LOSSLESS)).toMatchObject({ width: 321, height: 654 });
    expect(await ok(webpExtended(WEBP, 500, 400, 0))).toMatchObject({ width: 500, height: 400 });
    expect(await ok(await solid(300, 300, 4).webp().toBuffer())).toMatchObject({ width: 300 });
  });

  it("the clean copy is itself a decodable image in the same format, in sRGB", async () => {
    const cmyk = await textured(400, 300).toColourspace("cmyk").jpeg().toBuffer();
    expect((await sharp(cmyk).metadata()).space).toBe("cmyk");
    const { sanitized } = await ok(cmyk);
    expect(await sharp(sanitized).metadata()).toMatchObject({ format: "jpeg", space: "srgb", width: 400, height: 300 });
    for (const file of [JPEG, PNG, WEBP]) {
      const copy = await ok(file);
      expect(await sharp(copy.sanitized).metadata()).toMatchObject({ format: copy.format, width: copy.width, height: copy.height });
    }
  });

  it("the clean copy is pixel-accurate for lossless PNG", async () => {
    const copy = await ok(PNG);
    const raw = (b: Uint8Array) => sharp(b).raw().toBuffer();
    expect((await raw(copy.sanitized)).equals(await raw(PNG))).toBe(true);
  });

  it("accepts images exactly at the limits", async () => {
    expect((await ok(await solid(200, 200).jpeg().toBuffer())).width).toBe(200);
    expect((await ok(await solid(4000, 4000).png().toBuffer())).height).toBe(4000);
    expect((await ok(await solid(8000, 2000).png().toBuffer())).width).toBe(8000);
  }, HEAVY_TEST_MS);
});

describe("unsupported formats", () => {
  it.each([
    ["SVG", `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><script>alert(1)</script></svg>`],
    ["HTML", "<!doctype html><script>alert(1)</script>"],
    ["PDF", "%PDF-1.7\n%âãÏÓ"],
    ["BMP", "BM\x00\x00\x00\x00"],
    ["HEIC", "\x00\x00\x00\x18ftypheic"],
    ["ZIP", "PK\x03\x04"],
    ["Windows program", "MZ\x90\x00"],
    ["shell script", "#!/bin/sh\nrm -rf /"],
    ["plain text", "hello"],
    ["a type that only looks like WebP", "RIFF\x10\x00\x00\x00WAVEfmt "],
  ])("rejects %s", async (_name, content) => {
    expect(await rejected(bytesOf(content))).toBe("unsupported_format");
  });

  it("rejects real GIF and TIFF files", async () => {
    expect(await rejected(await solid(300, 300).gif().toBuffer())).toBe("unsupported_format");
    expect(await rejected(await solid(300, 300).tiff().toBuffer())).toBe("unsupported_format");
  });

  it("rejects an empty file", async () => {
    expect(await rejected(new Uint8Array(0))).toBe("malformed");
  });

  it("rejects a file with an image's first bytes that is really something else", async () => {
    const svgInside = bytesOf([0xff, 0xd8, 0xff, 0xe0, 0, 16], `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"/>`);
    expect(await rejected(svgInside)).toBe("malformed");
    expect(await rejected(bytesOf(PNG_SIGNATURE, "<html><script>alert(1)</script></html>"))).toBe("malformed");
    expect(await rejected(bytesOf("RIFF\x10\x00\x00\x00WEBP<script>"))).toBe("malformed");
  });

  it("an SVG hidden behind an image's first bytes never decodes as an SVG, with every libvips loader available", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"/>`;
    await expect(sharp(Buffer.from(svg)).metadata()).resolves.toMatchObject({ format: "svg" }); // libvips would read it
    expect(await rejected(bytesOf([0xff, 0xd8, 0xff], svg))).toBe("malformed");
    expect(await rejected(bytesOf(PNG_SIGNATURE, svg))).toBe("malformed");
    const size = svg.length + 4;
    expect(await rejected(bytesOf("RIFF", [size & 255, size >> 8, 0, 0], "WEBP", svg))).toBe("malformed");
  });

  it("rejects JPEG variants the decoder doesn't support", async () => {
    const frame = JPEG.indexOf(Buffer.from([0xff, 0xc0]));
    expect(frame).toBeGreaterThan(0);
    for (const marker of [0xc3, 0xc5, 0xc9, 0xca, 0xcb, 0xcd, 0xcf]) {
      const variant = Uint8Array.from(JPEG);
      variant[frame + 1] = marker;
      expect(await rejected(variant)).toBe("malformed");
    }
  });
});

describe("dimension limits and decompression bombs", () => {
  it("rejects images that are too small to read", async () => {
    expect(await rejected(await solid(199, 600).jpeg().toBuffer())).toBe("too_small");
    expect(await rejected(await solid(600, 199).png().toBuffer())).toBe("too_small");
    expect(await rejected(await solid(100, 100).webp().toBuffer())).toBe("too_small");
  });

  it("rejects one oversized side", async () => {
    expect(await rejected(await solid(8001, 300).jpeg().toBuffer())).toBe("too_large");
    expect(await rejected(await solid(300, 8001).png().toBuffer())).toBe("too_large");
  });

  it("rejects too many pixels even when each side is allowed", async () => {
    const justOver = await solid(4001, 4000).png().toBuffer();
    expect(await rejected(justOver)).toBe("too_large");
    expect(IMAGE_LIMITS.maxPixels).toBeLessThan(IMAGE_LIMITS.maxDimension ** 2);
  }, HEAVY_TEST_MS);

  it("rejects real bombs from the header: tiny files holding far more pixels than allowed", async () => {
    for (const bomb of [await solid(8000, 8000).png({ compressionLevel: 9 }).toBuffer(), await solid(8000, 8000).jpeg().toBuffer(), await solid(16000, 3000).webp().toBuffer()]) {
      expect(bomb.length).toBeLessThan(IMAGE_LIMITS.maxBytes);
      const before = Date.now();
      expect(await rejected(bomb)).toBe("too_large");
      expect(Date.now() - before).toBeLessThan(1000); // decoding 64 MP would take far longer than reading a header
    }
  }, HEAVY_TEST_MS);

  it("rejects a forged header claiming 4 gigapixels", async () => {
    expect(await rejected(pngClaiming(await solid(300, 300).png().toBuffer(), 65000, 65000))).toBe("too_large");
  });

  it("rejects a forged header claiming allowed dimensions the data doesn't hold, without using that memory", async () => {
    const before = Date.now();
    expect(await rejected(pngClaiming(PNG, 4000, 4000))).toBe("malformed");
    expect(Date.now() - before).toBeLessThan(1000);
  });

  it("rejects a file over the byte limit without decoding it", async () => {
    const big = new Uint8Array(IMAGE_LIMITS.maxBytes + 1);
    big.set(JPEG);
    expect(await rejected(big)).toBe("too_large");
  });

  it("rejects a clean copy that would be over the byte limit, as it couldn't be sent anywhere", async () => {
    const low = await noisy(4000, 4000).jpeg({ quality: 40 }).toBuffer();
    expect(low.length).toBeLessThan(IMAGE_LIMITS.maxBytes);
    expect(await rejected(low)).toBe("too_large");
  }, HEAVY_TEST_MS);

  it("the byte limit still fits a 10 MB base64 request", () => {
    expect(Math.ceil(IMAGE_LIMITS.maxBytes / 3) * 4).toBeLessThanOrEqual(10_000_000);
  });
});

describe("corrupted pixels (files whose structure can look fine)", () => {
  it("rejects any cut through a JPEG, baseline or progressive", async () => {
    for (const file of [JPEG, PROGRESSIVE]) {
      for (const share of [0.02, 0.1, 0.5, 0.9, 0.99]) expect(await rejected(file.subarray(0, Math.floor(file.length * share)))).toBe("malformed");
    }
  });

  it("rejects any cut through PNG pixel data", async () => {
    const pixelDataEnd = PNG.length - 12; // the end chunk that follows carries no pixels
    for (const share of [0.01, 0.1, 0.5, 0.9, 0.999]) expect(await rejected(PNG.subarray(0, Math.floor(pixelDataEnd * share)))).toBe("malformed");
    expect(await rejected(PNG.subarray(0, 40))).toBe("malformed");
  });

  it("rejects any cut through a WebP", async () => {
    for (const file of [WEBP, WEBP_LOSSLESS]) {
      for (const share of [0.01, 0.1, 0.5, 0.9, 0.999]) expect(await rejected(file.subarray(0, Math.floor(file.length * share)))).toBe("malformed");
    }
  });

  it("rejects a PNG with damaged pixel data, whether or not its checksum was also forged", async () => {
    const chunks = pngChunks(PNG);
    const idat = chunks.find((c) => c.type === "IDAT")!;
    for (const share of [0.1, 0.5, 0.9]) {
      const damaged = Uint8Array.from(idat.data);
      damaged[Math.floor(damaged.length * share)] ^= 0x55;
      const forgedCrc = pngFrom(chunks.map((c) => (c.type === "IDAT" ? { type: "IDAT", data: damaged } : c)));
      expect(await rejected(forgedCrc)).toBe("malformed");
      const at = PNG.indexOf(Buffer.from("IDAT")) + 4 + Math.floor(idat.data.length * share);
      const badCrc = Uint8Array.from(PNG);
      badCrc[at] ^= 0x55;
      expect(await rejected(badCrc)).toBe("malformed");
    }
  });

  it("rejects a JPEG whose scan data ends early or holds an invalid marker", async () => {
    const scan = JPEG.indexOf(Buffer.from([0xff, 0xda]));
    const mid = scan + Math.floor((JPEG.length - scan) / 2);
    const earlyEnd = Uint8Array.from(JPEG);
    earlyEnd.set([0xff, 0xd9], mid);
    expect(await rejected(earlyEnd)).toBe("malformed");
    const noiseBlock = Uint8Array.from(JPEG);
    for (let i = 0; i < 4000; i += 2) noiseBlock.set([0xff, 0xc4], mid + i);
    expect(await rejected(noiseBlock)).toBe("malformed");
  });

  it("rejects a WebP with heavily damaged image data", async () => {
    for (const file of [WEBP, WEBP_LOSSLESS]) {
      const damaged = Uint8Array.from(file);
      for (let i = 40; i < damaged.length; i += 3) damaged[i] ^= 0x55;
      expect(await rejected(damaged)).toBe("malformed");
    }
  });

  it("damage the decoder can't detect still can't crash or produce an unreadable copy (JPEG has no checksums)", async () => {
    const scan = JPEG.indexOf(Buffer.from([0xff, 0xda])) + 20;
    let seed = 11, accepted = 0;
    for (let trial = 0; trial < 60; trial++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const damaged = Uint8Array.from(JPEG);
      damaged[scan + seed % (JPEG.length - scan - 4)] ^= 0x55;
      const r = await validateImage(damaged);
      if (r.ok) {
        accepted++;
        expect((await sharp(r.sanitized).metadata()).format).toBe("jpeg");
      }
    }
    expect(accepted).toBeGreaterThan(0); // this is the documented limitation, not a goal: see the design doc
  }, HEAVY_TEST_MS);
});

describe("malformed files never crash anything", () => {
  it("resolves, never throws, on random bytes behind a valid signature", async () => {
    let seed = 42;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) >>> 24;
    for (const head of [[0xff, 0xd8, 0xff], PNG_SIGNATURE, [...bytesOf("RIFF"), 200, 0, 0, 0, ...bytesOf("WEBP")]]) {
      for (let n = 0; n < 60; n++) {
        const bytes = Uint8Array.from([...head, ...Array.from({ length: (n * 7) % 220 }, random)]);
        expect(await rejected(bytes)).toBe("malformed");
      }
    }
  });

  it("resolves, never throws, when every region of a real file is corrupted in turn", async () => {
    const files = [
      await solid(300, 300).jpeg().toBuffer(),
      await solid(300, 300).png().toBuffer(),
      await solid(300, 300).webp().toBuffer(),
    ];
    for (const file of files) {
      const step = Math.max(1, Math.floor(file.length / 150));
      for (let i = 0; i < file.length; i += step) {
        const bad = Uint8Array.from(file);
        bad[i] ^= 0xff;
        await expect(validateImage(bad)).resolves.toHaveProperty("ok");
      }
    }
  }, HEAVY_TEST_MS);

  it("resolves on PNG chunk lengths that run past the file or point nowhere", async () => {
    expect(await rejected(bytesOf(PNG_SIGNATURE, [0xff, 0xff, 0xff, 0xff], "IHDR"))).toBe("malformed");
    expect(await rejected(bytesOf(PNG_SIGNATURE))).toBe("malformed");
    expect(await rejected(bytesOf(PNG_SIGNATURE, pngChunk("IDAT", [1, 2])))).toBe("malformed");
    expect(await rejected(bytesOf(PNG_SIGNATURE, pngChunk("IHDR", Array(13).fill(0), true), pngChunk("IEND")))).toBe("malformed");
  });
});

describe("animation", () => {
  it("rejects animated PNG and WebP", async () => {
    const apng = withPngChunks(await solid(300, 300).png().toBuffer(), pngChunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0]));
    expect(await rejected(apng)).toBe("animated");
    const frame = await solid(300, 300).webp().toBuffer();
    expect(await rejected(webpAnimated(frame, 300, 300))).toBe("animated");
  });
});

describe("metadata and hidden content can't survive", () => {
  const META_TEXT = ["GPS-SECRET", "SECRET-XMP", "SECRET-COMMENT", "SECRET-TEXT", "SECRET-EXIF", "SECRET-ITXT", "SECRET-ZTXT", "Exif", "xmpmeta", "Photoshop"];
  const expectClean = async (copy: Uint8Array) => {
    for (const text of META_TEXT) expect(contains(copy, text), text).toBe(false);
    const m = await sharp(copy).metadata();
    expect([m.exif, m.xmp, m.icc, m.iptc, m.orientation]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  };

  it("removes real GPS, EXIF and colour profile data written by another tool", async () => {
    for (const encoder of ["jpeg", "webp", "png"] as const) {
      const file = await quadrants(400, 300)[encoder]()
        .withExif({ IFD0: { Copyright: "GPS-SECRET" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "1/1 2/1 3/1", GPSLongitudeRef: "E", GPSLongitude: "4/1 5/1 6/1" } })
        .withIccProfile("p3")
        .toBuffer();
      expect((await sharp(file).metadata()).exif, encoder).toBeDefined();
      await expectClean((await ok(file)).sanitized);
    }
  });

  it("removes JPEG EXIF, XMP and comments", async () => {
    const file = withJpegSegments(JPEG, exifSegment(1), jpegXmp("<x:xmpmeta>SECRET-XMP</x:xmpmeta>"), jpegComment("<script>SECRET-COMMENT</script>"));
    expect(contains(file, "GPS-SECRET")).toBe(true);
    await expectClean((await ok(file)).sanitized);
  });

  it("removes PNG text and metadata chunks", async () => {
    const file = withPngChunks(PNG, pngChunk("tEXt", "Comment\0SECRET-TEXT"), pngChunk("eXIf", exifBlock(1).subarray(6)), pngChunk("iTXt", "SECRET-ITXT"), pngChunk("zTXt", "SECRET-ZTXT"));
    await expectClean((await ok(file)).sanitized);
  });

  it("removes WebP EXIF and XMP", async () => {
    const file = webpExtended(SMALL_WEBP, 500, 400, 0x0c, webpChunk("EXIF", exifBlock(1)), webpChunk("XMP ", "SECRET-XMP"));
    await expectClean((await ok(file)).sanitized);
  });

  it("data appended after any image never reaches the clean copy", async () => {
    const hidden = "PK\x03\x04SECRET-TEXT<script>alert(1)</script>";
    for (const file of [JPEG, PNG, WEBP]) {
      const r = await validateImage(bytesOf(file, hidden));
      if (r.ok) expect(contains(r.sanitized, "SECRET-TEXT")).toBe(false);
    }
    const { sanitized } = await ok(bytesOf(JPEG, hidden));
    expect(sanitized.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  });

  it("damaged EXIF is removed rather than treated as an error, and the image stays upright", async () => {
    const damaged = bytesOf([0xff, 0xe1, 0, 16], "Exif\0\0II*\0", [0xff, 0xff, 0xff, 0xff]);
    await expectClean((await ok(withJpegSegments(JPEG, damaged))).sanitized);
    const nonsense = await ok(withJpegSegments(JPEG, exifSegment(99)));
    expect(nonsense).toMatchObject({ width: 800, height: 600 });
  });
});

describe("orientation is applied before metadata is removed", () => {
  // Stored image: red top-left, green top-right, blue bottom-left, white bottom-right, 600x400.
  const EXPECTED = {
    1: ["red", "green", "blue", "white"],
    2: ["green", "red", "white", "blue"], // mirrored left to right
    3: ["white", "blue", "green", "red"], // turned 180 degrees
    4: ["blue", "white", "red", "green"], // mirrored top to bottom
    5: ["red", "blue", "green", "white"], // top row becomes the left column
    6: ["blue", "red", "white", "green"], // turned 90 degrees clockwise
    7: ["white", "green", "blue", "red"], // top row becomes the right column, reversed
    8: ["green", "white", "red", "blue"], // turned 90 degrees anticlockwise
  } as const;

  for (const encoder of ["jpeg", "png", "webp"] as const) {
    it.each(Object.entries(EXPECTED))(`${encoder}: orientation %s produces upright pixels and no orientation tag`, async (value, [topLeft, topRight, bottomLeft, bottomRight]) => {
      const orientation = Number(value);
      const file = await quadrants(600, 400)[encoder]({ ...(encoder === "png" ? {} : { quality: 95 }) }).withMetadata({ orientation }).toBuffer();
      expect((await sharp(file).metadata()).orientation).toBe(orientation);
      const copy = await ok(file);
      const [width, height] = orientation >= 5 ? [400, 600] : [600, 400];
      expect(copy).toMatchObject({ width, height });
      expect((await sharp(copy.sanitized).metadata()).orientation).toBeUndefined();
      expect(await cornerColours(copy.sanitized)).toEqual({ topLeft, topRight, bottomLeft, bottomRight, width, height });
    });
  }

  it("reads both EXIF byte orders", async () => {
    const stored = await quadrants(600, 400).jpeg({ quality: 95 }).toBuffer();
    expect(await ok(withJpegSegments(stored, exifSegment(6)))).toMatchObject({ width: 400, height: 600 });
    expect(await ok(withJpegSegments(stored, exifSegment(8, false)))).toMatchObject({ width: 400, height: 600 });
  });
});

describe("resource limits", () => {
  // The heaviest image allowed: every pixel holds real transparency, so it decodes to 4 channels.
  const largest = () => sharp({ create: { width: 4000, height: 4000, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 0.5 } } }).webp({ effort: 0 }).toBuffer();

  it("answers by the deadline even if decoding is still running, and counts that work until it really ends", async () => {
    const file = await largest();
    await _imagesIdle();
    expect(await validateImage(file, { timeoutMs: 1 })).toEqual({ ok: false, code: "timeout" });
    expect(_pendingImages()).toBe(1);
    await _imagesIdle();
    expect(_pendingImages()).toBe(0);
    expect((await ok(file)).width).toBe(4000); // the next image is unaffected
  }, HEAVY_TEST_MS);

  it("also asks libvips to stop by itself, as a deadline alone only stops waiting for it", async () => {
    const timeout = vi.spyOn(sharp.prototype, "timeout");
    await ok(JPEG);
    expect(timeout).toHaveBeenCalledWith({ seconds: IMAGE_LIMITS.processingMs / 1000 });
    timeout.mockRestore();
  });

  it("work that was abandoned while waiting is never decoded", async () => {
    const file = await largest();
    await _imagesIdle();
    const running = validateImage(file);
    const queued = validateImage(file, { timeoutMs: 1 });
    expect(await queued).toEqual({ ok: false, code: "timeout" });
    expect(await running).toMatchObject({ ok: true });
    const finishedFirst = Date.now();
    await _imagesIdle();
    expect(Date.now() - finishedFirst).toBeLessThan(40); // decoding this image takes far longer
    expect(_pendingImages()).toBe(0);
  }, HEAVY_TEST_MS);

  it("decodes one image at a time, in order: a small image waits for a large one ahead of it", async () => {
    const large = await largest();
    await _imagesIdle();
    const finished: string[] = [];
    await Promise.all([
      validateImage(large).then(() => finished.push("large")),
      validateImage(SMALL_WEBP).then(() => finished.push("small")),
    ]);
    expect(finished).toEqual(["large", "small"]);
  }, HEAVY_TEST_MS);

  it("libvips keeps nothing between images and has a bounded thread count", async () => {
    await ok(JPEG);
    expect(sharp.cache()).toMatchObject({ memory: { max: 0 }, items: { max: 0 }, files: { max: 0 } });
    expect(sharp.concurrency()).toBeLessThanOrEqual(2);
  });

  it("never raises sharp's thread count, which it sets to 1 on glibc Linux to limit fragmentation", async () => {
    const before = sharp.concurrency();
    sharp.concurrency(1);
    vi.resetModules();
    const fresh = await import("./validate");
    expect((await fresh.validateImage(JPEG)).ok).toBe(true);
    expect(sharp.concurrency()).toBe(1);
    sharp.concurrency(before);
  });

  it("onFinished runs once, when work really ends, including after a deadline", async () => {
    const file = await largest();
    await _imagesIdle();
    const finished = vi.fn();
    expect(await validateImage(file, { timeoutMs: 1, onFinished: finished })).toEqual({ ok: false, code: "timeout" });
    expect(finished).not.toHaveBeenCalled(); // decoding is still running
    await _imagesIdle();
    expect(finished).toHaveBeenCalledTimes(1);
  }, HEAVY_TEST_MS);

  it("onFinished runs once for files refused before queueing, and for finished work", async () => {
    for (const file of [new Uint8Array(0), bytesOf("junk"), new Uint8Array(IMAGE_LIMITS.maxBytes + 1), JPEG, JPEG.subarray(0, 900)]) {
      const finished = vi.fn();
      await validateImage(file, { onFinished: finished });
      await _imagesIdle();
      expect(finished).toHaveBeenCalledTimes(1);
    }
  });

  it("recognises libvips's own timeout, and reports other decoder errors as damage", async () => {
    await _imagesIdle();
    const encode = vi.spyOn(sharp.prototype, "toBuffer");
    encode.mockRejectedValueOnce(new Error("timeout: 100% complete"));
    expect(await validateImage(JPEG)).toEqual({ ok: false, code: "timeout" });
    encode.mockRejectedValueOnce(new Error("/secret/path: out of order"));
    expect(await validateImage(JPEG)).toEqual({ ok: false, code: "malformed" });
    encode.mockRestore();
  });

  it("refuses new work beyond 4 pending images rather than letting it pile up", async () => {
    const file = await largest();
    await _imagesIdle();
    const results = await Promise.all(Array.from({ length: 6 }, () => validateImage(file)));
    expect(results.filter((r) => r.ok)).toHaveLength(4);
    expect(results.filter((r) => !r.ok && r.code === "busy")).toHaveLength(2);
    expect(_pendingImages()).toBe(0);
    expect((await ok(file)).width).toBe(4000);
  }, HEAVY_TEST_MS);

  it("a damaged image doesn't stop the queue for the next one", async () => {
    await _imagesIdle();
    const results = await Promise.all([validateImage(JPEG.subarray(0, 900)), validateImage(JPEG), validateImage(bytesOf(PNG_SIGNATURE, "junk")), validateImage(PNG)]);
    expect(results.map((r) => r.ok)).toEqual([false, true, false, true]);
    expect(_pendingImages()).toBe(0);
  });

  it("the pixel limit keeps the largest decoded image under the size at which libvips uses a temp file", () => {
    expect(IMAGE_LIMITS.maxPixels * 4).toBeLessThan(100 * 1024 * 1024);
  });

  it("the largest allowed images never reach the disk, whatever the format, depth or rotation", async () => {
    const webp = await largest();
    expect((await sharp(webp).metadata()).hasAlpha).toBe(true);
    const files = [
      webp,
      await sharp(webp).jpeg({ quality: 50 }).withMetadata({ orientation: 6 }).toBuffer(),
      await sharp(webp).png().toBuffer(),
      await sharp(webp).toColourspace("rgb16").png().withMetadata({ orientation: 6 }).toBuffer(),
      await sharp(webp).webp({ effort: 0 }).withMetadata({ orientation: 6 }).toBuffer(),
    ];
    const before = new Set(readdirSync(tmpdir()));
    const seen = new Set<string>();
    const watcher = setInterval(() => {
      for (const name of readdirSync(tmpdir())) if (!before.has(name) && /^vips-/.test(name)) seen.add(name);
    }, 2);
    try {
      for (const file of files) expect((await ok(file)).width).toBe(4000);
    } finally {
      clearInterval(watcher);
    }
    expect([...seen]).toEqual([]);
  }, HEAVY_TEST_MS);

  it("reports nothing about an image to the logs", async () => {
    const log = vi.spyOn(console, "log"), warn = vi.spyOn(console, "warn"), err = vi.spyOn(console, "error");
    await ok(withJpegSegments(JPEG, exifSegment(6)));
    await rejected(JPEG.subarray(0, 900));
    await rejected(bytesOf("SECRET"));
    for (const spy of [log, warn, err]) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe("structural errors the decoder must refuse", () => {
  const chunks = pngChunks(PNG);
  const ihdr = chunks.find((c) => c.type === "IHDR")!, idat = chunks.filter((c) => c.type === "IDAT"), iend = chunks.find((c) => c.type === "IEND")!;

  it("rejects PNG structure errors", async () => {
    const badDepth = Uint8Array.from(ihdr.data);
    badDepth.set([3, 2], 8); // invalid depth for the colour type
    const palette = await textured(300, 300).png({ palette: true }).toBuffer();
    expect(await rejected(pngFrom([idat[0], ihdr, iend]))).toBe("malformed"); // header not first
    expect(await rejected(pngFrom([ihdr, iend]))).toBe("malformed"); // no image data
    expect(await rejected(pngFrom([ihdr, idat[0], { type: "tEXt", data: bytesOf("x") }, idat[0], iend]))).toBe("malformed"); // split data
    expect(await rejected(pngFrom([{ type: "IHDR", data: badDepth }, ...idat, iend]))).toBe("malformed");
    expect(await rejected(pngFrom(pngChunks(palette).filter((c) => c.type !== "PLTE")))).toBe("malformed"); // palette image with no palette
    expect(await rejected(pngFrom([ihdr, { type: "ABCD", data: bytesOf("x") }, ...idat, iend]))).toBe("malformed"); // unknown required chunk
  });

  it("rejects WebP structure errors", async () => {
    const image = webpImageChunk(SMALL_WEBP);
    const wrongSize = Uint8Array.from(SMALL_WEBP);
    wrongSize[4] += 2;
    expect(await rejected(wrongSize)).toBe("malformed");
    expect(await rejected(riff(webpChunk("VP8 ", [0, 0, 0, 1, 2, 3, 0, 0, 0, 0])))).toBe("malformed"); // bad start code
    expect(await rejected(riff(webpChunk("VP8L", [0x00, 0, 0, 0, 0, 0])))).toBe("malformed"); // bad signature
    expect(await rejected(riff(webpVp8x(500, 400)))).toBe("malformed"); // no image
    expect(await rejected(riff(webpVp8x(900, 900), image))).toBe("malformed"); // canvas disagrees with image
    expect(await rejected(riff(webpVp8x(500, 400, 0x02), image))).toBe("malformed"); // claims animation, holds no frames
  });
});

describe("oddities that decode: only the decoded pixels reach the clean copy", () => {
  const expectOnlyPixels = async (file: Uint8Array, original: Uint8Array) => {
    const copy = await ok(file);
    expect(contains(copy.sanitized, "SECRET-TEXT")).toBe(false);
    const raw = (b: Uint8Array) => sharp(b).raw().toBuffer();
    expect(await raw(copy.sanitized)).toHaveLength((await raw(original)).length);
  };

  it("a PNG with appended data or no end chunk", async () => {
    await expectOnlyPixels(bytesOf(PNG, "SECRET-TEXT<script>alert(1)</script>"), PNG);
    const chunks = pngChunks(PNG);
    await expectOnlyPixels(pngFrom(chunks.filter((c) => c.type !== "IEND")), PNG);
  });

  it("a JPEG missing only its end marker, when every pixel is present", async () => {
    await expectOnlyPixels(JPEG.subarray(0, JPEG.length - 2), JPEG);
    expect((await ok(JPEG.subarray(0, JPEG.length - 2))).sanitized.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  });

  it("a WebP with appended data or a second image chunk holding other data", async () => {
    await expectOnlyPixels(bytesOf(SMALL_WEBP, "SECRET-TEXT<script>alert(1)</script>"), SMALL_WEBP);
    const hidden = riff(webpImageChunk(SMALL_WEBP), webpChunk("VP8 ", "SECRET-TEXT"));
    await expectOnlyPixels(hidden, SMALL_WEBP);
  });
});

describe("Next's image optimizer shares this sharp module without interference", () => {
  const SVG = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"/>`);

  it("Next's own formats keep working after an upload, in either order, and uploads stay restricted", async () => {
    const { getSharp, optimizeImage } = await import("next/dist/server/image-optimizer");
    const gif = await solid(300, 300).gif().toBuffer();
    const tiff = await solid(300, 300).tiff().toBuffer();
    const avif = await solid(300, 300).avif().toBuffer();
    const optimized = (buffer: Buffer) => optimizeImage({ buffer, contentType: "image/webp", quality: 75, width: 64 });

    await ok(JPEG); // validator loads first
    getSharp(undefined); // Next's optimizer second, which sets its own loaders
    await ok(JPEG); // and a further upload after it
    for (const file of [JPEG, PNG, WEBP, gif, tiff, avif, SVG]) expect((await optimized(file)).length, "Next could not optimize").toBeGreaterThan(0);

    for (const file of [gif, tiff, avif, SVG]) expect(await rejected(file)).toBe("unsupported_format");
    expect((await ok(WEBP)).format).toBe("webp");
  });
});
