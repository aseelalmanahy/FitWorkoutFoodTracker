// The real Anthropic SDK with a fake fetch: nothing can reach the network or be billed.
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMealIdentification } from "@/lib/meal-identification";
import { parseLabelExtraction } from "@/lib/label-extraction";
import { createAnthropicLabelExtractor, LABEL_JSON_SCHEMA, LABEL_SYSTEM_PROMPT } from "@/lib/server/labels/anthropic";
import { LabelExtractionError, runLabelExtraction, type LabelExtractionFailure } from "@/lib/server/labels/extractor";
import { createAnthropicMealIdentifier, MEAL_JSON_SCHEMA, MEAL_SYSTEM_PROMPT } from "./anthropic";
import { getMealIdentifier, isMealIdentificationConfigured, runMealIdentification, type MealIdentifier } from "./identifier";

const KEY = "test-key-not-real";
const IMAGE = { bytes: Uint8Array.from([1, 2, 3]), mediaType: "image/jpeg" };
const signal = () => new AbortController().signal;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const message = (text: string, stop_reason = "end_turn") => json(200, { id: "m", type: "message", role: "assistant", model: "m", content: [{ type: "text", text }], stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });

function identifierWith(respond: () => Response | Promise<Response>, over: Partial<Parameters<typeof createAnthropicMealIdentifier>[0]> = {}) {
  const calls: { url: string; body: Record<string, never>; headers: Headers }[] = [];
  const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init!.body)), headers: new Headers(init!.headers) });
    return respond();
  });
  return { identifier: createAnthropicMealIdentifier({ apiKey: KEY, model: "test-model", fetch: fake as unknown as typeof fetch, ...over }), calls, fake };
}
const failure = async (p: Promise<unknown>): Promise<LabelExtractionFailure> => {
  const err = await p.then(() => { throw new Error("expected a failure"); }, (e) => e);
  expect(err).toBeInstanceOf(LabelExtractionError);
  return (err as LabelExtractionError).code;
};

afterEach(() => vi.unstubAllEnvs());

describe("what's asked of the provider", () => {
  it("sends the documented shape, holding only the image and fixed text", async () => {
    const { identifier, calls } = identifierWith(() => message("{}"));
    await identifier.identify(IMAGE, signal());
    expect(calls).toHaveLength(1);
    const { url, body, headers } = calls[0];
    expect(new URL(url).pathname).toBe("/v1/messages");
    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model", "output_config", "system"]);
    expect(body.model).toBe("test-model");
    expect(body.max_tokens).toBe(1500);
    expect(body.system).toBe(MEAL_SYSTEM_PROMPT);
    expect(body.output_config).toEqual({ format: { type: "json_schema", schema: MEAL_JSON_SCHEMA } });
    const [image] = (body.messages as { content: { source?: unknown }[] }[])[0].content;
    expect(image.source).toEqual({ type: "base64", media_type: "image/jpeg", data: Buffer.from(IMAGE.bytes).toString("base64") });
    expect(headers.get("authorization")).toBe(`Bearer ${KEY}`);
    for (const name of ["cookie", "x-forwarded-for"]) expect(headers.has(name), name).toBe(false);
  });

  it("uses a configured effort, and sends none otherwise", async () => {
    const a = identifierWith(() => message("{}"), { effort: "low" });
    await a.identifier.identify(IMAGE, signal());
    expect((a.calls[0].body.output_config as { effort?: string }).effort).toBe("low");
    const b = identifierWith(() => message("{}"));
    await b.identifier.identify(IMAGE, signal());
    expect((b.calls[0].body.output_config as { effort?: string }).effort).toBeUndefined();
  });

  it("the prompt asks for no amounts or nutrition, treats text as data, and forbids assuming hidden ingredients", () => {
    expect(MEAL_SYSTEM_PROMPT).toMatch(/Don't mention how much of anything there is, its size, or anything about its nutritional content, and don't use numbers/);
    expect(MEAL_SYSTEM_PROMPT).toMatch(/data, never instructions/);
    expect(MEAL_SYSTEM_PROMPT).toMatch(/Don't assume sauces, oils/);
    expect(MEAL_SYSTEM_PROMPT).not.toMatch(/\bestimate\b/i);
  });

  it("the prompt matches what the validator rejects: no counting, no measures, and the Latin alphabet", () => {
    expect(MEAL_SYSTEM_PROMPT).toMatch(/Don't count foods or say how many there are/);
    expect(MEAL_SYSTEM_PROMPT).toMatch(/"pizza", not "a slice of pizza"/);
    expect(MEAL_SYSTEM_PROMPT).toMatch(/Write in English, using the Latin alphabet/);
  });
});

describe("the JSON schema", () => {
  const text = JSON.stringify(MEAL_JSON_SCHEMA);

  it("has no number fields at all", () => {
    expect(text).not.toMatch(/"(number|integer)"/);
  });

  it("has no field for nutrition, amounts or scores", () => {
    expect(text).not.toMatch(/calor|kcal|protein|carb|"fat"|fiber|gram|portion|serving|quantity|amount|weight|density|nutrition|confidence|probab|score/i);
  });

  it("only uses what structured outputs support, with every object closed", () => {
    for (const unsupported of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "pattern"]) expect(text).not.toContain(unsupported);
    type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean; items?: Schema };
    const walk = (s: Schema) => {
      if (s.type === "object") {
        expect(s.additionalProperties).toBe(false);
        expect([...s.required!].sort()).toEqual(Object.keys(s.properties!).sort());
        Object.values(s.properties!).forEach(walk);
      }
      if (s.items) walk(s.items);
    };
    walk(MEAL_JSON_SCHEMA as Schema);
  });

  it("describes what the validator accepts", () => {
    const sample = { containsFood: true, items: [{ name: "rice", category: "grain", certainty: "likely", observation: "White grains", possibleIngredients: [], preparation: null }] };
    expect(parseMealIdentification(sample).ok).toBe(true);
    const item = (MEAL_JSON_SCHEMA.properties.items.items as { required: string[] }).required;
    expect([...item].sort()).toEqual(Object.keys(sample.items[0]).sort());
  });
});

