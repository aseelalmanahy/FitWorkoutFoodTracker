/**
 * Phase 2: finding a product barcode in a camera frame or a photo, on the device. The browser's own BarcodeDetector
 * where it reads product codes (Chrome on Android); otherwise zxing-wasm through the barcode-detector ponyfill, loaded
 * only when needed, with its WebAssembly from this site's own build files (never a CDN, which the CSP also forbids).
 * Nothing about the image leaves the device: callers get the digits only.
 */
import { PRODUCT_FORMATS } from "@/lib/barcode";

export type Detected = { rawValue: string; format: string };
export type Detector = { native: boolean; detect: (source: ImageBitmapSource) => Promise<Detected[]> };

const WASM_URL = new URL("zxing-wasm/reader/zxing_reader.wasm", import.meta.url).toString();

type NativeCtor = { new (o: { formats: string[] }): { detect: (s: ImageBitmapSource) => Promise<Detected[]> }; getSupportedFormats(): Promise<string[]> };

let cached: Promise<Detector> | null = null;

export function getBarcodeDetector(): Promise<Detector> {
  return (cached ??= (async () => {
    const Native = (globalThis as { BarcodeDetector?: NativeCtor }).BarcodeDetector;
    if (Native) {
      const supported = await Native.getSupportedFormats().catch(() => [] as string[]);
      const formats = PRODUCT_FORMATS.filter((f) => supported.includes(f));
      if (formats.includes("ean_13")) {
        const d = new Native({ formats });
        return { native: true, detect: (s: ImageBitmapSource) => d.detect(s) };
      }
    }
    const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");
    prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? WASM_URL : prefix + path) }, fireImmediately: true });
    const d = new BarcodeDetector({ formats: [...PRODUCT_FORMATS] });
    return { native: false, detect: (s: ImageBitmapSource) => d.detect(s) as Promise<Detected[]> };
  })().catch((e) => { cached = null; throw e; }));
}

/** A still photo: its barcodes, decoded here. The file stays in this page and is released at once. */
export async function detectInImage(file: Blob): Promise<Detected[]> {
  const bitmap = await createImageBitmap(file);
  try {
    return await (await getBarcodeDetector()).detect(bitmap);
  } finally {
    bitmap.close();
  }
}
