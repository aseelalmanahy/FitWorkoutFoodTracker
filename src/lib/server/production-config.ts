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
const DESIGNATED_TEST_DATABASES = new Set(["fitdb_test", "fitdb_test_other"]);
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
  const problems: ConfigProblem[] = [...originProblems(env), ...databaseProblems(env)];
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
  if (!/^[1-9]\d?$/.test(hops)) add("proxy-hops", "TRUST_PROXY_HOPS must be the number of proxies in front of the app, at least 1.");

  if (allowlistEntries(env).some((e) => !ALLOWLIST_ENTRY.test(e))) add("allowlist-invalid", "REGISTRATION_ALLOWLIST must hold exact email addresses only.");
  if (set(env, "FDC_API_KEY") && PLACEHOLDER_KEY.test(env.FDC_API_KEY as string)) add("placeholder-key", "FDC_API_KEY is a placeholder.");
  if (noticeIsMalformed()) add("notice-malformed", "The notice says it's final, and doesn't pass as final.");
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") add("tls-disabled", "NODE_TLS_REJECT_UNAUTHORIZED must not disable certificate checks.");
  if (/--inspect/.test(env.NODE_OPTIONS ?? "")) add("debugger", "NODE_OPTIONS must not enable the debugger.");
  return problems;
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
