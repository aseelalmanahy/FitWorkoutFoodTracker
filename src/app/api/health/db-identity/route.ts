import { NextResponse } from "next/server";
import { databaseIdentity, dbIdentityEndpointEnabled } from "@/lib/server/db-identity";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/db-identity → { fingerprint, testMarker } (read-only, no auth, no writes).
 * Lets the live-provider check verify, before creating any record, that the server's
 * actual database is the deliberately marked test database. Returns an opaque hash and
 * the database's test marker comment (or null), never names of other objects or credentials.
 * Disabled (404) in production builds unless EXPOSE_DB_IDENTITY=1.
 */
export async function GET() {
  if (!dbIdentityEndpointEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json(await databaseIdentity(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}
