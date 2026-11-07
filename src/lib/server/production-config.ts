/**
 * What a production server refuses to start with, and who may register. Pure functions of the environment,
 * so each rule can be tested alone. Problems name a setting and never its value, as these end up in logs.
 *
 * `next start` always runs as production, including for the automated suites, which use test databases, stub
 * providers and open sign-up. FIT_LOCAL_TEST_SERVER permits that only for a designated test database on this
 * machine, so setting it on a real deployment is itself a refusal.
 */
import { noticeIsFinal, noticeIsMalformed, type Notice, NOTICE } from "../legal/notice";

type Env = Record<string, string | undefined>;
export interface ConfigProblem { id: string; message: string }

const set = (env: Env, key: string) => (env[key] ?? "") !== "";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const DESIGNATED_TEST_DATABASES = new Set(["fitdb_test", "fitdb_test_other", "fitdb_test_isolated"]);
/** The one local review database: the real app, real providers and real persistence, for the owner's hands-on review. */
export const REVIEW_DATABASE = "fitdb_review";
/** A review database's own marker. Deliberately outside the test-marker family, so no test tool treats it as a test database. */
export const REVIEW_MARKER = "fitworkoutfoodtracker:review-database:v1:fitdb_review";
const DEVELOPMENT_DATABASE = "fitdb";
const MIN_DATABASE_PASSWORD_LENGTH = 16;
const WEAK_PASSWORD = /^(password|postgres|admin|root|secret|changeme|change_me|test|example|placeholder|user)/i;
const SAFE_DATABASE_TLS = new Set(["require", "verify-ca", "verify-full"]);
const PLACEHOLDER_KEY = /^(demo_key|stub|test|fake|changeme|example)/i;

export const AI_SETTINGS = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "LABEL_EXTRACTION_MODEL", "LABEL_EXTRACTION_EFFORT", "MEAL_IDENTIFICATION_MODEL", "MEAL_IDENTIFICATION_EFFORT"];
const STUB_SETTINGS = ["FDC_BASE_URL", "OFF_BASE_URL", "LABEL_STUB_URL", "STUB_LOG_FILE", "MAIL_STUB_DIR"];
const TEST_SETTINGS = ["FOOD_RATE_LIMIT_MULTIPLIER", "SAFETY_DB_URL", "SAFETY_DB_CONFIRM", "SAFETY_OTHER_DB_URL", "GUARD_SNAPSHOT_SCOPE", "BASE_URL", "SHOTS_DIR", "SERVER_LOG_FILE", "EXPECT_UNCONFIGURED", "NODE_TEST_CONTEXT"];

function parseDatabaseUrl(raw: string | undefined): URL | null {
  try {
    const url = new URL(raw ?? "");
    return url.protocol === "postgresql:" || url.protocol === "postgres:" ? url : null;
  } catch {
    return null;
  }
}
const databaseName = (url: URL) => decodeURIComponent(url.pathname.slice(1));

/** Only for a designated test database on this machine, and only when asked for. */
export function isLocalTestServer(env: Env): boolean {
  if (env.FIT_LOCAL_TEST_SERVER !== "1") return false;
  const url = parseDatabaseUrl(env.DATABASE_URL);
  // A host= parameter can redirect the connection, whatever the URL's host says. The test guard refuses it too.
  return !!url && !url.searchParams.has("host") && LOOPBACK.has(url.hostname) && DESIGNATED_TEST_DATABASES.has(databaseName(url));
}

/**
 * A local review server: a production build with real food providers, on the one database named fitdb_review, on this
 * machine, served at this machine's own http origin. Unlike a test server it skips nothing but the two checks that only
 * make sense on a real deployment (an https origin elsewhere, and a proxy in front), and its database password rule is
 * reported instead of refused. Everything else, including registration staying closed, applies as in production.
 */
export function isLocalReviewServer(env: Env): boolean {
  if (env.FIT_LOCAL_REVIEW_SERVER !== "1") return false;
  const url = parseDatabaseUrl(env.DATABASE_URL);
  let origin: URL | null = null;
  try { origin = new URL(env.APP_ORIGIN ?? ""); } catch { origin = null; }
  return !!url && !url.searchParams.has("host") && LOOPBACK.has(url.hostname) && databaseName(url) === REVIEW_DATABASE
    && !!origin && origin.protocol === "http:" && LOOPBACK.has(origin.hostname) && (origin.pathname === "/" || origin.pathname === "") && !origin.search && !origin.username;
}

