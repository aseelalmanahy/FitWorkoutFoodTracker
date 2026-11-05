import "server-only";

export interface LabelImage {
  /** Only the clean copy from image validation, so no metadata can reach a provider. */
  bytes: Uint8Array;
  mediaType: string;
}

/**
 * Reads a nutrition label. Providers are replaceable, and the result is `unknown` on purpose: it's
 * untrusted input until `parseLabelExtraction` accepts it. It may be JSON text or a parsed value.
 */
export interface LabelExtractor {
  /** Recorded with each result, such as "anthropic:some-model". */
  readonly id: string;
  extract(image: LabelImage, signal: AbortSignal): Promise<unknown>;
}

export type LabelExtractionFailure =
  /** The provider can't be reached or is overloaded. Worth trying later. */
  | "unavailable"
  | "timeout"
  /** Our key, model or request was refused. An operator must fix it. */
  | "misconfigured"
  | "refused"
  | "truncated"
  | "invalid_response";

/** Carries only a code. Provider messages never go in here, so they can't reach a user or a log. */
export class LabelExtractionError extends Error {
  constructor(public readonly code: LabelExtractionFailure) {
    super(`Label extraction failed: ${code}`);
    this.name = "LabelExtractionError";
  }
}

export const LABEL_EXTRACTION_TIMEOUT_MS = 60_000;

/**
 * The configured extractor, or null when scanning isn't set up. Both a key and a model are needed.
 * There's deliberately no default model: which one is accurate enough at what cost must be
 * measured on real labels, then chosen by whoever pays for it.
 */
export async function getLabelExtractor(): Promise<LabelExtractor | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const model = process.env.LABEL_EXTRACTION_MODEL?.trim();
  if (!apiKey || !model) return null;
  const { createAnthropicLabelExtractor } = await import("./anthropic");
  return createAnthropicLabelExtractor({ apiKey, model, effort: process.env.LABEL_EXTRACTION_EFFORT?.trim() || undefined });
}

/** Runs an extractor with a hard deadline, even if it ignores the abort signal. */
export async function runLabelExtraction(extractor: LabelExtractor, image: LabelImage, timeoutMs = LABEL_EXTRACTION_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, fail) => {
    timer = setTimeout(() => {
      fail(new LabelExtractionError("timeout"));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([extractor.extract(image, controller.signal), deadline]);
  } catch (err) {
    throw err instanceof LabelExtractionError ? err : new LabelExtractionError("unavailable");
  } finally {
    clearTimeout(timer);
  }
}
