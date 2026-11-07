import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mailProvider, mailStubDir } from "../production-config";

export type MailKind = "signup" | "password-reset" | "password-changed";

export interface MailMessage {
  to: string;
  kind: MailKind;
  subject: string;
  text: string;
}

/**
 * Where a real provider plugs in, later and with approval. `signal` ends when the job's deadline passes, so a
 * provider can stop waiting. Throw MailRejected only when it's certain nothing was or will be delivered. Anything
 * else is treated as possibly delivered, so the limits keep counting it. Never put an address or token in an error.
 */
export interface MailTransport {
  send(message: MailMessage, signal: AbortSignal): Promise<void>;
}

/** Certainly not delivered, so the token it carried is useless and shouldn't count against the limits. */
export class MailRejected extends Error {}

/** Development and designated test databases only: tokens must never reach a log, so they go to a file. */
const fileStub = (dir: string): MailTransport => ({
  async send(message) {
    await mkdir(dir, { recursive: true });
    const name = `${Date.now()}-${randomBytes(6).toString("hex")}.json`;
    await writeFile(path.join(dir, name), JSON.stringify(message, null, 2), { mode: 0o600 });
  },
});

/** No provider exists yet, so a production server sends nothing, and says so once at startup. */
const notConfigured: MailTransport = {
  async send() {
    throw new MailRejected("not-configured");
  },
};

export function mailTransport(): MailTransport {
  const dir = mailStubDir();
  if (dir) return fileStub(dir);
  const provider = mailProvider();
  if (provider) {
    // Loaded only when configured. Startup has already checked these settings (production-config.ts).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resendTransport } = require("./resend") as typeof import("./resend");
    return resendTransport(provider.apiKey, provider.from);
  }
  return notConfigured;
}
