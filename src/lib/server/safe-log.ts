/**
 * A Prisma error's message can hold the query's values, such as a user's data, a row's id or a database
 * address. So only its type and code may reach a log, whichever code path logs it.
 */
const isPrismaError = (err: unknown): err is Error & { code?: unknown } => err instanceof Error && err.name.startsWith("PrismaClient");

const prismaSummary = (err: Error & { code?: unknown }) => `Database error: ${err.name}${typeof err.code === "string" ? ` ${err.code}` : ""}`;

/** Logs an unexpected error. Other errors are logged whole. */
export function logServerError(err: unknown) {
  console.error(isPrismaError(err) ? prismaSummary(err) : err);
}

const PRISMA_TEXT = /Invalid `(prisma|tx)\.|prisma:(error|warn|query)|PostgresError/;

/** Replaces what could carry a Prisma error's text with its summary, including an ordinary error that repeats it. */
export function safeLogArgument(arg: unknown): unknown {
  if (isPrismaError(arg)) return prismaSummary(arg);
  if (arg instanceof Error && isPrismaError(arg.cause)) return `${arg.name}: ${prismaSummary(arg.cause)}`;
  if (arg instanceof Error && PRISMA_TEXT.test(arg.message)) return `${arg.name}: Database error: details withheld`;
  if (typeof arg === "string" && PRISMA_TEXT.test(arg)) return "Database error: details withheld";
  return arg;
}

let installed = false;

/**
 * Next.js logs an error thrown while rendering a page by itself, past logServerError. This keeps Prisma's
 * text out of the console there too. It changes nothing else about what's logged.
 */
export function installSafeConsole(target: Pick<Console, "error" | "warn" | "log"> = console) {
  if (target === console && installed) return;
  if (target === console) installed = true;
  for (const method of ["error", "warn", "log"] as const) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => original(...args.map(safeLogArgument));
  }
}
