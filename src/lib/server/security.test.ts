import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_HEADERS, BASE_SECURITY_HEADERS, HSTS_VALUE, contentSecurityPolicy, isHttpsProduction } from "@/lib/security-headers";
import { prismaLogLevels } from "./db";
import { installSafeConsole, logServerError, safeLogArgument } from "./safe-log";

const ROW_ID = "cmw51vddu00a2vutsx71vx1dr";
const unknownError = () => new Prisma.PrismaClientUnknownRequestError(`Invalid \`prisma.exercise.deleteMany()\` invocation: PostgresError { code: "23001", detail: "Key (id)=(${ROW_ID})" }`, { clientVersion: "6" });
const knownError = () => new Prisma.PrismaClientKnownRequestError(`Unique constraint failed for sam@example.invalid`, { clientVersion: "6", code: "P2002" });

describe("S-10: Prisma's own logging", () => {
  it("is off outside development", () => {
    expect(prismaLogLevels("production")).toEqual([]);
    expect(prismaLogLevels("test")).toEqual([]);
    expect(prismaLogLevels(undefined)).toEqual([]);
  });
  it("stays on for local development", () => {
    expect(prismaLogLevels("development")).toEqual(["warn", "error"]);
  });
});

describe("S-10: what reaches a log", () => {
  afterEach(() => vi.restoreAllMocks());
  it("logServerError keeps only the type and code", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logServerError(unknownError());
    logServerError(knownError());
    const text = error.mock.calls.flat().map(String).join("\n");
    expect(text).not.toContain(ROW_ID);
    expect(text).not.toContain("sam@example.invalid");
    expect(text).toContain("PrismaClientUnknownRequestError");
    expect(text).toContain("P2002");
  });
  it("still logs other errors whole", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const other = new Error("not a database problem");
    logServerError(other);
    expect(error).toHaveBeenCalledWith(other);
  });
  it.each([
    ["an unknown Prisma error", () => unknownError()],
    ["a known Prisma error", () => knownError()],
    ["an error wrapping one", () => new Error("render failed", { cause: unknownError() })],
    ["an ordinary error repeating its text", () => new Error(`Render failed: Invalid \`prisma.user.create()\` invocation for ${ROW_ID} sam@example.invalid`)],
    ["Prisma's text as a string", () => `prisma:error Invalid \`prisma.user.create()\` invocation for ${ROW_ID} sam@example.invalid`],
    ["a transaction's text as a string", () => `Invalid \`tx.user.delete()\` invocation for ${ROW_ID} sam@example.invalid`],
  ])("the console guard withholds %s", (_label, make) => {
    const out = String(safeLogArgument(make()));
    expect(out).not.toContain(ROW_ID);
    expect(out).not.toContain("sam@example.invalid");
    expect(out).toMatch(/Database error/);
  });
  it("the console guard leaves everything else alone", () => {
    const calls: unknown[][] = [];
    const target = { error: (...a: unknown[]) => calls.push(a), warn: (...a: unknown[]) => calls.push(a), log: (...a: unknown[]) => calls.push(a) };
    installSafeConsole(target);
    const plain = new Error("plain");
    target.error("message", plain, 3);
    target.warn(unknownError());
    expect(calls[0]).toEqual(["message", plain, 3]);
    expect(calls[1].map(String).join("\n")).not.toContain(ROW_ID);
  });
});

describe("security headers", () => {
  const policy = contentSecurityPolicy("abc123");
  const directive = (name: string, text = policy) => text.split("; ").find((d) => d.startsWith(`${name} `));
  it("scripts need the nonce or this site", () => {
    expect(directive("script-src")).toBe("script-src 'self' 'nonce-abc123' 'wasm-unsafe-eval'");
  });
  it("never allows inline or evaluated script in production", () => {
    expect(directive("script-src")).not.toMatch(/'unsafe-inline'|'unsafe-eval'/);
    expect(policy).not.toMatch(/\*|https:|http:/);
  });
  it("allows evaluated script only for local development", () => {
    expect(directive("script-src", contentSecurityPolicy("n", { development: true }))).toContain("'unsafe-eval'");
  });
  it("can't be framed, has no plugins, and forms stay here", () => {
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
  });
  it("upgrades insecure requests only on HTTPS", () => {
    expect(policy).not.toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy("n", { https: true })).toContain("upgrade-insecure-requests");
  });
  it("HSTS only for production with an HTTPS origin, starting short", () => {
    expect(isHttpsProduction({ NODE_ENV: "production", APP_ORIGIN: "https://app.example.invalid" })).toBe(true);
    expect(isHttpsProduction({ NODE_ENV: "production", APP_ORIGIN: "http://app.example.invalid" })).toBe(false);
    expect(isHttpsProduction({ NODE_ENV: "production" })).toBe(false);
    expect(isHttpsProduction({ NODE_ENV: "development", APP_ORIGIN: "https://app.example.invalid" })).toBe(false);
    expect(HSTS_VALUE).toBe("max-age=86400");
    expect(HSTS_VALUE).not.toMatch(/includeSubDomains|preload/);
  });
  it("has the baseline headers", () => {
    const keys = BASE_SECURITY_HEADERS.map((h) => h.key);
    for (const key of ["X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy", "Cross-Origin-Opener-Policy", "X-Robots-Tag"]) expect(keys).toContain(key);
  });
  it("API responses can't be cached or load anything", () => {
    expect(API_HEADERS).toContainEqual({ key: "Cache-Control", value: "no-store" });
    expect(API_HEADERS.find((h) => h.key === "Content-Security-Policy")?.value).toContain("default-src 'none'");
  });
});
