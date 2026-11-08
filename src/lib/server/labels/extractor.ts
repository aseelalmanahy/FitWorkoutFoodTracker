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

/** On-device label reading (AI-01), with no paid service: LABEL_OCR=local. */
export const isLocalLabelOcrEnabled = () => process.env.LABEL_OCR === "local";
const isAnthropicLabelScanningConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim() && process.env.LABEL_EXTRACTION_MODEL?.trim());
export const isLabelScanningConfigured = () => isAnthropicLabelScanningConfigured() || isLocalLabelOcrEnabled();
/** Where a scan will be read (RC-07), in the same order as getLabelExtractor: the provider if configured, else this server. */
export const labelProcessing = (): "provider" | "server" | null =>
  isAnthropicLabelScanningConfigured() ? "provider" : isLocalLabelOcrEnabled() ? "server" : null;

/**
 * The configured extractor, or null when scanning isn't set up. Both a key and a model are needed.
 * There's deliberately no default model: which one is accurate enough at what cost must be
 * measured on real labels, then chosen by whoever pays for it.
 */
export async function getLabelExtractor(): Promise<LabelExtractor | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const model = process.env.LABEL_EXTRACTION_MODEL?.trim();
  if (!apiKey || !model) {
    if (!isLocalLabelOcrEnabled()) return null;
    const { createLocalLabelExtractor } = await import("./local-ocr");
    return createLocalLabelExtractor();
  }
  const { createAnthropicLabelExtractor } = await import("./anthropic");
  return createAnthropicLabelExtractor({ apiKey, model, effort: process.env.LABEL_EXTRACTION_EFFORT?.trim() || undefined });
}

/**
 * Runs one provider request, once, with a hard deadline. The caller gets an answer on time even if
 * the request ignores the abort signal, but that work can't be cancelled from here. `onSettled` runs
 * exactly once when the request has really finished, which can be after this returns. Whoever limits
 * concurrency must count the work until then.
 */
export async function runProviderRequest(
  task: (signal: AbortSignal) => Promise<unknown>,
  { timeoutMs = LABEL_EXTRACTION_TIMEOUT_MS, onSettled }: { timeoutMs?: number; onSettled?: () => void } = {},
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, fail) => {
    timer = setTimeout(() => {
      fail(new LabelExtractionError("timeout"));
      controller.abort();
    }, timeoutMs);
  });
  const work = (async () => task(controller.signal))();
  const settled = () => onSettled?.();
  void work.then(settled, settled); // also keeps a failure after the deadline from going unhandled
  try {
    return await Promise.race([work, deadline]);
  } catch (err) {
    throw err instanceof LabelExtractionError ? err : new LabelExtractionError("unavailable");
  } finally {
    clearTimeout(timer);
  }
}

export const runLabelExtraction = (extractor: LabelExtractor, image: LabelImage, options: { timeoutMs?: number; onSettled?: () => void } = {}) =>
  runProviderRequest((signal) => extractor.extract(image, signal), options);
