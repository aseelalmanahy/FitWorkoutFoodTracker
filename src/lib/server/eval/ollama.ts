/**
 * D1, evaluation only: a label reader and a meal identifier backed by a local Ollama server, so a local vision model can
 * be measured on the same sets and scoring as the on-device readers and the provider. It isn't wired into the app.
 *
 * Same instructions and output schema as the provider adapters, so only the model differs. Its output is untrusted, as
 * any reader's: it must pass parseLabelExtraction or parseMealIdentification to count. Only an Ollama on this machine
 * (127.0.0.1, localhost or ::1) is accepted, so a photo can't leave it this way. Nothing is installed or downloaded
 * here: Ollama and a model are the owner's D1 decision.
 */
import { LABEL_JSON_SCHEMA, LABEL_SYSTEM_PROMPT } from "@/lib/server/labels/anthropic";
import { LabelExtractionError, type LabelExtractor, type LabelImage } from "@/lib/server/labels/extractor";
import { MEAL_JSON_SCHEMA, MEAL_SYSTEM_PROMPT } from "@/lib/server/meals/anthropic";
import type { MealIdentifier } from "@/lib/server/meals/identifier";

// The provider adapters' user prompts, word for word (a test checks they still match).
export const LABEL_USER_PROMPT = "Report the nutrition label in this image.";
export const MEAL_USER_PROMPT = "Identify the foods visible in this photo.";
export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Null when `url` is an Ollama on this machine. Otherwise why not. */
export function ollamaUrlProblem(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return "the Ollama address can't be parsed"; }
  if (u.protocol !== "http:") return "the Ollama address must be http on this machine";
  if (!LOOPBACK.has(u.hostname)) return "the Ollama address must be on this machine (127.0.0.1, localhost or ::1)";
  if (u.username || u.password || u.search || (u.pathname !== "/" && u.pathname !== "")) return "the Ollama address must be just the server, with nothing else in it";
  return null;
}

type Options = { model: string; url?: string; fetch?: typeof fetch };

function request(options: Options, system: string, user: string, schema: unknown) {
  const base = options.url ?? DEFAULT_OLLAMA_URL;
  const problem = ollamaUrlProblem(base);
  if (problem) throw new Error(problem);
  if (!/^[\w.:/-]{1,100}$/.test(options.model)) throw new Error("the Ollama model name isn't one this accepts");
  const send = options.fetch ?? fetch;
  return async (image: LabelImage, signal: AbortSignal): Promise<unknown> => {
    let res: Response;
    try {
      res = await send(new URL("/api/chat", base), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: options.model,
          stream: false,
          format: schema,
          options: { temperature: 0 },
          messages: [{ role: "system", content: system }, { role: "user", content: user, images: [Buffer.from(image.bytes).toString("base64")] }],
        }),
        signal,
        redirect: "error",
      });
    } catch (e) {
      if (signal.aborted) throw new LabelExtractionError("timeout");
      throw new LabelExtractionError(e instanceof TypeError ? "unavailable" : "invalid_response");
    }
    if (res.status === 404) throw new LabelExtractionError("misconfigured"); // no such model pulled
    if (!res.ok) throw new LabelExtractionError(res.status >= 500 ? "unavailable" : "refused");
    const body = (await res.json().catch(() => null)) as { message?: { content?: unknown }; done_reason?: string } | null;
    if (body?.done_reason === "length") throw new LabelExtractionError("truncated");
    const content = body?.message?.content;
    if (typeof content !== "string") throw new LabelExtractionError("invalid_response");
    return content; // still untrusted: the caller's parser decides
  };
}

export function createOllamaLabelExtractor(options: Options): LabelExtractor {
  return { id: `ollama:${options.model}`, extract: request(options, LABEL_SYSTEM_PROMPT, LABEL_USER_PROMPT, LABEL_JSON_SCHEMA) };
}

export function createOllamaMealIdentifier(options: Options): MealIdentifier {
  return { id: `ollama:${options.model}`, identify: request(options, MEAL_SYSTEM_PROMPT, MEAL_USER_PROMPT, MEAL_JSON_SCHEMA) };
}
