import "server-only";
import { MailRejected, type MailMessage, type MailTransport } from "./transport";

/**
 * Real email through Resend's HTTP API (EMAIL-01): one POST per message, no SDK. Configured only by
 * MAIL_PROVIDER=resend, RESEND_API_KEY and MAIL_FROM, which startup validates (production-config.ts).
 *
 * The transport's contract: throw MailRejected only when the message certainly wasn't and won't be delivered, so the
 * limits stop counting it; anything uncertain (a timeout, a dropped connection, a server error) is a plain Error, and
 * counts. Errors carry a fixed code only: never the address, the subject, the link or the key.
 */
export const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function resendTransport(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): MailTransport {
  return {
    async send(message: MailMessage, signal: AbortSignal) {
      let res: Response;
      try {
        res = await fetchImpl(RESEND_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text, tags: [{ name: "kind", value: message.kind }] }),
          signal,
          cache: "no-store",
        });
      } catch {
        // No answer: it may or may not have been accepted.
        throw new Error("mail-provider-unreachable");
      }
      // The body is drained and never read into an error, as it can echo the address.
      await res.arrayBuffer().catch(() => undefined);
      if (res.ok) return;
      // Refused outright (bad request, bad key, unverified sender, over a quota): nothing was sent.
      if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404 || res.status === 422 || res.status === 429) {
        throw new MailRejected(`mail-provider-refused-${res.status}`);
      }
      throw new Error(`mail-provider-error-${res.status}`);
    },
  };
}
