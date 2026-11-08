// RC-07: what the label and meal pages say about where an image is read, and which reader each setting selects.
import { afterEach, describe, expect, it, vi } from "vitest";
import { LABEL_COPY, MEAL_COPY, processingOf, READ_LABEL } from "./processing";
import { labelProcessing } from "@/lib/server/labels/extractor";
import { mealProcessing } from "@/lib/server/meals/identifier";

const all = (o: object): string[] => Object.values(o).flatMap((v) => (typeof v === "string" ? [v] : all(v)));

describe("the wording", () => {
  it("on this server: says it's read here and goes nowhere else, never that it's sent to a provider", () => {
    for (const text of [...all(LABEL_COPY.server), MEAL_COPY.server.beforeIdentify]) {
      expect(text).toMatch(/this app's server/);
      expect(text).not.toMatch(/provider|sends? (this|the)/i);
    }
    expect(LABEL_COPY.server.beforeScan).toMatch(/isn't sent to any other company/);
  });
  it("with the provider: says the image is sent to it", () => {
    for (const text of [LABEL_COPY.provider.beforeScan, LABEL_COPY.provider.rescan, LABEL_COPY.provider.pdfSection, MEAL_COPY.provider.beforeIdentify]) {
      expect(text).toMatch(/sends (this|the|only the part)[^.]*(AI )?provider/);
    }
  });
  it("never claims an image is read on the phone or device, as it never is", () => {
    for (const text of [...all(LABEL_COPY), ...all(MEAL_COPY), ...all(READ_LABEL)]) expect(text).not.toMatch(/phone|device|browser/i);
  });
  it("names no product, model, version or address", () => {
    for (const text of [...all(LABEL_COPY), ...all(MEAL_COPY), ...all(READ_LABEL)]) {
      expect(text).not.toMatch(/tesseract|clip|anthropic|claude|onnx|huggingface|\d+\.\d+|https?:|localhost/i);
    }
  });
  it("labels a filled-in value by where it came from; only the provider's says AI", () => {
    expect(READ_LABEL).toEqual({ provider: "Read by AI", server: "Read by text recognition", "pdf-text": "Read from the PDF" });
  });
  it("a reader's id says where the work happened", () => {
    expect(processingOf("local:tesseract.js-6.0.1:eng")).toBe("server");
    expect(processingOf("local:clip-vit-base-patch32@6b7c523")).toBe("server");
    expect(processingOf("anthropic:some-model")).toBe("provider");
  });
});

describe("which reader each setting selects, as the extractor and identifier choose", () => {
  afterEach(() => vi.unstubAllEnvs());
  const set = (env: Record<string, string>) => {
    for (const k of ["ANTHROPIC_API_KEY", "LABEL_EXTRACTION_MODEL", "MEAL_IDENTIFICATION_MODEL", "LABEL_OCR", "MEAL_RECOGNITION"]) vi.stubEnv(k, env[k] ?? "");
  };
  it("nothing set: none, so no page says anything about where an image goes", () => {
    set({});
    expect([labelProcessing(), mealProcessing()]).toEqual([null, null]);
  });
  it("on-device only: this server", () => {
    set({ LABEL_OCR: "local", MEAL_RECOGNITION: "local" });
    expect([labelProcessing(), mealProcessing()]).toEqual(["server", "server"]);
  });
  it("the provider configured: the provider, even with on-device also on, as it takes precedence", () => {
    set({ ANTHROPIC_API_KEY: "k", LABEL_EXTRACTION_MODEL: "m", MEAL_IDENTIFICATION_MODEL: "m", LABEL_OCR: "local", MEAL_RECOGNITION: "local" });
    expect([labelProcessing(), mealProcessing()]).toEqual(["provider", "provider"]);
  });
  it("a key without a model doesn't select the provider", () => {
    set({ ANTHROPIC_API_KEY: "k", LABEL_OCR: "local", MEAL_RECOGNITION: "local" });
    expect([labelProcessing(), mealProcessing()]).toEqual(["server", "server"]);
  });
});
