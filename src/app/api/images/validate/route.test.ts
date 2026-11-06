// The upload route with its real validation, limits and session lookup. The database and cookie
// store are in-memory fakes: no database is touched, and no network is used.
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _imagesIdle, IMAGE_LIMITS, type ImageValidation } from "@/lib/server/images/validate";
import { _resetImageUploadLimits, _trackedUploadUsers, beginImageUpload } from "@/lib/server/images/upload-limits";
import { bytesOf, exifSegment, pngClaiming, quadrants, solid, withJpegSegments } from "@/test/image-fixtures";
import { POST } from "./route";
import * as routeModule from "./route";

const fakes = vi.hoisted(() => ({ sessionFind: vi.fn(), cookies: new Map<string, string>(), findUser: vi.fn(), create: vi.fn(), validationOverride: null as ImageValidationOverride, timeoutMs: undefined as number | undefined }));
type ImageValidationOverride = (() => Promise<ImageValidation>) | null;
vi.mock("@/lib/server/images/validate", async (original) => {
  const actual = await original<typeof import("@/lib/server/images/validate")>();
  return {
    ...actual,
    validateImage: (bytes: Uint8Array, options: { onFinished?: () => void }) => {
      if (fakes.validationOverride) {
        options.onFinished?.();
        return fakes.validationOverride();
      }
      return actual.validateImage(bytes, { ...options, ...(fakes.timeoutMs ? { timeoutMs: fakes.timeoutMs } : {}) });
    },
  };
});
vi.mock("@/lib/server/db", () => ({
  prisma: new Proxy({}, { get: (_t, model: string) => (model === "session" ? { findUnique: fakes.sessionFind, delete: async () => ({}) } : model === "profile" ? { findUnique: async () => ({ birthDate: new Date("1990-01-01T00:00:00Z") }) } : { findUnique: fakes.findUser, create: fakes.create, update: fakes.create, upsert: fakes.create }) }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (fakes.cookies.has(name) ? { value: fakes.cookies.get(name) } : undefined), set: () => {}, delete: () => {} }),
}));

const ctx = { params: Promise.resolve({}) } as never;
const asUser = (id: string) => {
  fakes.cookies.set("fit_session", `token-${id}`);
  fakes.sessionFind.mockResolvedValue({ id: "s", expiresAt: new Date(Date.now() + 60_000), user: { id, email: `${id}@example.com` } });
};
const upload = (body: BodyInit | null, type: string | null = "image/jpeg", headers: Record<string, string> = {}) => POST(new NextRequest("http://localhost:3000/api/images/validate", {
  method: "POST",
  headers: { Origin: "http://localhost:3000", Host: "localhost:3000", ...(type ? { "Content-Type": type } : {}), ...headers },
  body,
  ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
} as ConstructorParameters<typeof NextRequest>[1]), ctx);
const blob = (b: Uint8Array) => Buffer.from(b);

// Real, decodable images.
const JPEG = await solid(800, 600).jpeg().toBuffer();
const PNG = await solid(640, 480).png().toBuffer();
const WEBP = await solid(500, 400).webp().toBuffer();
const jpeg = () => JPEG;
const png = () => PNG;

