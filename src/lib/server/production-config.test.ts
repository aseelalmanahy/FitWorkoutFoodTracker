import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseIdentityProblems, isLocalTestServer, productionConfigProblems, registrationAllowed, registrationIsClosed } from "./production-config";
import { preflightProblems } from "./production-preflight";

// Fake values only. example.invalid is reserved and never resolves.
const SECRET = "fake-sentinel-password-5f3a9c1e";
const VALID = {
  NODE_ENV: "production",
  APP_ORIGIN: "https://app.example.invalid",
  DATABASE_URL: `postgresql://fit_app:${SECRET}@db.example.invalid:5432/fit_production?sslmode=require`,
  TRUST_PROXY_HOPS: "1",
};
const ids = (env: Record<string, string | undefined>) => productionConfigProblems(env).map((p) => p.id);
const fake = (over: Record<string, string | undefined>) => ({ ...VALID, ...over });
const url = (rest: string) => `postgresql://${rest}`;

describe("a valid production configuration", () => {
  it("has no problems", () => {
    expect(productionConfigProblems(VALID)).toEqual([]);
  });
  it("may set the optional settings it's meant to", () => {
    expect(ids(fake({ REGISTRATION_ALLOWLIST: "a@example.invalid, B@example.invalid", FDC_API_KEY: "a-real-looking-key", OFF_CONTACT: "x" }))).toEqual([]);
  });
  it("treats an empty AI setting as unset", () => {
    expect(ids(fake({ ANTHROPIC_API_KEY: "", LABEL_EXTRACTION_MODEL: "" }))).toEqual([]);
  });
});

describe("each condition refuses alone", () => {
  it.each([
    ["app-origin", { APP_ORIGIN: undefined }, "missing"],
    ["app-origin", { APP_ORIGIN: "" }, "empty"],
    ["app-origin", { APP_ORIGIN: "http://app.example.invalid" }, "not HTTPS"],
    ["app-origin", { APP_ORIGIN: "not a url" }, "invalid"],
    ["app-origin", { APP_ORIGIN: "https://localhost" }, "this machine"],
    ["app-origin", { APP_ORIGIN: "https://app.example.invalid/path" }, "with a path"],
    ["app-origin", { APP_ORIGIN: "https://user:pw@app.example.invalid" }, "with credentials"],
    ["database-missing", { DATABASE_URL: undefined }, "missing"],
    ["database-invalid", { DATABASE_URL: "mysql://u:p@h/x" }, "not PostgreSQL"],
    ["database-test", { DATABASE_URL: url(`fit_app:${SECRET}@db.example.invalid/fitdb_test?sslmode=require`) }, "test name"],
    ["database-test", { DATABASE_URL: url(`fit_app:${SECRET}@db.example.invalid/MyTESTdb?sslmode=require`) }, "test in any case"],
    ["database-development", { DATABASE_URL: url(`fit_app:${SECRET}@localhost:5432/fitdb`) }, "development database"],
    ["database-password-missing", { DATABASE_URL: url("fit_app@db.example.invalid/fit_production?sslmode=require") }, "no password"],
    ["database-password-weak", { DATABASE_URL: url("fit_app:short@db.example.invalid/fit_production?sslmode=require") }, "too short"],
    ["database-password-weak", { DATABASE_URL: url("fit_app:password1234567890@db.example.invalid/fit_production?sslmode=require") }, "a common word"],
    ["database-password-weak", { DATABASE_URL: url("averyveryverylongname:averyveryverylongname@db.example.invalid/fit_production?sslmode=require") }, "same as the user"],
    ["database-tls", { DATABASE_URL: url(`fit_app:${SECRET}@db.example.invalid/fit_production`) }, "no TLS"],
    ["database-tls", { DATABASE_URL: url(`fit_app:${SECRET}@db.example.invalid/fit_production?sslmode=disable`) }, "TLS off"],
    ["database-tls", { DATABASE_URL: url(`fit_app:${SECRET}@db.example.invalid/fit_production?sslmode=prefer`) }, "TLS optional"],
    ["db-identity", { EXPOSE_DB_IDENTITY: "1" }, "exposed"],
    ["ai-enabled", { ANTHROPIC_API_KEY: "fake" }, "key"],
    ["ai-enabled", { ANTHROPIC_BASE_URL: "http://x" }, "base URL"],
    ["ai-enabled", { LABEL_EXTRACTION_MODEL: "m" }, "label model"],
    ["ai-enabled", { MEAL_IDENTIFICATION_MODEL: "m" }, "meal model"],
    ["stub-provider", { FDC_BASE_URL: "http://127.0.0.1:1/fdc" }, "USDA stub"],
    ["stub-provider", { OFF_BASE_URL: "http://127.0.0.1:1/off" }, "OFF stub"],
    ["stub-provider", { LABEL_STUB_URL: "http://127.0.0.1:1" }, "label stub"],
    ["test-setting", { FOOD_RATE_LIMIT_MULTIPLIER: "100" }, "rate multiplier"],
    ["test-setting", { SAFETY_DB_URL: "x" }, "safety"],
    ["test-server-flag", { FIT_LOCAL_TEST_SERVER: "1" }, "test flag on a real database"],
    ["test-registration-flag", { FIT_TEST_OPEN_REGISTRATION: "1" }, "open sign-up on a real database"],
    ["proxy-hops", { TRUST_PROXY_HOPS: undefined }, "missing"],
    ["proxy-hops", { TRUST_PROXY_HOPS: "0" }, "zero"],
    ["proxy-hops", { TRUST_PROXY_HOPS: "many" }, "not a number"],
    ["allowlist-invalid", { REGISTRATION_ALLOWLIST: "*" }, "wildcard"],
    ["allowlist-invalid", { REGISTRATION_ALLOWLIST: "@example.invalid" }, "whole domain"],
    ["allowlist-invalid", { REGISTRATION_ALLOWLIST: "a@example.invalid, nope" }, "not an address"],
    ["placeholder-key", { FDC_API_KEY: "DEMO_KEY" }, "demo key"],
    ["tls-disabled", { NODE_TLS_REJECT_UNAUTHORIZED: "0" }, "certificate checks off"],
    ["debugger", { NODE_OPTIONS: "--inspect=0.0.0.0:9229" }, "debugger"],
  ])("%s: %j (%s)", (id, over, _label) => {
    expect(ids(fake(over))).toContain(id);
  });

  it("never includes a value in what it reports", () => {
    const env = fake({ APP_ORIGIN: `http://${SECRET}.invalid`, ANTHROPIC_API_KEY: SECRET, FDC_BASE_URL: SECRET, DATABASE_URL: url(`fit_app:${SECRET}@db.example.invalid/fitdb_test`) });
    const text = JSON.stringify(productionConfigProblems(env));
    expect(productionConfigProblems(env).length).toBeGreaterThan(2);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("db.example.invalid");
  });
});

