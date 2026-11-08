// The deployment templates, read as text. They've never been run, so this checks only what's written in them.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HSTS_VALUE } from "@/lib/security-headers";
import { productionConfigProblems } from "./production-config";

const ROOT = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");

describe("the Node version is pinned everywhere", () => {
  const pinned = read(".nvmrc").trim();
  it("is an exact version", () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("in package.json", () => {
    expect(JSON.parse(read("package.json")).engines.node).toBe(pinned);
  });
  it("in every image stage", () => {
    const stages = [...read("Dockerfile").matchAll(/^FROM node:([^\s-]+)/gm)].map((m) => m[1]);
    expect(stages.length).toBeGreaterThanOrEqual(2);
    for (const v of stages) expect(v).toBe(pinned);
  });
});

describe("the image", () => {
  const docker = read("Dockerfile");
  it("runs as production, as a non-root user, with a health check", () => {
    expect(docker).toMatch(/ENV NODE_ENV=production/);
    expect(docker).toMatch(/^USER node$/m);
    expect(docker).toMatch(/HEALTHCHECK[\s\S]*\/api\/health/);
  });
  it("keeps secrets out", () => {
    const ignore = read(".dockerignore");
    expect(ignore).toMatch(/^\.mail-outbox\r?$/m); // development email holds live links
    for (const entry of [".env", ".env.*", ".git"]) expect(ignore.split("\n")).toContain(entry);
  });
  it("includes what next.config.ts imports", () => {
    expect(read("next.config.ts")).toContain("./src/lib/security-headers");
    expect(docker).toContain("COPY src/lib/security-headers.ts");
  });
});

describe("Compose", () => {
  const compose = read("deploy/compose.production.yml");
  it("has no database, as it's managed", () => {
    expect(compose).not.toMatch(/image: *postgres/i);
    expect(compose).not.toMatch(/5432/);
  });
  it("publishes the app on no host port", () => {
    const app = compose.slice(compose.indexOf("\n  app:\n"), compose.indexOf("\n  proxy:\n"));
    expect(app).not.toMatch(/^\s+ports:/m);
    expect(app).toMatch(/expose:/);
    expect(app).toMatch(/mem_limit: 1536m/);
    expect(app).toMatch(/read_only: true/);
    expect(app).toMatch(/cap_drop: \[ALL\]/);
    expect(app).toMatch(/TRUST_PROXY_HOPS: "1"/);
    expect(app).toMatch(/NODE_ENV: production/);
  });
  it("runs migrations only when asked, with their own credential", () => {
    const migrate = compose.slice(compose.indexOf("\n  migrate:\n"), compose.indexOf("\nnetworks:"));
    expect(migrate).toMatch(/profiles: \[migrate\]/);
    expect(migrate).toMatch(/MIGRATION_DATABASE_URL/);
    expect(compose.slice(compose.indexOf("\n  app:\n"), compose.indexOf("\n  proxy:\n"))).not.toContain("MIGRATION_DATABASE_URL");
  });
  it("sets nothing the preflight refuses", () => {
    for (const key of ["EXPOSE_DB_IDENTITY", "ANTHROPIC", "LABEL_EXTRACTION", "MEAL_IDENTIFICATION", "FDC_BASE_URL", "OFF_BASE_URL", "FIT_LOCAL_TEST_SERVER", "FIT_TEST_OPEN_REGISTRATION", "FOOD_RATE_LIMIT_MULTIPLIER"]) expect(compose, key).not.toContain(key);
  });
});

describe("the proxy", () => {
  const caddy = read("deploy/Caddyfile");
  it("matches the app's HSTS value, and limits bodies", () => {
    expect(caddy).toContain(`Strict-Transport-Security "${HSTS_VALUE}"`);
    expect(caddy).toMatch(/max_size 8MB/);
  });
  it("trusts no proxy in front of it, so a caller's forwarded headers are replaced", () => {
    expect(caddy).not.toMatch(/^\s*trusted_proxies/m);
  });
  it("names no real domain", () => {
    expect(caddy).toContain("{$APP_DOMAIN}");
  });
});

describe("the environment template", () => {
  const raw = read("deploy/production.env.example");
  const entries = Object.fromEntries(raw.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  it("is refused as it stands, so it can't be used unfilled", () => {
    const problems = productionConfigProblems({ NODE_ENV: "production", APP_ORIGIN: entries.APP_ORIGIN, DATABASE_URL: entries.APP_DATABASE_URL, TRUST_PROXY_HOPS: "1" });
    expect(problems.map((p) => p.id)).toContain("database-password-weak");
  });
  it("holds no real secret or host", () => {
    for (const value of [entries.APP_DATABASE_URL, entries.MIGRATION_DATABASE_URL]) {
      expect(value).toContain("CHANGE_ME@CHANGE_ME.example.invalid");
      expect(value).toContain("sslmode=require");
    }
    expect(entries.FDC_API_KEY).toBe("");
    expect(entries.REGISTRATION_ALLOWLIST).toBe("");
  });
  it("is the only environment file Git will track here", () => {
    expect(read(".gitignore")).toContain("deploy/production.env");
  });
  // G1 review: Compose passes only the variables its app service lists, so a setting in the template that isn't
  // listed there would be silently ignored in production (mail and on-device reading were, before this test).
  it("every app setting it offers, set or commented out, reaches the app container", () => {
    const compose = read("deploy/compose.production.yml");
    const app = compose.slice(compose.indexOf("\n  app:\n"), compose.indexOf("\n  proxy:\n"));
    const offered = [...raw.matchAll(/^#?\s*([A-Z][A-Z_]+)=/gm)].map((m) => m[1]);
    const forCompose = new Set(["APP_IMAGE_TAG", "APP_DOMAIN", "MIGRATION_DATABASE_URL", "APP_DATABASE_URL"]);
    const missing = offered.filter((k) => !forCompose.has(k) && !new RegExp(`\\$\\{${k}[:}]`).test(app));
    expect(offered).toEqual(expect.arrayContaining(["MAIL_PROVIDER", "RESEND_API_KEY", "MAIL_FROM", "LABEL_OCR", "MEAL_RECOGNITION"]));
    expect(missing).toEqual([]);
    expect(app).toMatch(/DATABASE_URL: \$\{APP_DATABASE_URL:\?/);
  });
});

describe("the design documents don't claim what isn't true", () => {
  it("the runbook says nothing has been deployed", () => {
    expect(read("docs/PHASE_4_0_3_DEPLOYMENT.md")).toMatch(/prepared, never used/);
  });
  it("the recovery design says the ledger isn't operational", () => {
    const doc = read("docs/PHASE_4_0_3_BACKUP_RECOVERY.md");
    expect(doc).toMatch(/a design only\. Nothing here is operational/);
    expect(doc).toMatch(/a restore can bring deleted accounts back/);
    expect(doc).toMatch(/No retention period here is legally approved/);
  });
});