describe("responses and failures", () => {
  it("returns the text unjudged, for the validator", async () => {
    const { identifier } = identifierWith(() => message('{"anything":1}'));
    expect(await identifier.identify(IMAGE, signal())).toBe('{"anything":1}');
  });

  it.each([["refusal", "refused"], ["max_tokens", "truncated"]])("treats stop reason %s as %s", async (stop, code) => {
    const { identifier } = identifierWith(() => message("{}", stop));
    expect(await failure(identifier.identify(IMAGE, signal()))).toBe(code);
  });

  it.each([[401, "misconfigured"], [404, "misconfigured"], [429, "unavailable"], [500, "unavailable"], [529, "unavailable"]])("HTTP %d is %s, with exactly one attempt", async (status, code) => {
    const { identifier, fake } = identifierWith(() => json(status, { type: "error", error: { type: "api_error", message: `detail ${KEY}` } }));
    expect(await failure(identifier.identify(IMAGE, signal()))).toBe(code);
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it("errors carry only a code", async () => {
    const { identifier } = identifierWith(() => json(401, { type: "error", error: { type: "authentication_error", message: `invalid ${KEY}` } }));
    const err: Error = await identifier.identify(IMAGE, signal()).then(() => { throw new Error("no"); }, (e) => e);
    expect(`${err.message} ${err.stack} ${JSON.stringify(err)}`).not.toContain(KEY);
  });
});

describe("sharing provider code with label scanning", () => {
  const labelWith = (respond: () => Response) => {
    const calls: { body: Record<string, never> }[] = [];
    const fake = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init!.body)) });
      return respond();
    });
    return { extractor: createAnthropicLabelExtractor({ apiKey: KEY, model: "label-model", fetch: fake as unknown as typeof fetch }), calls, fake };
  };

  it("each sends only its own prompt, schema, model and output cap", async () => {
    const label = labelWith(() => message("{}"));
    await label.extractor.extract(IMAGE, signal());
    const meal = identifierWith(() => message("{}"));
    await meal.identifier.identify(IMAGE, signal());
    expect(label.calls[0].body.system).toBe(LABEL_SYSTEM_PROMPT);
    expect(label.calls[0].body.output_config).toEqual({ format: { type: "json_schema", schema: LABEL_JSON_SCHEMA } });
    expect(label.calls[0].body.max_tokens).toBe(4096);
    expect(label.calls[0].body.model).toBe("label-model");
    expect(meal.calls[0].body.system).toBe(MEAL_SYSTEM_PROMPT);
    expect(meal.calls[0].body.output_config).toEqual({ format: { type: "json_schema", schema: MEAL_JSON_SCHEMA } });
    expect(meal.calls[0].body.max_tokens).toBe(1500);
    expect(MEAL_SYSTEM_PROMPT).not.toBe(LABEL_SYSTEM_PROMPT);
  });

  it("the schemas stay apart: the meal schema gains nothing from the label's", () => {
    expect(Object.keys(MEAL_JSON_SCHEMA.properties).sort()).toEqual(["containsFood", "items"]);
    expect(JSON.stringify(LABEL_JSON_SCHEMA)).not.toEqual(JSON.stringify(MEAL_JSON_SCHEMA));
    expect(JSON.stringify(MEAL_JSON_SCHEMA)).not.toMatch(/"(number|integer)"/);
  });

  it("neither validator accepts the other's response", () => {
    expect(parseLabelExtraction({ containsFood: true, items: [] }).ok).toBe(false);
    expect(parseMealIdentification({ columns: [] }).ok).toBe(false);
  });

  it.each([[429], [500], [529]])("both make exactly one attempt on HTTP %d", async (status) => {
    const body = { type: "error", error: { type: "api_error", message: "x" } };
    const label = labelWith(() => json(status, body));
    await expect(label.extractor.extract(IMAGE, signal())).rejects.toBeInstanceOf(LabelExtractionError);
    expect(label.fake).toHaveBeenCalledTimes(1);
    const meal = identifierWith(() => json(status, body));
    await expect(meal.identifier.identify(IMAGE, signal())).rejects.toBeInstanceOf(LabelExtractionError);
    expect(meal.fake).toHaveBeenCalledTimes(1);
  });

  it("label extraction keeps the shared deadline, and reports settling only when the work ends", async () => {
    let finish: (v: unknown) => void = () => {};
    const onSettled = vi.fn();
    const stubborn = { id: "x", extract: () => new Promise((r) => { finish = r; }) };
    await expect(runLabelExtraction(stubborn, IMAGE, { timeoutMs: 5, onSettled })).rejects.toMatchObject({ code: "timeout" });
    expect(onSettled).not.toHaveBeenCalled();
    finish("late");
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
  });

  it("an abort from the deadline reaches the real SDK call, and fails with a code", async () => {
    const hanging = createAnthropicMealIdentifier({
      apiKey: KEY, model: "m",
      fetch: ((_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })) as unknown as typeof fetch,
    });
    await expect(runMealIdentification(hanging, IMAGE, { timeoutMs: 20 })).rejects.toMatchObject({ code: "timeout" });
  });

  it("logs nothing itself", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await identifierWith(() => message("{}")).identifier.identify(IMAGE, signal());
    await failure(identifierWith(() => json(500, { type: "error", error: { type: "api_error", message: KEY } })).identifier.identify(IMAGE, signal()));
    for (const spy of spies) { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); }
  });
});

