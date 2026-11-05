import { NextResponse } from "next/server";
import { checkLabelExtraction, parseLabelExtraction } from "@/lib/label-extraction";
import { HttpError, route } from "@/lib/server/api";
import { withValidatedImage } from "@/lib/server/images/upload";
import { getLabelExtractor, LabelExtractionError, runLabelExtraction, type LabelExtractionFailure } from "@/lib/server/labels/extractor";
import { checkLabelScanBudget, reserveLabelScan, type ScanBudget } from "@/lib/server/labels/limits";

const NOTICE = "Unverified. This was read by AI and may be wrong. Check every value against the label before using it.";
const UNREADABLE = "The label couldn't be read reliably. Try again with a clearer photo, or enter the values yourself.";

const FAILURES: Record<LabelExtractionFailure, { status: number; message: string; retryAfter?: string }> = {
  unavailable: { status: 503, message: "Label scanning is temporarily unavailable. Try again later.", retryAfter: "30" },
  timeout: { status: 504, message: "The label took too long to read. Try again later.", retryAfter: "30" },
  misconfigured: { status: 503, message: "Label scanning is temporarily unavailable. Try again later." },
  refused: { status: 502, message: UNREADABLE },
  truncated: { status: 502, message: UNREADABLE },
  invalid_response: { status: 502, message: UNREADABLE },
};

function assertBudget(budget: ScanBudget) {
  if (!budget.allowed) throw new HttpError(429, "You've reached the limit for label scans. Try again later.", undefined, { "Retry-After": String(budget.retryAfterSec) });
}

/**
 * Reads a nutrition label from one image sent as the raw request body. The result is unverified and
 * is only returned: no image is stored, and no food or log entry is created. Only the clean image
 * copy reaches the provider, with nothing that identifies the user.
 */
export const POST = route(async (req, { user }) => {
  const extractor = await getLabelExtractor();
  if (!extractor) throw new HttpError(503, "Label scanning isn't set up on this server.");
  assertBudget(checkLabelScanBudget(user.id));

  return withValidatedImage(req, user.id, async ({ image, sha256, holdSlot }) => {
    assertBudget(reserveLabelScan(user.id));

    let raw: unknown;
    try {
      raw = await runLabelExtraction(extractor, { bytes: image.sanitized, mediaType: image.mediaType }, { onSettled: holdSlot() });
    } catch (err) {
      const code: LabelExtractionFailure = err instanceof LabelExtractionError ? err.code : "unavailable";
      // The code only: provider messages can hold request details, so they're never logged or returned.
      console.error(`Label extraction failed: ${code}`);
      const { status, message, retryAfter } = FAILURES[code];
      throw new HttpError(status, message, undefined, retryAfter ? { "Retry-After": retryAfter } : undefined);
    }

    const parsed = parseLabelExtraction(raw);
    if (!parsed.ok) {
      console.error(`Label extraction failed: invalid_response (${parsed.reason})`);
      throw new HttpError(FAILURES.invalid_response.status, FAILURES.invalid_response.message);
    }
    if (!parsed.extraction.isNutritionLabel) throw new HttpError(422, "This doesn't look like a nutrition label. Crop to the label, or try another photo.");

    return NextResponse.json(
      { verified: false, notice: NOTICE, extraction: parsed.extraction, flags: checkLabelExtraction(parsed.extraction), extractorId: extractor.id, imageSha256: sha256 },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
});
