import { databaseIdentityProblems, isLocalTestServer, mailStubDir, noticeGateOpen, productionConfigProblems, testDatabaseMarkerProblems, type ConfigProblem } from "./production-config";
import { installSafeConsole } from "./safe-log";

const IDENTITY_SQL = `SELECT current_database() AS name, shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') AS comment`;

type IdentityReader = () => Promise<{ name: string; comment: string | null }>;

async function readIdentity(): Promise<{ name: string; comment: string | null }> {
  const { prisma } = await import("./db");
  const rows = await prisma.$queryRawUnsafe<{ name: string; comment: string | null }[]>(IDENTITY_SQL);
  return rows[0];
}

/** Every reason this server must not start. An unreadable database counts, as nothing shows it's safe. */
export async function preflightProblems(env: Record<string, string | undefined> = process.env, identity: IdentityReader = readIdentity): Promise<ConfigProblem[]> {
  if (isLocalTestServer(env)) {
    try {
      return testDatabaseMarkerProblems(await identity());
    } catch {
      return [{ id: "database-unverified", message: "The database couldn't be reached to check what it is." }];
    }
  }
  const problems = productionConfigProblems(env);
  if (problems.length) return problems;
  try {
    return databaseIdentityProblems(await identity());
  } catch {
    return [{ id: "database-unverified", message: "The database couldn't be reached to check what it is." }];
  }
}

/** Runs once, as the production server starts. On any problem it stops the process before serving a request. */
export async function runProductionPreflight(): Promise<void> {
  installSafeConsole();
  const problems = await preflightProblems();
  if (!problems.length) {
    if (!mailStubDir()) console.warn("[preflight] No email provider exists yet, so sign-up and password reset emails won't be sent.");
    if (!noticeGateOpen()) console.warn("[preflight] The privacy notice and terms are drafts, so registration is closed.");
    return;
  }
  for (const p of problems) console.error(`[preflight] ${p.id}: ${p.message}`);
  console.error(`[preflight] Refusing to start: ${problems.length} problem(s).`);
  process.exit(1);
}
