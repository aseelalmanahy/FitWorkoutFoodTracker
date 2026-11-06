import "server-only";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Prisma's own error log prints the driver's text, with row ids and values, past safe-log.ts. It's only for
 * local development. errorFormat keeps the source context out of error messages too.
 */
export const prismaLogLevels = (nodeEnv: string | undefined): ("warn" | "error")[] => (nodeEnv === "development" ? ["warn", "error"] : []);

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ log: prismaLogLevels(process.env.NODE_ENV), errorFormat: "minimal" });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
