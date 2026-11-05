// Real, decodable images made with sharp, plus byte-level helpers to damage them or hide data in them.
import { crc32 } from "node:zlib";
import sharp from "sharp";

export const bytesOf = (...parts: (Uint8Array | number[] | string)[]) => {
  const arrays = parts.map((p) => (typeof p === "string" ? new TextEncoder().encode(p) : Uint8Array.from(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) { out.set(a, at); at += a.length; }
  return out;
};
export const contains = (haystack: Uint8Array, needle: string) => Buffer.from(haystack).includes(needle);
const be16 = (n: number) => [n >> 8, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, n >> 8];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

export type Colour = "red" | "green" | "blue" | "white";
const RGB: Record<Colour, number[]> = { red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], white: [255, 255, 255] };

/** Red, green, blue and white corners (top-left, top-right, bottom-left, bottom-right), so any rotation or mirroring shows. */
export function quadrants(width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const colour = y < height / 2 ? (x < width / 2 ? RGB.red : RGB.green) : (x < width / 2 ? RGB.blue : RGB.white);
      pixels.set(colour, (y * width + x) * 3);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

/** Seeded noise over a smooth background: a lot of real compressed data to damage. */
export function textured(width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 7;
  for (let i = 0; i < pixels.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    pixels[i] = 90 + (i % 64) + (seed >>> 28);
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

/** Pure noise: as hard to compress as an image gets. */
export function noisy(width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 3;
  for (let i = 0; i < pixels.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    pixels[i] = seed >>> 24;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

export const solid = (width: number, height: number, channels: 3 | 4 = 3) => sharp({ create: { width, height, channels, background: "#808080" } });

/** The colours at the four corners of an image, read by decoding it. */
export async function cornerColours(image: Uint8Array) {
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number): Colour => {
    const i = (y * info.width + x) * 3;
    const p = [data[i], data[i + 1], data[i + 2]];
    const distance = (c: Colour) => RGB[c].reduce((sum, v, k) => sum + (v - p[k]) ** 2, 0);
    return (Object.keys(RGB) as Colour[]).reduce((best, c) => (distance(c) < distance(best) ? c : best));
  };
  const inset = 10;
  return {
    topLeft: at(inset, inset),
    topRight: at(info.width - inset, inset),
    bottomLeft: at(inset, info.height - inset),
    bottomRight: at(info.width - inset, info.height - inset),
    width: info.width,
    height: info.height,
  };
}

const jpegSegment = (marker: number, data: Uint8Array | number[] | string) => {
  const body = bytesOf(data);
  return bytesOf([0xff, marker, ...be16(body.length + 2)], body);
};
/** An EXIF block holding only the orientation tag, plus text standing in for GPS data. */
export function exifBlock(orientation: number, littleEndian = true) {
  const u16 = littleEndian ? le16 : be16;
  const u32 = littleEndian ? le32 : be32;
  return bytesOf("Exif\0\0", littleEndian ? "II" : "MM", u16(42), u32(8), u16(1), u16(0x0112), u16(3), u32(1), u16(orientation), [0, 0], u32(0), "GPS-SECRET");
}
export const exifSegment = (orientation: number, littleEndian = true) => jpegSegment(0xe1, exifBlock(orientation, littleEndian));
export const jpegComment = (text: string) => jpegSegment(0xfe, text);
export const jpegXmp = (text: string) => jpegSegment(0xe1, `http://ns.adobe.com/xap/1.0/\0${text}`);
/** Adds segments straight after the JPEG's first marker. */
export const withJpegSegments = (file: Uint8Array, ...segments: Uint8Array[]) => bytesOf(file.subarray(0, 2), ...segments, file.subarray(2));

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export function pngChunk(type: string, data: Uint8Array | number[] | string = [], badCrc = false) {
  const body = bytesOf(type, data);
  return bytesOf(be32(body.length - 4), body, be32(badCrc ? (crc32(body) ^ 1) >>> 0 : crc32(body)));
}
export function pngChunks(file: Uint8Array) {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const chunks: { type: string; data: Uint8Array }[] = [];
  for (let i = 8; i < file.length; i += 12 + view.getUint32(i)) {
    chunks.push({ type: String.fromCharCode(...file.subarray(i + 4, i + 8)), data: file.subarray(i + 8, i + 8 + view.getUint32(i)) });
  }
  return chunks;
}
/** Rebuilds a PNG, recalculating every checksum, so damage reaches the decoder rather than the checksum test. */
export const pngFrom = (chunks: { type: string; data: Uint8Array }[]) => bytesOf(PNG_SIGNATURE, ...chunks.map((c) => pngChunk(c.type, c.data)));
/** A PNG whose header claims other dimensions, with a valid checksum. */
export function pngClaiming(file: Uint8Array, width: number, height: number) {
  return pngFrom(pngChunks(file).map((c) => (c.type === "IHDR" ? { type: c.type, data: bytesOf(be32(width), be32(height), c.data.subarray(8)) } : c)));
}
/** Adds chunks straight after the PNG header chunk, recalculating nothing else. */
export function withPngChunks(file: Uint8Array, ...chunks: Uint8Array[]) {
  return bytesOf(file.subarray(0, 33), ...chunks, file.subarray(33));
}

export function webpChunk(type: string, data: Uint8Array | number[] | string) {
  const body = bytesOf(data);
  return bytesOf(type, le32(body.length), body, body.length % 2 ? [0] : []);
}
export function riff(...chunks: Uint8Array[]) {
  const body = bytesOf("WEBP", ...chunks);
  return bytesOf("RIFF", le32(body.length), body);
}
export const webpVp8x = (w: number, h: number, flags = 0) => webpChunk("VP8X", [flags, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]);
/** The compressed image chunk from a simple (non-extended) WebP file. */
export const webpImageChunk = (file: Uint8Array) => file.subarray(12);
/** A real WebP image placed in an extended container, with extra chunks after it. */
export const webpExtended = (file: Uint8Array, w: number, h: number, flags: number, ...extra: Uint8Array[]) => riff(webpVp8x(w, h, flags), webpImageChunk(file), ...extra);
/** An animated WebP with real frames. */
export function webpAnimated(frame: Uint8Array, w: number, h: number, frames = 2) {
  const image = webpImageChunk(frame);
  const anmf = webpChunk("ANMF", bytesOf([0, 0, 0, 0, 0, 0], le24(w - 1), le24(h - 1), le24(100), [0], image));
  return riff(webpVp8x(w, h, 0x02), webpChunk("ANIM", [0, 0, 0, 0, 0, 0]), ...Array(frames).fill(anmf));
}
