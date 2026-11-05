import "server-only";
import { runProviderRequest, type LabelImage } from "@/lib/server/labels/extractor";

/**
 * Suggests what foods a photo shows. Providers are replaceable, and the result is `unknown` on
 * purpose: it's untrusted input until `parseMealIdentification` accepts it.
 */
export interface MealIdentifier {
  /** Recorded with each result, such as "anthropic:some-model". */
  readonly id: string;
  identify(image: LabelImage, signal: AbortSignal): Promise<unknown>;
}

const key = () => process.env.ANTHROPIC_API_KEY?.trim();
const model = () => process.env.MEAL_IDENTIFICATION_MODEL?.trim();

export const isMealIdentificationConfigured = () => Boolean(key() && model());

/**
 * The configured identifier, or null when it isn't set up. It has its own model setting, with no
 * default: the label model's accuracy on labels says nothing about its accuracy on meals.
 */
export async function getMealIdentifier(): Promise<MealIdentifier | null> {
  const apiKey = key();
  const chosen = model();
  if (!apiKey || !chosen) return null;
  const { createAnthropicMealIdentifier } = await import("./anthropic");
  return createAnthropicMealIdentifier({ apiKey, model: chosen, effort: process.env.MEAL_IDENTIFICATION_EFFORT?.trim() || undefined });
}

/** One request with a hard deadline. As with labels, `onSettled` runs only when the work has really ended. */
export const runMealIdentification = (identifier: MealIdentifier, image: LabelImage, options: { timeoutMs?: number; onSettled?: () => void } = {}) =>
  runProviderRequest((signal) => identifier.identify(image, signal), options);