describe("the local test exemption", () => {
  const local = { FIT_LOCAL_TEST_SERVER: "1", DATABASE_URL: url("u:p@localhost:5432/fitdb_test") };
  it("applies to a designated test database on this machine", () => {
    expect(isLocalTestServer(local)).toBe(true);
    expect(productionConfigProblems({ ...local, EXPOSE_DB_IDENTITY: "1", FDC_BASE_URL: "http://127.0.0.1" })).toEqual([]);
  });
  it.each([
    ["a real database", url(`fit_app:${SECRET}@db.example.invalid/fit_production?sslmode=require`)],
    ["a test name on another host", url("u:p@db.example.invalid:5432/fitdb_test")],
    ["the development database", url("u:p@localhost:5432/fitdb")],
    ["another name on this machine", url("u:p@localhost:5432/fit_production")],
    ["no database", undefined],
  ])("doesn't apply to %s", (_label, DATABASE_URL) => {
    expect(isLocalTestServer({ FIT_LOCAL_TEST_SERVER: "1", DATABASE_URL })).toBe(false);
    expect(ids({ ...VALID, FIT_LOCAL_TEST_SERVER: "1", DATABASE_URL })).toContain("test-server-flag");
  });
  it("needs the exact flag", () => {
    expect(isLocalTestServer({ ...local, FIT_LOCAL_TEST_SERVER: "true" })).toBe(false);
  });
});

describe("the connected database's own identity", () => {
  it("accepts an ordinary production database", () => {
    expect(databaseIdentityProblems({ name: "fit_production", comment: null })).toEqual([]);
    expect(databaseIdentityProblems({ name: "fit_production", comment: "Production data" })).toEqual([]);
  });
  it("refuses a test name, whatever the URL said", () => {
    expect(databaseIdentityProblems({ name: "fitdb_test", comment: null }).map((p) => p.id)).toEqual(["database-identity-test"]);
  });
  it("refuses a test marker on any name", () => {
    expect(databaseIdentityProblems({ name: "fit_production", comment: "fitworkoutfoodtracker:test-database:v1:fitdb_test" }).map((p) => p.id)).toEqual(["database-marker"]);
  });
});