/** Exact addresses only. Anything else is refused at startup, so "*" or "@example.com" can't open sign-up. */
const ALLOWLIST_ENTRY = /^[^\s@*,]+@[^\s@*,]+\.[^\s@*,]+$/;
const allowlistEntries = (env: Env) => (env.REGISTRATION_ALLOWLIST ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

export const registrationIsClosed = (env: Env = process.env) =>
  env.NODE_ENV === "production" && !(isLocalTestServer(env) && env.FIT_TEST_OPEN_REGISTRATION === "1");

const isLoopbackOrigin = (origin: string | undefined) => {
  if (!origin) return true;
  try {
    return LOOPBACK.has(new URL(origin).hostname);
  } catch {
    return false;
  }
};

/**
 * Whether anyone can register under the current legal documents. A draft keeps real registration shut. A designated
 * test database needs this machine's own origin as well, so a real host pointed at a local database named fitdb_test,
 * with its real origin set, isn't exempt. Startup confirms that database's marker. One deliberate misconfiguration still
 * opens it: the test-server flag, a marked local fitdb_test, and no real origin set, behind a host others can reach. Its
 * mail only reaches a local file or nowhere, so nobody could finish signing up, S-28.
 * Development needs that exact value, the development database on this machine, and no real origin, so an unset
 * NODE_ENV opens nothing. Startup refuses a real deployment with any other NODE_ENV. `next dev` skips that check, so
 * `next dev` with a local fitdb on a machine others can reach would still be open, with its mail only in a local file.
 * FIT_TEST_OPEN_REGISTRATION has no part in this.
 */
export function noticeGateOpen(env: Env = process.env, notice: Notice = NOTICE): boolean {
  if (noticeIsFinal(notice)) return true;
  if (isLocalTestServer(env)) return isLoopbackOrigin(env.APP_ORIGIN);
  if (env.NODE_ENV !== "development" || !isLoopbackOrigin(env.APP_ORIGIN)) return false;
  const url = parseDatabaseUrl(env.DATABASE_URL);
  return !!url && !url.searchParams.has("host") && LOOPBACK.has(url.hostname) && databaseName(url) === DEVELOPMENT_DATABASE;
}

/**
 * Closed by default in production, and while the documents are drafts. `email` has been normalized by the shared
 * schema, and the match is exact. Issuing a link and creating an account both come through here, so a link sent
 * earlier can't get past a gate that has since closed.
 */
export function registrationAllowed(email: string, env: Env = process.env): boolean {
  if (!noticeGateOpen(env)) return false;
  if (!registrationIsClosed(env)) return true;
  return allowlistEntries(env).filter((e) => ALLOWLIST_ENTRY.test(e)).includes(email.trim().toLowerCase());
}

/** The file stub's folder, for development and designated test databases. A real deployment never has one. */
/**
 * A real email provider (EMAIL-01), when MAIL_PROVIDER names one and its settings are valid. Null otherwise. A designated
 * test database's mail always stays in a local folder instead, so tests never send real email.
 */
export const MAIL_PROVIDERS = ["resend"] as const;
const MAIL_FROM = /^(?:[^<>\r\n]{1,80} <)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/;
export function mailProvider(env: Env = process.env): { name: (typeof MAIL_PROVIDERS)[number]; apiKey: string; from: string } | null {
  if (env.MAIL_PROVIDER !== "resend" || isLocalTestServer(env)) return null;
  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  const from = (env.MAIL_FROM ?? "").trim();
  if (!apiKey || !MAIL_FROM.test(from)) return null;
  return { name: "resend", apiKey, from };
}
function mailProblems(env: Env): ConfigProblem[] {
  if (!set(env, "MAIL_PROVIDER")) return [];
  const problems: ConfigProblem[] = [];
  if (!(MAIL_PROVIDERS as readonly string[]).includes(env.MAIL_PROVIDER as string)) problems.push({ id: "mail-provider", message: `MAIL_PROVIDER must be one of: ${MAIL_PROVIDERS.join(", ")}.` });
  if (!set(env, "RESEND_API_KEY")) problems.push({ id: "mail-key", message: "RESEND_API_KEY is required with MAIL_PROVIDER=resend." });
  else if (PLACEHOLDER_KEY.test(env.RESEND_API_KEY as string) || !/^re_[A-Za-z0-9_]{16,}$/.test((env.RESEND_API_KEY as string).trim())) problems.push({ id: "mail-key", message: "RESEND_API_KEY doesn't look like a Resend API key." });
  if (!MAIL_FROM.test((env.MAIL_FROM ?? "").trim())) problems.push({ id: "mail-from", message: "MAIL_FROM must be an address on a domain verified with the provider, such as \"FitWorkoutFoodTracker <no-reply@example.com>\"." });
  return problems;
}

export function mailStubDir(env: Env = process.env): string | null {
  if (env.NODE_ENV === "production" && !isLocalTestServer(env)) return null;
  return env.MAIL_STUB_DIR || (env.NODE_ENV === "production" ? null : ".mail-outbox");
}

/**
 * Where emailed links point. Never from a request header, which anyone can forge. Startup requires APP_ORIGIN on a real
 * deployment. A development or test server gets a fixed value, as its port varies and nothing real receives this mail.
 */
export function accountLinkOrigin(env: Env = process.env): string | null {
  const origin = (env.APP_ORIGIN ?? "").replace(/\/$/, "");
  if (origin) return origin;
  return env.NODE_ENV === "production" && !isLocalTestServer(env) ? null : "http://localhost:3000";
}

function originProblems(env: Env): ConfigProblem[] {
  const fail = (message: string) => [{ id: "app-origin", message }];
  if (!set(env, "APP_ORIGIN")) return fail("APP_ORIGIN is required.");
  let url: URL;
  try {
    url = new URL(env.APP_ORIGIN as string);
  } catch {
    return fail("APP_ORIGIN isn't a valid URL.");
  }
  if (url.protocol !== "https:") return fail("APP_ORIGIN must use HTTPS.");
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return fail("APP_ORIGIN must be only a scheme and host.");
  if (LOOPBACK.has(url.hostname)) return fail("APP_ORIGIN can't be this machine.");
  return [];
}

function databaseProblems(env: Env): ConfigProblem[] {
  const fail = (id: string, message: string) => [{ id, message }];
  if (!set(env, "DATABASE_URL")) return fail("database-missing", "DATABASE_URL is required.");
  const url = parseDatabaseUrl(env.DATABASE_URL);
  if (!url) return fail("database-invalid", "DATABASE_URL isn't a PostgreSQL URL.");
  const name = databaseName(url);
  if (/test/i.test(name)) return fail("database-test", "DATABASE_URL names a test database.");
  if (LOOPBACK.has(url.hostname) && name === DEVELOPMENT_DATABASE) return fail("database-development", "DATABASE_URL names the development database.");
  const problems: ConfigProblem[] = [];
  const password = decodeURIComponent(url.password);
  if (!password) problems.push({ id: "database-password-missing", message: "The database password is missing." });
  else if (password.length < MIN_DATABASE_PASSWORD_LENGTH || WEAK_PASSWORD.test(password) || password === decodeURIComponent(url.username)) problems.push({ id: "database-password-weak", message: "The database password is too weak." });
  if (!LOOPBACK.has(url.hostname) && !SAFE_DATABASE_TLS.has(url.searchParams.get("sslmode") ?? "")) problems.push({ id: "database-tls", message: "A remote database must use sslmode=require or stricter." });
  return problems;
}

/** Everything wrong with this environment for production. Empty means it may proceed to check the database itself. */
export function productionConfigProblems(env: Env = process.env): ConfigProblem[] {
  if (isLocalTestServer(env)) return [];
  const review = isLocalReviewServer(env);
  if (set(env, "FIT_LOCAL_REVIEW_SERVER") && !review) {
    return [{ id: "review-server-flag", message: "FIT_LOCAL_REVIEW_SERVER is only for the local review database, fitdb_review, served at this machine's http origin." }];
  }
  const problems: ConfigProblem[] = [...(review ? [] : originProblems(env)), ...databaseProblems(env).filter((p) => !(review && REVIEW_WARNINGS.has(p.id)))];
  const add = (id: string, message: string) => problems.push({ id, message });

  // `next start` keeps whatever it's given, and development mode relaxes registration.
  if (env.NODE_ENV !== "production") add("node-env", "NODE_ENV must be production.");

  if (set(env, "FIT_LOCAL_TEST_SERVER")) add("test-server-flag", "FIT_LOCAL_TEST_SERVER is only for a test database on this machine.");
  if (set(env, "FIT_TEST_OPEN_REGISTRATION")) add("test-registration-flag", "FIT_TEST_OPEN_REGISTRATION is only for a test database on this machine.");
  if (set(env, "EXPOSE_DB_IDENTITY")) add("db-identity", "EXPOSE_DB_IDENTITY must not be set: it publishes the database's identity.");
  for (const key of AI_SETTINGS) if (set(env, key)) add("ai-enabled", `${key} must not be set: paid AI isn't approved.`);
  for (const key of STUB_SETTINGS) if (set(env, key)) add("stub-provider", `${key} must not be set: it's for stub providers.`);
  for (const key of TEST_SETTINGS) if (set(env, key)) add("test-setting", `${key} must not be set: it's for automated tests.`);

  const hops = env.TRUST_PROXY_HOPS ?? "";
  // A review server has no proxy in front, and nobody but this machine reaches it.
  if (!review && !/^[1-9]\d?$/.test(hops)) add("proxy-hops", "TRUST_PROXY_HOPS must be the number of proxies in front of the app, at least 1.");
  if (review && hops) add("proxy-hops", "TRUST_PROXY_HOPS must not be set on a local review server, as nothing is in front of it.");

  if (allowlistEntries(env).some((e) => !ALLOWLIST_ENTRY.test(e))) add("allowlist-invalid", "REGISTRATION_ALLOWLIST must hold exact email addresses only.");
  problems.push(...mailProblems(env));
  if (set(env, "LABEL_OCR") && env.LABEL_OCR !== "local") add("label-ocr", "LABEL_OCR can only be \"local\", for on-device label reading.");
  if (set(env, "MEAL_RECOGNITION")) {
    // The model files themselves are checked by the startup preflight, which runs only in Node (production-preflight.ts).
    if (env.MEAL_RECOGNITION !== "local") add("meal-recognition", "MEAL_RECOGNITION can only be \"local\", for on-device meal suggestions.");
  }
  if (set(env, "FDC_API_KEY") && PLACEHOLDER_KEY.test(env.FDC_API_KEY as string)) add("placeholder-key", "FDC_API_KEY is a placeholder.");
  if (noticeIsMalformed()) add("notice-malformed", "The notice says it's final, and doesn't pass as final.");
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") add("tls-disabled", "NODE_TLS_REJECT_UNAUTHORIZED must not disable certificate checks.");
  if (/--inspect/.test(env.NODE_OPTIONS ?? "")) add("debugger", "NODE_OPTIONS must not enable the debugger.");
  return problems;
}

/** Reported at a review server's start, but not refused: they concern a deployment, and the review database is on this machine. */
const REVIEW_WARNINGS = new Set(["database-password-weak"]);
export function reviewServerWarnings(env: Env = process.env): ConfigProblem[] {
  return isLocalReviewServer(env) ? databaseProblems(env).filter((p) => REVIEW_WARNINGS.has(p.id)) : [];
}

/** A review server's database has to be exactly the review database, carrying the review marker and no test marker. */
export function reviewDatabaseProblems(identity: { name: string; comment: string | null }): ConfigProblem[] {
  return identity.name === REVIEW_DATABASE && identity.comment === REVIEW_MARKER ? [] : [{ id: "review-database-unmarked", message: "This review server's database isn't fitdb_review carrying its review marker." }];
}

const MARKER_FAMILY = "fitworkoutfoodtracker:test-database:";

/** A designated test database has to carry its own marker, so a tunnel with that name isn't treated as one. */
export function testDatabaseMarkerProblems(identity: { name: string; comment: string | null }): ConfigProblem[] {
  return identity.comment === MARKER_FAMILY + `v1:${identity.name}` ? [] : [{ id: "test-database-unmarked", message: "This test server's database doesn't carry its own test marker." }];
}

/** The database as it reports itself, so an alias or proxy can't hide a test database behind another name. */
export function databaseIdentityProblems(identity: { name: string; comment: string | null }): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  if (/test/i.test(identity.name)) problems.push({ id: "database-identity-test", message: "The connected database is a test database." });
  if (identity.comment?.startsWith(MARKER_FAMILY)) problems.push({ id: "database-marker", message: "The connected database carries a test marker." });
  return problems;
}
