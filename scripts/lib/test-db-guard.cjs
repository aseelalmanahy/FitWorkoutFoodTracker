// Shared guard for any tool that MODIFIES a database's test-database marker
// (scripts/mark-test-database.cjs and scripts/live-provider-check.safety.test.cjs).
//
// A database may only be marked/unmarked when ALL of these hold:
//   1. The URL is postgres:// or postgresql:// with a LOCAL host: localhost, 127.0.0.1 or ::1.
//      No `host=` query override (it can redirect to another server or socket).
//   2. The database name contains "test" and uses only letters, digits and "_".
//   3. An explicit confirmation value equals the database name exactly.
//   4. After connecting, current_database() equals that name, and the server address
//      is loopback (127.0.0.1 / ::1) or a local socket (NULL), which catches hosts-file or
//      proxy redirection to a remote server.
// Checks 1–3 run before any connection is opened; check 4 runs before any write.
"use strict";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const TEST_DB_MARKER_PREFIX = "fitworkoutfoodtracker:test-database:v1:";

/**
 * Static checks (no connection). Returns { ok, errors, dbName, host }.
 * @param {string|undefined} url
 * @param {string|undefined} confirm
 */
function validateTargetUrl(url, confirm) {
  const errors = [];
  let dbName = null, host = null;
  if (!url) return { ok: false, errors: ["no database URL was given"], dbName, host };
  let u;
  try { u = new URL(url); } catch { return { ok: false, errors: ["the database URL can't be parsed"], dbName, host }; }
  if (!["postgres:", "postgresql:"].includes(u.protocol)) errors.push(`unsupported protocol "${u.protocol}" (expected postgresql:)`);
  host = u.hostname;
  if (!LOCAL_HOSTS.has(host)) errors.push(`database host "${host || "(none)"}" is not local (allowed: localhost, 127.0.0.1, ::1)`);
  if (u.searchParams.has("host")) errors.push('the URL has a "host=" parameter, which can redirect the connection; remove it');
  dbName = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) errors.push(`database name "${dbName}" must use only letters, digits and _`);
  else if (!/test/i.test(dbName)) errors.push(`database name "${dbName}" doesn't contain "test"`);
  if (confirm === undefined || confirm === null || confirm === "") errors.push(`no confirmation given (it must equal the database name "${dbName}")`);
  else if (confirm !== dbName) errors.push(`confirmation "${confirm}" doesn't match the database name "${dbName}"`);
  return { ok: errors.length === 0, errors, dbName, host };
}

/**
 * Post-connection check (read-only). `query` runs SQL and returns rows.
 * Throws if the connected database or server isn't the validated local test database.
 */
async function assertConnectedTarget(query, expectedName) {
  const rows = await query("SELECT current_database() AS name, host(inet_server_addr()) AS addr");
  const { name, addr } = rows[0] || {};
  if (name !== expectedName) throw new Error(`connected to database "${name}", expected "${expectedName}"`);
  if (addr !== null && addr !== undefined && addr !== "127.0.0.1" && addr !== "::1") {
    throw new Error(`the database server address ${addr} is not local`);
  }
}

/** Replace secret values (URL passwords, keys) in any message before printing it. */
function redact(message, secrets) {
  let out = String(message);
  for (const s of secrets) if (s && s.length >= 3) out = out.split(s).join("<redacted>");
  return out;
}

/** Secret forms of the password in a database URL (encoded and decoded), for redaction. */
function urlSecrets(url) {
  try {
    const u = new URL(url);
    if (!u.password) return [];
    return [...new Set([u.password, decodeURIComponent(u.password)])];
  } catch { return []; }
}

module.exports = { validateTargetUrl, assertConnectedTarget, redact, urlSecrets, TEST_DB_MARKER_PREFIX, LOCAL_HOSTS };
