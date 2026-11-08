import { HttpError, route } from "@/lib/server/api";
import { withValidatedImage } from "@/lib/server/images/upload";
import { LabelExtractionError, runProviderRequest } from "@/lib/server/labels/extractor";
import { checkLabelScanBudget, reserveLabelScan, type ScanBudget } from "@/lib/server/labels/limits";
import { recognizePlanText } from "@/lib/server/labels/local-ocr";
import { packageTextLines } from "@/lib/package-text";

function assertBudget(budget: ScanBudget) {
  if (!budget.allowed) throw new HttpError(429, "You've reached today's limit for reading photos. Try again later, or search by name.", undefined, { "Retry-After": String(budget.retryAfterSec) });
}

/**
 * Phase 4: the words on a package's front, from one photo with no readable barcode, read on this server with no paid
 * service and no network request, so the person can choose what to search for. Only words come back, never values:
 * nothing here can become a nutrient. The photo is validated, held in memory, and released; nothing is stored.
 */
export const POST = route(async (req, { user }) => {
  assertBudget(checkLabelScanBudget(user.id));
  return withValidatedImage(req, user.id, async ({ image, holdSlot }) => {
    assertBudget(reserveLabelScan(user.id));
    try {
      const text = await runProviderRequest((signal) => recognizePlanText(image.sanitized, signal), { onSettled: holdSlot(), timeoutMs: 45_000 });
      return { lines: packageTextLines(String(text)) };
    } catch (err) {
      const code = err instanceof LabelExtractionError ? err.code : "unavailable";
      console.error(`Package photo reading failed: ${code}`);
      throw new HttpError(code === "timeout" ? 504 : 503, "The photo couldn't be read just now. Try again, or search by name.", undefined, { "Retry-After": "30" });
    }
  });
});
