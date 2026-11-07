// EMAIL-01: the Resend transport and its configuration. Mocked fetch only: no email is sent.
import { describe, expect, it, vi } from "vitest";
import { RESEND_ENDPOINT, resendTransport } from "./resend";
import { MailRejected, type MailMessage } from "./transport";
import { mailProvider, productionConfigProblems } from "../production-config";

const KEY = "re_FAKEfakeFAKEfake1234567890";
const FROM = "FitWorkoutFoodTracker <no-reply@example.com>";
const MESSAGE: MailMessage = { to: "person@example.com", kind: "password-reset", subject: "Reset your password", text: "Open https://app.example.invalid/reset-password#token=SECRET-TOKEN-123" };
const reply = (status: number, body = "{}") => vi.fn(async () => new Response(body, { status }));
const signal = () => new AbortController().signal;

describe("sending", () => {
  it("posts one message to the provider, with the key as a bearer token and the job's signal", async () => {
    const fetchImpl = reply(200, '{"id":"x"}');
    const s = signal();
    await resendTransport(KEY, FROM, fetchImpl).send(MESSAGE, s);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(init.signal).toBe(s);
    expect(JSON.parse(init.body as string)).toEqual({ from: FROM, to: ["person@example.com"], subject: "Reset your password", text: MESSAGE.text, tags: [{ name: "kind", value: "password-reset" }] });
  });

  it.each([400, 401, 403, 404, 422, 429])("a %i refusal is certainly not delivered: MailRejected, so the limits stop counting it", async (status) => {
    await expect(resendTransport(KEY, FROM, reply(status)).send(MESSAGE, signal())).rejects.toBeInstanceOf(MailRejected);
  });
  it.each([500, 502, 503])("a %i may or may not have been accepted: a plain error, which still counts", async (status) => {
    const err = await resendTransport(KEY, FROM, reply(status)).send(MESSAGE, signal()).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(MailRejected);
  });
  it("no answer at all is uncertain too", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("fetch failed"); });
    const err = await resendTransport(KEY, FROM, fetchImpl).send(MESSAGE, signal()).catch((e) => e);
    expect(err).not.toBeInstanceOf(MailRejected);
    expect(err.message).toBe("mail-provider-unreachable");
  });
  it("never puts the address, the link, the token or the key in an error, even when the provider echoes them", async () => {
    const echo = JSON.stringify({ message: `invalid to ${MESSAGE.to} ${MESSAGE.text} ${KEY}` });
    for (const status of [422, 500]) {
      const err = await resendTransport(KEY, FROM, reply(status, echo)).send(MESSAGE, signal()).catch((e) => e);
      for (const secret of [MESSAGE.to, "SECRET-TOKEN-123", KEY, "reset-password"]) expect(String(err.message)).not.toContain(secret);
    }
  });
});

describe("configuration", () => {
  const base = { NODE_ENV: "production", APP_ORIGIN: "https://app.example.invalid", DATABASE_URL: "postgresql://fit_app:fake-sentinel-password-5f3a9c1e@db.example.invalid:5432/fit_production?sslmode=require", TRUST_PROXY_HOPS: "1" };
  const ids = (env: Record<string, string | undefined>) => productionConfigProblems(env).map((p) => p.id);
  it("a complete provider configuration is accepted, and used", () => {
    const env = { ...base, MAIL_PROVIDER: "resend", RESEND_API_KEY: KEY, MAIL_FROM: FROM };
    expect(ids(env)).toEqual([]);
    expect(mailProvider(env)).toEqual({ name: "resend", apiKey: KEY, from: FROM });
  });
  it("no provider is fine, and means no email", () => {
    expect(ids(base)).toEqual([]);
    expect(mailProvider(base)).toBeNull();
  });
  it.each([
    ["an unknown provider", { MAIL_PROVIDER: "sendmail", RESEND_API_KEY: KEY, MAIL_FROM: FROM }, "mail-provider"],
    ["no key", { MAIL_PROVIDER: "resend", MAIL_FROM: FROM }, "mail-key"],
    ["a placeholder key", { MAIL_PROVIDER: "resend", RESEND_API_KEY: "changeme", MAIL_FROM: FROM }, "mail-key"],
    ["a key of another shape", { MAIL_PROVIDER: "resend", RESEND_API_KEY: "not-a-resend-key-abcdefghijklmnop", MAIL_FROM: FROM }, "mail-key"],
    ["no sender", { MAIL_PROVIDER: "resend", RESEND_API_KEY: KEY }, "mail-from"],
    ["a sender that isn't an address", { MAIL_PROVIDER: "resend", RESEND_API_KEY: KEY, MAIL_FROM: "no-reply" }, "mail-from"],
  ])("refuses to start with %s", (_label, over, id) => {
    expect(ids({ ...base, ...over })).toContain(id);
  });
  it("a designated test database's mail stays local whatever is configured, so tests never send real email", () => {
    expect(mailProvider({ FIT_LOCAL_TEST_SERVER: "1", DATABASE_URL: "postgresql://u:p@localhost:5432/fitdb_test_isolated", MAIL_PROVIDER: "resend", RESEND_API_KEY: KEY, MAIL_FROM: FROM })).toBeNull();
  });
  it("problems name the setting, never its value", () => {
    const text = JSON.stringify(productionConfigProblems({ ...base, MAIL_PROVIDER: "resend", RESEND_API_KEY: "not-a-resend-key-abcdefghijklmnop", MAIL_FROM: "x" }));
    expect(text).not.toContain("not-a-resend-key-abcdefghijklmnop");
  });
});
