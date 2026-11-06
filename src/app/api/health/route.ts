import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { logServerError } from "@/lib/server/safe-log";

export const dynamic = "force-dynamic";

const DATABASE_TIMEOUT_MS = 2000;

/**
 * GET /api/health, for the proxy and an uptime monitor. Status only: nothing about the database, the version
 * or the host. No auth, no writes, and one trivial query, so calling it often costs little.
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, fail) => { timer = setTimeout(() => fail(new Error("Health check timed out")), DATABASE_TIMEOUT_MS); }),
    ]);
    return NextResponse.json({ status: "ok" }, { headers });
  } catch (err) {
    logServerError(err);
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers });
  } finally {
    clearTimeout(timer);
  }
}
