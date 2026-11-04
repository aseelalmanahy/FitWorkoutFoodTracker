import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "./db";

/**
 * Database identity for scripts/live-provider-check.cjs, which uses it to prove,
 * BEFORE writing anything, that the running server is connected to a deliberately
 * provisioned test database.
 *
 * fingerprint: SHA-256 over current_database(), the database's OID and the cluster
 *   start time (epoch seconds). Identical for every connection to the same database,
 *   independent of session settings such as the time zone. Only the hash is returned.
 * testMarker: the test marker on the current database, or null. A dedicated test database
 *   is marked deliberately with scripts/mark-test-database.cjs, and the valid value is
 *   `${TEST_DB_MARKER_PREFIX}<database name>`. Migrations never set it. Only comments shaped
 *   like a marker are echoed; any other database comment is reported as NON_MARKER_COMMENT,
 *   so arbitrary comment text is never exposed by this unauthenticated endpoint.
 *
 * The SQL and formats are duplicated in the scripts and must stay in sync.
 */
export const TEST_DB_MARKER_PREFIX = "fitworkoutfoodtracker:test-database:v1:";
const MARKER_FAMILY = "fitworkoutfoodtracker:test-database:";
export const NON_MARKER_COMMENT = "<non-marker comment>";

export const DB_IDENTITY_SQL =
  "SELECT current_database() || '|' || (SELECT oid::text FROM pg_database WHERE datname = current_database()) || '|' || extract(epoch from pg_postmaster_start_time())::text AS identity, " +
  "shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') AS marker";

export async function databaseIdentity(): Promise<{ fingerprint: string; testMarker: string | null }> {
  const rows = await prisma.$queryRawUnsafe<{ identity: string; marker: string | null }[]>(DB_IDENTITY_SQL);
  return {
    fingerprint: createHash("sha256").update(`fwft-db-identity-v1|${rows[0].identity}`).digest("hex"),
    testMarker: rows[0].marker == null ? null
      : rows[0].marker.startsWith(MARKER_FAMILY) && rows[0].marker.length <= 200 ? rows[0].marker
      : NON_MARKER_COMMENT,
  };
}

/** Off in production builds unless explicitly enabled; always on in development. */
export const dbIdentityEndpointEnabled = () =>
  process.env.NODE_ENV !== "production" || process.env.EXPOSE_DB_IDENTITY === "1";
