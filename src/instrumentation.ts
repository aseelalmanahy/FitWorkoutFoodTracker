/** Next.js calls this once as a server starts. It's the one point every production start passes through. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { runProductionPreflight } = await import("@/lib/server/production-preflight");
  await runProductionPreflight();
}
