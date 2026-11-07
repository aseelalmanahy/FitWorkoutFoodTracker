import { NextResponse } from "next/server";
import { parseMealIdentification } from "@/lib/meal-identification";
import { HttpError, route } from "@/lib/server/api";
import { withValidatedImage } from "@/lib/server/images/upload";
import { LabelExtractionError, type LabelExtractionFailure } from "@/lib/server/labels/extractor";
import { checkLabelScanBudget, reserveLabelScan, type ScanBudget } from "@/lib/server/labels/limits";
import { getMealIdentifier, runMealIdentification } from "@/lib/server/meals/identifier";

const NOTICE = "Unverified. These are AI suggestions from a photo and may be wrong. Check each one. Nothing about amounts or nutrition comes from the photo.";
const LOCAL_NOTICE = "Unverified. This is a suggestion from a model on this server, which names only the main dish and may be wrong. Check it, and add anything else yourself. Nothing about amounts or nutrition comes from the photo.";
const UNREADABLE = "The foods in this photo couldn't be identified. Try another photo, or search for the foods yourself.";

const FAILURES: Record<LabelExtractionFailure, { status: number; message: string; retryAfter?: string }> = {
  unavailable: { status: 503, message: "Meal identification is temporarily unavailable. Try again later.", retryAfter: "30" },
  timeout: { status: 504, message: "The photo took too long to read. Try again later.", retryAfter: "30" },
  misconfigured: { status: 503, message: "Meal identification is temporarily unavailable. Try again later." },
  refused: { status: 502, message: UNREADABLE },
  truncated: { status: 502, message: UNREADABLE },
  invalid_response: { status: 502, message: UNREADABLE },
};

function assertBudget(budget: ScanBudget) {
  if (!budget.allowed) throw new HttpError(429, "You've reached the limit for scans. Try again later.", undefined, { "Retry-After": String(budget.retryAfterSec) });
}

/**
 * Suggests what foods one photo shows, sent as the raw request body. The result is unverified and
 * only returned: no image is stored, and no food or diary entry is created. Only the clean image copy
 * reaches the provider, with nothing that identifies the user. It shares the scan budget with label
 * scans, so the total number of paid requests has one ceiling.
 */
export const POST = route(async (req, { user }) => {
  const identifier = await getMealIdentifier();
  if (!identifier) throw new HttpError(503, "Meal identification isn't set up on this server.");
  assertBudget(checkLabelScanBudget(user.id));

  return withValidatedImage(req, user.id, async ({ image, holdSlot }) => {
    assertBudget(reserveLabelScan(user.id));

    let raw: unknown;
    try {
      raw = await runMealIdentification(identifier, { bytes: image.sanitized, mediaType: image.mediaType }, { onSettled: holdSlot() });
    } catch (err) {
      const code: LabelExtractionFailure = err instanceof LabelExtractionError ? err.code : "unavailable";
      // The code only: provider messages can hold request details, so they're never logged or returned.
      console.error(`Meal identification failed: ${code}`);
      const { status, message, retryAfter } = FAILURES[code];
      throw new HttpError(status, message, undefined, retryAfter ? { "Retry-After": retryAfter } : undefined);
    }

    const parsed = parseMealIdentification(raw);
    if (!parsed.ok) {
      console.error(`Meal identification failed: invalid_response (${parsed.reason})`);
      throw new HttpError(FAILURES.invalid_response.status, FAILURES.invalid_response.message);
    }
    if (!parsed.identification.containsFood) throw new HttpError(422, "This doesn't look like a photo of food. Try another photo, or search for the foods yourself.");

    return NextResponse.json(
      { verified: false, notice: identifier.id.startsWith("local:") ? LOCAL_NOTICE : NOTICE, identification: parsed.identification, identifierId: identifier.id },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
});
