// The two named local databases that aren't fitdb_test, and the checks every script touching them makes first.
//   fitdb_review         the owner's hands-on review: a real database, kept, never used by automated tests
//   fitdb_test_isolated  a separate database for the guarded regression suites, so they never touch fitdb_test
// Only these exact names, only on this machine, only from their own settings file. Never fitdb, fitdb_test,
// fitdb_test_other or anything remote. Nothing here drops, resets or overwrites a database.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { parseEnv } = require("node:util");
const { DB_IDENTITY_SQL } = require("./test-target-guard.cjs");
const { assertConnectedTarget, redact, urlSecrets, TEST_DB_MARKER_PREFIX } = require("./test-db-guard.cjs");

// Must equal REVIEW_MARKER in src/lib/server/production-config.ts. Outside the test-marker family on purpose.
const REVIEW_MARKER = "fitworkoutfoodtracker:review-database:v1:fitdb_review";
const LOCAL_DATABASES = Object.freeze({
  fitdb_review: Object.freeze({ envFile: ".env.review", marker: REVIEW_MARKER }),
  fitdb_test_isolated: Object.freeze({ envFile: ".env.isolated", marker: `${TEST_DB_MARKER_PREFIX}fitdb_test_isolated` }),
  // B1: the isolated database's companion. Its address is .env.isolated's, with only the name changed (see companionUrl).
  fitdb_test_isolated_other: Object.freeze({ envFile: ".env.isolated", companionOf: "fitdb_test_isolated", marker: `${TEST_DB_MARKER_PREFIX}fitdb_test_isolated_other` }),
});

/** A companion's address: its parent's verified local address with only the database name changed. Null if not one. */
function companionUrl(parentUrl, name) {
  const parent = LOCAL_DATABASES[name]?.companionOf;
  if (!parent || localDatabaseProblem(parentUrl, parent)) return null;
  const u = new URL(parentUrl);
  u.pathname = `/${name}`;
  return u.toString();
}
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Null when `url` is exactly the named local database on this machine. Otherwise why not, with no secret in it. */
function localDatabaseProblem(url, name) {
  if (!Object.hasOwn(LOCAL_DATABASES, name)) return `"${name}" isn't one of: ${Object.keys(LOCAL_DATABASES).join(", ")}.`;
  let u;
  try { u = new URL(url ?? ""); } catch { return "DATABASE_URL can't be parsed."; }
  if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") return "DATABASE_URL isn't a PostgreSQL address.";
  if (!LOOPBACK.has(u.hostname)) return "the database host isn't this machine.";
  if ([...u.searchParams.keys()].length) return "DATABASE_URL has parameters, and one such as host= can redirect the connection.";
  const db = decodeURIComponent(u.pathname.slice(1));
  if (db !== name) return `DATABASE_URL names "${db}", not ${name}.`;
  return null;
}

/** The settings came from exactly that database's own file, and nothing already in the shell overrode them. */
function envFileProblem(name, execArgv = process.execArgv, env = process.env) {
  const want = LOCAL_DATABASES[name]?.envFile;
  if (!want) return `"${name}" has no settings file.`;
  const files = execArgv.filter((a) => a.startsWith("--env-file"));
  if (files.length !== 1 || !files[0].startsWith("--env-file=") || path.basename(files[0].slice("--env-file=".length)) !== want) return `run this with exactly --env-file=${want}.`;
  const fromFile = parseEnv(fs.readFileSync(files[0].slice("--env-file=".length), "utf8")).DATABASE_URL;
  if (env.DATABASE_URL !== fromFile) return `a DATABASE_URL already in this shell differs from ${want}'s. In PowerShell, run: Remove-Item Env:DATABASE_URL`;
  return null;
}

/** The server's maintenance database, on the same local server, for creating a database. */
function maintenanceUrl(url) {
  const u = new URL(url);
  u.pathname = "/postgres";
  return u.toString();
}

const fingerprintOf = (identity) => createHash("sha256").update(`fwft-db-identity-v1|${identity}`).digest("hex");

/** Read-only: confirms this connection reaches the named database on a local server, and returns its fingerprint and marker. */
async function readLocalIdentity(client, name) {
  await assertConnectedTarget((sql) => client.$queryRawUnsafe(sql), name);
  const [row] = await client.$queryRawUnsafe(DB_IDENTITY_SQL);
  return { fingerprint: fingerprintOf(row.identity), marker: row.marker };
}

const scrubber = (url) => { const secrets = urlSecrets(url); return (s) => redact(String(s), secrets).replace(/postgres(?:ql)?:\/\/\S+/g, "<database address>"); };

module.exports = { REVIEW_MARKER, LOCAL_DATABASES, companionUrl, localDatabaseProblem, envFileProblem, maintenanceUrl, readLocalIdentity, scrubber };