describe("the whole preflight, with a stand-in database", () => {
  const healthy = async () => ({ name: "fit_production", comment: null });
  it("passes a valid configuration and an ordinary database", async () => {
    await expect(preflightProblems(VALID, healthy)).resolves.toEqual([]);
  });
  it("refuses on configuration, before contacting the database", async () => {
    const identity = vi.fn(healthy);
    expect((await preflightProblems(fake({ EXPOSE_DB_IDENTITY: "1" }), identity)).map((p) => p.id)).toEqual(["db-identity"]);
    expect(identity).not.toHaveBeenCalled();
  });
  it("refuses a test marker it finds on connecting", async () => {
    expect((await preflightProblems(VALID, async () => ({ name: "fit_production", comment: "fitworkoutfoodtracker:test-database:v1:x" }))).map((p) => p.id)).toEqual(["database-marker"]);
  });
  it("refuses an unreachable database, without the driver's message", async () => {
    const problems = await preflightProblems(VALID, async () => { throw new Error(`can't reach ${VALID.DATABASE_URL}`); });
    expect(problems.map((p) => p.id)).toEqual(["database-unverified"]);
    expect(JSON.stringify(problems)).not.toContain(SECRET);
  });
  it("skips the checks for a local test server", async () => {
    const identity = vi.fn(healthy);
    await expect(preflightProblems({ FIT_LOCAL_TEST_SERVER: "1", DATABASE_URL: url("u:p@localhost:5432/fitdb_test") }, identity)).resolves.toEqual([]);
    expect(identity).not.toHaveBeenCalled();
  });
});

describe("registration", () => {
  afterEach(() => vi.unstubAllEnvs());
  const prod = { NODE_ENV: "production" };
  it("is open in development only", () => {
    expect(registrationIsClosed({ NODE_ENV: "development" })).toBe(false);
    expect(registrationAllowed("a@example.invalid", { NODE_ENV: "development" })).toBe(true);
  });
  it("is closed by default in production", () => {
    expect(registrationIsClosed(prod)).toBe(true);
    expect(registrationAllowed("a@example.invalid", prod)).toBe(false);
    expect(registrationAllowed("a@example.invalid", { ...prod, REGISTRATION_ALLOWLIST: "" })).toBe(false);
  });
  it("admits exactly the listed addresses, ignoring case and spaces", () => {
    const env = { ...prod, REGISTRATION_ALLOWLIST: " Sam@Example.invalid ,lee@example.invalid" };
    expect(registrationAllowed("sam@example.invalid", env)).toBe(true);
    expect(registrationAllowed("lee@example.invalid", env)).toBe(true);
    for (const other of ["sam+x@example.invalid", "xsam@example.invalid", "sam@example.invalid.evil.invalid", "sam@example.invalid,lee@example.invalid", "", "*"]) expect(registrationAllowed(other, env), other).toBe(false);
  });
  it("can't be opened by a wildcard or a domain, even past the startup check", () => {
    for (const entry of ["*", "*@example.invalid", "@example.invalid"]) {
      expect(registrationAllowed("sam@example.invalid", { ...prod, REGISTRATION_ALLOWLIST: entry }), entry).toBe(false);
    }
  });
  it("opens for tests only on a designated test database on this machine", () => {
    const local = { ...prod, FIT_LOCAL_TEST_SERVER: "1", FIT_TEST_OPEN_REGISTRATION: "1" };
    expect(registrationIsClosed({ ...local, DATABASE_URL: url("u:p@localhost:5432/fitdb_test") })).toBe(false);
    expect(registrationIsClosed({ ...local, DATABASE_URL: url("u:p@db.example.invalid/fitdb_test") })).toBe(true);
    expect(registrationIsClosed({ ...local, DATABASE_URL: url("u:p@localhost:5432/fit_production") })).toBe(true);
    expect(registrationIsClosed({ ...prod, FIT_TEST_OPEN_REGISTRATION: "1", DATABASE_URL: url("u:p@localhost:5432/fitdb_test") })).toBe(true);
  });
});
