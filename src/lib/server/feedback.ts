import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { HttpError } from "./api";
import { prisma } from "./db";
import { redactFeedbackText, type FeedbackSubmit, type FeedbackUpdate, FEEDBACK_STATUSES, FEEDBACK_CATEGORIES } from "@/lib/feedback";

/** Judgements for a small invited beta. Counted from the table, so a restart doesn't reset them. */
export const FEEDBACK_LIMITS = { perHour: 5, perDay: 20 } as const;
const HOUR = 60 * 60 * 1000;

const ownView = { id: true, category: true, description: true, route: true, status: true, createdAt: true } as const;

/** One report, unless it repeats the person's own in the last day, word for word, which returns that one instead. */
export async function submitFeedback(userId: string, input: FeedbackSubmit) {
  const now = Date.now();
  const recent = await prisma.feedback.findMany({ where: { userId, createdAt: { gt: new Date(now - 24 * HOUR) } }, select: { id: true, description: true, createdAt: true } });
  const same = recent.find((r) => r.description.trim().toLowerCase() === input.description.trim().toLowerCase());
  if (same) return { feedback: await prisma.feedback.findUniqueOrThrow({ where: { id: same.id }, select: ownView }), repeated: true };
  if (recent.length >= FEEDBACK_LIMITS.perDay || recent.filter((r) => now - r.createdAt.getTime() < HOUR).length >= FEEDBACK_LIMITS.perHour) {
    throw new HttpError(429, "Thanks: that's a lot of feedback at once. Please try again a little later.", undefined, { "Retry-After": "3600" });
  }
  const feedback = await prisma.feedback.create({ data: { userId, category: input.category, description: input.description, route: input.route ?? null }, select: ownView });
  return { feedback, repeated: false };
}

export const listOwnFeedback = (userId: string) =>
  prisma.feedback.findMany({ where: { userId }, select: ownView, orderBy: { createdAt: "desc" }, take: 50 });

type Filter = { status?: (typeof FEEDBACK_STATUSES)[number]; category?: (typeof FEEDBACK_CATEGORIES)[number] };

/** For administrators only; the caller checks. The reporter is shown by a short reference, not an address. */
export async function listAllFeedback(filter: Filter) {
  const rows = await prisma.feedback.findMany({
    where: filter,
    select: { id: true, userId: true, category: true, description: true, route: true, status: true, severity: true, priority: true, duplicateOfId: true, decisionNote: true, taskLink: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const counts = await prisma.feedback.groupBy({ by: ["status"], _count: { _all: true } });
  return { feedback: rows.map(({ userId, ...r }) => ({ ...r, reporter: userId.slice(-6) })), counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
}

export async function updateFeedback(id: string, patch: FeedbackUpdate) {
  if (patch.duplicateOfId) {
    if (patch.duplicateOfId === id) throw new HttpError(400, "A report can't repeat itself.");
    const target = await prisma.feedback.findUnique({ where: { id: patch.duplicateOfId }, select: { duplicateOfId: true } });
    if (!target) throw new HttpError(400, "The report it repeats doesn't exist.");
    if (target.duplicateOfId === id) throw new HttpError(400, "That report already repeats this one.");
  }
  const data = { ...patch, ...(patch.duplicateOfId ? { status: "DUPLICATE" as const } : {}) };
  return prisma.feedback.update({ where: { id }, data, select: { id: true, status: true, severity: true, priority: true, duplicateOfId: true, decisionNote: true, taskLink: true, updatedAt: true } });
}

/**
 * A report for product and engineering review (phase 6): no addresses or IDs, the text redacted, and each reporter
 * replaced by a pseudonym that is the same within this export and can't be linked to another export. Administrators'
 * notes and task links stay out. A person still reads it before it's shared, as redaction can't find every detail.
 */
export async function redactedFeedbackExport(filter: Filter, now = new Date()) {
  const rows = await prisma.feedback.findMany({ where: filter, select: { id: true, userId: true, category: true, description: true, route: true, status: true, severity: true, priority: true, duplicateOfId: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 2000 });
  const key = randomBytes(32);
  const pseudonym = (userId: string) => `reporter-${createHmac("sha256", key).update(userId).digest("hex").slice(0, 8)}`;
  const ref = new Map(rows.map((r, i) => [r.id, `F-${String(i + 1).padStart(4, "0")}`]));
  return {
    format: "fitworkoutfoodtracker-feedback-review",
    version: 1,
    generatedAt: now.toISOString(),
    notice: "Redacted automatically: email addresses, links, handles and long numbers are replaced. Names and other details may remain. Read it before sharing it.",
    items: rows.map((r) => ({
      ref: ref.get(r.id),
      reporter: pseudonym(r.userId),
      category: r.category,
      status: r.status,
      severity: r.severity,
      priority: r.priority,
      duplicateOf: r.duplicateOfId ? ref.get(r.duplicateOfId) ?? "an earlier report" : null,
      date: r.createdAt.toISOString().slice(0, 10),
      page: r.route,
      text: redactFeedbackText(r.description),
    })),
  };
}
