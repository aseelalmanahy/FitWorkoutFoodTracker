// Phase 4.0.1 Stage A: the access gate with its real logic and a fake database, plus source checks that
// removed wording, formulas and colours stay gone. No database is touched.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountRoute, publicRoute, route } from "@/lib/server/api";
import { isRateLimited, recordAttempt } from "@/lib/server/auth";

const fakes = vi.hoisted(() => ({ profile: null as null | { birthDate: Date }, handled: 0 }));
vi.mock("@/lib/server/db", () => ({
  prisma: {
    session: { findUnique: async () => ({ id: "s", expiresAt: new Date(Date.now() + 60_000), user: { id: "u", email: "u@example.com" } }), delete: async () => ({}) },
    profile: { findUnique: async () => fakes.profile },
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "token" }), set: () => {}, delete: () => {} }) }));

const ctx = { params: Promise.resolve({}) } as never;
const request = (origin = "http://localhost:3000") => new NextRequest("http://localhost:3000/api/x", { method: "POST", headers: { Origin: origin, Host: "localhost:3000" } });
const handler = async () => { fakes.handled++; return { ok: true }; };
const yearsAgo = (n: number) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - n); return d; };

describe("the access gate", () => {
  beforeEach(() => { fakes.handled = 0; });

  it("T33: no profile gets 409, and the handler doesn't run", async () => {
    fakes.profile = null;
    const res = await route(handler)(request(), ctx);
    expect(res.status).toBe(409);
    expect(fakes.handled).toBe(0);
  });
  it("T33: a stored under-minimum date gets 403, with no date or number in the body", async () => {
    fakes.profile = { birthDate: yearsAgo(17) };
    const res = await route(handler)(request(), ctx);
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(JSON.parse(text).details.reason).toBe("account_restricted");
    expect(text).not.toMatch(/\d/);
    expect(fakes.handled).toBe(0);
  });
  it("an eligible profile passes", async () => {
    fakes.profile = { birthDate: yearsAgo(30) };
    expect((await route(handler)(request(), ctx)).status).toBe(200);
    expect(fakes.handled).toBe(1);
  });
  it("accountRoute skips the gate but keeps the Origin check", async () => {
    fakes.profile = { birthDate: yearsAgo(17) };
    expect((await accountRoute(handler)(request(), ctx)).status).toBe(200);
    expect((await accountRoute(handler)(request("https://evil.example"), ctx)).status).toBe(403);
    expect(fakes.handled).toBe(1);
  });
  it("the Origin check runs before the gate, on every wrapper", async () => {
    fakes.profile = null;
    const res = await route(handler)(request("https://evil.example"), ctx);
    expect((await res.json()).error).toBe("Invalid origin");
    expect((await publicRoute(handler)(request("https://evil.example"))).status).toBe(403);
  });
});

describe("the attempt limit", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("T36: stops at 10 in 15 minutes, then recovers by itself, so nobody is trapped", () => {
    vi.useFakeTimers();
    const key = "age-refusal:stage-a-test";
    for (let i = 0; i < 10; i++) {
      expect(isRateLimited(key)).toBe(false);
      recordAttempt(key);
    }
    expect(isRateLimited(key)).toBe(true);
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(isRateLimited(key)).toBe(false);
  });
});

const SRC = path.resolve(__dirname, "../..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");
const source = walk(SRC).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"));
const read = (f: string) => readFileSync(f, "utf8");
const inSrc = (f: string) => read(path.join(SRC, f));

