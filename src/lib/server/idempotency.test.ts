import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { idempotentId, isUniqueViolation, readIdempotencyKey } from "./idempotency";

vi.mock("./auth", () => ({ getCurrentUser: vi.fn() }));

const request = (key?: string) => new NextRequest("http://x/y", { method: "POST", headers: key === undefined ? {} : { "Idempotency-Key": key } });

describe("idempotency keys", () => {
  it("no key means none", () => {
    expect(readIdempotencyKey(request())).toBeNull();
  });

  it("accepts the form the client sends", () => {
    expect(readIdempotencyKey(request("0123456789abcdef0123456789abcdef"))).toBe("0123456789abcdef0123456789abcdef");
  });

  it.each(["short", "x".repeat(129), "has spaces in the key!", "' OR 1=1 --------"])('refuses "%s" rather than ignoring it', (key) => {
    expect(() => readIdempotencyKey(request(key))).toThrow("Invalid idempotency key");
  });

  it("the same user and key always derive the same value", () => {
    expect(idempotentId("entry", "u1", "k".repeat(16))).toBe(idempotentId("entry", "u1", "k".repeat(16)));
  });

  it("another user's identical key derives another value", () => {
    expect(idempotentId("entry", "u1", "k".repeat(16))).not.toBe(idempotentId("entry", "u2", "k".repeat(16)));
  });

  it("a food and an entry with one key don't share a value", () => {
    expect(idempotentId("food", "u1", "k".repeat(16))).not.toBe(idempotentId("entry", "u1", "k".repeat(16)));
  });

  it("users and keys can't run together to collide", () => {
    expect(idempotentId("entry", "ab", "c".repeat(16))).not.toBe(idempotentId("entry", "abc", "c".repeat(15)));
  });

  it("fits the API's limit for an id", () => {
    expect(idempotentId("food", "u", "k".repeat(128)).length).toBeLessThanOrEqual(40);
  });

  it("recognizes only the database's unique violation", () => {
    expect(isUniqueViolation(new Prisma.PrismaClientKnownRequestError("x", { code: "P2002", clientVersion: "6" }))).toBe(true);
    expect(isUniqueViolation(new Prisma.PrismaClientKnownRequestError("x", { code: "P2025", clientVersion: "6" }))).toBe(false);
    expect(isUniqueViolation(new Error("P2002"))).toBe(false);
  });
});
