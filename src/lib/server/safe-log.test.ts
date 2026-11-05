import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logServerError } from "./safe-log";

afterEach(() => vi.restoreAllMocks());
const logged = () => JSON.stringify(vi.mocked(console.error).mock.calls);

describe("logging unexpected errors", () => {
  it("a database error logs its type and code, without its message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logServerError(new Prisma.PrismaClientKnownRequestError("value secret@example.test in postgres://u:pw@host/db", { code: "P2010", clientVersion: "6" }));
    expect(logged()).toContain("PrismaClientKnownRequestError P2010");
    expect(logged()).not.toMatch(/secret@example|pw@host/);
  });

  it("errors with no code are covered too", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logServerError(new Prisma.PrismaClientValidationError("Invalid invocation: name: 'private food'", { clientVersion: "6" }));
    expect(logged()).toContain("PrismaClientValidationError");
    expect(logged()).not.toContain("private food");
  });

  it("other errors stay whole, for debugging", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new TypeError("a bug");
    logServerError(err);
    expect(spy).toHaveBeenCalledWith(err);
  });
});
