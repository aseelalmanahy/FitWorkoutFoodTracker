// D1: the evaluation-only Ollama adapter, against a stand-in server on this machine. No Ollama is installed or called.
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseLabelExtraction } from "@/lib/label-extraction";
import { parseMealIdentification } from "@/lib/meal-identification";
import { goodLabel } from "@/test/label-fixtures";
import { createOllamaLabelExtractor, createOllamaMealIdentifier, LABEL_USER_PROMPT, MEAL_USER_PROMPT, ollamaUrlProblem } from "./ollama";

const image = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mediaType: "image/jpeg" };
let server: http.Server, url = "";
const seen: { body: Record<string, unknown>; path: string }[] = [];
let reply: (res: http.ServerResponse) => void = () => {};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => { raw += d; });
    req.on("end", () => { seen.push({ path: req.url ?? "", body: JSON.parse(raw) }); reply(res); });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
const answer = (status: number, body: unknown) => (res: http.ServerResponse) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };

describe("Ollama evaluation adapter", () => {
  it("sends the provider's instructions, its schema and the image to /api/chat, and returns the reply for the parser to judge", async () => {
    reply = answer(200, { message: { content: JSON.stringify(goodLabel()) }, done_reason: "stop" });
    seen.length = 0;
    const out = await createOllamaLabelExtractor({ model: "qwen2.5vl:7b", url }).extract(image, new AbortController().signal);
    expect(parseLabelExtraction(out).ok).toBe(true);
    const [{ path: p, body }] = seen;
    expect(p).toBe("/api/chat");
    expect(body).toMatchObject({ model: "qwen2.5vl:7b", stream: false, options: { temperature: 0 } });
    const messages = body.messages as { role: string; content: string; images?: string[] }[];
    expect(messages[0].role).toBe("system");
    expect(messages[1]).toMatchObject({ role: "user", content: LABEL_USER_PROMPT, images: [Buffer.from(image.bytes).toString("base64")] });
    expect((body.format as { type: string }).type).toBe("object");
  });
  it("meal suggestions go through the same path, and an answer with an amount is refused by the parser, not by trust", async () => {
    reply = answer(200, { message: { content: JSON.stringify({ containsFood: true, items: [{ name: "200 g rice", category: "grain", certainty: "likely", observation: "White grains", possibleIngredients: [], preparation: null }] }) } });
    const out = await createOllamaMealIdentifier({ model: "llava:7b", url }).identify(image, new AbortController().signal);
    expect(parseMealIdentification(out).ok).toBe(false);
    expect((seen.at(-1)!.body.messages as { content: string }[])[1].content).toBe(MEAL_USER_PROMPT);
  });
  it("failures become codes: a missing model, a server error, a cut-off answer, a reply without text", async () => {
    const extractor = createOllamaLabelExtractor({ model: "m", url });
    for (const [status, body, code] of [[404, { error: "model not found" }, "misconfigured"], [500, {}, "unavailable"], [200, { message: { content: "{" }, done_reason: "length" }, "truncated"], [200, { message: {} }, "invalid_response"]] as const) {
      reply = answer(status, body);
      await expect(extractor.extract(image, new AbortController().signal)).rejects.toMatchObject({ code });
    }
  });
  it("only an Ollama on this machine is accepted, so a photo can't leave it this way", () => {
    for (const ok of ["http://127.0.0.1:11434", "http://localhost:11434", "http://[::1]:11434"]) expect(ollamaUrlProblem(ok)).toBeNull();
    for (const bad of ["https://ollama.example.com", "http://192.168.1.5:11434", "http://127.0.0.1.example.com:11434", "http://u:p@127.0.0.1:11434", "http://127.0.0.1:11434/proxy", "ftp://127.0.0.1"]) expect(ollamaUrlProblem(bad), bad).not.toBeNull();
    expect(() => createOllamaLabelExtractor({ model: "m", url: "http://10.0.0.2:11434" })).toThrow(/this machine/);
    expect(() => createOllamaLabelExtractor({ model: "m; rm -rf", url })).toThrow(/model name/);
  });
  it("uses the provider adapters' user prompts word for word", () => {
    const labels = readFileSync(path.join(process.cwd(), "src/lib/server/labels/anthropic.ts"), "utf8");
    const meals = readFileSync(path.join(process.cwd(), "src/lib/server/meals/anthropic.ts"), "utf8");
    expect(labels).toContain(`const LABEL_USER_PROMPT = ${JSON.stringify(LABEL_USER_PROMPT)};`);
    expect(meals).toContain(`const MEAL_USER_PROMPT = ${JSON.stringify(MEAL_USER_PROMPT)};`);
  });
});
