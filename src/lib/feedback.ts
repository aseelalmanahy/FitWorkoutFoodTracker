/**
 * Beta feedback (phase 5): what a person may send, and what an administrator may change. Shared by server and client.
 * Bounded everywhere: no attachments, no device details, a short page path, and at most 2,000 characters of text.
 */
import { z } from "zod";

export const FEEDBACK_CATEGORIES = ["BUG", "FEATURE", "IMPROVEMENT", "UX", "GENERAL"] as const;
export const FEEDBACK_STATUSES = ["NEW", "TRIAGED", "PLANNED", "IN_PROGRESS", "DONE", "DECLINED", "DUPLICATE"] as const;
export const FEEDBACK_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export const FEEDBACK_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;

export const CATEGORY_LABELS: Record<(typeof FEEDBACK_CATEGORIES)[number], string> = {
  BUG: "Something doesn't work",
  FEATURE: "A feature request",
  IMPROVEMENT: "An improvement to something that exists",
  UX: "Hard to use or understand",
  GENERAL: "General feedback",
};
export const STATUS_LABELS: Record<(typeof FEEDBACK_STATUSES)[number], string> = {
  NEW: "Received", TRIAGED: "Reviewed", PLANNED: "Planned", IN_PROGRESS: "In progress", DONE: "Done", DECLINED: "Not planned", DUPLICATE: "Already reported",
};

export const MIN_FEEDBACK_CHARS = 10;
export const MAX_FEEDBACK_CHARS = 2000;
/** A page path the app has, such as /workouts/plans: letters, digits, dashes and slashes only, so no query or token. */
const ROUTE = /^\/[A-Za-z0-9/_-]{0,119}$/;

export const feedbackSubmitSchema = z.strictObject({
  category: z.enum(FEEDBACK_CATEGORIES),
  description: z.string().trim().min(MIN_FEEDBACK_CHARS, `Please write at least ${MIN_FEEDBACK_CHARS} characters.`).max(MAX_FEEDBACK_CHARS, `At most ${MAX_FEEDBACK_CHARS} characters.`),
  route: z.string().regex(ROUTE).nullable().optional(),
});
export type FeedbackSubmit = z.infer<typeof feedbackSubmitSchema>;

const CUID = /^c[a-z0-9]{20,32}$/;
export const feedbackUpdateSchema = z.strictObject({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  severity: z.enum(FEEDBACK_SEVERITIES).nullable().optional(),
  priority: z.enum(FEEDBACK_PRIORITIES).nullable().optional(),
  duplicateOfId: z.string().regex(CUID).nullable().optional(),
  decisionNote: z.string().trim().max(MAX_FEEDBACK_CHARS).nullable().optional(),
  // A link to the development task: https only, so a stored note can't become a script or a local file link.
  taskLink: z.string().trim().max(500).url().refine((u) => u.startsWith("https://"), "Must be an https link").nullable().optional(),
}).refine((v) => Object.keys(v).length > 0, "Nothing to change");
export type FeedbackUpdate = z.infer<typeof feedbackUpdateSchema>;

export const feedbackFilterSchema = z.strictObject({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  category: z.enum(FEEDBACK_CATEGORIES).optional(),
});

/**
 * Takes out what usually identifies someone in free text: email addresses, phone and other long numbers, links,
 * @handles. Names and other details can't be found reliably, so a person still reads every export before sharing it.
 */
export function redactFeedbackText(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link]")
    .replace(/(^|\s)@[A-Za-z0-9_]{2,}/g, "$1[handle]")
    .replace(/\+?\d[\d\s().-]{5,}\d/g, "[number]");
}