beforeEach(() => {
  _resetImageUploadLimits();
  fakes.cookies.clear();
  fakes.sessionFind.mockReset();
  fakes.findUser.mockReset();
  fakes.create.mockReset();
  fakes.validationOverride = null;
  fakes.timeoutMs = undefined;
  asUser("user-a");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("valid uploads", () => {
  it("accepts JPEG, PNG and WebP, returning only metadata, with no-store", async () => {
    for (const [file, type] of [[withJpegSegments(JPEG, exifSegment(6)), "image/jpeg"], [PNG, "image/png"], [WEBP, "image/webp"]] as const) {
      const r = await upload(blob(file), type);
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe("no-store");
      const body = await r.json();
      expect(Object.keys(body).sort()).toEqual(["bytes", "format", "height", "mediaType", "ok", "sha256", "width"]);
      expect(body.mediaType).toBe(type);
      expect(body.bytes).toBe(file.length);
      expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("reports the upright dimensions of a rotated photo", async () => {
    const rotated = await quadrants(800, 600).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect(await (await upload(blob(rotated))).json()).toMatchObject({ width: 600, height: 800 });
  });

  it("accepts a charset-style parameter and any capitalization on the type", async () => {
    expect((await upload(blob(png()), "IMAGE/PNG; foo=bar")).status).toBe(200);
  });
});

describe("authentication and origin", () => {
  it("rejects unauthenticated requests before reading the body", async () => {
    fakes.cookies.clear();
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); } }, { highWaterMark: 0 });
    expect((await upload(stream)).status).toBe(401);
    expect(pulled).toBe(0);
  });

  it("rejects an invalid or expired session", async () => {
    fakes.sessionFind.mockResolvedValue(null);
    expect((await upload(blob(jpeg()))).status).toBe(401);
    fakes.sessionFind.mockResolvedValue({ id: "s", expiresAt: new Date(Date.now() - 1000), user: { id: "user-a", email: "a@example.com" } });
    expect((await upload(blob(jpeg()))).status).toBe(401);
  });

  it("rejects a cross-origin or missing Origin", async () => {
    expect((await upload(blob(jpeg()), "image/jpeg", { Origin: "https://evil.example" })).status).toBe(403);
    const noOrigin = await POST(new NextRequest("http://localhost:3000/api/images/validate", { method: "POST", headers: { Host: "localhost:3000", "Content-Type": "image/jpeg" }, body: blob(jpeg()) }), ctx);
    expect(noOrigin.status).toBe(403);
  });
});

describe("content, not labels, decides", () => {
  it.each([
    ["HTML sent as a JPEG", "<!doctype html><script>alert(1)</script>", "image/jpeg"],
    ["SVG sent as a PNG", `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`, "image/png"],
    ["PDF sent as WebP", "%PDF-1.7", "image/webp"],
    ["program sent as a JPEG", "MZ\x90\x00", "image/jpeg"],
  ])("rejects %s", async (_name, content, type) => {
    expect((await upload(blob(bytesOf(content)), type)).status).toBe(415);
  });

  it("rejects a real image sent under a different image type", async () => {
    const r = await upload(blob(png()), "image/jpeg");
    expect(r.status).toBe(415);
    expect(await r.json()).toEqual({ error: "The file's content doesn't match its type" });
  });

  it("rejects other declared types, including multipart and missing, before reading the body", async () => {
    for (const type of ["image/gif", "image/svg+xml", "text/html", "application/octet-stream", "multipart/form-data; boundary=x", "application/json", null]) {
      let pulled = 0;
      const stream = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(1)); c.close(); } }, { highWaterMark: 0 });
      expect((await upload(stream, type)).status, String(type)).toBe(415);
      expect(pulled).toBe(0);
    }
  });

  it("rejects compressed bodies, which could hide their real size", async () => {
    expect((await upload(blob(jpeg()), "image/jpeg", { "Content-Encoding": "gzip" })).status).toBe(415);
  });

  it("ignores file names: path traversal and unsafe names have no effect and are never echoed", async () => {
    const unsafe = { "X-Filename": "../../etc/passwd", "Content-Disposition": `attachment; filename="../../evil.php"`, "X-File-Path": "C:\\Windows\\evil.exe" };
    const before = readdirSync(tmpdir()).length;
    const r = await upload(blob(jpeg()), "image/jpeg", unsafe);
    expect(r.status).toBe(200);
    const text = await r.text();
    for (const leak of ["passwd", "evil", "Windows", ".."]) expect(text).not.toContain(leak);
    expect(readdirSync(tmpdir()).length).toBeLessThanOrEqual(before);
  });
});