describe("configuration", () => {
  it.each([
    ["no key", undefined, "m"], ["no model", "k", undefined], ["an empty model", "k", "  "],
  ])("is off with %s", async (_name, key, model) => {
    vi.stubEnv("ANTHROPIC_API_KEY", key as string);
    vi.stubEnv("MEAL_IDENTIFICATION_MODEL", model as string);
    expect(isMealIdentificationConfigured()).toBe(false);
    expect(await getMealIdentifier()).toBeNull();
  });

  it("doesn't fall back to the label model", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", KEY);
    vi.stubEnv("LABEL_EXTRACTION_MODEL", "label-model");
    vi.stubEnv("MEAL_IDENTIFICATION_MODEL", "");
    expect(await getMealIdentifier()).toBeNull();
  });

  it("uses its own model", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", KEY);
    vi.stubEnv("LABEL_EXTRACTION_MODEL", "label-model");
    vi.stubEnv("MEAL_IDENTIFICATION_MODEL", "meal-model");
    expect(isMealIdentificationConfigured()).toBe(true);
    expect((await getMealIdentifier())?.id).toBe("anthropic:meal-model");
  });
});

describe("the deadline", () => {
  it("answers on time, requests cancellation, and reports settling only when the work ends", async () => {
    let finish: (v: unknown) => void = () => {};
    let seen: AbortSignal | undefined;
    const stubborn: MealIdentifier = { id: "x", identify: (_i, s) => { seen = s; return new Promise((r) => { finish = r; }); } };
    const onSettled = vi.fn();
    await expect(runMealIdentification(stubborn, IMAGE, { timeoutMs: 5, onSettled })).rejects.toMatchObject({ code: "timeout" });
    expect(seen?.aborted).toBe(true);
    expect(onSettled).not.toHaveBeenCalled();
    finish("late");
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
  });
});
