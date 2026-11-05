import "server-only";

/**
 * Logs an unexpected error. A Prisma error's message can hold the query's values, such as a user's
 * data or a database address, so only its type and code are logged. Other errors are logged whole.
 */
export function logServerError(err: unknown) {
  if (err instanceof Error && err.name.startsWith("PrismaClient")) {
    const code = (err as { code?: unknown }).code;
    console.error(`Database error: ${err.name}${typeof code === "string" ? ` ${code}` : ""}`);
    return;
  }
  console.error(err);
}