describe("malformed and oversized", () => {
  it("rejects corrupted files and empty bodies with a generic message", async () => {
    const whole = jpeg();
    for (const body of [whole.subarray(0, whole.length - 2), new Uint8Array(0)]) {
      const r = await upload(blob(body));
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "This image is damaged or incomplete" });
    }
    expect((await upload(null)).status).toBe(400);
  });

  it("rejects small and huge dimensions", async () => {
    expect((await upload(blob(await solid(100, 100).jpeg().toBuffer()))).status).toBe(422);
    const bomb = await upload(blob(pngClaiming(PNG, 65000, 65000)), "image/png");
    expect(bomb.status).toBe(413);
    const realBomb = await solid(8000, 8000).png({ compressionLevel: 9 }).toBuffer();
    expect((await upload(blob(realBomb), "image/png")).status).toBe(413);
  });

  it("rejects a file with valid headers whose pixels can't be decoded", async () => {
    const cut = PNG.subarray(0, Math.floor(PNG.length / 2));
    const r = await upload(blob(cut), "image/png");
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "This image is damaged or incomplete" });
    expect((await upload(blob(pngClaiming(PNG, 4000, 4000)), "image/png")).status).toBe(400);
  });

  it("rejects by Content-Length without reading any of the body", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); } }, { highWaterMark: 0 });
    const r = await upload(stream, "image/jpeg", { "Content-Length": String(IMAGE_LIMITS.maxBytes + 1) });
    expect(r.status).toBe(413);
    expect(pulled).toBe(0);
  });

  it("stops reading a body with no length at the limit and releases its slot", async () => {
    let sent = 0, cancelled = false;
    const chunk = new Uint8Array(256 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) { sent += chunk.length; c.enqueue(chunk); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    expect((await upload(stream)).status).toBe(413);
    await vi.waitFor(() => expect(cancelled).toBe(true));
    expect(sent).toBeLessThanOrEqual(IMAGE_LIMITS.maxBytes + 2 * chunk.length);
    expect((await upload(blob(jpeg()))).status).toBe(200); // no slot leaked
  });

  it("gives up on a stalled upload, cancels it and releases its slot", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const stalled = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new Uint8Array(10)); }, // then nothing more
      cancel() { cancelled = true; },
    });
    const pending = upload(stalled);
    await vi.advanceTimersByTimeAsync(30_001);
    const r = await pending;
    expect(r.status).toBe(408);
    expect(cancelled).toBe(true);
    vi.useRealTimers();
    expect((await upload(blob(jpeg()))).status).toBe(200);
  });

  it("a connection failure mid-upload gives a clean error and releases its slot", async () => {
    const broken = new ReadableStream<Uint8Array>({ pull(c) { c.error(new Error("connection reset /secret/path")); } }, { highWaterMark: 0 });
    const r = await upload(broken);
    expect(r.status).toBe(400);
    expect(await r.text()).not.toContain("secret");
    expect((await upload(blob(jpeg()))).status).toBe(200);
  });
});

