import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetGuard, _setClock, acquire, FAILURE_THRESHOLD, parseRetryAfter, record } from "./guard";
import { ExternalFoodError } from "./types";

let t = 1_000_000;
beforeEach(() => {
  _resetGuard();
  t = 1_000_000;
  _setClock(() => t);
  delete process.env.FOOD_RATE_LIMIT_MULTIPLIER;
});
afterEach(() => _setClock(() => Date.now()));

const take = (op: Parameters<typeof acquire>[0], user?: string) => {
  try {
    acquire(op, user);
    return "ok";
  } catch (e) {
    return (e as ExternalFoodError).kind;
  }
};
const err = (kind: ExternalFoodError["kind"], retryAfterMs?: number) => new ExternalFoodError("USDA", kind, "x", retryAfterMs);

describe("per-user budgets", () => {
  it("OFF search: 4 per user per minute, then user_rate_limited with retry-after", () => {
    for (let i = 0; i < 4; i++) expect(take("OFF_SEARCH", "u1")).toBe("ok");
    expect(take("OFF_SEARCH", "u1")).toBe("user_rate_limited");
    try { acquire("OFF_SEARCH", "u1"); } catch (e) { expect((e as ExternalFoodError).retryAfterMs).toBe(60_000); }
  });
  it("one user's exhaustion doesn't block another user", () => {
    for (let i = 0; i < 5; i++) take("OFF_SEARCH", "heavy");
    expect(take("OFF_SEARCH", "light")).toBe("ok");
  });
  it("resets as the sliding window moves", () => {
    for (let i = 0; i < 4; i++) take("OFF_SEARCH", "u1");
    expect(take("OFF_SEARCH", "u1")).toBe("user_rate_limited");
    t += 59_999;
    expect(take("OFF_SEARCH", "u1")).toBe("user_rate_limited");
    t += 1;
    expect(take("OFF_SEARCH", "u1")).toBe("ok");
  });
  it("rejected attempts are not charged", () => {
    for (let i = 0; i < 4; i++) take("OFF_SEARCH", "u1");
    for (let i = 0; i < 10; i++) take("OFF_SEARCH", "u1"); // all rejected
    t += 60_000;
    for (let i = 0; i < 4; i++) expect(take("OFF_SEARCH", "u1")).toBe("ok");
  });
  it("USDA: 20/min and 150/hour per user", () => {
    for (let i = 0; i < 20; i++) expect(take("USDA", "u1")).toBe("ok");
    expect(take("USDA", "u1")).toBe("user_rate_limited");
    for (let m = 1; m < 8; m++) { t += 60_000; for (let i = 0; i < 20; i++) take("USDA", "u1"); } // 160 attempts in 8 min
    t += 60_000;
    expect(take("USDA", "u1")).toBe("user_rate_limited"); // hourly cap reached (150)
    t += 3_600_000;
    expect(take("USDA", "u1")).toBe("ok");
  });
  it("budgets are separate per operation", () => {
    for (let i = 0; i < 4; i++) take("OFF_SEARCH", "u1");
    expect(take("OFF_PRODUCT", "u1")).toBe("ok");
    expect(take("USDA", "u1")).toBe("ok");
  });
});

describe("global budgets protect shared provider capacity", () => {
  it("OFF search: 10/min across all users, reported as unavailable", () => {
    for (let u = 0; u < 3; u++) for (let i = 0; i < 4; i++) take("OFF_SEARCH", `user${u}`); // 12 attempts, 10 allowed
    expect(take("OFF_SEARCH", "fresh-user")).toBe("unavailable");
    t += 60_000;
    expect(take("OFF_SEARCH", "fresh-user")).toBe("ok");
  });
  it("USDA: 900/hour globally (below the 1,000/hour key quota)", () => {
    let ok = 0;
    for (let u = 0; u < 60; u++) for (let i = 0; i < 20; i++) if (take("USDA", `user${u}`) === "ok") ok++;
    expect(ok).toBe(900);
  });
  it("test multiplier scales budgets", () => {
    process.env.FOOD_RATE_LIMIT_MULTIPLIER = "2";
    for (let i = 0; i < 8; i++) expect(take("OFF_SEARCH", "u1")).toBe("ok");
    expect(take("OFF_SEARCH", "u1")).toBe("user_rate_limited");
  });
});

describe("circuit breaker / backoff", () => {
  it("provider 429 opens the circuit for Retry-After, then closes", () => {
    record("USDA", err("rate_limited", 30_000));
    expect(take("USDA", "u1")).toBe("unavailable");
    t += 29_999;
    expect(take("USDA", "u1")).toBe("unavailable");
    t += 1;
    expect(take("USDA", "u1")).toBe("ok");
  });
  it("consecutive 429s back off exponentially, capped at 15 min; default 60 s", () => {
    record("USDA", err("rate_limited"));
    t += 60_000;
    expect(take("USDA")).toBe("ok");
    record("USDA", err("rate_limited")); // 2nd consecutive → 120 s
    t += 119_999;
    expect(take("USDA")).toBe("unavailable");
    t += 1;
    for (let i = 0; i < 10; i++) record("USDA", err("rate_limited"));
    t += 15 * 60_000 - 1;
    expect(take("USDA")).toBe("unavailable");
    t += 1;
    expect(take("USDA")).toBe("ok");
  });
  it(`${FAILURE_THRESHOLD} consecutive failures open for 30 s; a success resets the count`, () => {
    record("OFF_SEARCH", err("http"));
    record("OFF_SEARCH", err("timeout"));
    record("OFF_SEARCH", "success");
    record("OFF_SEARCH", err("network"));
    record("OFF_SEARCH", err("http"));
    expect(take("OFF_SEARCH", "u1")).toBe("ok"); // only 2 consecutive
    record("OFF_SEARCH", err("invalid_response")); // 3rd consecutive
    expect(take("OFF_SEARCH", "u1")).toBe("unavailable");
    t += 30_000;
    expect(take("OFF_SEARCH", "u1")).toBe("ok");
    record("OFF_SEARCH", err("http")); // 4th consecutive → 60 s
    t += 59_999;
    expect(take("OFF_SEARCH", "u1")).toBe("unavailable");
  });
  it("404 and configuration errors don't count as provider failures", () => {
    for (let i = 0; i < 5; i++) record("OFF_PRODUCT", err("not_found"));
    for (let i = 0; i < 5; i++) record("USDA", err("not_configured"));
    expect(take("OFF_PRODUCT", "u1")).toBe("ok");
    expect(take("USDA", "u1")).toBe("ok");
  });
  it("circuits are per operation", () => {
    record("OFF_SEARCH", err("rate_limited"));
    expect(take("OFF_SEARCH", "u1")).toBe("unavailable");
    expect(take("OFF_PRODUCT", "u1")).toBe("ok");
  });
});

describe("Retry-After parsing", () => {
  it("handles seconds, HTTP dates, junk and caps at 15 min", () => {
    expect(parseRetryAfter("30")).toBe(30_000);
    expect(parseRetryAfter(new Date(t + 45_000).toUTCString())).toBeGreaterThan(44_000);
    expect(parseRetryAfter("soon")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("-5")).toBeUndefined();
    expect(parseRetryAfter("99999")).toBe(15 * 60_000);
  });
});