describe("every API route is classified", () => {
  const routes = walk(path.join(SRC, "app/api")).filter((f) => path.basename(f) === "route.ts");
  // Anything not named here must use route(), which is closed by default.
  const EXCEPTIONS: Record<string, string> = {
    "app/api/profile/route.ts": "accountRoute",
    "app/api/account/delete/route.ts": "accountRoute",
    "app/api/account/export/route.ts": "accountRoute",
    "app/api/account/password/route.ts": "accountRoute",
    "app/api/auth/login/route.ts": "publicRoute",
    "app/api/auth/register/route.ts": "publicRoute",
    "app/api/auth/register/complete/route.ts": "publicRoute",
    "app/api/auth/password/forgot/route.ts": "publicRoute",
    "app/api/auth/password/reset/route.ts": "publicRoute",
    "app/api/auth/logout/route.ts": "publicRoute",
    "app/api/health/db-identity/route.ts": "none",
    "app/api/health/route.ts": "none",
  };

  it("T33: finds the routes", () => {
    expect(routes.length).toBeGreaterThan(25);
  });
  it.each(routes.map(rel))("T33: %s", (f) => {
    const code = inSrc(f);
    const exports = [...code.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b\s*=\s*([A-Za-z]+)/g)];
    const wrappers = new Set(exports.map((m) => m[2]));
    const expected = EXCEPTIONS[f];
    if (expected === "none") {
      expect(code).toMatch(/export async function GET/);
      expect(code).not.toMatch(/export (const|async function) (POST|PUT|PATCH|DELETE)/);
    } else {
      expect(exports.length).toBeGreaterThan(0);
      expect([...wrappers]).toEqual([expected ?? "route"]);
    }
  });
  it("accountRoute is used only where named", () => {
    const users = source.filter((f) => read(f).includes("accountRoute(") && !f.endsWith(path.join("server", "api.ts"))).map(rel);
    expect(users.sort()).toEqual(["app/api/account/delete/route.ts", "app/api/account/export/route.ts", "app/api/account/password/route.ts", "app/api/profile/route.ts"]);
  });
});

describe("removed things stay removed", () => {
  it("T24: no unsupported wording in the source", () => {
    for (const f of source) expect(read(f), rel(f)).not.toMatch(/minimum safe floor|Moderate deficit|Small surplus|Used by the BMR equation|personalise calorie estimates/i);
  });
  it("acceptance 4: the formulas no longer exist", () => {
    for (const f of source) expect(read(f), rel(f)).not.toMatch(/suggestCalories|suggestMacros|MIN_INTAKE_KCAL|mifflinStJeorBmr|estimateTdee|suggestionFromProfile|syncSuggestedTarget|applySuggestion/);
  });
  it("no second age calculation", () => {
    for (const f of source) expect(read(f), rel(f)).not.toMatch(/365\.25/);
    const callers = source.filter((f) => read(f).includes("ageFromBirthDate(")).map(rel).sort();
    expect(callers).toEqual(["lib/eligibility.ts", "lib/energy.ts"]);
  });
  it("acceptance 3: nothing but setManualTarget writes a target", () => {
    const writers = source.filter((f) => /nutritionTarget\.(create|createMany|update|updateMany|upsert)\b/.test(read(f))).map(rel);
    expect(writers).toEqual(["lib/server/nutrition/targets.ts"]);
    // The only removal is the person deleting their whole account.
    const removers = source.filter((f) => /nutritionTarget\.(delete|deleteMany)\b/.test(read(f))).map(rel);
    expect(removers).toEqual(["lib/server/account/delete.ts"]);
    const code = inSrc("lib/server/nutrition/targets.ts");
    expect(code.match(/nutritionTarget\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g)).toEqual(["nutritionTarget.upsert"]);
    expect(code).not.toMatch(/"SUGGESTED"/);
  });
  it("T37: no over-target state uses the down colour", () => {
    for (const f of ["components/nutrition/macro-bar.tsx", "app/(app)/nutrition/page.tsx", "app/(app)/nutrition/history/page.tsx"]) {
      expect(inSrc(f), f).not.toMatch(/text-down|bg-down|--down/);
    }
    expect(inSrc("components/nutrition/macro-bar.tsx")).toMatch(/over target/);
  });
  it("T6: the refusal copy states no number, and no age", () => {
    const form = inSrc("components/profile/profile-form.tsx");
    const refusal = form.slice(form.indexOf("if (refused) {"), form.indexOf("const mu ="));
    expect(refusal).not.toMatch(/\b1[38]\b|adult|years old/i);
    expect(inSrc("app/api/profile/route.ts")).not.toMatch(/"[^"]*\b1[38]\b[^"]*"/);
  });
  it("age is never described to the person as verified", () => {
    for (const f of source.filter((x) => x.endsWith(".tsx"))) expect(read(f), rel(f)).not.toMatch(/verify your age|age (has been |is )?verified|verified age/i);
  });
});
