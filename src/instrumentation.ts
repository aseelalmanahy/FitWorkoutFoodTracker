/** Next.js calls this once as a server starts. It's the one point every production start passes through. */
export async function register() {
  // A test server also runs in development mode, and has to prove its database is a test one either way.
  if (process.env.NEXT_RUNTIME !== "nodejs" || (process.env.NODE_ENV !== "production" && process.env.FIT_LOCAL_TEST_SERVER !== "1")) return;
  const { runProductionPreflight } = await import("@/lib/server/production-preflight");
  await runProductionPreflight();
}