describe("resource limits", () => {
  it("each user gets 20 uploads per 10 minutes, and rejected uploads count", async () => {
    for (let i = 0; i < 10; i++) expect((await upload(blob(jpeg()))).status).toBe(200);
    for (let i = 0; i < 10; i++) expect((await upload(blob(bytesOf("junk")))).status).toBe(415);
    const over = await upload(blob(jpeg()));
    expect(over.status).toBe(429);
    expect(Number(over.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("one user's limit doesn't affect another user", async () => {
    for (let i = 0; i < 20; i++) await upload(blob(jpeg()));
    expect((await upload(blob(jpeg()))).status).toBe(429);
    asUser("user-b");
    expect((await upload(blob(jpeg()))).status).toBe(200);
  });

  it("the limit expires after the window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
    asUser("user-a");
    for (let i = 0; i < 20; i++) await upload(blob(jpeg()));
    expect((await upload(blob(jpeg()))).status).toBe(429);
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    asUser("user-a");
    expect((await upload(blob(jpeg()))).status).toBe(200);
  });

  it("at most 4 uploads are held in memory at once, refused before reading the body", async () => {
    const held = Array.from({ length: 4 }, (_, i) => beginImageUpload(`holder-${i}`));
    expect(held.every((s) => s.allowed)).toBe(true);
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(1)); c.close(); } }, { highWaterMark: 0 });
    const r = await upload(stream);
    expect(r.status).toBe(429);
    expect(pulled).toBe(0);
    for (const s of held) if (s.allowed) s.release();
    expect((await upload(blob(jpeg()))).status).toBe(200);
  });

  it("one user can hold only one upload at a time, and other users aren't affected", async () => {
    const held = beginImageUpload("user-a");
    expect(held.allowed).toBe(true);
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(1)); c.close(); } }, { highWaterMark: 0 });
    expect((await upload(stream)).status).toBe(429);
    expect(pulled).toBe(0);
    asUser("user-b");
    expect((await upload(blob(jpeg()))).status).toBe(200);
    asUser("user-a");
    if (held.allowed) held.release();
    expect((await upload(blob(jpeg()))).status).toBe(200);
  });

  it.each(["timeout", "busy"] as const)("%s gives a 503 with Retry-After, generic text, and releases the slot", async (code) => {
    fakes.validationOverride = async () => ({ ok: false, code });
    const r = await upload(blob(jpeg()));
    expect(r.status).toBe(503);
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(JSON.stringify(await r.json())).not.toMatch(/sharp|vips|stack/i);
    fakes.validationOverride = null;
    expect((await upload(blob(jpeg()))).status).toBe(200);
  });

  describe("a timeout while decoding is still running", () => {
    const heavy = () => sharp({ create: { width: 4000, height: 4000, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 0.5 } } }).webp({ effort: 0 }).toBuffer();

    it("keeps the user's slot until decoding really ends, then frees it", async () => {
      const file = blob(await heavy());
      fakes.timeoutMs = 1;
      expect((await upload(file, "image/webp")).status).toBe(503);
      fakes.timeoutMs = undefined;
      expect((await upload(blob(jpeg()))).status).toBe(429); // the abandoned work still holds this user's slot
      await _imagesIdle();
      expect((await upload(blob(jpeg()))).status).toBe(200);
    }, 60_000);

    it("timed-out work counts against the 4 global slots, so it can't pile up across users", async () => {
      const file = blob(await heavy());
      fakes.timeoutMs = 1;
      for (const id of ["a", "b", "c", "d"]) {
        asUser(`timeout-${id}`);
        expect((await upload(file, "image/webp")).status).toBe(503);
      }
      fakes.timeoutMs = undefined;
      asUser("timeout-e");
      let pulled = 0;
      const stream = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(1)); c.close(); } }, { highWaterMark: 0 });
      expect((await upload(stream)).status).toBe(429);
      expect(pulled).toBe(0);
      await _imagesIdle();
      expect((await upload(blob(jpeg()))).status).toBe(200);
    }, 60_000);
  });

  it("an unexpected decoder failure gives a generic 500 and releases the slot", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    fakes.validationOverride = async () => { throw new Error("could not load /secret/path/sharp.node"); };
    const r = await upload(blob(jpeg()));
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("secret");
    err.mockRestore();
    fakes.validationOverride = null;
    expect((await upload(blob(jpeg()))).status).toBe(200);
  });

  it("tracked users stay bounded", () => {
    for (let i = 0; i < 12_000; i++) {
      const slot = beginImageUpload(`flood-${i}`);
      if (slot.allowed) slot.release();
    }
    expect(_trackedUploadUsers()).toBeLessThanOrEqual(10_000);
  });
});

describe("no storage and no cross-user access", () => {
  it("writes nothing to the database, and the response holds no id or URL to fetch an image by", async () => {
    const r = await upload(blob(jpeg()));
    const body = await r.json();
    expect(JSON.stringify(body)).not.toMatch(/https?:|\/api\/|"id"|"url"|"path"/);
    expect(fakes.create).not.toHaveBeenCalled();
  });

  it("the route only offers POST: no handler exists to read or list images", () => {
    expect(Object.keys(routeModule)).toEqual(["POST"]);
  });

  it("two users uploading the same image get the same content hash but no link between them", async () => {
    const a = await (await upload(blob(jpeg()))).json();
    asUser("user-b");
    const b = await (await upload(blob(jpeg()))).json();
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).not.toContain("user-");
  });

  it("logs nothing about the image", async () => {
    const log = vi.spyOn(console, "log");
    const err = vi.spyOn(console, "error");
    await upload(blob(bytesOf(JPEG, "SECRET")));
    await upload(blob(bytesOf("SECRET")));
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });
});
