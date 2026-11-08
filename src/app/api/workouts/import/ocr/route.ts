import { HttpError, route } from "@/lib/server/api";
import { withValidatedImage } from "@/lib/server/images/upload";
import { runProviderRequest } from "@/lib/server/labels/extractor";
import { checkLabelScanBudget, reserveLabelScan, type ScanBudget } from "@/lib/server/labels/limits";
import { LabelExtractionError } from "@/lib/server/labels/extractor";
import { recognizePlanText } from "@/lib/server/labels/local-ocr";

function assertBudget(budget: ScanBudget) {
  if (!budget.allowed) throw new HttpError(429, "You've reached today's limit for reading images. Try again later, or type the plan in.", undefined, { "Retry-After": String(budget.retryAfterSec) });
}

/**
 * Phase 3: the text of one image of a workout plan (a photo, a screenshot, or a scanned PDF page drawn in the
 * browser), read on this server with no paid service and no network request. The image arrives as the raw request
 * body, goes through the upload's validation and limits, is held only in memory, and is released when the request
 * ends. Only text comes back; the browser turns it into a draft. Counts against the same daily allowance as label
 * scans, as it's the same work.
 */
export const POST = route(async (req, { user }) => {
  assertBudget(checkLabelScanBudget(user.id));
  return withValidatedImage(req, user.id, async ({ image, holdSlot }) => {
    assertBudget(reserveLabelScan(user.id));
    try {
      const text = await runProviderRequest((signal) => recognizePlanText(image.sanitized, signal), { onSettled: holdSlot(), timeoutMs: 45_000 });
      return { text: String(text) };
    } catch (err) {
      const code = err instanceof LabelExtractionError ? err.code : "unavailable";
      console.error(`Plan image reading failed: ${code}`);
      throw new HttpError(code === "timeout" ? 504 : 503, "The image couldn't be read just now. Try again, or type the plan in.", undefined, { "Retry-After": "30" });
    }
  });
});
